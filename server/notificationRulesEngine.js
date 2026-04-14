const { DateTime } = require('luxon');

const MAX_RULES = 20;
const MAX_DELIVERY_KEYS = 400;

function parseTimeLocal(s) {
  if (!s || typeof s !== 'string') return null;
  const m = s.trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m) return null;
  const hour = Number(m[1], 10);
  const minute = Number(m[2], 10);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function parseYmd(ymd) {
  if (!ymd || typeof ymd !== 'string') return null;
  const s = String(ymd).trim().slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return { year: Number(m[1], 10), month: Number(m[2], 10), day: Number(m[3], 10) };
}

function launchRawFromPage(page, dateField) {
  const raw =
    dateField === 'targetedLaunchDate'
      ? page.targetedLaunchDateRaw || page.targetedLaunchDate
      : page.actualLaunchDateRaw || page.actualLaunchDate;
  if (!raw || typeof raw !== 'string') return null;
  const parts = parseYmd(raw);
  if (!parts) return null;
  const d = DateTime.fromObject(parts, { zone: 'utc' });
  if (!d.isValid) return null;
  return d.toISODate();
}

/**
 * Whole calendar days from today (in `timeZone`) until launch day: 0 = launch is today, 1 = tomorrow, etc.
 * Uses rounding so DST boundaries do not pull pages in/out of the window incorrectly.
 */
function wholeCalendarDaysUntilLaunch(launchRaw, timeZone, nowUtc = Date.now()) {
  if (!launchRaw) return null;
  const zone = timeZone || 'UTC';
  const today = DateTime.fromMillis(nowUtc, { zone }).startOf('day');
  const parts = parseYmd(launchRaw);
  if (!parts) return null;
  const launchDay = DateTime.fromObject(parts, { zone }).startOf('day');
  if (!launchDay.isValid) return null;
  return Math.round(launchDay.diff(today, 'days').days);
}

/**
 * Page matches this rule's launch cohort only if days-until-launch is in [minDays, maxDays] (inclusive).
 * maxDays is the existing "within the next N days" setting (0 = only launches today).
 * minDays defaults to 0; set minDays = 7 and maxDays = 7 to only match launches exactly one week away.
 */
function pageMatchesLaunchDayRange(launchRaw, minDays, maxDays, timeZone, nowUtc = Date.now()) {
  if (!launchRaw || maxDays == null || maxDays < 0) return false;
  const min = Math.min(365, Math.max(0, minDays == null ? 0 : minDays));
  const max = Math.min(365, Math.max(0, maxDays));
  if (min > max) return false;
  const diff = wholeCalendarDaysUntilLaunch(launchRaw, timeZone, nowUtc);
  if (diff == null) return false;
  // Past launches never match (only today and future launch days).
  return diff >= min && diff <= max;
}

/**
 * Calendar day = launch day + offsetDays, at timeLocal in timeZone. offsetDays -7 = seven days before launch.
 */
function computeSendInstantMillis(launchRaw, offsetDays, timeLocal, timeZone) {
  const hm = parseTimeLocal(timeLocal);
  if (!hm || !launchRaw) return null;
  const zone = timeZone || 'UTC';
  const parts = parseYmd(launchRaw);
  if (!parts) return null;
  const launch = DateTime.fromObject(parts, { zone }).startOf('day');
  if (!launch.isValid) return null;
  const day = launch.plus({ days: Number(offsetDays) || 0 });
  const send = day.set({ hour: hm.hour, minute: hm.minute, second: 0, millisecond: 0 });
  if (!send.isValid) return null;
  return send.toMillis();
}

function buildDedupeKey(ruleId, pageId, launchRaw) {
  return `${String(ruleId)}|${String(pageId)}|${String(launchRaw)}`;
}

function interpolateTemplate(template, vars) {
  if (!template || typeof template !== 'string') return '';
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    const v = vars[key];
    return v == null ? '' : String(v);
  });
}

function buildTemplateVars(page, credentials) {
  const base = (credentials && credentials.baseUrl) || '';
  const wiki = base.replace(/\/$/, '');
  const pageUrl = page.url || (page.id && wiki ? `${wiki}/wiki/spaces/...` : '');
  return {
    title: page.title || '',
    status: page.status || '',
    jiraTicket: page.jiraTicket || '',
    jiraUrl: page.jiraUrl || '',
    confluenceUrl: page.url || pageUrl,
    actualLaunchDate: page.actualLaunchDate || page.actualLaunchDateRaw || '',
    targetedLaunchDate: page.targetedLaunchDate || page.targetedLaunchDateRaw || ''
  };
}

function normalizeRule(raw, index = 0) {
  if (!raw || typeof raw !== 'object') return null;
  const id = typeof raw.id === 'string' && raw.id ? raw.id : `rule-${index}`;
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : `Rule ${index + 1}`;
  const enabled = raw.enabled !== false;
  const dateField =
    raw.criteria && raw.criteria.dateField === 'targetedLaunchDate'
      ? 'targetedLaunchDate'
      : 'actualLaunchDate';
  const withinDays = Math.min(
    365,
    Math.max(0, Number(raw.criteria && raw.criteria.withinDays != null ? raw.criteria.withinDays : 7))
  );
  let minDaysUntilLaunch = Math.min(
    365,
    Math.max(
      0,
      Number(
        raw.criteria && raw.criteria.minDaysUntilLaunch != null ? raw.criteria.minDaysUntilLaunch : 0
      )
    )
  );
  if (minDaysUntilLaunch > withinDays) {
    minDaysUntilLaunch = withinDays;
  }
  const offsetDaysFromLaunch = Math.min(
    30,
    Math.max(-90, Number(raw.schedule && raw.schedule.offsetDaysFromLaunch != null ? raw.schedule.offsetDaysFromLaunch : -7))
  );
  const timeLocal =
    raw.schedule && typeof raw.schedule.timeLocal === 'string'
      ? raw.schedule.timeLocal.trim()
      : '09:00';
  const timeZone =
    raw.schedule && typeof raw.schedule.timeZone === 'string' && raw.schedule.timeZone.trim()
      ? raw.schedule.timeZone.trim()
      : 'America/New_York';
  const bodyTemplate =
    raw.action && typeof raw.action.bodyTemplate === 'string' ? raw.action.bodyTemplate : '';
  const statuses = Array.isArray(raw.statuses)
    ? raw.statuses.map(String).filter(Boolean)
    : [];
  if (!parseTimeLocal(timeLocal)) return null;
  if (!bodyTemplate.trim()) return null;
  if (!DateTime.now().setZone(timeZone).isValid) return null;
  return {
    id,
    name,
    enabled,
    criteria: { dateField, withinDays, minDaysUntilLaunch },
    schedule: { offsetDaysFromLaunch, timeLocal, timeZone },
    action: { type: 'jira_comment', bodyTemplate: bodyTemplate.trim() },
    statuses
  };
}

function normalizeRulesList(rules) {
  if (!Array.isArray(rules)) return [];
  const out = [];
  for (let i = 0; i < rules.length && out.length < MAX_RULES; i++) {
    const n = normalizeRule(rules[i], i);
    if (n) out.push(n);
  }
  return out;
}

function trimDeliveryLog(log) {
  if (!log || typeof log !== 'object' || Array.isArray(log)) return {};
  const keys = Object.keys(log);
  if (keys.length <= MAX_DELIVERY_KEYS) return { ...log };
  keys.sort((a, b) => {
    const ta = new Date(log[a]?.sentAt || 0).getTime();
    const tb = new Date(log[b]?.sentAt || 0).getTime();
    return ta - tb;
  });
  const drop = keys.length - MAX_DELIVERY_KEYS;
  const next = { ...log };
  for (let i = 0; i < drop; i++) delete next[keys[i]];
  return next;
}

module.exports = {
  launchRawFromPage,
  pageMatchesLaunchDayRange,
  wholeCalendarDaysUntilLaunch,
  computeSendInstantMillis,
  buildDedupeKey,
  interpolateTemplate,
  buildTemplateVars,
  normalizeRulesList,
  trimDeliveryLog,
  parseTimeLocal
};
