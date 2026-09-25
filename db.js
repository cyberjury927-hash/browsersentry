import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAX_EVENTS = 5000;

let pool = null;

function getDatabaseUrl() {
  return process.env.DATABASE_URL || '';
}

export function isDatabaseConfigured() {
  return Boolean(getDatabaseUrl());
}

export function getPool() {
  if (!pool) {
    const connectionString = getDatabaseUrl();
    if (!connectionString) {
      throw new Error('DATABASE_URL is not set. Add it to browsersentry-analytics/.env or Vercel env vars');
    }
    pool = new pg.Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
      max: 10
    });
  }
  return pool;
}

export async function initDatabase() {
  const client = await getPool().connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS analytics_events (
        id TEXT PRIMARY KEY,
        timestamp BIGINT NOT NULL,
        event_type TEXT,
        category TEXT,
        action TEXT,
        label TEXT,
        page TEXT,
        path TEXT,
        feature TEXT,
        element TEXT,
        detail TEXT,
        metadata JSONB,
        device_id TEXT,
        session_id TEXT,
        user_id TEXT,
        user_email TEXT,
        extension_version TEXT,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_analytics_events_timestamp
        ON analytics_events (timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_analytics_events_feature
        ON analytics_events (feature);
      CREATE INDEX IF NOT EXISTS idx_analytics_events_device_id
        ON analytics_events (device_id);
      CREATE INDEX IF NOT EXISTS idx_analytics_events_event_type
        ON analytics_events (event_type);
    `);
  } finally {
    client.release();
  }
}

function rowToEvent(row) {
  if (!row) return null;
  const payload = row.payload && typeof row.payload === 'object' ? row.payload : {};
  return {
    ...payload,
    id: row.id,
    timestamp: Number(row.timestamp),
    eventType: row.event_type || payload.eventType || '',
    category: row.category || payload.category || '',
    action: row.action || payload.action || '',
    label: row.label || payload.label || '',
    page: row.page || payload.page || '',
    path: row.path || payload.path || '',
    feature: row.feature || payload.feature || '',
    element: row.element || payload.element || '',
    detail: row.detail || payload.detail || '',
    metadata: row.metadata ?? payload.metadata ?? null,
    deviceId: row.device_id || payload.deviceId || '',
    sessionId: row.session_id || payload.sessionId || '',
    userId: row.user_id || payload.userId || null,
    userEmail: row.user_email || payload.userEmail || null,
    extensionVersion: row.extension_version || payload.extensionVersion || ''
  };
}

function eventToColumns(event) {
  return {
    id: event.id,
    timestamp: Number(event.timestamp) || Date.now(),
    event_type: event.eventType || event.type || 'event',
    category: event.category || 'usage',
    action: event.action || 'recorded',
    label: event.label || '',
    page: event.page || '',
    path: event.path || '',
    feature: event.feature || '',
    element: event.element || '',
    detail: event.detail || '',
    metadata: event.metadata && typeof event.metadata === 'object' ? event.metadata : null,
    device_id: event.deviceId || '',
    session_id: event.sessionId || '',
    user_id: event.userId || null,
    user_email: event.userEmail || null,
    extension_version: event.extensionVersion || '',
    payload: event
  };
}

export async function getEvents(limit = MAX_EVENTS) {
  const result = await getPool().query(
    `SELECT *
     FROM analytics_events
     ORDER BY timestamp DESC
     LIMIT $1`,
    [limit]
  );
  return result.rows.map(rowToEvent);
}

export async function getEventCount() {
  const result = await getPool().query('SELECT COUNT(*)::int AS count FROM analytics_events');
  return result.rows[0]?.count || 0;
}

export async function upsertEvent(event) {
  const columns = eventToColumns(event);
  await getPool().query(
    `INSERT INTO analytics_events (
      id, timestamp, event_type, category, action, label, page, path, feature,
      element, detail, metadata, device_id, session_id, user_id, user_email,
      extension_version, payload
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9,
      $10, $11, $12, $13, $14, $15, $16,
      $17, $18
    )
    ON CONFLICT (id) DO UPDATE SET
      timestamp = EXCLUDED.timestamp,
      event_type = EXCLUDED.event_type,
      category = EXCLUDED.category,
      action = EXCLUDED.action,
      label = EXCLUDED.label,
      page = EXCLUDED.page,
      path = EXCLUDED.path,
      feature = EXCLUDED.feature,
      element = EXCLUDED.element,
      detail = EXCLUDED.detail,
      metadata = EXCLUDED.metadata,
      device_id = EXCLUDED.device_id,
      session_id = EXCLUDED.session_id,
      user_id = EXCLUDED.user_id,
      user_email = EXCLUDED.user_email,
      extension_version = EXCLUDED.extension_version,
      payload = EXCLUDED.payload`,
    [
      columns.id,
      columns.timestamp,
      columns.event_type,
      columns.category,
      columns.action,
      columns.label,
      columns.page,
      columns.path,
      columns.feature,
      columns.element,
      columns.detail,
      columns.metadata,
      columns.device_id,
      columns.session_id,
      columns.user_id,
      columns.user_email,
      columns.extension_version,
      columns.payload
    ]
  );

  await trimEvents();
  return event;
}

async function trimEvents() {
  await getPool().query(
    `DELETE FROM analytics_events
     WHERE id NOT IN (
       SELECT id
       FROM analytics_events
       ORDER BY timestamp DESC
       LIMIT $1
     )`,
    [MAX_EVENTS]
  );
}

export async function clearEvents() {
  await getPool().query('DELETE FROM analytics_events');
}

export async function migrateLocalJsonIfNeeded() {
  const eventsFile = path.join(__dirname, 'data', 'events.json');
  if (!fs.existsSync(eventsFile)) return 0;

  const existingCount = await getEventCount();
  if (existingCount > 0) return 0;

  let parsed = [];
  try {
    parsed = JSON.parse(fs.readFileSync(eventsFile, 'utf8'));
  } catch {
    return 0;
  }
  if (!Array.isArray(parsed) || !parsed.length) return 0;

  for (const event of parsed.slice(0, MAX_EVENTS)) {
    if (!event?.id) continue;
    await upsertEvent(event);
  }

  return parsed.length;
}

export async function closeDatabase() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
