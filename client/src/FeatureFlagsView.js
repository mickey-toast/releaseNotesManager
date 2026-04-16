import React, { useState, useEffect, useMemo } from 'react';
import { authenticatedFetch } from './api';

const FeatureFlagsView = ({ config }) => {
  const [flags, setFlags] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showMissingOnly, setShowMissingOnly] = useState(false);
  const [filterMode, setFilterMode] = useState(null); // null, 'withNotes', 'missingNotes', 'withJpd', 'missingJpd'
  const [searchTerm, setSearchTerm] = useState('');
  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' });
  const [lastRefresh, setLastRefresh] = useState(null);

  const fetchFlags = async (forceRefresh = false) => {
    console.log('[FeatureFlags] Starting fetch...', { forceRefresh, hasConfig: !!config });
    setLoading(true);
    setError(null);

    try {
      // Get settings from config (may be nested in config.settings)
      const settings = config.settings || config;

      if (!settings?.launchdarklyApiKey) {
        console.error('[FeatureFlags] Missing LaunchDarkly API key');
        throw new Error('LaunchDarkly API key not configured. Please add it in Settings → LaunchNotes Integration.');
      }
      if (!settings?.launchnotesApiKey) {
        console.error('[FeatureFlags] Missing LaunchNotes API key');
        throw new Error('LaunchNotes API token not configured. Please add it in Settings → LaunchNotes Integration.');
      }
      if (!settings?.email || !settings?.apiToken) {
        console.error('[FeatureFlags] Missing Jira credentials');
        throw new Error('Jira credentials not configured. Please add them in Settings → Authentication.');
      }

      console.log('[FeatureFlags] All credentials present, making API call...');

      const endpoint = forceRefresh ? '/api/feature-flags/refresh' : '/api/feature-flags';
      const method = forceRefresh ? 'POST' : 'GET';

      const response = await authenticatedFetch(endpoint, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-LaunchDarkly-Key': settings.launchdarklyApiKey,
          'X-LaunchNotes-Key': settings.launchnotesApiKey,
          'X-Atlassian-Email': settings.email,
          'X-Atlassian-Token': settings.apiToken,
          'X-Atlassian-Base-Url': settings.baseUrl || config.baseUrl
        }
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to fetch feature flags');
      }

      const data = await response.json();
      console.log('[FeatureFlags] API response received:', { count: data.data?.length, cached: data.cached });
      setFlags(data.data || []);
      setLastRefresh(data.timestamp);
    } catch (err) {
      console.error('[FeatureFlags] Error:', err);
      setError(err.message);
      setFlags([]);
    } finally {
      setLoading(false);
      console.log('[FeatureFlags] Fetch complete');
    }
  };

  useEffect(() => {
    if (config) {
      fetchFlags();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  const handleRefresh = () => {
    fetchFlags(true);
  };

  // Filter and search
  const filteredFlags = useMemo(() => {
    let result = flags;

    // Apply filter mode (from summary card clicks)
    if (filterMode === 'withNotes') {
      result = result.filter(flag => flag.hasReleaseNote);
    } else if (filterMode === 'missingNotes') {
      result = result.filter(flag => !flag.hasReleaseNote);
    } else if (filterMode === 'withJpd') {
      result = result.filter(flag => flag.jpdKey);
    } else if (filterMode === 'missingJpd') {
      result = result.filter(flag => !flag.jpdKey);
    }

    // Legacy filter (from checkbox)
    if (showMissingOnly) {
      result = result.filter(flag => !flag.hasReleaseNote);
    }

    // Search filter
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter(flag =>
        flag.flagKey.toLowerCase().includes(term) ||
        flag.jpdKey.toLowerCase().includes(term) ||
        flag.jpdSummary.toLowerCase().includes(term) ||
        flag.releaseVersion.toLowerCase().includes(term)
      );
    }

    // Sort
    if (sortConfig.key) {
      result = [...result].sort((a, b) => {
        let aVal = a[sortConfig.key];
        let bVal = b[sortConfig.key];

        if (sortConfig.key === 'hasReleaseNote') {
          aVal = a.hasReleaseNote ? 1 : 0;
          bVal = b.hasReleaseNote ? 1 : 0;
        } else if (sortConfig.key === 'percentage') {
          aVal = a.percentage || 0;
          bVal = b.percentage || 0;
        } else {
          aVal = String(aVal || '').toLowerCase();
          bVal = String(bVal || '').toLowerCase();
        }

        if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
        if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }

    return result;
  }, [flags, showMissingOnly, filterMode, searchTerm, sortConfig]);

  const handleSort = (key) => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  // Statistics
  const stats = useMemo(() => {
    const total = flags.length;
    const withNotes = flags.filter(f => f.hasReleaseNote).length;
    const missingNotes = total - withNotes;
    const withJpd = flags.filter(f => f.jpdKey).length;
    const missingJpd = total - withJpd;

    return { total, withNotes, missingNotes, withJpd, missingJpd };
  }, [flags]);

  const renderSortIcon = (key) => {
    if (sortConfig.key !== key) return null;
    return sortConfig.direction === 'asc' ? ' ▲' : ' ▼';
  };

  if (loading && flags.length === 0) {
    return (
      <div className="feature-flags-view">
        <div className="loading-message">
          <div className="spinner"></div>
          <p>Loading feature flags... This may take a minute.</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="feature-flags-view">
        <div className="error-message">
          <h3>Error Loading Feature Flags</h3>
          <p>{error}</p>
          <button onClick={handleRefresh} disabled={loading}>
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="feature-flags-view">
      <div className="feature-flags-header">
        <h2>Feature Flags Dashboard</h2>
        <button
          onClick={handleRefresh}
          disabled={loading}
          className="refresh-button"
          title="Refresh data from LaunchDarkly and LaunchNotes"
        >
          {loading ? '↻ Refreshing...' : '↻ Refresh'}
        </button>
      </div>

      {loading && (
        <div className="loading-banner">
          <div className="spinner-small"></div>
          <span>Loading feature flags data... This may take 1-2 minutes.</span>
        </div>
      )}

      {lastRefresh && !loading && (
        <div className="last-refresh">
          Last updated: {new Date(lastRefresh).toLocaleString()}
        </div>
      )}

      <div className="feature-flags-stats">
        <div
          className={`stat-card ${filterMode === null ? 'active' : ''}`}
          onClick={() => {
            setFilterMode(null);
            setShowMissingOnly(false);
          }}
          role="button"
          tabIndex={0}
        >
          <div className="stat-value">{stats.total}</div>
          <div className="stat-label">Total Flags</div>
        </div>
        <div
          className={`stat-card success ${filterMode === 'withNotes' ? 'active' : ''}`}
          onClick={() => {
            setFilterMode('withNotes');
            setShowMissingOnly(false);
          }}
          role="button"
          tabIndex={0}
        >
          <div className="stat-value">{stats.withNotes}</div>
          <div className="stat-label">With Release Notes</div>
        </div>
        <div
          className={`stat-card warning ${filterMode === 'missingNotes' ? 'active' : ''}`}
          onClick={() => {
            setFilterMode('missingNotes');
            setShowMissingOnly(false);
          }}
          role="button"
          tabIndex={0}
        >
          <div className="stat-value">{stats.missingNotes}</div>
          <div className="stat-label">Missing Release Notes</div>
        </div>
        <div
          className={`stat-card info ${filterMode === 'withJpd' ? 'active' : ''}`}
          onClick={() => {
            setFilterMode('withJpd');
            setShowMissingOnly(false);
          }}
          role="button"
          tabIndex={0}
        >
          <div className="stat-value">{stats.withJpd}</div>
          <div className="stat-label">With JPD</div>
        </div>
        <div
          className={`stat-card info ${filterMode === 'missingJpd' ? 'active' : ''}`}
          onClick={() => {
            setFilterMode('missingJpd');
            setShowMissingOnly(false);
          }}
          role="button"
          tabIndex={0}
        >
          <div className="stat-value">{stats.missingJpd}</div>
          <div className="stat-label">Missing JPD</div>
        </div>
      </div>

      <div className="feature-flags-controls">
        <div className="search-box">
          <input
            type="text"
            placeholder="Search flags, JPD, or summary..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <label className="filter-toggle">
          <input
            type="checkbox"
            checked={showMissingOnly}
            onChange={(e) => setShowMissingOnly(e.target.checked)}
          />
          Show only flags missing release notes
        </label>
      </div>

      <div className="feature-flags-count">
        Showing {filteredFlags.length} of {flags.length} flags
      </div>

      <div className="feature-flags-table-container">
        <table className="feature-flags-table">
          <thead>
            <tr>
              <th onClick={() => handleSort('flagKey')}>
                Feature Flag{renderSortIcon('flagKey')}
              </th>
              <th onClick={() => handleSort('tier')}>
                Tier{renderSortIcon('tier')}
              </th>
              <th onClick={() => handleSort('status')}>
                Status{renderSortIcon('status')}
              </th>
              <th onClick={() => handleSort('percentage')}>
                %{renderSortIcon('percentage')}
              </th>
              <th onClick={() => handleSort('hasReleaseNote')}>
                Release Note{renderSortIcon('hasReleaseNote')}
              </th>
              <th onClick={() => handleSort('jpdKey')}>
                JPD{renderSortIcon('jpdKey')}
              </th>
              <th>JPD Summary</th>
            </tr>
          </thead>
          <tbody>
            {filteredFlags.map((flag) => (
              <tr key={flag.flagKey}>
                <td>
                  <div className="flag-cell">
                    <a
                      href={flag.flagUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flag-link"
                    >
                      {flag.flagKey}
                    </a>
                    {flag.releaseVersion && (
                      <span className="release-version-pill">
                        v{flag.releaseVersion}
                      </span>
                    )}
                  </div>
                </td>
                <td>
                  {flag.tier && (
                    <span className={`tier-badge tier-${flag.tier}`}>
                      {flag.tier}
                    </span>
                  )}
                </td>
                <td>
                  <span className={`status-badge status-${flag.status.toLowerCase()}`}>
                    {flag.status}
                  </span>
                </td>
                <td className="percentage-cell">
                  {flag.status === 'ON' && flag.percentage > 0 && (
                    <div className="percentage-bar-container">
                      <div
                        className="percentage-bar"
                        style={{ width: `${flag.percentage}%` }}
                      />
                      <span className="percentage-text">{flag.percentage}%</span>
                    </div>
                  )}
                  {flag.status === 'OFF' && (
                    <span className="percentage-text-gray">—</span>
                  )}
                </td>
                <td className="release-note-cell">
                  {flag.hasReleaseNote ? (
                    <a
                      href={flag.releaseNoteUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="release-note-link has-note"
                      title={flag.releaseNoteTitle}
                    >
                      ✓ {flag.releaseNoteTitle}
                    </a>
                  ) : (
                    <span className="release-note-missing">✗ No release note</span>
                  )}
                </td>
                <td>
                  {flag.jpdKey ? (
                    <a
                      href={flag.jpdUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="jpd-link"
                    >
                      {flag.jpdKey}
                    </a>
                  ) : (
                    <span className="jpd-missing">—</span>
                  )}
                </td>
                <td className="jpd-summary-cell">
                  <span title={flag.jpdSummary}>
                    {flag.jpdSummary}
                  </span>
                </td>
              </tr>
            ))}
            {filteredFlags.length === 0 && (
              <tr>
                <td colSpan="7" className="empty-state">
                  {showMissingOnly
                    ? 'No flags missing release notes! 🎉'
                    : 'No flags found.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default FeatureFlagsView;
