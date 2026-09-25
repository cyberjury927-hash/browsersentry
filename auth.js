import crypto from 'crypto';

const SESSION_COOKIE = 'bs_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function env(name) {
  return (process.env[name] || '').trim();
}

export function isAuthConfigured() {
  return Boolean(env('AUTH_USERNAME') && env('AUTH_PASSWORD') && env('AUTH_SECRET'));
}

export function getAuthConfigStatus() {
  return {
    hasUsername: Boolean(env('AUTH_USERNAME')),
    hasPassword: Boolean(env('AUTH_PASSWORD')),
    hasSecret: Boolean(env('AUTH_SECRET'))
  };
}

function getSecret() {
  const secret = env('AUTH_SECRET');
  if (!secret) {
    throw new Error('AUTH_SECRET is not set');
  }
  return secret;
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export function verifyCredentials(username, password) {
  if (!isAuthConfigured()) return false;
  const expectedUser = env('AUTH_USERNAME');
  const expectedPass = env('AUTH_PASSWORD');
  const userOk = safeEqual(String(username || ''), expectedUser);
  const passOk = safeEqual(String(password || ''), expectedPass);
  return userOk && passOk;
}

export function createSessionToken(username) {
  const payload = {
    user: username,
    exp: Date.now() + SESSION_TTL_MS
  };
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', getSecret()).update(data).digest('base64url');
  return `${data}.${signature}`;
}

export function verifySessionToken(token) {
  if (!token || !isAuthConfigured()) return null;
  const [data, signature] = String(token).split('.');
  if (!data || !signature) return null;

  const expected = crypto.createHmac('sha256', getSecret()).update(data).digest('base64url');
  if (!safeEqual(signature, expected)) return null;

  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    if (!payload?.user || !payload?.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function parseCookies(req) {
  const header = req.headers.cookie || '';
  return header.split(';').reduce((cookies, part) => {
    const trimmed = part.trim();
    if (!trimmed) return cookies;
    const separator = trimmed.indexOf('=');
    if (separator === -1) return cookies;
    const key = trimmed.slice(0, separator);
    const value = trimmed.slice(separator + 1);
    cookies[key] = decodeURIComponent(value);
    return cookies;
  }, {});
}

export function getSessionFromRequest(req) {
  const cookies = parseCookies(req);
  return verifySessionToken(cookies[SESSION_COOKIE]);
}

export function setSessionCookie(res, token) {
  const secure = Boolean(process.env.VERCEL || process.env.NODE_ENV === 'production');
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`
  ];
  if (secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function clearSessionCookie(res) {
  const secure = Boolean(process.env.VERCEL || process.env.NODE_ENV === 'production');
  const parts = [
    `${SESSION_COOKIE}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0'
  ];
  if (secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function requireAuth(req, res, next) {
  if (!isAuthConfigured()) {
    if (req.path.startsWith('/api/')) {
      res.status(503).json({
        ok: false,
        error: 'Dashboard auth is not configured. Set AUTH_USERNAME, AUTH_PASSWORD, and AUTH_SECRET, then redeploy.'
      });
      return;
    }
    res.redirect('/login.html?error=auth-not-configured');
    return;
  }

  const session = getSessionFromRequest(req);
  if (!session) {
    if (req.path.startsWith('/api/')) {
      res.status(401).json({ ok: false, error: 'Authentication required' });
      return;
    }
    res.redirect('/login.html');
    return;
  }

  req.user = session.user;
  next();
}
