import React, { useState, useEffect, useCallback } from 'react';
import { authenticatedFetch } from './api';

const ExportForClaudeModal = ({
  statuses = {},
  onClose,
  onExport,
  exportLoading = false
}) => {
  const statusKeys = Object.keys(statuses);
  const [statusesSelected, setStatusesSelected] = useState(() => []);
  const [assigneesSelected, setAssigneesSelected] = useState([]);
  const [fixVersionsSelected, setFixVersionsSelected] = useState([]);
  const [lobsSelected, setLobsSelected] = useState([]);
  const [dateFilterType, setDateFilterType] = useState('none'); // 'none' | 'actual' | 'targeted'
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [options, setOptions] = useState({ assignees: [], fixVersions: [], lobs: [] });
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [previewPages, setPreviewPages] = useState([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [assigneeSearch, setAssigneeSearch] = useState('');
  const [lobSearch, setLobSearch] = useState('');

  const loadOptions = useCallback(async () => {
    if (statusesSelected.length === 0) {
      setOptions({ assignees: [], fixVersions: [], lobs: [] });
      return;
    }
    setOptionsLoading(true);
    try {
      const res = await authenticatedFetch('/api/export-for-claude-options', {
        method: 'POST',
        body: JSON.stringify({ statuses: statusesSelected })
      });
      if (res.ok) {
        const data = await res.json();
        setOptions({
          assignees: data.assignees || [],
          fixVersions: data.fixVersions || [],
          lobs: data.lobs || []
        });
      }
    } catch (e) {
      console.warn('Export options failed:', e);
    } finally {
      setOptionsLoading(false);
    }
  }, [statusesSelected]);

  const loadPreview = useCallback(async () => {
    if (statusesSelected.length === 0) {
      setPreviewPages([]);
      return;
    }
    setPreviewLoading(true);
    try {
      const body = {
        statuses: statusesSelected,
        assignees: assigneesSelected.length ? assigneesSelected : undefined,
        fixVersions: fixVersionsSelected.length ? fixVersionsSelected : undefined,
        lobs: lobsSelected.length ? lobsSelected : undefined
      };
      if (dateFilterType === 'actual') {
        if (dateFrom) body.actualLaunchDateFrom = dateFrom;
        if (dateTo) body.actualLaunchDateTo = dateTo;
      } else if (dateFilterType === 'targeted') {
        if (dateFrom) body.targetedLaunchDateFrom = dateFrom;
        if (dateTo) body.targetedLaunchDateTo = dateTo;
      }
      const res = await authenticatedFetch('/api/export-for-claude-preview', {
        method: 'POST',
        body: JSON.stringify(body)
      });
      if (res.ok) {
        const data = await res.json();
        setPreviewPages(data.pages || []);
      } else {
        setPreviewPages([]);
      }
    } catch (e) {
      setPreviewPages([]);
    } finally {
      setPreviewLoading(false);
    }
  }, [statusesSelected, assigneesSelected, fixVersionsSelected, lobsSelected, dateFilterType, dateFrom, dateTo]);

  useEffect(() => {
    loadOptions();
  }, [loadOptions]);

  useEffect(() => {
    loadPreview();
  }, [loadPreview]);

  const toggleStatus = (key) => {
    setStatusesSelected(prev =>
      prev.includes(key) ? prev.filter(s => s !== key) : [...prev, key]
    );
  };

  const assigneesFiltered = (options.assignees || []).filter(a =>
    !assigneeSearch.trim() || String(a).toLowerCase().includes(assigneeSearch.trim().toLowerCase())
  );
  const lobsFiltered = (options.lobs || []).filter(v =>
    !lobSearch.trim() || String(v).toLowerCase().includes(lobSearch.trim().toLowerCase())
  );

  const toggleAssignee = (name) => {
    setAssigneesSelected(prev =>
      prev.includes(name) ? prev.filter(a => a !== name) : [...prev, name]
    );
  };

  const toggleLob = (v) => {
    setLobsSelected(prev =>
      prev.includes(v) ? prev.filter(l => l !== v) : [...prev, v]
    );
  };

  const handleExport = () => {
    const payload = {
      statuses: statusesSelected,
      assignees: assigneesSelected.length ? assigneesSelected : undefined,
      fixVersions: fixVersionsSelected.length ? fixVersionsSelected : undefined,
      lobs: lobsSelected.length ? lobsSelected : undefined
    };
    if (dateFilterType === 'actual') {
      if (dateFrom) payload.actualLaunchDateFrom = dateFrom;
      if (dateTo) payload.actualLaunchDateTo = dateTo;
    } else if (dateFilterType === 'targeted') {
      if (dateFrom) payload.targetedLaunchDateFrom = dateFrom;
      if (dateTo) payload.targetedLaunchDateTo = dateTo;
    }
    onExport(payload);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg export-for-claude-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Export to Cursor — preferences</h2>
          <button type="button" className="close-btn" onClick={onClose}>×</button>
        </div>
        <div className="modal-body export-for-claude-modal-body">
          <p className="export-claude-intro">
            Choose filters below. All selected filters stack (e.g. Draft + assignee + fix version + date range). Confirm the page list, then export to zip.
          </p>

          <div className="export-prefs-grid">
            <div className="export-pref-section">
              <label className="export-pref-label">Page statuses</label>
              <div className="export-status-toggles">
                {statusKeys.map(key => (
                  <label key={key} className="export-status-check">
                    <input
                      type="checkbox"
                      checked={statusesSelected.includes(key)}
                      onChange={() => toggleStatus(key)}
                    />
                    <span>{statuses[key]?.name || key}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="export-pref-section">
              <label className="export-pref-label">Assignee</label>
              <input
                type="text"
                className="export-search-input"
                placeholder="Search assignees…"
                value={assigneeSearch}
                onChange={e => setAssigneeSearch(e.target.value)}
                disabled={optionsLoading}
                aria-label="Search assignees"
              />
              <div className="export-searchable-list">
                {optionsLoading && <div className="export-searchable-loading">Loading…</div>}
                {!optionsLoading && options.assignees.length === 0 && (
                  <div className="export-searchable-empty">No assignees in selected statuses</div>
                )}
                {!optionsLoading && options.assignees.length > 0 && (
                  <>
                    {assigneesFiltered.length === 0 && (
                      <div className="export-searchable-empty">No assignees match &quot;{assigneeSearch}&quot;</div>
                    )}
                    {assigneesFiltered.length > 0 && assigneesFiltered.map(a => (
                      <label key={a} className="export-searchable-option">
                        <input
                          type="checkbox"
                          checked={assigneesSelected.includes(a)}
                          onChange={() => toggleAssignee(a)}
                        />
                        <span>{a}</span>
                      </label>
                    ))}
                  </>
                )}
              </div>
              <small className="export-pref-hint">
                {assigneesSelected.length > 0 ? `${assigneesSelected.length} selected; ` : ''}Leave empty for any.
              </small>
            </div>

            <div className="export-pref-section">
              <label className="export-pref-label">Fix version</label>
              <select
                multiple
                className="export-multi-select"
                value={fixVersionsSelected}
                onChange={e => {
                  const selected = [...e.target.selectedOptions].map(o => o.value);
                  setFixVersionsSelected(selected);
                }}
                disabled={optionsLoading}
              >
                {options.fixVersions.map(v => (
                  <option key={v} value={v}>{v}</option>
                ))}
                {options.fixVersions.length === 0 && !optionsLoading && (
                  <option disabled>No fix versions in selected statuses</option>
                )}
              </select>
              <small className="export-pref-hint">Hold Ctrl/Cmd to select multiple; leave empty for any.</small>
            </div>

            <div className="export-pref-section">
              <label className="export-pref-label">LOB (line of business)</label>
              <input
                type="text"
                className="export-search-input"
                placeholder="Search LOB…"
                value={lobSearch}
                onChange={e => setLobSearch(e.target.value)}
                disabled={optionsLoading}
                aria-label="Search line of business"
              />
              <div className="export-searchable-list">
                {optionsLoading && <div className="export-searchable-loading">Loading…</div>}
                {!optionsLoading && options.lobs.length === 0 && (
                  <div className="export-searchable-empty">No LOB values in selected statuses</div>
                )}
                {!optionsLoading && options.lobs.length > 0 && (
                  <>
                    {lobsFiltered.length === 0 && (
                      <div className="export-searchable-empty">No LOB values match &quot;{lobSearch}&quot;</div>
                    )}
                    {lobsFiltered.length > 0 && lobsFiltered.map(v => (
                      <label key={v} className="export-searchable-option">
                        <input
                          type="checkbox"
                          checked={lobsSelected.includes(v)}
                          onChange={() => toggleLob(v)}
                        />
                        <span>{v}</span>
                      </label>
                    ))}
                  </>
                )}
              </div>
              <small className="export-pref-hint">
                {lobsSelected.length > 0 ? `${lobsSelected.length} selected; ` : ''}Leave empty for any.
              </small>
            </div>

            <div className="export-pref-section export-date-section">
              <label className="export-pref-label">Launch date filter</label>
              <select
                className="export-date-type-select"
                value={dateFilterType}
                onChange={e => setDateFilterType(e.target.value)}
              >
                <option value="none">None</option>
                <option value="actual">Actual launch date</option>
                <option value="targeted">Targeted launch date</option>
              </select>
              {(dateFilterType === 'actual' || dateFilterType === 'targeted') && (
                <div className="export-date-range">
                  <input
                    type="date"
                    className="export-date-input"
                    value={dateFrom}
                    onChange={e => setDateFrom(e.target.value)}
                    placeholder="From"
                  />
                  <span className="export-date-sep">to</span>
                  <input
                    type="date"
                    className="export-date-input"
                    value={dateTo}
                    onChange={e => setDateTo(e.target.value)}
                    placeholder="To"
                  />
                </div>
              )}
              <small className="export-pref-hint">Optional from/to; leave both empty to skip date filter.</small>
            </div>
          </div>

          <div className="export-preview-section">
            <div className="export-preview-header">
              <label className="export-pref-label">Pages to export ({previewPages.length})</label>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={loadPreview}
                disabled={previewLoading || statusesSelected.length === 0}
              >
                {previewLoading ? 'Loading…' : 'Refresh preview'}
              </button>
            </div>
            <div className="export-preview-list">
              {previewLoading && <div className="export-preview-loading">Loading preview…</div>}
              {!previewLoading && previewPages.length === 0 && (
                <div className="export-preview-empty">No pages match the current filters. Adjust statuses or other filters.</div>
              )}
              {!previewLoading && previewPages.length > 0 && (
                <ul className="export-preview-ul">
                  {previewPages.map(p => (
                    <li key={p.id} className="export-preview-li">
                      <span className="export-preview-title">{p.title || p.id}</span>
                      <span className="export-preview-meta">
                        {p.status} {p.assignee && ` · ${p.assignee}`}
                        {p.actualLaunchDate && ` · Actual: ${p.actualLaunchDate}`}
                        {p.targetedLaunchDate && ` · Targeted: ${p.targetedLaunchDate}`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleExport}
            disabled={exportLoading || statusesSelected.length === 0 || previewPages.length === 0}
          >
            {exportLoading ? 'Exporting…' : `Export to zip (${previewPages.length} pages)`}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ExportForClaudeModal;
