const jwt = require('jsonwebtoken');
const { createRemoteJWKSet, jwtVerify } = require('jose');

function normalizeDomainSuffix(raw) {
  const s = (raw || '@toasttab.com').trim().toLowerCase();
  return s.startsWith('@') ? s : `@${s}`;
}

function decodeJwtHeader(token) {
  try {
    const [h] = token.split('.');
    if (!h) return null;
    const json = Buffer.from(h, 'base64url').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

const jwksByOrigin = new Map();

function remoteJWKSetForSupabaseUrl(supabaseUrl) {
  const base = supabaseUrl.replace(/\/$/, '');
  const jwksUrl = `${base}/auth/v1/.well-known/jwks.json`;
  if (!jwksByOrigin.has(jwksUrl)) {
    jwksByOrigin.set(jwksUrl, createRemoteJWKSet(new URL(jwksUrl)));
  }
  return jwksByOrigin.get(jwksUrl);
}

/**
 * Verify Supabase Auth access token. Newer projects use asymmetric keys (ES256, RS256, …)
 * verified via JWKS; legacy projects use HS256 with JWT secret.
 */
async function verifySupabaseAccessToken(token) {
  const secret = process.env.SUPABASE_JWT_SECRET;
  const supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const header = decodeJwtHeader(token);
  const alg = header?.alg || '';

  if (alg === 'HS256' && secret) {
    return jwt.verify(token, secret, { algorithms: ['HS256'] });
  }

  if (supabaseUrl) {
    const JWKS = remoteJWKSetForSupabaseUrl(supabaseUrl);
    const issuer = `${supabaseUrl}/auth/v1`;
    const { payload } = await jwtVerify(token, JWKS, { issuer });
    return payload;
  }

  if (alg === 'HS256') {
    throw new Error('SUPABASE_JWT_SECRET is required for HS256 tokens');
  }
  throw new Error(
    'SUPABASE_URL is required to verify asymmetric (e.g. RS256) Supabase JWTs. Add it to server .env.'
  );
}

/**
 * When SUPABASE_JWT_SECRET is set, all /api routes require a valid Supabase
 * access token and an allowed email domain. When unset (local dev / Electron
 * without auth), requests pass through unchanged.
 *
 * Tokens signed with asymmetric keys (current Supabase default) are verified
 * using JWKS at SUPABASE_URL/auth/v1/.well-known/jwks.json — set SUPABASE_URL
 * on the server alongside SUPABASE_JWT_SECRET.
 */
function requireSupabaseAuth(req, res, next) {
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) {
    return next();
  }

  const auth = req.headers.authorization || '';
  const match = auth.match(/^Bearer\s+(\S+)$/i);
  if (!match) {
    return res.status(401).json({
      error: 'Unauthorized',
      details: 'Sign in required. Missing Authorization bearer token.'
    });
  }

  const token = match[1];

  (async () => {
    let payload;
    try {
      payload = await verifySupabaseAccessToken(token);
    } catch (err) {
      const msg = err?.message || String(err);
      if (
        msg.includes('SUPABASE_URL is required') ||
        msg.includes('SUPABASE_JWT_SECRET is required')
      ) {
        console.error('[authMiddleware] Misconfiguration:', msg);
        return res.status(500).json({
          error: 'Server misconfiguration',
          details: msg
        });
      }
      return res.status(401).json({
        error: 'Unauthorized',
        details: 'Invalid or expired session. Sign in again.'
      });
    }

    const email = String(payload.email || '')
      .toLowerCase()
      .trim();
    const suffix = normalizeDomainSuffix(process.env.ALLOWED_EMAIL_DOMAIN);
    if (!email || !email.endsWith(suffix)) {
      return res.status(403).json({
        error: 'Forbidden',
        details: `Only ${suffix} accounts may use this app.`
      });
    }

    req.appUser = { id: String(payload.sub), email };
    next();
  })().catch((err) => {
    console.error('[authMiddleware]', err);
    next(err);
  });
}

module.exports = { requireSupabaseAuth };
