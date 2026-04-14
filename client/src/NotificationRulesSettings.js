import React, { useState, useCallback } from 'react';
import { runDueNotificationRules } from './notificationRulesClient';

const STATUS_OPTIONS = [
  { id: 'draft', label: 'Draft' },
  { id: 'inProgress', label: 'In Progress' },
  { id: 'needsAction', label: 'Needs Action' },
  { id: 'published', label: 'Published' },
  { id: 'discard', label: 'Discarded' }
];

function newRule() {
  return {
    id: `rule-${Date.now()}`,
    name: 'Launch reminder',
    enabled: true,
    criteria: { dateField: 'actualLaunchDate', minDaysUntilLaunch: 0, withinDays: 7 },
    schedule: {
      offsetDaysFromLaunch: -7,
      timeLocal: '09:00',
      timeZone: 'America/New_York'
    },
    action: {
      type: 'jira_comment',
      bodyTemplate:
        'Release note reminder: "{title}" has actual launch date {actualLaunchDate}. Please confirm readiness.'
    },
    statuses: ['draft', 'inProgress', 'needsAction']
  };
}

export default function NotificationRulesSettings({ rules, setRules }) {
  const [running, setRunning] = useState(false);
  const [runMessage, setRunMessage] = useState(null);

  const updateRule = useCallback(
    (id, patch) => {
      setRules((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    },
    [setRules]
  );

  const updateNested = useCallback(
    (id, key, patch) => {
      setRules((prev) =>
        prev.map((r) => (r.id === id ? { ...r, [key]: { ...r[key], ...patch } } : r))
      );
    },
    [setRules]
  );

  const addRule = () => setRules((prev) => [...prev, newRule()]);
  const removeRule = (id) => setRules((prev) => prev.filter((r) => r.id !== id));

  const toggleStatus = (ruleId, statusId, checked) => {
    setRules((prev) =>
      prev.map((r) => {
        if (r.id !== ruleId) return r;
        const cur = Array.isArray(r.statuses) ? r.statuses : [];
        if (checked) {
          return { ...r, statuses: [...new Set([...cur, statusId])] };
        }
        return { ...r, statuses: cur.filter((s) => s !== statusId) };
      })
    );
  };

  const handleRunDue = async () => {
    setRunning(true);
    setRunMessage(null);
    try {
      const data = await runDueNotificationRules();
      if (!data.ok) {
        setRunMessage({
          type: 'err',
          text: data.details || data.error || 'Request failed'
        });
        return;
      }
      const n = (data.posted && data.posted.length) || 0;
      const f = (data.failed && data.failed.length) || 0;
      setRunMessage({
        type: f ? 'warn' : 'ok',
        text:
          n === 0 && f === 0
            ? data.message || 'No comments posted (nothing due, or rules disabled / no matching pages).'
            : `Posted ${n} Jira comment(s).${f ? ` ${f} failed — see server logs or Jira permissions.` : ''}`
      });
    } catch (e) {
      setRunMessage({ type: 'err', text: e.message || 'Failed' });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="settings-section notification-rules-section">
      <h3>Scheduled Jira notifications</h3>
      <p className="settings-intro">
        Each rule is evaluated on its own. A Jira comment is posted <strong>only</strong> when{' '}
        <strong>every</strong> condition for <em>that</em> rule is true: statuses you picked, a linked Jira issue, a
        launch date, <strong>whole calendar days until launch</strong> falling in the min/max range you set (in the
        rule&apos;s timezone), <strong>current time on or after</strong> the scheduled send instant for that rule, and
        this rule has not already posted for that page and launch date. Pages outside that range never get this
        rule&apos;s comment; rules do not send before the scheduled time.
      </p>
      <p className="settings-intro" style={{ fontSize: '0.9rem' }}>
        Example: max <strong>7</strong> days until launch and send <strong>7</strong> days before at 9:00 means only
        tickets whose launch is still between <strong>0 and 7 days away</strong> are eligible, and the comment goes
        out only once that send moment has passed (typically the morning seven calendar days before launch).
      </p>
      <p className="settings-intro" style={{ fontSize: '0.9rem', color: 'var(--muted, #64748b)' }}>
        <strong>Automatic delivery:</strong> while this app is open in your browser, due rules are checked about
        every 12 minutes (using your saved Atlassian credentials). For 24/7 delivery without keeping the app open,
        use an external scheduler (for example cron) to call the same API your account uses — contact your admin if
        you need that pattern documented.
      </p>

      <div className="notification-rules-actions" style={{ marginBottom: '1rem', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-secondary btn-sm" onClick={addRule}>
          Add rule
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={handleRunDue}
          disabled={running}
        >
          {running ? 'Running…' : 'Run due notifications now'}
        </button>
      </div>
      {runMessage && (
        <p
          className="settings-intro"
          style={{
            fontSize: '0.9rem',
            color:
              runMessage.type === 'err'
                ? 'var(--danger, #b91c1c)'
                : runMessage.type === 'warn'
                  ? 'var(--warn, #b45309)'
                  : 'var(--success, #15803d)'
          }}
        >
          {runMessage.text}
        </p>
      )}

      <p className="settings-intro" style={{ fontSize: '0.85rem' }}>
        Placeholders in comment text:{' '}
        <code>{'{title}'}</code>, <code>{'{actualLaunchDate}'}</code>, <code>{'{targetedLaunchDate}'}</code>,{' '}
        <code>{'{jiraTicket}'}</code>, <code>{'{jiraUrl}'}</code>, <code>{'{confluenceUrl}'}</code>,{' '}
        <code>{'{status}'}</code>
      </p>

      {rules.length === 0 && (
        <p className="settings-intro">No rules yet. Click &quot;Add rule&quot; to create one, then save Settings.</p>
      )}

      {rules.map((rule) => (
        <div key={rule.id} className="notification-rule-card" style={{ border: '1px solid var(--border, #e2e8f0)', borderRadius: '8px', padding: '1rem', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginBottom: '0.75rem' }}>
            <input
              type="text"
              className="settings-input-inline"
              value={rule.name}
              onChange={(e) => updateRule(rule.id, { name: e.target.value })}
              aria-label="Rule name"
              style={{ flex: 1, maxWidth: '320px' }}
            />
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}>
              <input
                type="checkbox"
                checked={rule.enabled !== false}
                onChange={(e) => updateRule(rule.id, { enabled: e.target.checked })}
              />
              Enabled
            </label>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => removeRule(rule.id)}>
              Remove
            </button>
          </div>

          <div className="settings-field">
            <label>Launch date field</label>
            <select
              value={rule.criteria?.dateField || 'actualLaunchDate'}
              onChange={(e) => updateNested(rule.id, 'criteria', { dateField: e.target.value })}
            >
              <option value="actualLaunchDate">Actual launch date</option>
              <option value="targetedLaunchDate">Targeted launch date</option>
            </select>
          </div>

          <div className="settings-field" style={{ display: 'flex', flexWrap: 'wrap', gap: '16px' }}>
            <div>
              <label>Min. days until launch</label>
              <input
                type="number"
                min={0}
                max={365}
                value={rule.criteria?.minDaysUntilLaunch ?? 0}
                onChange={(e) => {
                  const minDaysUntilLaunch = Math.min(365, Math.max(0, Number(e.target.value) || 0));
                  const maxD = rule.criteria?.withinDays ?? 7;
                  updateNested(rule.id, 'criteria', {
                    minDaysUntilLaunch,
                    withinDays: Math.max(minDaysUntilLaunch, maxD)
                  });
                }}
              />
            </div>
            <div>
              <label>Max. days until launch</label>
              <input
                type="number"
                min={0}
                max={365}
                value={rule.criteria?.withinDays ?? 7}
                onChange={(e) => {
                  const withinDays = Math.min(365, Math.max(0, Number(e.target.value) || 0));
                  const minD = rule.criteria?.minDaysUntilLaunch ?? 0;
                  updateNested(rule.id, 'criteria', {
                    withinDays,
                    minDaysUntilLaunch: Math.min(minD, withinDays)
                  });
                }}
              />
            </div>
          </div>
          <small className="settings-hint" style={{ display: 'block', marginTop: '-0.5rem', marginBottom: '0.75rem' }}>
            Counts whole calendar days in the rule timezone (0 = launch is today). Only launches in this inclusive
            range are considered; launches further out do not get this rule&apos;s notification.
          </small>

          <div className="settings-field">
            <label>Post comment on this offset from launch (days)</label>
            <input
              type="number"
              min={-90}
              max={30}
              value={rule.schedule?.offsetDaysFromLaunch ?? -7}
              onChange={(e) =>
                updateNested(rule.id, 'schedule', {
                  offsetDaysFromLaunch: Math.min(30, Math.max(-90, Number(e.target.value) || 0))
                })
              }
            />
            <small className="settings-hint">Negative = before launch (e.g. -7 is seven days before launch day). 0 = launch day.</small>
          </div>

          <div className="settings-field" style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
            <div>
              <label>Local time</label>
              <input
                type="time"
                value={rule.schedule?.timeLocal || '09:00'}
                onChange={(e) => updateNested(rule.id, 'schedule', { timeLocal: e.target.value })}
              />
            </div>
            <div style={{ flex: 1, minWidth: '200px' }}>
              <label>IANA timezone</label>
              <input
                type="text"
                value={rule.schedule?.timeZone || 'America/New_York'}
                onChange={(e) => updateNested(rule.id, 'schedule', { timeZone: e.target.value })}
                placeholder="America/New_York"
              />
            </div>
          </div>

          <div className="settings-field">
            <label>Statuses (leave empty for all except Discarded when fetching)</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', marginTop: '6px' }}>
              {STATUS_OPTIONS.map((s) => (
                <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <input
                    type="checkbox"
                    checked={(rule.statuses || []).includes(s.id)}
                    onChange={(e) => toggleStatus(rule.id, s.id, e.target.checked)}
                  />
                  {s.label}
                </label>
              ))}
            </div>
            <small className="settings-hint">If none checked, the server loads Draft, In Progress, Needs Action, and Published.</small>
          </div>

          <div className="settings-field">
            <label>Jira comment</label>
            <textarea
              rows={4}
              value={rule.action?.bodyTemplate || ''}
              onChange={(e) => updateNested(rule.id, 'action', { bodyTemplate: e.target.value })}
              placeholder="Reminder: ..."
              style={{ width: '100%', fontFamily: 'inherit' }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
