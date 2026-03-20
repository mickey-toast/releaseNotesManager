/**
 * Feature permissions per auth user. Missing DB row = use defaultAllowed.
 * Checked with the end-user Supabase JWT (RLS on grants; app_admins self-read).
 */

const PERMISSION_KEYS = {
  export: {
    label: 'Export & import',
    description:
      'Lets users download packaged content for external tools and re-import it. Denying this hides export actions in the UI and blocks the related API routes.',
    covers: [
      'Export for Claude / Cursor (zip with pages, style guide, manifest)',
      'Import from a previously exported zip',
      'Other bulk export entry points in the app (e.g. master export) that call these APIs'
    ],
    defaultAllowed: true
  },
  ai: {
    label: 'AI features',
    description:
      'Controls AI-assisted writing and analysis, including server-side style guide refresh. Denying this disables AI Hub, batch AI, and compliance/suggestion flows tied to the API.',
    covers: [
      'AI Hub: generate release notes, batch generate, suggestions, style compliance check',
      'Style guide auto-refresh (POST /api/style-guide/refresh)',
      'All /api/ai/* generation and analysis endpoints'
    ],
    defaultAllowed: true
  },
  launchnotes: {
    label: 'LaunchNotes',
    description:
      'Allows creating LaunchNotes drafts from the app using the user’s saved LaunchNotes credentials. Denying this hides LaunchNotes-oriented UI and blocks draft creation API calls.',
    covers: [
      'LaunchNotes tab and actions in the bulk editor',
      'Sending page content to LaunchNotes as drafts (POST /api/launchnotes/create-draft)'
    ],
    defaultAllowed: true
  }
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
