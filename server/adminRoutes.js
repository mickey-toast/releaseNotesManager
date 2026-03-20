const express = require('express');
const { getServiceClient, adminApiEnabled } = require('./supabaseServiceClient');
const { PERMISSION_KEYS } = require('./userPermissions');

const router = express.Router();

async function isUserAdmin(userId) {
  const sr = getServiceClient();
  if (!sr) return false;
  const { data } = await sr.from('app_admins').select('user_id').eq('user_id', userId).maybeSingle();
  return !!data;
}

async function requireAdmin(req, res, next) {
  try {
    if (!req.appUser?.id) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    if (!adminApiEnabled()) {
      return res.status(503).json({
        error: 'Admin API unavailable',
        details: 'Set SUPABASE_SERVICE_ROLE_KEY on the server (never expose it to the browser).'
      });
    }
    const ok = await isUserAdmin(req.appUser.id);
    if (!ok) {
      return res.status(403).json({ error: 'Forbidden', details: 'Admin access required' });
    }
    next();
  } catch (e) {
    console.error('[admin] requireAdmin', e);
    return res.status(500).json({ error: 'Admin check failed', details: e.message });
  }
}

router.get('/admin/permission-catalog', requireAdmin, (req, res) => {
  res.json({
    permissions: Object.entries(PERMISSION_KEYS).map(([key, v]) => ({
      key,
      label: v.label,
      description: v.description,
      covers: v.covers,
      defaultAllowed: v.defaultAllowed
    }))
  });
});

router.get('/admin/users', requireAdmin, async (req, res) => {
  const sr = getServiceClient();
  try {
    const allUsers = [];
    let page = 1;
    const perPage = 200;
    for (;;) {
      const { data, error } = await sr.auth.admin.listUsers({ page, perPage });
      if (error) throw error;
      const batch = data?.users || [];
      allUsers.push(...batch);
      if (batch.length < perPage) break;
      page += 1;
      if (page > 50) break;
    }

    const [{ data: adminRows }, { data: allGrants }] = await Promise.all([
      sr.from('app_admins').select('user_id'),
      sr.from('user_permission_grants').select('user_id, permission_key, allowed')
    ]);

    const adminSet = new Set((adminRows || []).map((r) => r.user_id));
    const grantsByUser = {};
    (allGrants || []).forEach((g) => {
      if (!grantsByUser[g.user_id]) grantsByUser[g.user_id] = {};
      grantsByUser[g.user_id][g.permission_key] = g.allowed;
    });

    const users = allUsers.map((u) => {
      const grantMap = grantsByUser[u.id] || {};
      const permissions = {};
      for (const key of Object.keys(PERMISSION_KEYS)) {
        permissions[key] =
          grantMap[key] !== undefined ? grantMap[key] : PERMISSION_KEYS[key].defaultAllowed;
      }
      return {
        id: u.id,
        email: u.email,
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at,
        email_confirmed_at: u.email_confirmed_at,
        is_admin: adminSet.has(u.id),
        permissions
      };
    });

    users.sort((a, b) => (a.email || '').localeCompare(b.email || ''));
    return res.json({ users });
  } catch (e) {
    console.error('[admin/users]', e);
    return res.status(500).json({ error: 'Failed to list users', details: e.message });
  }
});

router.post('/admin/invite', requireAdmin, async (req, res) => {
  const email = (req.body?.email || '').trim().toLowerCase();
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email required' });
  }
  const sr = getServiceClient();
  const redirectTo = process.env.PUBLIC_APP_URL || process.env.REACT_APP_PUBLIC_URL;
  try {
    const { data, error } = await sr.auth.admin.inviteUserByEmail(email, {
      redirectTo: redirectTo ? `${redirectTo.replace(/\/$/, '')}/` : undefined
    });
    if (error) throw error;
    return res.status(201).json({ ok: true, user: data?.user || null });
  } catch (e) {
    console.error('[admin/invite]', e);
    return res.status(400).json({ error: 'Invite failed', details: e.message });
  }
});

router.post('/admin/admins', requireAdmin, async (req, res) => {
  const userId = req.body?.userId;
  if (!userId || typeof userId !== 'string') {
    return res.status(400).json({ error: 'userId required' });
  }
  const sr = getServiceClient();
  try {
    const { error } = await sr.from('app_admins').upsert({ user_id: userId }, { onConflict: 'user_id' });
    if (error) throw error;
    return res.json({ ok: true });
  } catch (e) {
    console.error('[admin/admins POST]', e);
    return res.status(500).json({ error: 'Failed to add admin', details: e.message });
  }
});

router.delete('/admin/admins/:userId', requireAdmin, async (req, res) => {
  const { userId } = req.params;
  if (userId === req.appUser.id) {
    return res.status(400).json({ error: 'Cannot remove yourself as admin' });
  }
  const sr = getServiceClient();
  try {
    const { error } = await sr.from('app_admins').delete().eq('user_id', userId);
    if (error) throw error;
    return res.json({ ok: true });
  } catch (e) {
    console.error('[admin/admins DELETE]', e);
    return res.status(500).json({ error: 'Failed to remove admin', details: e.message });
  }
});

router.put('/admin/permissions', requireAdmin, async (req, res) => {
  const { userId, permissionKey, allowed } = req.body || {};
  if (!userId || typeof permissionKey !== 'string' || typeof allowed !== 'boolean') {
    return res.status(400).json({ error: 'userId, permissionKey (string), allowed (boolean) required' });
  }
  if (!PERMISSION_KEYS[permissionKey]) {
    return res.status(400).json({ error: 'Unknown permission key' });
  }
  const sr = getServiceClient();
  try {
    const defaults = PERMISSION_KEYS[permissionKey].defaultAllowed;
    if (allowed === defaults) {
      const { error: delErr } = await sr
        .from('user_permission_grants')
        .delete()
        .eq('user_id', userId)
        .eq('permission_key', permissionKey);
      if (delErr) throw delErr;
    } else {
      const { error } = await sr.from('user_permission_grants').upsert(
        {
          user_id: userId,
          permission_key: permissionKey,
          allowed,
          updated_at: new Date().toISOString()
        },
        { onConflict: 'user_id,permission_key' }
      );
      if (error) throw error;
    }
    const { data: grantRows } = await sr
      .from('user_permission_grants')
      .select('permission_key, allowed')
      .eq('user_id', userId);
    const grantMap = {};
    (grantRows || []).forEach((g) => {
      grantMap[g.permission_key] = g.allowed;
    });
    const permissions = {};
    for (const key of Object.keys(PERMISSION_KEYS)) {
      permissions[key] =
        grantMap[key] !== undefined ? grantMap[key] : PERMISSION_KEYS[key].defaultAllowed;
    }
    return res.json({ ok: true, permissions });
  } catch (e) {
    console.error('[admin/permissions]', e);
    return res.status(500).json({ error: 'Failed to update permission', details: e.message });
  }
});

module.exports = router;
