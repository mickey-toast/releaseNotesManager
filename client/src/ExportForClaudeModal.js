import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { authenticatedFetch } from './api';

/** Mirrors server applyExportFilters for client-side preview when using cached board pages. */
function applyExportFiltersClient(pages, filters) {
  if (!filters) return pages;
  let out = pages;
  if (Array.isArray(filters.assignees) && filters.assignees.length > 0) {
    const set = new Set(filters.assignees);
    out = out.filter(p => {
      const name = p.jiraAssignee?.displayName || p.referenceAssignee || '';
      return name && set.has(name);
    });
  }
  if (Array.isArray(filters.fixVersions) && filters.fixVersions.length > 0) {
    const set = new Set(filters.fixVersions);
    out = out.filter(p => {
      const fv = p.fixVersions;
      if (!fv) return false;
      const arr = Array.isArray(fv) ? fv : [fv];
      return arr.some(v => set.has(String(v)));
    });
  }
  if (Array.isArray(filters.lobs) && filters.lobs.length > 0) {
    const set = new Set(filters.lobs);
    out = out.filter(p => {
      const pill = (p.jiraMetadataPills || []).find(
        x =>
          (x.label || '').toLowerCase().includes('line of business') ||
          (x.label || '').toLowerCase().includes('product area')
      );
      const vals = pill?.values || [];
      return vals.some(v => set.has(String(v)));
    });
  }
  const fromActual = filters.actualLaunchDateFrom;
  const toActual = filters.actualLaunchDateTo;
  if (fromActual || toActual) {
    out = out.filter(p => {
      const raw = p.actualLaunchDateRaw || '';
      if (!raw) return false;
      if (fromActual && raw < fromActual) return false;
      if (toActual && raw > toActual) return false;
      return true;
    });
  }
  const fromTargeted = filters.targetedLaunchDateFrom;
  const toTargeted = filters.targetedLaunchDateTo;
  if (fromTargeted || toTargeted) {
    out = out.filter(p => {
      const raw = p.targetedLaunchDateRaw || '';
      if (!raw) return false;
      if (fromTargeted && raw < fromTargeted) return false;
      if (toTargeted && raw > toTargeted) return false;
      return true;
    });
  }
  return out;
}

function buildExportOptionsFromPages(pages) {
  const assignees = [];
  const fixVersions = new Set();
  const lobs = new Set();
  (pages || []).forEach(p => {
    const name = p.jiraAssignee?.displayName || p.referenceAssignee;
    if (name) assignees.push(name);
    const fv = p.fixVersions;
    if (fv) (Array.isArray(fv) ? fv : [fv]).forEach(v => fixVersions.add(String(v)));
    const pill = (p.jiraMetadataPills || []).find(
      x =>
        (x.label || '').toLowerCase().includes('line of business') ||
        (x.label || '').toLowerCase().includes('product area')
    );
    (pill?.values || []).forEach(v => lobs.add(String(v)));
  });
  return {
    assignees: [...new Set(assignees)].sort(),
    fixVersions: [...fixVersions].sort(),
    lobs: [...lobs].sort()
  };
}

function toPreviewRow(p) {
  const pill = (p.jiraMetadataPills || []).find(
    x =>
      (x.label || '').toLowerCase().includes('line of business') ||
      (x.label || '').toLowerCase().includes('product area')
  );
  return {
    id: p.id,
    title: p.title,
    status: p.status,
    assignee: p.jiraAssignee?.displayName || p.referenceAssignee,
    fixVersions: p.fixVersions,
    lob: pill?.values,
    actualLaunchDate: p.actualLaunchDate,
    targetedLaunchDate: p.targetedLaunchDate
  };
}

/** Keep table order from ids; only include rows that appear in list. */
function applyBoardSelectionConstraint(rows, ids) {
  if (!ids || ids.length === 0) return rows;
  const byId = new Map((rows || []).map(r => [String(r.id), r]));
  const out = [];
  for (const id of ids) {
    const r = byId.get(String(id));
    if (r) out.push(r);
  }
  return out;
}

const ExportForClaudeModal = ({
  statuses = {},
  /** Pages already loaded for the active board column (same shape as GET /api/pages). */
  cachedPages = null,
  /** Status key for that column, e.g. 'draft'. */
  cachedStatus = null,
  /**
   * When set (e.g. from board multi-select), preview and export are limited to these page ids
   * in this order, intersected with the current filter preview. User can clear to use full filter.
   */
  initialBoardSelectionIds = null,
  onClose,
  onExport,
  exportLoading = false
}) => {
  const statusKeys = Object.keys(statuses);
  const [statusesSelected, setStatusesSelected] = useState(() =>
    cachedStatus ? [cachedStatus] : []
  );
  const [assigneesSelected, setAssigneesSelected] = useState([]);
  const [fixVersionsSelected, setFixVersionsSelected] = useState([]);
  const [lobsSelected, setLobsSelected] = useState([]);
  const [dateFilterType, setDateFilterType] = useState('none');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [options, setOptions] = useState({ assignees: [], fixVersions: [], lobs: [] });
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [previewPages, setPreviewPages] = useState([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [assigneeSearch, setAssigneeSearch] = useState('');
  const [lobSearch, setLobSearch] = useState('');
  /** 'cache' = use cachedPages; 'server' = Confluence re-fetch (multi-status or explicit reload). */
  const [previewSource, setPreviewSource] = useState(() =>
    cachedStatus != null && Array.isArray(cachedPages) ? 'cache' : 'server'
  );
  const [serverPullNonce, setServerPullNonce] = useState(0);
  const [boardSelectionIds, setBoardSelectionIds] = useState(() =>
    initialBoardSelectionIds?.length ? initialBoardSelectionIds.map(String) : null
  );

  const canUseBoardCache = useMemo(() => {
    return (
      Array.isArray(cachedPages) &&
      cachedStatus != null &&
      statusesSelected.length === 1 &&
      statusesSelected[0] === cachedStatus
    );
  }, [cachedPages, cachedStatus, statusesSelected]);

  useEffect(() => {
    if (!canUseBoardCache) {
      setPreviewSource('server');
    }
  }, [canUseBoardCache]);

  const buildFilters = useCallback(() => {
    const filters = {
      assignees: assigneesSelected.length ? assigneesSelected : undefined,
      fixVersions: fixVersionsSelected.length ? fixVersionsSelected : undefined,
      lobs: lobsSelected.length ? lobsSelected : undefined
    };
    if (dateFilterType === 'actual') {
      if (dateFrom) filters.actualLaunchDateFrom = dateFrom;
      if (dateTo) filters.actualLaunchDateTo = dateTo;
    } else if (dateFilterType === 'targeted') {
      if (dateFrom) filters.targetedLaunchDateFrom = dateFrom;
      if (dateTo) filters.targetedLaunchDateTo = dateTo;
    }
    return filters;
  }, [
    assigneesSelected,
    fixVersionsSelected,
    lobsSelected,
    dateFilterType,
    dateFrom,
    dateTo
  ]);

  useEffect(() => {
    if (statusesSelected.length === 0) {
      setOptions({ assignees: [], fixVersions: [], lobs: [] });
      setPreviewPages([]);
      setOptionsLoading(false);
      setPreviewLoading(false);
    }
  }, [statusesSelected]);

  useEffect(() => {
    if (statusesSelected.length === 0) return;
    if (previewSource !== 'cache' || !canUseBoardCache) return;
    setOptionsLoading(false);
    setPreviewLoading(false);
    setOptions(buildExportOptionsFromPages(cachedPages));
    const filtered = applyExportFiltersClient(cachedPages, buildFilters());
    setPreviewPages(applyBoardSelectionConstraint(filtered.map(toPreviewRow), boardSelectionIds));
  }, [
    statusesSelected,
    previewSource,
    canUseBoardCache,
    cachedPages,
    buildFilters,
    boardSelectionIds
  ]);

  useEffect(() => {
    if (exportLoading) return;
    if (statusesSelected.length === 0) return;
    if (previewSource === 'cache' && canUseBoardCache) return;

    let cancelled = false;

    (async () => {
      setOptionsLoading(true);
      setPreviewLoading(true);
      try {
        const optionsRes = await authenticatedFetch('/api/export-for-claude-options', {
          method: 'POST',
          body: JSON.stringify({ statuses: statusesSelected })
        });
        if (cancelled) return;
        if (optionsRes.ok) {
          const data = await optionsRes.json();
          if (cancelled) return;
          setOptions({
            assignees: data.assignees || [],
            fixVersions: data.fixVersions || [],
            lobs: data.lobs || []
          });
        }
      } catch (e) {
        console.warn('Export options failed:', e);
      } finally {
        if (!cancelled) setOptionsLoading(false);
      }

      if (cancelled) {
        setPreviewLoading(false);
        return;
      }

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
        const previewRes = await authenticatedFetch('/api/export-for-claude-preview', {
          method: 'POST',
          body: JSON.stringify(body)
        });
        if (cancelled) return;
        if (previewRes.ok) {
          const previewData = await previewRes.json();
          if (cancelled) return;
          setPreviewPages(
            applyBoardSelectionConstraint(previewData.pages || [], boardSelectionIds)
          );
        } else if (!cancelled) {
          setPreviewPages([]);
        }
      } catch (e) {
        if (!cancelled) setPreviewPages([]);
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    exportLoading,
    statusesSelected,
    previewSource,
    canUseBoardCache,
    serverPullNonce,
    assigneesSelected,
    fixVersionsSelected,
    lobsSelected,
    dateFilterType,
    dateFrom,
    dateTo,
    boardSelectionIds
  ]);

  const toggleStatus = key => {
    setStatusesSelected(prev =>
      prev.includes(key) ? prev.filter(s => s !== key) : [...prev, key]
    );
  };

  const assigneesFiltered = (options.assignees || []).filter(
    a =>
      !assigneeSearch.trim() ||
      String(a).toLowerCase().includes(assigneeSearch.trim().toLowerCase())
  );
  const lobsFiltered = (options.lobs || []).filter(
    v =>
      !lobSearch.trim() || String(v).toLowerCase().includes(lobSearch.trim().toLowerCase())
  );

  const toggleAssignee = name => {
    setAssigneesSelected(prev =>
      prev.includes(name) ? prev.filter(a => a !== name) : [...prev, name]
    );
  };

  const toggleLob = v => {
    setLobsSelected(prev =>
      prev.includes(v) ? prev.filter(l => l !== v) : [...prev, v]
    );
  };

  const handleExport = () => {
    const payload = {
      statuses: statusesSelected,
      assignees: assigneesSelected.length ? assigneesSelected : undefined,
      fixVersions: fixVersionsSelected.length ? fixVersionsSelected : undefined,
      lobs: lobsSelected.length ? lobsSelected : undefined,
      previewPageIds:
        previewPages.length > 0 ? previewPages.map(p => String(p.id)) : undefined
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

  const handleReloadFromConfluence = () => {
    setPreviewSource('server');
    setServerPullNonce(n => n + 1);
  };

  const handleUseBoardCache = () => {
    setPreviewSource('cache');
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg export-for-claude-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Export to Cursor — preferences</h2>
          <button type="button" className="close-btn" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="modal-body export-for-claude-modal-body">
          <p className="export-claude-intro">
            Choose filters below. All selected filters stack (e.g. Draft + assignee + fix version + date
            range). Confirm the page list, then export to zip.
          </p>
          {boardSelectionIds && boardSelectionIds.length > 0 && (
            <p className="export-cache-hint" style={{ fontSize: '0.9rem', color: 'var(--muted, #64748b)' }}>
              Started from <strong>{boardSelectionIds.length}</strong> page
              {boardSelectionIds.length === 1 ? '' : 's'} selected on the board. The list below is that
              selection narrowed by your filters (or reloaded from Confluence). Use{' '}
              <strong>Show all matching pages</strong> if you want every page that matches the filters, not
              only the board selection.
            </p>
          )}
          {canUseBoardCache && previewSource === 'cache' && (
            <p className="export-cache-hint" style={{ fontSize: '0.9rem', color: 'var(--muted, #64748b)' }}>
              Using pages already loaded for <strong>{statuses[cachedStatus]?.name || cachedStatus}</strong>.
              Add another status or use <strong>Reload from Confluence</strong> if the board may be out of date.
            </p>
          )}

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
                      <div className="export-searchable-empty">
                        No assignees match &quot;{assigneeSearch}&quot;
                      </div>
                    )}
                    {assigneesFiltered.length > 0 &&
                      assigneesFiltered.map(a => (
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
                {assigneesSelected.length > 0 ? `${assigneesSelected.length} selected; ` : ''}Leave empty for
                any.
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
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
                {options.fixVersions.length === 0 && !optionsLoading && (
                  <option disabled>No fix versions in selected statuses</option>
                )}
              </select>
              <small className="export-pref-hint">
                Hold Ctrl/Cmd to select multiple; leave empty for any.
              </small>
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
                      <div className="export-searchable-empty">
                        No LOB values match &quot;{lobSearch}&quot;
                      </div>
                    )}
                    {lobsFiltered.length > 0 &&
                      lobsFiltered.map(v => (
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
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                {boardSelectionIds && boardSelectionIds.length > 0 && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => setBoardSelectionIds(null)}
                    disabled={previewLoading || optionsLoading}
                    title="Use the full filtered page list instead of only your board selection"
                  >
                    Show all matching pages
                  </button>
                )}
                {canUseBoardCache && previewSource === 'server' && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={handleUseBoardCache}
                    disabled={previewLoading || optionsLoading}
                  >
                    Use loaded board
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={handleReloadFromConfluence}
                  disabled={previewLoading || optionsLoading || statusesSelected.length === 0}
                >
                  {previewLoading || optionsLoading ? 'Loading…' : 'Reload from Confluence'}
                </button>
              </div>
            </div>
            <div className="export-preview-list">
              {previewLoading && <div className="export-preview-loading">Loading preview…</div>}
              {!previewLoading && previewPages.length === 0 && (
                <div className="export-preview-empty">
                  No pages match the current filters. Adjust statuses or other filters.
                </div>
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
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
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
