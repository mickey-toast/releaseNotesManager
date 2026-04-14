import { authenticatedFetch } from './api';
import { supabase, isSupabaseAuthConfigured } from './supabaseClient';
import { getAuditCategoryPreferences, setAuditCategoryPreferences } from './activityLog';

function safeJsonParse(raw, fallback) {
  if (raw == null || raw === '') return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function applyCloudPayloadToBrowser(payload) {
  if (!payload || typeof payload !== 'object') return;
  if (payload.confluenceSettings && typeof payload.confluenceSettings === 'object') {
    localStorage.setItem('confluenceSettings', JSON.stringify(payload.confluenceSettings));
  }
  if (payload.jiraFieldPreferences && typeof payload.jiraFieldPreferences === 'object') {
    localStorage.setItem('jiraFieldPreferences', JSON.stringify(payload.jiraFieldPreferences));
  }
  if (Array.isArray(payload.quickCommentTemplates)) {
    localStorage.setItem('quickCommentTemplates', JSON.stringify(payload.quickCommentTemplates));
  }
  if (Array.isArray(payload.notificationRules)) {
    localStorage.setItem('notificationRules', JSON.stringify(payload.notificationRules));
  }
  if (payload.notificationDeliveryLog && typeof payload.notificationDeliveryLog === 'object') {
    localStorage.setItem('notificationDeliveryLog', JSON.stringify(payload.notificationDeliveryLog));
  }
  if (payload.auditCategoryPreferences && typeof payload.auditCategoryPreferences === 'object') {
    setAuditCategoryPreferences(payload.auditCategoryPreferences);
  }
}

/**
 * Pull saved settings from Postgres (via Express) into localStorage after login.
 */
export async function hydrateSettingsFromCloud() {
  if (!isSupabaseAuthConfigured() || !supabase) return;
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return;
  try {
    const res = await authenticatedFetch('/api/me/profile');
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      if (res.status === 404 && data && data.cloudProfile === false) return;
      return;
    }
    if (!data.payload || !data.payload.confluenceSettings) return;
    applyCloudPayloadToBrowser(data.payload);
    window.dispatchEvent(new Event('settingsSaved'));
  } catch (e) {
    console.warn('[Cloud profile] hydrate failed', e);
  }
}

/**
 * Push current browser settings to Postgres. Call after Settings modal saves (localStorage already updated).
 * @returns {null|boolean} null = cloud sync not in use; true/false = success
 */
export async function saveSettingsProfileToCloud(confluenceSettings) {
  if (!isSupabaseAuthConfigured() || !supabase) return null;
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;
  const payload = {
    confluenceSettings,
    jiraFieldPreferences: safeJsonParse(localStorage.getItem('jiraFieldPreferences'), {}),
    quickCommentTemplates: safeJsonParse(localStorage.getItem('quickCommentTemplates'), []),
    auditCategoryPreferences: getAuditCategoryPreferences(),
    notificationRules: safeJsonParse(localStorage.getItem('notificationRules'), []),
    notificationDeliveryLog: (() => {
      const raw = safeJsonParse(localStorage.getItem('notificationDeliveryLog'), {});
      return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    })()
  };
  try {
    const res = await authenticatedFetch('/api/me/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return res.ok;
  } catch (e) {
    console.warn('[Cloud profile] save failed', e);
    return false;
  }
}
