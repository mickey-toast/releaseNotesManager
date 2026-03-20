const express = require('express');
const { cloudProfileEnabled, createUserSupabaseClient } = require('./supabaseUserClient');

const router = express.Router();

const MAX_DESC = 2000;
const MAX_CAT = 128;
const MAX_DETAILS_BYTES = 48_000;

router.post('/audit-log', async (req, res) => {
  if (!cloudProfileEnabled()) {
    return res.status(404).json({ auditLog: false });
  }
  if (!req.appUser?.id) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const { category, description, details } = req.body || {};
  if (typeof category !== 'string' || !category.trim()) {
    return res.status(400).json({ error: 'category is required' });
  }
  if (typeof description !== 'string' || !description.trim()) {
    return res.status(400).json({ error: 'description is required' });
  }
  const cat = category.trim().slice(0, MAX_CAT);
  const desc = description.trim().slice(0, MAX_DESC);
  let detailsJson = null;
  if (details != null) {
    if (typeof details !== 'object' || Array.isArray(details)) {
      return res.status(400).json({ error: 'details must be a JSON object' });
    }
    try {
      const raw = JSON.stringify(details);
      if (raw.length > MAX_DETAILS_BYTES) {
        return res.status(413).json({ error: 'details too large' });
      }
      detailsJson = details;
    } catch {
      return res.status(400).json({ error: 'details must be serializable' });
    }
  }
  try {
    const sb = createUserSupabaseClient(req);
    const { error } = await sb.from('app_audit_log').insert({
      user_id: req.appUser.id,
      user_email: req.appUser.email || '',
      category: cat,
      description: desc,
      details: detailsJson
    });
    if (error) {
      console.error('[app_audit_log] insert', error);
      return res.status(500).json({ error: 'Failed to write audit entry', details: error.message });
    }
    return res.status(201).json({ ok: true });
  } catch (e) {
    console.error('[app_audit_log] post', e);
    return res.status(500).json({ error: 'Failed to write audit entry', details: e.message });
  }
});

router.get('/audit-log', async (req, res) => {
  if (!cloudProfileEnabled()) {
    return res.status(404).json({ auditLog: false, entries: [] });
  }
  if (!req.appUser?.id) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  let limit = parseInt(req.query.limit, 10);
  if (Number.isNaN(limit) || limit < 1) limit = 200;
  if (limit > 500) limit = 500;
  try {
    const sb = createUserSupabaseClient(req);
    const { data, error } = await sb
      .from('app_audit_log')
      .select('id, created_at, user_id, user_email, category, description, details')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) {
      console.error('[app_audit_log] select', error);
      return res.status(500).json({ error: 'Failed to load audit log', details: error.message });
    }
    return res.json({ entries: data || [] });
  } catch (e) {
    console.error('[app_audit_log] get', e);
    return res.status(500).json({ error: 'Failed to load audit log', details: e.message });
  }
});

module.exports = router;
