/**
 * Activity / audit log for Release Notes Manager.
 * Persists to localStorage. Used for showing usage and exporting work summary.
 * When signed in with Supabase, mirrors each entry to Postgres (team audit in Troubleshooting).
 */

import { getAppAuthHeaders } from './api';

const STORAGE_KEY = 'releaseManagerActivityLog';
const PREFERENCES_KEY = 'releaseManagerAuditCategories';
const MAX_ENTRIES = 2000;

export const ACTIVITY_CATEGORIES = [
  { id: 'page_move', label: 'Page moves', default: true },
  { id: 'sync_confluence', label: 'Sync from Confluence', default: true },
  { id: 'refresh_jira', label: 'Refresh from Jira', default: true },
  { id: 'comment_confluence', label: 'Confluence comments', default: true },
  { id: 'comment_jira', label: 'Jira comments', default: true },
  { id: 'jira_update', label: 'Jira updates (labels)', default: true },
  { id: 'launchnotes', label: 'LaunchNotes', default: true },
  { id: 'ai_generate', label: 'AI release note generation', default: true },
  { id: 'ai_suggestions', label: 'AI suggestions', default: true },
  { id: 'ai_compliance', label: 'AI compliance check', default: true },
  { id: 'assignment', label: 'Assign / unassign pages', default: true },
  { id: 'style_guide', label: 'Style guide refresh', default: true },
  { id: 'settings', label: 'Settings changes', default: false },
  { id: 'export', label: 'Exports / imports', default: true }
];

function queueServerAudit(category, description, details) {
  if (typeof window === 'undefined') return;
  void (async () => {
    try {
      const auth = await getAppAuthHeaders();
      if (!auth.Authorization) return;
      await fetch('/api/audit-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify({
          category,
          description,
          details: details && typeof details === 'object' && !Array.isArray(details) ? details : {}
        })
      });
    } catch (_) {
      /* never break the app */
    }
  })();
}

function getPreferences() {
  try {
    const raw = localStorage.getItem(PREFERENCES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const out = {};
      ACTIVITY_CATEGORIES.forEach(c => {
        out[c.id] = parsed[c.id] !== undefined ? parsed[c.id] : c.default;
      });
      return out;
    }
  } catch (_) {}
  const out = {};
  ACTIVITY_CATEGORIES.forEach(c => { out[c.id] = c.default; });
  return out;
}

export function getAuditCategoryPreferences() {
  return getPreferences();
}

export function setAuditCategoryPreferences(prefs) {
  localStorage.setItem(PREFERENCES_KEY, JSON.stringify(prefs));
}

function getEntriesRaw() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return [];
}

function setEntriesRaw(entries) {
  try {
    const trimmed = entries.slice(-MAX_ENTRIES);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch (e) {
    console.warn('[Activity log] Failed to save:', e);
  }
}

/** Total number of entries in the log (unfiltered). For diagnostics. */
export function getActivityLogTotalCount() {
  return getEntriesRaw().length;
}

/**
 * Log an activity. Only persists if the category is enabled in preferences.
 * (We only skip when explicitly false, so missing/undefined = log.)
 * Wrapped in try/catch so logging never breaks the app.
 * @param {string} category - One of ACTIVITY_CATEGORIES[].id
 * @param {string} description - Short label (e.g. "Moved page to Published")
 * @param {object} [details] - Optional extra info (e.g. { pageTitle, count, targetStatus })
 */
export function logActivity(category, description, details = {}) {
  try {
    const prefs = getPreferences();
    if (prefs[category] === false) return;

    const entry = {
      ts: new Date().toISOString(),
      category,
      description,
      ...details
    };
    const entries = getEntriesRaw();
    entries.push(entry);
    setEntriesRaw(entries);
    queueServerAudit(category, description, details);
  } catch (e) {
    console.warn('[Activity log] Failed to log:', e);
  }
}

/**
 * Get log entries, optionally filtered by date range and categories.
 * @param {Date} [fromDate]
 * @param {Date} [toDate]
 * @param {string[]} [categories] - If provided, only include these category ids
 * @returns {Array<{ts, category, description, ...}>}
 */
export function getLogEntries(fromDate, toDate, categories = null) {
  let entries = getEntriesRaw();
  if (fromDate) {
    const from = new Date(fromDate);
    entries = entries.filter(e => new Date(e.ts) >= from);
  }
  if (toDate) {
    const to = new Date(toDate);
    to.setHours(23, 59, 59, 999);
    entries = entries.filter(e => new Date(e.ts) <= to);
  }
  if (categories && categories.length > 0) {
    const set = new Set(categories);
    entries = entries.filter(e => set.has(e.category));
  }
  return entries.sort((a, b) => new Date(a.ts) - new Date(b.ts));
}

/**
 * Format a single entry for display (one line).
 */
function formatEntry(entry, categoryLabels) {
  const label = categoryLabels[entry.category] || entry.category;
  const date = new Date(entry.ts).toLocaleString();
  const extra = [];
  if (entry.pageTitle) extra.push(entry.pageTitle);
  if (entry.targetStatus) extra.push(`→ ${entry.targetStatus}`);
  if (entry.count != null) extra.push(`(${entry.count} item${entry.count !== 1 ? 's' : ''})`);
  if (entry.jiraTicket) extra.push(entry.jiraTicket);
  const suffix = extra.length ? ` — ${extra.join(' ')}` : '';
  return `${date}\t${label}\t${entry.description}${suffix}`;
}

/**
 * Export filtered entries as plain text (tab-separated, good for paste).
 */
export function exportAsText(entries, categoryLabels) {
  const labels = categoryLabels || ACTIVITY_CATEGORIES.reduce((acc, c) => { acc[c.id] = c.label; return acc; }, {});
  const header = 'Date/Time\tCategory\tAction\tDetails';
  const lines = entries.map(e => formatEntry(e, labels));
  return [header, ...lines].join('\n');
}

/**
 * Export filtered entries as CSV.
 */
export function exportAsCSV(entries, categoryLabels) {
  const labels = categoryLabels || ACTIVITY_CATEGORIES.reduce((acc, c) => { acc[c.id] = c.label; return acc; }, {});
  const header = 'Date/Time,Category,Action,Details';
  const escape = (s) => {
    if (s == null) return '';
    const str = String(s);
    return str.includes(',') || str.includes('"') || str.includes('\n') ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const rows = entries.map(e => {
    const label = labels[e.category] || e.category;
    const date = new Date(e.ts).toLocaleString();
    const details = [e.pageTitle, e.targetStatus, e.count != null ? `${e.count} items` : '', e.jiraTicket].filter(Boolean).join('; ');
    return [date, label, e.description, details].map(escape).join(',');
  });
  return [header, ...rows].join('\n');
}

/**
 * Clear all log entries.
 */
export function clearLog() {
  setEntriesRaw([]);
}
