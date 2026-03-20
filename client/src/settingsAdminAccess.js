/**
 * Who may see Settings → Admin (UI only). Server-side admin APIs still require `app_admins`.
 * Override with REACT_APP_SETTINGS_SUPER_ADMIN_EMAILS=comma@separated.com
 */
const DEFAULT_EMAILS = ['mickey.farmer@toasttab.com'];

function parseEnvEmailList() {
  const raw = process.env.REACT_APP_SETTINGS_SUPER_ADMIN_EMAILS;
  if (!raw || !String(raw).trim()) return null;
  return String(raw)
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function settingsSuperAdminEmails() {
  return parseEnvEmailList() || [...DEFAULT_EMAILS];
}

export function isSettingsSuperAdmin(email) {
  if (!email || typeof email !== 'string') return false;
  const e = email.trim().toLowerCase();
  return settingsSuperAdminEmails().includes(e);
}
