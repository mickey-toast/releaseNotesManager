import React, { useState, useMemo } from 'react';
import {
  getLogEntries,
  getAuditCategoryPreferences,
  getActivityLogTotalCount,
  logActivity,
  ACTIVITY_CATEGORIES,
  exportAsText,
  exportAsCSV,
  clearLog
} from './activityLog';

function todayLocalYYYYMMDD() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysAgoLocalYYYYMMDD(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const ActivityLogModal = ({ onClose, onCopyNotify }) => {
  const [fromDate, setFromDate] = useState(() => daysAgoLocalYYYYMMDD(90));
  const [toDate, setToDate] = useState(todayLocalYYYYMMDD);
  const [categoryFilters, setCategoryFilters] = useState(() => {
    const prefs = getAuditCategoryPreferences();
    return ACTIVITY_CATEGORIES.reduce((acc, c) => ({ ...acc, [c.id]: true }), {});
  });
  const [copied, setCopied] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [testKey, setTestKey] = useState(0);

  const entries = useMemo(() => {
    const from = fromDate ? new Date(fromDate + 'T00:00:00') : null;
    const to = toDate ? new Date(toDate + 'T23:59:59.999') : null;
    const cats = Object.keys(categoryFilters).filter(k => categoryFilters[k]);
    return getLogEntries(from, to, cats.length > 0 ? cats : null);
  }, [fromDate, toDate, categoryFilters, testKey]);

  const totalCount = getActivityLogTotalCount();

  const handleTestLog = () => {
    logActivity('page_move', 'Test entry (diagnostic)', { pageTitle: 'Test', targetStatus: 'In Progress' });
    setTestKey(k => k + 1);
  };

  const categoryLabels = useMemo(() =>
    ACTIVITY_CATEGORIES.reduce((acc, c) => { acc[c.id] = c.label; return acc; }, {}),
  []);

  const handleCopy = () => {
    const text = exportAsText(entries, categoryLabels);
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      if (onCopyNotify) onCopyNotify();
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleExportCSV = () => {
    const csv = exportAsCSV(entries, categoryLabels);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `release-manager-activity-${fromDate}-to-${toDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleClearLog = () => {
    clearLog();
    setShowClearConfirm(false);
    onClose();
  };

  const toggleCategory = (id) => {
    setCategoryFilters(prev => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg activity-log-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Activity Log</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>
        <div className="modal-body activity-log-body">
          <p className="activity-log-intro">
            Track what you&apos;ve done in the tool. Use filters below, then copy or export to show your work.
          </p>

          <div className="activity-log-filters">
            <div className="activity-log-date-range">
              <label>From</label>
              <input
                type="date"
                value={fromDate}
                onChange={e => setFromDate(e.target.value)}
              />
              <label>To</label>
              <input
                type="date"
                value={toDate}
                onChange={e => setToDate(e.target.value)}
              />
            </div>
            <details className="activity-log-categories-details">
              <summary>Filter by category</summary>
              <div className="activity-log-categories">
                {ACTIVITY_CATEGORIES.map(c => (
                  <label key={c.id} className="activity-log-category-check">
                    <input
                      type="checkbox"
                      checked={categoryFilters[c.id] !== false}
                      onChange={() => toggleCategory(c.id)}
                    />
                    <span>{c.label}</span>
                  </label>
                ))}
              </div>
            </details>
          </div>

          <div className="activity-log-actions">
            <span className="activity-log-count" title="Total entries stored (unfiltered)">
              Total in log: {totalCount} · Showing: {entries.length} entr{entries.length === 1 ? 'y' : 'ies'}
            </span>
            <button type="button" className="btn btn-primary btn-sm" onClick={handleCopy}>
              {copied ? 'Copied!' : 'Copy to clipboard'}
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={handleExportCSV}>
              Export CSV
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm activity-log-clear"
              onClick={() => setShowClearConfirm(true)}
            >
              Clear log
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleTestLog}
              title="Add a test entry to verify logging works"
            >
              Add test entry
            </button>
          </div>

          <div className="activity-log-list-wrapper">
            {entries.length === 0 ? (
              <p className="activity-log-empty">
                {totalCount === 0
                  ? 'No activity recorded yet. Move a page (e.g. Draft → In Progress), sync from Confluence, or perform another action—then open Activity Log again to see entries here.'
                  : 'No activity in this date range or category. Try widening the date range or enabling more categories above.'}
              </p>
            ) : (
              <ul className="activity-log-list">
                {entries.map((entry, i) => (
                  <li key={`${entry.ts}-${i}`} className="activity-log-item">
                    <span className="activity-log-time">
                      {new Date(entry.ts).toLocaleString()}
                    </span>
                    <span className="activity-log-cat">{categoryLabels[entry.category] || entry.category}</span>
                    <span className="activity-log-desc">{entry.description}</span>
                    {(entry.pageTitle || entry.targetStatus || entry.count != null || entry.jiraTicket) && (
                      <span className="activity-log-details">
                        {[entry.pageTitle, entry.targetStatus && `→ ${entry.targetStatus}`, entry.count != null && `(${entry.count})`, entry.jiraTicket].filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {showClearConfirm && (
          <div className="modal-footer activity-log-footer">
            <span>Clear all activity log entries? This cannot be undone.</span>
            <div>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowClearConfirm(false)}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary btn-sm" onClick={handleClearLog}>
                Clear all
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ActivityLogModal;
