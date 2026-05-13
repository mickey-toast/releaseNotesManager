import React, { useState, useEffect } from 'react';
import { authenticatedFetch } from './api';
import { usePermissions } from './permissionsContext';

const ReviewQueueView = ({ onCountChange }) => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [rechecking, setRechecking] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [statusFilter, setStatusFilter] = useState('all');
  const [error, setError] = useState(null);
  const perms = usePermissions();

  const isAdmin = perms.loaded && perms.isAdmin;

  useEffect(() => {
    fetchReviewQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const fetchReviewQueue = async () => {
    setLoading(true);
    setError(null);

    try {
      const url = statusFilter === 'all'
        ? '/api/review-queue'
        : `/api/review-queue?status=${encodeURIComponent(statusFilter)}`;

      console.log('[ReviewQueue] Fetching from:', url);
      const response = await authenticatedFetch(url);

      console.log('[ReviewQueue] Response status:', response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[ReviewQueue] Error response:', errorText);
        throw new Error('Failed to fetch review queue');
      }

      const data = await response.json();
      console.log('[ReviewQueue] Received data:', data);
      console.log('[ReviewQueue] Items count:', data.items?.length || 0);
      setItems(data.items || []);
    } catch (err) {
      console.error('[ReviewQueue] Error fetching review queue:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleStatusChange = async (id, newStatus) => {
    if (!isAdmin) {
      alert('Only admins can change status');
      return;
    }

    try {
      const response = await authenticatedFetch(`/api/review-queue/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ status: newStatus })
      });

      if (!response.ok) {
        throw new Error('Failed to update status');
      }

      const data = await response.json();

      // If marked as Published, item is deleted from queue
      if (data.deleted) {
        setItems(items.filter(item => item.id !== id));
        setSelectedIds(prev => {
          const newSet = new Set(prev);
          newSet.delete(id);
          return newSet;
        });
      } else {
        // Update the item in the list
        setItems(items.map(item =>
          item.id === id ? { ...item, status: newStatus } : item
        ));
      }

      // Notify parent to update count
      if (onCountChange) {
        onCountChange();
      }
    } catch (err) {
      console.error('Error updating status:', err);
      alert('Failed to update status: ' + err.message);
    }
  };

  const handleBulkDelete = async () => {
    if (!isAdmin) {
      alert('Only admins can delete items');
      return;
    }

    if (selectedIds.size === 0) {
      alert('Please select items to delete');
      return;
    }

    if (!window.confirm(`Delete ${selectedIds.size} selected item${selectedIds.size !== 1 ? 's' : ''}?`)) {
      return;
    }

    try {
      const response = await authenticatedFetch('/api/review-queue/bulk-delete', {
        method: 'POST',
        body: JSON.stringify({ ids: Array.from(selectedIds) })
      });

      if (!response.ok) {
        throw new Error('Failed to delete items');
      }

      // Remove deleted items from list
      setItems(items.filter(item => !selectedIds.has(item.id)));
      setSelectedIds(new Set());

      // Notify parent to update count
      if (onCountChange) {
        onCountChange();
      }
    } catch (err) {
      console.error('Error deleting items:', err);
      alert('Failed to delete items: ' + err.message);
    }
  };

  const handleRecheckConfluence = async () => {
    if (selectedIds.size === 0) {
      alert('Please select items to re-check');
      return;
    }

    setRechecking(true);
    try {
      const response = await authenticatedFetch('/api/review-queue/recheck-confluence', {
        method: 'POST',
        body: JSON.stringify({ ids: Array.from(selectedIds) })
      });

      if (!response.ok) {
        throw new Error('Failed to re-check Confluence pages');
      }

      const data = await response.json();

      // Refresh the list to show updated items
      await fetchReviewQueue();

      // Clear selection
      setSelectedIds(new Set());

      // Show results
      const message = `${data.results.updated.length} page${data.results.updated.length !== 1 ? 's' : ''} found and updated.\n${data.results.unchanged.length} item${data.results.unchanged.length !== 1 ? 's' : ''} unchanged.${data.results.failed.length > 0 ? `\n${data.results.failed.length} failed.` : ''}`;
      alert(message);
    } catch (err) {
      console.error('Error re-checking Confluence pages:', err);
      alert('Failed to re-check Confluence pages: ' + err.message);
    } finally {
      setRechecking(false);
    }
  };

  const handleMarkAsDuplicate = async (item) => {
    if (!item.page_id) {
      alert('No Confluence page found for this item. Use "Re-check Confluence Pages" first.');
      return;
    }

    if (!window.confirm(`Mark "${item.page_title || item.jira_key}" as duplicate?\n\nThis will:\n- Move the page to DISCARDED status\n- Add a comment: "This page is a duplicate and has been discarded. For help with this page, Send a message to #toast-release-notes."`)) {
      return;
    }

    try {
      const response = await authenticatedFetch(`/api/pages/${item.page_id}/mark-duplicate`, {
        method: 'POST'
      });

      if (!response.ok) {
        throw new Error('Failed to mark as duplicate');
      }

      // Remove item from queue after successful duplicate marking
      setItems(items.filter(i => i.id !== item.id));
      setSelectedIds(prev => {
        const newSet = new Set(prev);
        newSet.delete(item.id);
        return newSet;
      });

      // Notify parent to update count
      if (onCountChange) {
        onCountChange();
      }

      alert('Page marked as duplicate and moved to Discarded');
    } catch (err) {
      console.error('Error marking as duplicate:', err);
      alert('Failed to mark as duplicate: ' + err.message);
    }
  };

  const handleBulkMarkAsDuplicate = async () => {
    if (selectedIds.size === 0) {
      alert('Please select items to mark as duplicate');
      return;
    }

    // Filter selected items to only those with page_id
    const selectedItems = items.filter(item => selectedIds.has(item.id));
    const itemsWithPages = selectedItems.filter(item => item.page_id);

    if (itemsWithPages.length === 0) {
      alert('None of the selected items have a Confluence page. Use "Re-check Confluence Pages" first.');
      return;
    }

    if (!window.confirm(`Mark ${itemsWithPages.length} selected item${itemsWithPages.length !== 1 ? 's' : ''} as duplicate?\n\nThis will:\n- Move pages to DISCARDED status\n- Add duplicate comments to each page`)) {
      return;
    }

    let successCount = 0;
    let failCount = 0;

    for (const item of itemsWithPages) {
      try {
        const response = await authenticatedFetch(`/api/pages/${item.page_id}/mark-duplicate`, {
          method: 'POST'
        });

        if (response.ok) {
          successCount++;
        } else {
          failCount++;
        }
      } catch (err) {
        console.error(`Error marking ${item.jira_key} as duplicate:`, err);
        failCount++;
      }
    }

    // Refresh the list
    await fetchReviewQueue();
    setSelectedIds(new Set());

    // Show results
    const message = `${successCount} page${successCount !== 1 ? 's' : ''} marked as duplicate.${failCount > 0 ? `\n${failCount} failed.` : ''}`;
    alert(message);

    // Notify parent to update count
    if (onCountChange) {
      onCountChange();
    }
  };

  const handleSelectAll = (e) => {
    if (e.target.checked) {
      setSelectedIds(new Set(items.map(item => item.id)));
    } else {
      setSelectedIds(new Set());
    }
  };

  const handleSelectItem = (id) => {
    setSelectedIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  const getStatusCounts = () => {
    const counts = {
      all: items.length,
      'To Do': 0,
      'Under Review': 0,
      'Published': 0
    };

    items.forEach(item => {
      if (counts[item.status] !== undefined) {
        counts[item.status]++;
      }
    });

    return counts;
  };

  const statusCounts = getStatusCounts();

  if (loading) {
    return (
      <div className="review-queue-view">
        <div className="review-queue-header">
          <h2>JPD Review Queue</h2>
        </div>
        <div className="loading-state">
          <span className="spinner" /> Loading review queue...
        </div>
      </div>
    );
  }

  return (
    <div className="review-queue-view">
      <div className="review-queue-header">
        <h2>JPD Review Queue</h2>
        <p className="review-queue-description">
          {isAdmin
            ? 'Manage submitted JPD pages for review. Update status or remove items from the queue.'
            : 'View submitted JPD pages awaiting review.'}
        </p>
      </div>

      <div className="review-queue-controls">
        <div className="status-filter-tabs">
          <button
            className={`status-filter-tab ${statusFilter === 'all' ? 'active' : ''}`}
            onClick={() => setStatusFilter('all')}
          >
            All <span className="tab-count">{statusCounts.all}</span>
          </button>
          <button
            className={`status-filter-tab ${statusFilter === 'To Do' ? 'active' : ''}`}
            onClick={() => setStatusFilter('To Do')}
          >
            To Do <span className="tab-count">{statusCounts['To Do']}</span>
          </button>
          <button
            className={`status-filter-tab ${statusFilter === 'Under Review' ? 'active' : ''}`}
            onClick={() => setStatusFilter('Under Review')}
          >
            Under Review <span className="tab-count">{statusCounts['Under Review']}</span>
          </button>
        </div>

        <button
          className="btn btn-secondary"
          onClick={fetchReviewQueue}
          disabled={loading}
        >
          {loading ? <span className="spinner" /> : null} Refresh
        </button>
      </div>

      {selectedIds.size > 0 && (
        <div className="bulk-actions-bar">
          <span className="selected-count">
            {selectedIds.size} selected
          </span>
          <button
            className="btn btn-info"
            onClick={handleRecheckConfluence}
            disabled={rechecking}
            title="Check if Confluence pages have been created for selected items"
          >
            {rechecking ? (
              <>
                <span className="spinner" /> Re-checking...
              </>
            ) : (
              <>🔄 Re-check Confluence Pages</>
            )}
          </button>
          {isAdmin && (
            <>
              <button
                className="btn btn-warning"
                onClick={handleBulkMarkAsDuplicate}
                title="Mark selected pages as duplicates and move to Discarded"
              >
                Mark as Duplicate
              </button>
              <button
                className="btn btn-danger"
                onClick={handleBulkDelete}
              >
                Delete Selected
              </button>
            </>
          )}
          <button
            className="btn btn-secondary"
            onClick={() => setSelectedIds(new Set())}
          >
            Clear Selection
          </button>
        </div>
      )}

      {error && (
        <div className="error-message">
          <strong>Error:</strong> {error}
        </div>
      )}

      {items.length === 0 ? (
        <div className="empty-state">
          <p>No items in the review queue{statusFilter !== 'all' ? ` with status "${statusFilter}"` : ''}.</p>
        </div>
      ) : (
        <div className="review-queue-table-container">
          <table className="review-queue-table">
            <thead>
              <tr>
                <th className="checkbox-column">
                  <input
                    type="checkbox"
                    checked={selectedIds.size === items.length && items.length > 0}
                    onChange={handleSelectAll}
                    title="Select all"
                  />
                </th>
                <th>Jira Issue</th>
                <th>Confluence Page</th>
                <th>Reporter</th>
                <th>Submitted</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className={selectedIds.has(item.id) ? 'selected' : ''}>
                  <td className="checkbox-column">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(item.id)}
                      onChange={() => handleSelectItem(item.id)}
                    />
                  </td>
                  <td className="jira-cell">
                    <a
                      href={item.jira_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="jira-link"
                      title="Open in Jira"
                    >
                      {item.jira_key}
                    </a>
                  </td>
                  <td className="jpd-cell">
                    {item.page_url ? (
                      <>
                        <a
                          href={item.page_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="jpd-link"
                          title="Open in Confluence"
                        >
                          {item.page_title || `Page ${item.page_id}`}
                        </a>
                        <span className="page-id">ID: {item.page_id}</span>
                      </>
                    ) : (
                      <span className="no-page-warning">
                        No linked Confluence page found
                      </span>
                    )}
                  </td>
                  <td>{item.reporter_email}</td>
                  <td>{new Date(item.submitted_at).toLocaleDateString()}</td>
                  <td>
                    {isAdmin ? (
                      <select
                        className={`status-select status-${item.status.toLowerCase().replace(' ', '-')}`}
                        value={item.status}
                        onChange={(e) => handleStatusChange(item.id, e.target.value)}
                      >
                        <option value="To Do">To Do</option>
                        <option value="Under Review">Under Review</option>
                        <option value="Published">Published</option>
                      </select>
                    ) : (
                      <span className={`status-badge status-${item.status.toLowerCase().replace(' ', '-')}`}>
                        {item.status}
                      </span>
                    )}
                  </td>
                  <td className="actions-cell">
                    {item.page_url && (
                      <a
                        href={item.page_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn-sm btn-secondary"
                        title="View in Confluence"
                      >
                        View
                      </a>
                    )}
                    {isAdmin && item.page_id && (
                      <button
                        className="btn btn-sm btn-warning"
                        onClick={() => handleMarkAsDuplicate(item)}
                        title="Mark as duplicate and move to Discarded"
                      >
                        Duplicate
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default ReviewQueueView;
