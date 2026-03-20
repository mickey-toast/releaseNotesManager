const express = require('express');
const { cloudProfileEnabled, createUserSupabaseClient } = require('./supabaseUserClient');

const router = express.Router();

const MAX_PAYLOAD_BYTES = 1_500_000;

router.get('/me/profile', async (req, res) => {
  if (!cloudProfileEnabled()) {
    return res.status(404).json({ cloudProfile: false });
  }
  if (!req.appUser?.id) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const sb = createUserSupabaseClient(req);
    const { data, error } = await sb
      .from('user_app_profile')
      .select('payload, updated_at')
      .eq('user_id', req.appUser.id)
      .maybeSingle();
    if (error) {
      console.error('[user_app_profile] select', error);
      return res.status(500).json({ error: 'Failed to load profile', details: error.message });
    }
    if (!data) {
      return res.json({ payload: null, updated_at: null });
    }
    return res.json({ payload: data.payload, updated_at: data.updated_at });
  } catch (e) {
    console.error('[user_app_profile] get', e);
    return res.status(500).json({ error: 'Failed to load profile', details: e.message });
  }
});

router.put('/me/profile', async (req, res) => {
  if (!cloudProfileEnabled()) {
    return res.status(404).json({ cloudProfile: false });
  }
  if (!req.appUser?.id) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return res.status(400).json({ error: 'Body must be a JSON object' });
  }
  if (!body.confluenceSettings || typeof body.confluenceSettings !== 'object') {
    return res.status(400).json({ error: 'confluenceSettings object is required' });
  }
  try {
    const raw = JSON.stringify(body);
    if (raw.length > MAX_PAYLOAD_BYTES) {
      return res.status(413).json({ error: 'Profile payload too large' });
    }
  } catch (e) {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }
  try {
    const sb = createUserSupabaseClient(req);
    const { error } = await sb.from('user_app_profile').upsert(
      { user_id: req.appUser.id, payload: body },
      { onConflict: 'user_id' }
    );
    if (error) {
      console.error('[user_app_profile] upsert', error);
      return res.status(500).json({ error: 'Failed to save profile', details: error.message });
    }
    return res.json({ ok: true });
  } catch (e) {
    console.error('[user_app_profile] put', e);
    return res.status(500).json({ error: 'Failed to save profile', details: e.message });
  }
});

module.exports = router;
