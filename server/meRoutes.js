const express = require('express');
const { createUserSupabaseClient, cloudProfileEnabled } = require('./supabaseUserClient');
const { PERMISSION_KEYS, buildPermissionsForUser } = require('./userPermissions');

const router = express.Router();

router.get('/me/permissions', async (req, res) => {
  if (!cloudProfileEnabled() || !req.appUser?.id) {
    const open = Object.fromEntries(Object.keys(PERMISSION_KEYS).map((k) => [k, true]));
    return res.json({ loaded: true, isAdmin: false, ...open });
  }
  try {
    const sb = createUserSupabaseClient(req);
    const perms = await buildPermissionsForUser(sb, req.appUser.id);
    return res.json({ loaded: true, ...perms });
  } catch (e) {
    console.error('[me/permissions]', e);
    return res.status(500).json({ error: 'Failed to load permissions', details: e.message });
  }
});

module.exports = router;
