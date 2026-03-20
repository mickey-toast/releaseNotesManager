const { createClient } = require('@supabase/supabase-js');

function cloudProfileEnabled() {
  return !!(
    process.env.SUPABASE_JWT_SECRET &&
    process.env.SUPABASE_URL &&
    process.env.SUPABASE_ANON_KEY
  );
}

/**
 * Supabase client that acts as the signed-in user (RLS uses auth.uid() from this JWT).
 */
function createUserSupabaseClient(req) {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const authHeader = req.headers.authorization;
  if (!url || !anonKey || !authHeader) {
    throw new Error('Missing SUPABASE_URL, SUPABASE_ANON_KEY, or Authorization header');
  }
  return createClient(url, anonKey, {
    global: {
      headers: { Authorization: authHeader }
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });
}

module.exports = { cloudProfileEnabled, createUserSupabaseClient };
