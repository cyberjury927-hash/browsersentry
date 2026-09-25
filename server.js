import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  clearSessionCookie,
  createSessionToken,
  getAuthConfigStatus,
  getSessionFromRequest,
  isAuthConfigured,
  requireAuth,
  setSessionCookie,
  verifyCredentials
} from './auth.js';
import {
  clearEvents,
  closeDatabase,
  getEventCount,
  getEvents,
  initDatabase,
  isDatabaseConfigured,
  migrateLocalJsonIfNeeded,
  upsertEvent
} from './db.js';
import { computeMetrics } from './metrics.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT) || 3847;
const IS_VERCEL = Boolean(process.env.VERCEL);

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const sseClients = new Set();
let dbReady = false;
let dbInitPromise = null;

async function ensureDatabase(_req, res, next) {
  try {
    if (!isDatabaseConfigured()) {
      throw new Error('DATABASE_URL is not set. Add it in Vercel project settings or browsersentry-analytics/.env');
    }
    if (dbReady) {
      next();
      return;
    }
    if (!dbInitPromise) {
      dbInitPromise = (async () => {
        await initDatabase();
        if (!IS_VERCEL) {
          const migrated = await migrateLocalJsonIfNeeded();
          if (migrated > 0) {
            console.log(`[analytics] Migrated ${migrated} local JSON events into Supabase.`);
          }
        }
        dbReady = true;
      })();
    }
    await dbInitPromise;
    next();
  } catch (error) {
    res.status(503).json({ ok: false, error: error.message });
  }
}

function broadcast(eventName, payload) {
  const data = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of sseClients) {
    res.write(data);
  }
}

app.get('/api/auth/status', (_req, res) => {
  const session = getSessionFromRequest(_req);
  res.json({
    ok: true,
    authConfigured: isAuthConfigured(),
    authenticated: Boolean(session),
    user: session?.user || null,
    env: getAuthConfigStatus()
  });
});

app.post('/api/login', (req, res) => {
  if (!isAuthConfigured()) {
    res.status(503).json({
      ok: false,
      error: 'Dashboard auth is not configured. Set AUTH_USERNAME, AUTH_PASSWORD, and AUTH_SECRET.'
    });
    return;
  }

  const { username, password } = req.body || {};
  if (!verifyCredentials(username, password)) {
    res.status(401).json({ ok: false, error: 'Invalid username or password' });
    return;
  }

  setSessionCookie(res, createSessionToken(username));
  res.json({ ok: true, user: username });
});

app.post('/api/logout', (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get('/login.html', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'login.html'));
});

app.get('/login.js', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'login.js'));
});

app.get('/styles.css', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'styles.css'));
});

app.get('/api/health', ensureDatabase, async (_req, res) => {
  try {
    const count = await getEventCount();
    res.json({
      ok: true,
      events: count,
      port: PORT,
      storage: 'supabase-postgres',
      authConfigured: isAuthConfigured()
    });
  } catch (error) {
    res.status(503).json({ ok: false, error: error.message });
  }
});

app.post('/api/events', ensureDatabase, async (req, res) => {
  const event = req.body;
  if (!event || typeof event !== 'object') {
    res.status(400).json({ error: 'Invalid event payload' });
    return;
  }
  if (!event.id) event.id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  if (!event.timestamp) event.timestamp = Date.now();

  try {
    await upsertEvent(event);
    broadcast('event', event);
    res.status(201).json({ success: true, id: event.id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/', (req, res) => {
  if (!isAuthConfigured() || !getSessionFromRequest(req)) {
    res.redirect('/login.html');
    return;
  }
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.use(requireAuth);
app.use(ensureDatabase);

app.get('/api/events', async (_req, res) => {
  try {
    const events = await getEvents();
    res.json({ events });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/metrics', async (_req, res) => {
  try {
    const events = await getEvents();
    res.json(computeMetrics(events));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/events', async (_req, res) => {
  try {
    await clearEvents();
    broadcast('clear', { cleared: true });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/events/stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  try {
    const events = await getEvents();
    res.write(`event: snapshot\ndata: ${JSON.stringify({ events })}\n\n`);
  } catch (error) {
    res.write(`event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`);
    res.end();
    return;
  }

  if (IS_VERCEL) {
    res.end();
    return;
  }

  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

app.use(express.static(PUBLIC_DIR, { index: false }));

app.use((err, _req, res, _next) => {
  console.error('[analytics] Unhandled error:', err);
  if (res.headersSent) return;
  res.status(500).json({ ok: false, error: 'Internal server error' });
});

async function startLocalServer() {
  if (!isDatabaseConfigured()) {
    console.error('[analytics] Missing DATABASE_URL.');
    console.error('[analytics] Copy .env.example to .env and add your Supabase password.');
    process.exit(1);
  }

  if (!isAuthConfigured()) {
    console.warn('[analytics] Auth env vars missing. Dashboard login will be disabled until configured.');
  }

  try {
    await initDatabase();
    const migrated = await migrateLocalJsonIfNeeded();
    if (migrated > 0) {
      console.log(`[analytics] Migrated ${migrated} local JSON events into Supabase.`);
    }
    dbReady = true;
  } catch (error) {
    console.error('[analytics] Failed to initialize database:', error.message);
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`BrowserSentry analytics dashboard → http://localhost:${PORT}`);
    console.log(`Database storage          → Supabase session pooler`);
    console.log(`API health check          → http://localhost:${PORT}/api/health`);
  });
}

if (!IS_VERCEL) {
  startLocalServer().catch(error => {
    console.error('[analytics] Failed to start:', error.message);
    process.exit(1);
  });

  process.on('SIGINT', async () => {
    await closeDatabase();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await closeDatabase();
    process.exit(0);
  });
}

export default app;
