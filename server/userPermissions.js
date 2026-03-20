/**
 * Feature permissions per auth user. Missing DB row = use defaultAllowed.
 * Checked with the end-user Supabase JWT (RLS on grants; app_admins self-read).
 */

const PERMISSION_KEYS = {
  export: { label: 'Exports (CSV, Claude/Cursor zip, import)', defaultAllowed: true },
  ai: { label: 'AI features (Hub, generation, style guide refresh)', defaultAllowed: true },
  launchnotes: { label: 'LaunchNotes (drafts, API)', defaultAllowed: true }
};

async function buildPermissionsForUser(supabaseUserClient, userId) {
  const [{ data: adminRow, error: e1 }, { data: grantRows, error: e2 }] = await Promise.all([
    supabaseUserClient.from('app_admins').select('user_id').eq('user_id', userId).maybeSingle(),
    supabaseUserClient
      .from('user_permission_grants')
      .select('permission_key, allowed')
      .eq('user_id', userId)
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  const grantMap = {};
  (grantRows || []).forEach((g) => {
    grantMap[g.permission_key] = g.allowed;
  });
  const out = { isAdmin: !!adminRow };
  for (const key of Object.keys(PERMISSION_KEYS)) {
    out[key] =
      grantMap[key] !== undefined ? grantMap[key] : PERMISSION_KEYS[key].defaultAllowed;
  }
  return out;
}

module.exports = { PERMISSION_KEYS, buildPermissionsForUser };
