const { createUserSupabaseClient, cloudProfileEnabled } = require('./supabaseUserClient');
const { buildPermissionsForUser, PERMISSION_KEYS } = require('./userPermissions');

function requirePermission(permissionKey) {
  if (!PERMISSION_KEYS[permissionKey]) {
    throw new Error(`Unknown permission: ${permissionKey}`);
  }
  return async function permissionGate(req, res, next) {
    try {
      if (!cloudProfileEnabled() || !req.appUser?.id) {
        return next();
      }
      const sb = createUserSupabaseClient(req);
      const perms = await buildPermissionsForUser(sb, req.appUser.id);
      if (!perms[permissionKey]) {
        return res.status(403).json({
          error: 'Forbidden',
          code: 'PERMISSION_DENIED',
          permission: permissionKey,
          details: `This action requires the "${permissionKey}" permission.`
        });
      }
      next();
    } catch (err) {
      console.error('[permission]', permissionKey, err);
      return res.status(500).json({ error: 'Permission check failed', details: err.message });
    }
  };
}

module.exports = { requirePermission };
