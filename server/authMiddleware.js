const jwt = require('jsonwebtoken');

function normalizeDomainSuffix(raw) {
  const s = (raw || '@toasttab.com').trim().toLowerCase();
  return s.startsWith('@') ? s : `@${s}`;
}

/**
 * When SUPABASE_JWT_SECRET is set, all /api routes require a valid Supabase
 * access token and an allowed email domain. When unset (local dev / Electron
 * without auth), requests pass through unchanged.
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

  let payload;
  try {
    payload = jwt.verify(match[1], secret, { algorithms: ['HS256'] });
  } catch (err) {
    return res.status(401).json({
      error: 'Unauthorized',
      details: 'Invalid or expired session. Sign in again.'
    });
  }

  const email = (payload.email || '').toLowerCase().trim();
  const suffix = normalizeDomainSuffix(process.env.ALLOWED_EMAIL_DOMAIN);
  if (!email || !email.endsWith(suffix)) {
    return res.status(403).json({
      error: 'Forbidden',
      details: `Only ${suffix} accounts may use this app.`
    });
  }

  req.appUser = { id: payload.sub, email };
  next();
}

module.exports = { requireSupabaseAuth };
