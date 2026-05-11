import React, { useState } from 'react';
import { authenticatedFetch } from './api';

const BulkSubmitView = ({ standalone = false, onSubmitSuccess }) => {
  const [jpdLinks, setJpdLinks] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);
  const [duplicateWarning, setDuplicateWarning] = useState(null);
  const [pendingSubmit, setPendingSubmit] = useState(null);

  const parseLinks = (text) => {
    // Support both line-separated and comma-separated
    const separators = /[\n,]+/;
    const links = text
      .split(separators)
      .map(link => link.trim())
      .filter(link => link.length > 0);

    return links;
  };

  const extractJiraKey = (url) => {
    // Jira URLs look like:
    // https://toasttab.atlassian.net/browse/CPPL-484
    // or just CPPL-484
    const patterns = [
      /\/browse\/([A-Z]+-\d+)/i,  // Matches /browse/CPPL-484
      /^([A-Z]+-\d+)$/i            // Matches plain CPPL-484
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) {
        return match[1];
      }
    }
    return null;
  };

  const checkDuplicates = async (items) => {
    try {
      const response = await authenticatedFetch('/api/review-queue/check-duplicate', {
        method: 'POST',
        body: JSON.stringify({
          jiraKeys: items.map(item => item.jiraKey)
        })
      });

      if (!response.ok) {
        throw new Error('Failed to check for duplicates');
      }

      const data = await response.json();
      return data.duplicates || {};
    } catch (err) {
      console.error('Error checking duplicates:', err);
      return {};
    }
  };

  const handleSubmit = async (e, force = false) => {
    if (e) e.preventDefault();

    setError(null);
    setResults(null);
    setDuplicateWarning(null);

    const links = force && pendingSubmit ? pendingSubmit.links : parseLinks(jpdLinks);

    if (links.length === 0) {
      setError('Please enter at least one Jira link');
      return;
    }

    // Extract Jira keys
    const items = links.map(link => ({
      url: link,
      jiraKey: extractJiraKey(link)
    }));

    // Check for invalid URLs
    const invalidUrls = items.filter(item => !item.jiraKey);
    if (invalidUrls.length > 0) {
      setError(`Could not extract Jira issue key from ${invalidUrls.length} URL(s). Please use Jira URLs like https://toasttab.atlassian.net/browse/CPPL-484 or just the issue key like CPPL-484`);
      return;
    }

    // Check for duplicates unless force is true
    if (!force) {
      const duplicates = await checkDuplicates(items);
      const duplicateJiraKeys = Object.keys(duplicates);

      if (duplicateJiraKeys.length > 0) {
        // Show warning about duplicates
        setPendingSubmit({ links, items });
        setDuplicateWarning({
          count: duplicateJiraKeys.length,
          items: duplicateJiraKeys.map(jiraKey => ({
            jiraKey,
            reporter: duplicates[jiraKey].reporter,
            submittedAt: new Date(duplicates[jiraKey].submittedAt).toLocaleDateString()
          }))
        });
        return;
      }
    }

    // Clear pending submit if we're forcing
    setPendingSubmit(null);
    setDuplicateWarning(null);
    setSubmitting(true);

    try {
      const response = await authenticatedFetch('/api/review-queue/submit', {
        method: 'POST',
        body: JSON.stringify({
          jiraKeys: items.map(item => item.jiraKey),
          force: force
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to submit pages');
      }

      const data = await response.json();
      setResults(data);
      setJpdLinks(''); // Clear the form on success

      // Notify parent component to refresh count
      if (onSubmitSuccess && data.successful && data.successful.length > 0) {
        onSubmitSuccess();
      }
    } catch (err) {
      setError(err.message || 'An error occurred while submitting');
      console.error('Bulk submit error:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmDuplicates = () => {
    handleSubmit(null, true);
  };

  const handleCancelDuplicates = () => {
    setDuplicateWarning(null);
    setPendingSubmit(null);
  };

  const handleClear = () => {
    setJpdLinks('');
    setResults(null);
    setError(null);
    setDuplicateWarning(null);
    setPendingSubmit(null);
  };

  return (
    <div className={standalone ? "bulk-submit-standalone" : "bulk-submit-view"}>
      {standalone && (
        <div className="standalone-header">
          <h1>Submit JPDs for Review</h1>
          <p className="standalone-description">
            Submit Jira issue URLs or keys to be reviewed by the release notes team. The system will automatically find the linked Confluence pages.
          </p>
        </div>
      )}

      {!standalone && (
        <div className="bulk-submit-header">
          <h2>Bulk Submit JPDs</h2>
          <p className="bulk-submit-description">
            Paste Jira issue URLs or keys (one per line or comma-separated) to submit them for review. The system will automatically find the linked Confluence pages. Questions about the release notes process? Head over to #toast-release-notes on Slack and ask away!
          </p>
        </div>
      )}

      <form onSubmit={(e) => handleSubmit(e, false)} className="bulk-submit-form">
        <div className="form-group">
          <label htmlFor="jpd-links">
            JPD Links <span className="label-hint">(Jira issue URLs or keys)</span>
          </label>
          <textarea
            id="jpd-links"
            className="bulk-submit-textarea"
            value={jpdLinks}
            onChange={(e) => setJpdLinks(e.target.value)}
            placeholder="https://toasttab.atlassian.net/browse/CPPL-484&#10;https://toasttab.atlassian.net/browse/CPPL-485&#10;CPPL-486&#10;CPPL-487"
            rows={10}
            disabled={submitting || duplicateWarning}
          />
          <div className="form-hint">
            Enter Jira URLs or issue keys - one per line, or comma-separated
          </div>
        </div>

        <div className="bulk-submit-actions">
          <button
            type="submit"
            className="btn btn-primary"
            disabled={submitting || !jpdLinks.trim() || duplicateWarning}
          >
            {submitting ? (
              <>
                <span className="spinner" /> Submitting...
              </>
            ) : (
              `Submit ${parseLinks(jpdLinks).length} Page${parseLinks(jpdLinks).length !== 1 ? 's' : ''}`
            )}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleClear}
            disabled={submitting}
          >
            Clear
          </button>
        </div>
      </form>

      {duplicateWarning && (
        <div className="duplicate-warning">
          <h3>⚠️ Duplicate Submissions Detected</h3>
          <p>
            {duplicateWarning.count} page{duplicateWarning.count !== 1 ? 's have' : ' has'} already been submitted for review:
          </p>
          <ul className="duplicate-list">
            {duplicateWarning.items.map((item, index) => (
              <li key={index}>
                <strong>{item.jiraKey}</strong> - submitted by <strong>{item.reporter}</strong> on {item.submittedAt}
              </li>
            ))}
          </ul>
          <p>Do you want to re-submit {duplicateWarning.count === 1 ? 'this page' : 'these pages'}?</p>
          <div className="duplicate-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleConfirmDuplicates}
              disabled={submitting}
            >
              Yes, Re-submit
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleCancelDuplicates}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="bulk-submit-error">
          <strong>Error:</strong> {error}
        </div>
      )}

      {results && (
        <div className="bulk-submit-results">
          <h3>✓ Submission Complete</h3>
          <p className="results-message">
            Your pages have been submitted for review. The release notes team will process them soon.
          </p>
          <div className="results-summary">
            <div className="result-stat success">
              <span className="stat-number">{results.successful?.length || 0}</span>
              <span className="stat-label">Successfully submitted</span>
            </div>
            {results.failed && results.failed.length > 0 && (
              <div className="result-stat error">
                <span className="stat-number">{results.failed.length}</span>
                <span className="stat-label">Failed</span>
              </div>
            )}
          </div>

          {results.successful && results.successful.length > 0 && (
            <div className="results-section">
              <h4>Successfully Submitted</h4>
              <ul className="results-list">
                {results.successful.map((item) => (
                  <li key={item.jiraKey || item.pageId} className="result-item success-item">
                    <span className="result-icon">✓</span>
                    <span className="result-title">{item.jiraKey}: {item.pageTitle || `Page ${item.pageId}`}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {results.failed && results.failed.length > 0 && (
            <div className="results-section">
              <h4>Failed</h4>
              <ul className="results-list">
                {results.failed.map((item, index) => (
                  <li key={index} className="result-item error-item">
                    <span className="result-icon">✗</span>
                    <span className="result-error">
                      {item.jiraKey || item.pageId}: {item.error}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default BulkSubmitView;
