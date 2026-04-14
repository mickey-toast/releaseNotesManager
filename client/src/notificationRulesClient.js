import { authenticatedFetch } from './api';

const LS_RULES = 'notificationRules';
const LS_LOG = 'notificationDeliveryLog';

export function getNotificationRulesFromStorage() {
  try {
    const raw = localStorage.getItem(LS_RULES);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function setNotificationRulesInStorage(rules) {
  localStorage.setItem(LS_RULES, JSON.stringify(Array.isArray(rules) ? rules : []));
}

export function getNotificationDeliveryLogFromStorage() {
  try {
    const raw = localStorage.getItem(LS_LOG);
    if (!raw) return {};
    const o = JSON.parse(raw);
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  } catch {
    return {};
  }
}

export function setNotificationDeliveryLogInStorage(log) {
  localStorage.setItem(LS_LOG, JSON.stringify(log && typeof log === 'object' ? log : {}));
}

/**
 * Ask the server to post any due Jira comments per rules. Updates delivery log in localStorage on success.
 * @returns {Promise<{ ok?: boolean, posted?: array, failed?: array, error?: string, details?: string }>}
 */
export async function runDueNotificationRules() {
  const rules = getNotificationRulesFromStorage();
  const deliveryLog = getNotificationDeliveryLogFromStorage();
  const res = await authenticatedFetch('/api/notifications/run-due', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rules, deliveryLog })
  });
  const data = await res.json().catch(() => ({}));
  if (res.ok && data.deliveryLog && typeof data.deliveryLog === 'object') {
    setNotificationDeliveryLogInStorage(data.deliveryLog);
  }
  return { ...data, ok: res.ok };
}
