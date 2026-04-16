import React, { useState, useEffect, useCallback, useMemo, useId } from 'react';
import './App.css';
import SettingsModal from './SettingsModal';
import ExportForClaudeModal from './ExportForClaudeModal';
import AIHub from './AIHub';
import ActivityLogModal from './ActivityLogModal';
import FeatureFlagsView from './FeatureFlagsView';
import { authenticatedFetch, getAuthHeaders, getAppAuthHeaders, hasCredentials, getCredentials, shouldShowField, getDebugLogs, clearDebugLogs } from './api';
import { signOutApp, isSupabaseAuthConfigured } from './supabaseClient';
import { hydrateSettingsFromCloud, saveSettingsProfileToCloud } from './cloudProfile';
import { getNotificationRulesFromStorage, runDueNotificationRules } from './notificationRulesClient';
import { usePermissions } from './permissionsContext';
import AdminPortal from './AdminPortal';
import { logActivity, ACTIVITY_CATEGORIES } from './activityLog';
import { getTemplates } from './templateConstants';

// Confetti Celebration Component
const ConfettiCelebration = ({ onComplete }) => {
  useEffect(() => {
    const timer = setTimeout(() => {
      if (onComplete) onComplete();
    }, 3000); // Animation lasts 3 seconds
    return () => clearTimeout(timer);
  }, [onComplete]);

  // Create confetti pieces - mix of colors and shapes
  const confettiPieces = [];
  const colors = ['#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#ef4444'];
  const shapes = ['●', '■', '▲', '◆'];
  
  // Generate 50 confetti pieces
  for (let i = 0; i < 50; i++) {
    confettiPieces.push({
      id: i,
      color: colors[Math.floor(Math.random() * colors.length)],
      shape: shapes[Math.floor(Math.random() * shapes.length)],
      left: Math.random() * 100, // Random horizontal position (0-100%)
      delay: Math.random() * 0.5, // Stagger the start (0-0.5s)
      duration: 2 + Math.random() * 1, // 2-3 seconds
      angle: Math.random() * 360, // Random rotation
      xVelocity: (Math.random() - 0.5) * 200, // Horizontal drift
      size: 8 + Math.random() * 8 // Size variation
    });
  }

  return (
    <div className="confetti-celebration">
      {confettiPieces.map((piece) => (
        <div
          key={piece.id}
          className="confetti-piece"
          style={{
            left: `${piece.left}%`,
            color: piece.color,
            animationDelay: `${piece.delay}s`,
            animationDuration: `${piece.duration}s`,
            '--angle': `${piece.angle}deg`,
            '--x-velocity': `${piece.xVelocity}px`,
            '--size': `${piece.size}px`
          }}
        >
          {piece.shape}
        </div>
      ))}
    </div>
  );
};

// Theme options
const THEMES = [
  { id: 'dim', name: 'Dim' },
  { id: 'dark', name: 'Dark' },
  { id: 'light', name: 'Light' }
];

/** Simple inline SVGs so the trigger always renders clearly (no empty emoji slot). */
function ThemeGlyph({ themeId, className = '' }) {
  const dimGradId = useId();
  const svgProps = {
    className: `theme-glyph ${className}`.trim(),
    width: 20,
    height: 20,
    viewBox: '0 0 24 24',
    'aria-hidden': true,
    focusable: false
  };

  if (themeId === 'light') {
    return (
      <svg {...svgProps}>
        <circle cx="12" cy="12" r="4" fill="currentColor" />
        <path
          d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  if (themeId === 'dark') {
    return (
      <svg {...svgProps}>
        <path
          fill="currentColor"
          fillRule="evenodd"
          d="M9.528 1.718a.75.75 0 01.162.819A8.97 8.97 0 009 6a9 9 0 009 9 8.97 8.97 0 003.463-.69.75.75 0 01.981.98 10.503 10.503 0 01-9.694 6.46c-5.799 0-10.5-4.701-10.5-10.5 0-4.368 2.667-8.112 6.46-9.694a.75.75 0 01.818.162z"
          clipRule="evenodd"
        />
      </svg>
    );
  }

  // dim — horizontal half light / half dark (between sun and full moon)
  return (
    <svg {...svgProps}>
      <defs>
        <linearGradient id={dimGradId} x1="4" y1="12" x2="20" y2="12" gradientUnits="userSpaceOnUse">
          <stop stopColor="currentColor" stopOpacity="0.35" />
          <stop offset="1" stopColor="currentColor" stopOpacity="1" />
        </linearGradient>
      </defs>
      <circle cx="12" cy="12" r="8" fill={`url(#${dimGradId})`} />
    </svg>
  );
}

// Theme picker component
const ThemePicker = () => {
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('theme') || 'dim';
  });
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  return (
    <div className="theme-picker">
      <button
        type="button"
        className="theme-picker-btn"
        onClick={() => setIsOpen(!isOpen)}
        title="Change theme"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
      >
        <ThemeGlyph themeId={theme} />
      </button>
      {isOpen && (
        <>
          <div className="overflow-backdrop" onClick={() => setIsOpen(false)} />
          <div className="theme-dropdown" role="listbox" aria-label="Theme">
            {THEMES.map(t => (
              <button
                key={t.id}
                type="button"
                role="option"
                aria-selected={theme === t.id}
                className={`theme-option ${theme === t.id ? 'active' : ''}`}
                onClick={() => { setTheme(t.id); setIsOpen(false); }}
              >
                <span className="theme-icon">
                  <ThemeGlyph themeId={t.id} />
                </span>
                <span>{t.name}</span>
                {theme === t.id && <span className="theme-check">✓</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

// Status badge component
const StatusBadge = ({ days, threshold = 30 }) => {
  if (days === null || days === undefined) return <span className="status-badge neutral">—</span>;
  
  const isStale = threshold && days >= threshold;
  const isWarning = threshold && days >= threshold * 0.7 && days < threshold;
  
  let className = 'status-badge';
  if (isStale) className += ' stale';
  else if (isWarning) className += ' warning';
  else className += ' fresh';
  
  return (
    <span className={className}>
      {days} {days === 1 ? 'day' : 'days'}
    </span>
  );
};

// Jira status color mapping
const getStatusColor = (category) => {
  switch (category?.toLowerCase()) {
    case 'done': return '#10b981';
    case 'in progress': return '#3b82f6';
    case 'to do': return '#64748b';
    default: return '#6366f1';
  }
};

// Page Detail Panel component
const PageDetailPanel = ({
  page,
  onClose,
  statuses,
  currentStatus,
  onMove,
  onViewComments,
  onAddComment,
  onViewJiraComments,
  isAssigned,
  onAssign,
  onUnassign,
  onAddToLaunchNotes,
  onAISuggestions,
  onCheckCompliance,
  onSyncFromConfluence,
  syncingFromConfluence,
  onRefreshFromJira,
  refreshingJira,
  onNotesUpdated,
  onCreateDocTicket,
  docTicketsBusy,
  addToast
}) => {
  const { ai: canAi, launchnotes: canLn } = usePermissions();
  const [docTicketCreating, setDocTicketCreating] = useState(false);
  const [jiraData, setJiraData] = useState(null);
  const [jiraLoading, setJiraLoading] = useState(false);
  const [jiraError, setJiraError] = useState(null);
  const [pageBody, setPageBody] = useState(null);
  const [pageBodyLoading, setPageBodyLoading] = useState(false);
  const [showPageBody, setShowPageBody] = useState(false);
  const [notesText, setNotesText] = useState('');
  const [notesLoading, setNotesLoading] = useState(false);
  const [notesSaving, setNotesSaving] = useState(false);

  useEffect(() => {
    if (!page?.id) return;
    setNotesLoading(true);
    authenticatedFetch(`/api/pages/${page.id}/notes`)
      .then(res => res.json())
      .then(data => {
        setNotesText(data.text != null ? data.text : '');
      })
      .catch(() => setNotesText(''))
      .finally(() => setNotesLoading(false));
  }, [page?.id]);

  const saveNotes = useCallback(async () => {
    if (!page?.id) return;
    setNotesSaving(true);
    try {
      const response = await authenticatedFetch(`/api/pages/${page.id}/notes`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: notesText })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (addToast) addToast(data.error || 'Failed to save notes', 'error');
        return;
      }
      if (data.text != null) setNotesText(data.text);
      if (onNotesUpdated) onNotesUpdated(page.id);
      if (addToast) addToast('Notes saved', 'success');
    } catch (err) {
      console.error('Failed to save notes:', err);
      if (addToast) addToast('Failed to save notes', 'error');
    } finally {
      setNotesSaving(false);
    }
  }, [page?.id, notesText, onNotesUpdated, addToast]);

  useEffect(() => {
    if (page?.jiraTicket) {
      setJiraLoading(true);
      setJiraError(null);
      authenticatedFetch(`/api/jira/issue/${page.jiraTicket}`)
        .then(res => res.json())
        .then(data => {
          if (data.error) {
            setJiraError(data.details || data.error);
          } else {
            setJiraData(data);
          }
        })
        .catch(err => setJiraError(err.message))
        .finally(() => setJiraLoading(false));
    } else {
      setJiraData(null);
    }
  }, [page?.jiraTicket]);

  const fetchPageBody = useCallback(async () => {
    if (pageBody !== null) {
      setShowPageBody(!showPageBody);
      return;
    }
    
    setPageBodyLoading(true);
    try {
      const response = await authenticatedFetch(`/api/pages/${page.id}`);
      const data = await response.json();
      if (data.error) {
        setPageBody('<p>Error loading page content</p>');
      } else {
        setPageBody(data.body || '<p>No content available</p>');
        setShowPageBody(true);
      }
    } catch (err) {
      setPageBody('<p>Error loading page content</p>');
      setShowPageBody(true);
    } finally {
      setPageBodyLoading(false);
    }
  }, [page?.id, pageBody, showPageBody]);

  if (!page) return null;

  return (
    <div className="detail-panel-overlay" onClick={onClose}>
      <div className="detail-panel" onClick={e => e.stopPropagation()}>
        <div className="detail-panel-header">
          <h2>{page.title}</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="detail-panel-content">
          {/* Notes - app-only notes for this record */}
          <section className="detail-section notes-section">
            <h3 className="notes-section-title">
              <span className="notes-icon" aria-hidden="true">📝</span>
              Notes
            </h3>
            {notesLoading ? (
              <p className="notes-placeholder">Loading notes…</p>
            ) : (
              <>
                <textarea
                  className="notes-textarea"
                  placeholder="Add notes for this record (only visible in this app, not in Confluence or Jira)…"
                  value={notesText}
                  onChange={e => setNotesText(e.target.value)}
                  rows={3}
                />
                <div className="notes-actions">
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={saveNotes}
                    disabled={notesSaving}
                  >
                    {notesSaving ? 'Saving…' : 'Save notes'}
                  </button>
                </div>
              </>
            )}
          </section>

          {/* Quick Actions - Moved to top for better UX */}
          <section className="detail-section">
            <h3>Quick Actions</h3>
            <div className="quick-actions">
              {Object.entries(statuses).map(([key, status]) => (
                key !== currentStatus && (
                  <button 
                    key={key}
                    className="quick-action-btn"
                    onClick={() => onMove(page, key)}
                  >
                    Move to {status.name}
                  </button>
                )
              ))}
              {canLn && (
                <button 
                  className="quick-action-btn launchnotes-btn"
                  onClick={() => {
                    if (onAddToLaunchNotes) {
                      onAddToLaunchNotes([page]);
                    } else {
                      alert('LaunchNotes functionality is not available. Please check your settings.');
                    }
                  }}
                  title="Create draft in LaunchNotes"
                >
                  Add to LaunchNotes
                </button>
              )}
              {page.jiraTicket && onCreateDocTicket && (
                <button
                  type="button"
                  className="quick-action-btn"
                  disabled={docTicketCreating || docTicketsBusy}
                  title="Create a DOC Story with Confluence body as description, and link it (Relates) to the page’s reference Jira issue"
                  onClick={async () => {
                    setDocTicketCreating(true);
                    try {
                      await onCreateDocTicket(page.id);
                    } finally {
                      setDocTicketCreating(false);
                    }
                  }}
                >
                  {docTicketCreating ? 'Creating DOC…' : 'Create DOC ticket'}
                </button>
              )}
            </div>
          </section>

          {/* Assignment */}
          <section className="detail-section detail-section-small">
            <h3>Assignment</h3>
            {isAssigned ? (
              <div className="assignment-status">
                <span className="assignment-badge assigned">Assigned to you</span>
                <button 
                  className="btn btn-secondary btn-sm"
                  onClick={() => onUnassign(page.id)}
                >
                  Unassign
                </button>
              </div>
            ) : (
              <div className="assignment-status">
                <span className="assignment-badge unassigned">Not assigned</span>
                <button 
                  className="btn btn-primary btn-sm"
                  onClick={() => onAssign(page.id)}
                >
                  Assign to Me
                </button>
              </div>
            )}
          </section>

          {/* Reference Assignee from Confluence - Moved up with Assignment */}
          {page.referenceAssignee && (
            <section className="detail-section detail-section-small">
              <h3>Reference Ticket Assignee</h3>
              <p className="reference-assignee">{page.referenceAssignee}</p>
            </section>
          )}

          {/* Confluence Info */}
          <section className="detail-section">
            <h3>Confluence Page</h3>
            <div className="detail-grid">
              <div className="detail-item">
                <span className="detail-label">Author</span>
                <span className="detail-value">{page.author}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">Created</span>
                <span className="detail-value">{page.createdDaysAgo} days ago</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">Last Activity</span>
                <span className="detail-value">
                  <StatusBadge days={page.lastActivityDaysAgo} threshold={30} />
                </span>
              </div>
              <div className="detail-item">
                <span className="detail-label">Comments</span>
                <span className="detail-value">{page.commentCount || 0}</span>
              </div>
            </div>
            <div className="detail-actions">
              <a href={page.url} target="_blank" rel="noopener noreferrer" className="btn btn-primary">
                Open in Confluence →
              </a>
              {onSyncFromConfluence && (
                <button
                  className="btn btn-secondary"
                  onClick={() => onSyncFromConfluence([page.id])}
                  disabled={syncingFromConfluence}
                  title="Re-fetch this page from Confluence to update Jira ticket, assignee, comments, and other details"
                >
                  {syncingFromConfluence ? 'Syncing…' : '↻ Sync from Confluence'}
                </button>
              )}
              {onRefreshFromJira && page.jiraTicket && (
                <button
                  className="btn btn-secondary"
                  onClick={() => onRefreshFromJira([page.id])}
                  disabled={refreshingJira}
                  title="Fetch latest from Jira (fix version, labels, assignee, etc.). Jira remains source of truth; this only updates our view."
                >
                  {refreshingJira ? 'Refreshing…' : '↻ Refresh from Jira'}
                </button>
              )}
              <button className="btn btn-secondary" onClick={() => onViewComments(page)}>
                View Comments
              </button>
              {canAi && (
                <>
                  <button 
                    className="btn btn-secondary" 
                    onClick={() => onAISuggestions && onAISuggestions(page)}
                    title="Get AI-powered suggestions for improving this release note"
                  >
                    AI Suggestions
                  </button>
                  <button 
                    className="btn btn-secondary" 
                    onClick={() => onCheckCompliance && onCheckCompliance(page)}
                    title="Check style guide compliance"
                  >
                    ✓ Check Compliance
                  </button>
                </>
              )}
            </div>
            
            {/* Page Body */}
            <div className="page-body-section">
              <button 
                className="btn btn-secondary btn-sm"
                onClick={fetchPageBody}
                disabled={pageBodyLoading}
              >
                {pageBodyLoading ? (
                  <>Loading...</>
                ) : showPageBody ? (
                  <>▼ Hide Page Content</>
                ) : (
                  <>▶ Show Page Content</>
                )}
              </button>
              {showPageBody && pageBody && (
                <div 
                  className="page-body-content"
                  dangerouslySetInnerHTML={{ __html: pageBody }}
                />
              )}
            </div>
          </section>

          {/* Jira Ticket Info */}
          <section className="detail-section">
            <h3>Jira Ticket</h3>
            {!page.jiraTicket ? (
              <div className="detail-empty">
                <span>No Reference Ticket found in page</span>
              </div>
            ) : jiraLoading ? (
              <div className="detail-loading">
                <span className="spinner"></span> Loading Jira data...
              </div>
            ) : jiraError ? (
              <div className="detail-error">
                <span>{jiraError}</span>
                <a 
                  href={page.jiraUrl} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="btn btn-secondary btn-sm"
                >
                  Open {page.jiraTicket} anyway →
                </a>
              </div>
            ) : jiraData ? (
              <>
                <div className="jira-header">
                  <a 
                    href={jiraData.url} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="jira-key"
                  >
                    {jiraData.key}
                  </a>
                  <span 
                    className="jira-status"
                    style={{ backgroundColor: getStatusColor(jiraData.status?.category) }}
                  >
                    {jiraData.status?.name}
                  </span>
                </div>
                <p className="jira-summary">{jiraData.summary}</p>
                
                <div className="detail-grid">
                  <div className="detail-item">
                    <span className="detail-label">Assignee</span>
                    <span className="detail-value">
                      {jiraData.assignee ? (
                        <span className="user-badge">
                          {jiraData.assignee.displayName}
                        </span>
                      ) : (
                        <span className="unassigned">Unassigned</span>
                      )}
                    </span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Reporter</span>
                    <span className="detail-value">
                      {jiraData.reporter ? (
                        <span className="user-badge">
                          {jiraData.reporter.displayName}
                        </span>
                      ) : '—'}
                    </span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Priority</span>
                    <span className="detail-value">
                      {jiraData.priority ? (
                        <span className="priority-badge">
                          {jiraData.priority.iconUrl && (
                            <img src={jiraData.priority.iconUrl} alt="" className="priority-icon" />
                          )}
                          {jiraData.priority.name}
                        </span>
                      ) : '—'}
                    </span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Type</span>
                    <span className="detail-value">
                      {jiraData.issueType ? (
                        <span className="type-badge">
                          {jiraData.issueType.iconUrl && (
                            <img src={jiraData.issueType.iconUrl} alt="" className="type-icon" />
                          )}
                          {jiraData.issueType.name}
                        </span>
                      ) : '—'}
                    </span>
                  </div>
                  {jiraData.dueDate && (
                    <div className="detail-item">
                      <span className="detail-label">Due Date</span>
                      <span className="detail-value">{new Date(jiraData.dueDate).toLocaleDateString()}</span>
                    </div>
                  )}
                  {jiraData.fixVersions?.length > 0 && (
                    <div className="detail-item">
                      <span className="detail-label">Fix Version</span>
                      <span className="detail-value">{jiraData.fixVersions.join(', ')}</span>
                    </div>
                  )}
                </div>

                {jiraData.labels?.length > 0 && (
                  <div className="jira-labels">
                    {jiraData.labels.map(label => (
                      <span key={label} className="jira-label">{label}</span>
                    ))}
                  </div>
                )}

                <div className="detail-actions">
                  <a href={jiraData.url} target="_blank" rel="noopener noreferrer" className="btn btn-primary">
                    Open in Jira →
                  </a>
                  <button 
                    className="btn btn-secondary" 
                    onClick={() => onViewJiraComments?.(page, jiraData)}
                  >
                    View Comments
                  </button>
                </div>
              </>
            ) : null}
          </section>

        </div>
      </div>
    </div>
  );
};

// Overflow menu component
const OverflowMenu = ({ page, statuses, currentStatus, onMove, onViewComments, isAssigned, onAssign, onUnassign, onAddToLaunchNotes }) => {
  const { launchnotes: canLn } = usePermissions();
  const [isOpen, setIsOpen] = useState(false);
  const [dropdownStyle, setDropdownStyle] = useState({});
  const [copied, setCopied] = useState(false);
  const menuRef = React.useRef(null);
  const buttonRef = React.useRef(null);

  const handleMove = (targetStatus) => {
    onMove(page, targetStatus);
    setIsOpen(false);
  };

  const handleAssign = () => {
    if (isAssigned) {
      onUnassign(page.id);
    } else {
      onAssign(page.id);
    }
    setIsOpen(false);
  };

  const handleAddToLaunchNotes = (pagesToAdd) => {
    if (onAddToLaunchNotes) {
      onAddToLaunchNotes(pagesToAdd);
    }
  };

  const handleCopyUrl = async () => {
    if (page.url) {
      try {
        await navigator.clipboard.writeText(page.url);
        setCopied(true);
        setTimeout(() => {
          setCopied(false);
          setIsOpen(false);
        }, 1500);
      } catch (err) {
        console.error('Failed to copy URL:', err);
      }
    }
  };

  const handleToggle = () => {
    if (!isOpen && buttonRef.current) {
      // Calculate position for fixed dropdown
      const rect = buttonRef.current.getBoundingClientRect();
      const dropdownWidth = 180; // min-width from CSS
      const spaceOnRight = window.innerWidth - rect.right;
      const spaceOnLeft = rect.left;
      
      // Position dropdown - prefer right alignment, but switch to left if not enough space
      let right, left;
      if (spaceOnRight >= dropdownWidth || spaceOnRight >= spaceOnLeft) {
        right = `${window.innerWidth - rect.right}px`;
        left = 'auto';
      } else {
        left = `${rect.left}px`;
        right = 'auto';
      }
      
      setDropdownStyle({
        top: `${rect.bottom + 4}px`,
        right,
        left
      });
    }
    setIsOpen(!isOpen);
  };

  return (
    <div className="overflow-menu" ref={menuRef}>
      <button 
        ref={buttonRef}
        className="overflow-btn"
        onClick={handleToggle}
        title="Actions"
      >
        ⋮
      </button>
      {isOpen && (
        <>
          <div className="overflow-backdrop" onClick={() => setIsOpen(false)} />
          <div className="overflow-dropdown" style={dropdownStyle}>
            <button onClick={handleAssign}>
              {isAssigned ? 'Assigned to me' : 'Assign to me'}
            </button>
            <div className="overflow-divider" />
            <button onClick={() => { onViewComments(page); setIsOpen(false); }}>
              View Comments
            </button>
            <button onClick={handleCopyUrl} disabled={!page.url}>
              {copied ? 'Copied!' : 'Copy URL'}
            </button>
            <a 
              href={page.url} 
              target="_blank" 
              rel="noopener noreferrer"
              className="overflow-link"
              onClick={() => setIsOpen(false)}
            >
              Open in Confluence
            </a>
            {canLn && (
              <>
                <div className="overflow-divider" />
                <button onClick={() => { 
                  if (onAddToLaunchNotes) {
                    onAddToLaunchNotes([page]); 
                    setIsOpen(false);
                  } else {
                    alert('LaunchNotes functionality is not available. Please check your settings.');
                    setIsOpen(false);
                  }
                }}>
                  Add to LaunchNotes
                </button>
              </>
            )}
            <div className="overflow-divider" />
            <div className="overflow-label">Move to...</div>
            {Object.entries(statuses).map(([key, status]) => (
              key !== currentStatus && (
                <button 
                  key={key} 
                  onClick={() => handleMove(key)}
                  className="move-option"
                >
                  {status.name}
                </button>
              )
            ))}
          </div>
        </>
      )}
    </div>
  );
};

// Mention input component with @user autocomplete
const MentionInput = ({ value, onChange, placeholder, onSubmit, disabled }) => {
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionStartIndex, setMentionStartIndex] = useState(-1);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const textareaRef = React.useRef(null);

  // Store mentions for conversion to Confluence format
  const [mentions, setMentions] = useState([]);

  const searchUsers = useCallback(async (query) => {
    if (query.length < 2) {
      setSuggestions([]);
      return;
    }
    
    setSearchLoading(true);
    try {
      const response = await authenticatedFetch(`/api/users/search?q=${encodeURIComponent(query)}`);
      const data = await response.json();
      setSuggestions(data.users || []);
      setSelectedIndex(0);
    } catch (err) {
      console.error('Failed to search users:', err);
      setSuggestions([]);
    } finally {
      setSearchLoading(false);
    }
  }, []);

  const handleChange = (e) => {
    const newValue = e.target.value;
    const cursorPos = e.target.selectionStart;
    
    // Check if we're in a mention context
    const textBeforeCursor = newValue.slice(0, cursorPos);
    const lastAtIndex = textBeforeCursor.lastIndexOf('@');
    
    if (lastAtIndex !== -1) {
      const textAfterAt = textBeforeCursor.slice(lastAtIndex + 1);
      // Check if there's no space after @
      if (!textAfterAt.includes(' ') && !textAfterAt.includes('\n')) {
        setMentionStartIndex(lastAtIndex);
        setMentionQuery(textAfterAt);
        setShowSuggestions(true);
        searchUsers(textAfterAt);
      } else {
        setShowSuggestions(false);
        setMentionQuery('');
      }
    } else {
      setShowSuggestions(false);
      setMentionQuery('');
    }
    
    onChange(newValue);
  };

  const insertMention = (user) => {
    const beforeMention = value.slice(0, mentionStartIndex);
    const afterMention = value.slice(mentionStartIndex + mentionQuery.length + 1);
    const mentionText = `@${user.displayName}`;
    
    const newValue = beforeMention + mentionText + ' ' + afterMention;
    
    // Track this mention for later conversion
    setMentions(prev => [...prev, {
      text: mentionText,
      accountId: user.accountId,
      displayName: user.displayName
    }]);
    
    onChange(newValue);
    setShowSuggestions(false);
    setMentionQuery('');
    
    // Focus back on textarea
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        const newCursorPos = beforeMention.length + mentionText.length + 1;
        textareaRef.current.setSelectionRange(newCursorPos, newCursorPos);
      }
    }, 0);
  };

  const handleKeyDown = (e) => {
    if (showSuggestions && suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(prev => (prev + 1) % suggestions.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(prev => (prev - 1 + suggestions.length) % suggestions.length);
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        insertMention(suggestions[selectedIndex]);
      } else if (e.key === 'Escape') {
        setShowSuggestions(false);
      }
    } else if (e.key === 'Enter' && e.metaKey) {
      e.preventDefault();
      onSubmit?.();
    }
  };

  // Convert plain text with @mentions to Confluence storage format
  const getConfluenceMarkup = () => {
    let result = value;
    
    // Replace each mention with Confluence markup
    mentions.forEach(mention => {
      const mentionRegex = new RegExp(mention.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
      result = result.replace(
        mentionRegex,
        `<ac:link><ri:user ri:account-id="${mention.accountId}" /></ac:link>`
      );
    });
    
    return result;
  };

  // Expose the getConfluenceMarkup function
  React.useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.getConfluenceMarkup = getConfluenceMarkup;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, mentions]);

  return (
    <div className="mention-input-container">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        rows={3}
        disabled={disabled}
      />
      {showSuggestions && (
        <div className="mention-suggestions">
          {searchLoading ? (
            <div className="mention-loading">
              <span className="spinner"></span> Searching...
            </div>
          ) : suggestions.length === 0 ? (
            <div className="mention-empty">
              {mentionQuery.length < 2 ? 'Type at least 2 characters...' : 'No users found'}
            </div>
          ) : (
            suggestions.map((user, index) => (
              <button
                key={user.accountId}
                className={`mention-suggestion ${index === selectedIndex ? 'selected' : ''}`}
                onClick={() => insertMention(user)}
                type="button"
              >
                <div className="mention-avatar">
                  {user.avatarUrl ? (
                    <img src={user.avatarUrl} alt="" />
                  ) : (
                    <span>{user.displayName?.[0]?.toUpperCase() || '?'}</span>
                  )}
                </div>
                <div className="mention-info">
                  <span className="mention-name">{user.displayName}</span>
                  {user.email && <span className="mention-email">{user.email}</span>}
                </div>
              </button>
            ))
          )}
        </div>
      )}
      <div className="mention-hint">
        Type <code>@name</code> to mention someone • <code>⌘+Enter</code> to submit
      </div>
    </div>
  );
};

// Threaded Comment Viewer Component
const ThreadedCommentViewer = ({ comments, onAddComment, onReply, loading, type = 'confluence' }) => {
  const [replyingTo, setReplyingTo] = useState(null);
  const [replyTexts, setReplyTexts] = useState({});
  const [submitting, setSubmitting] = useState(false);

  // Ensure comments is always an array
  const safeComments = Array.isArray(comments) ? comments : [];

  const handleReply = async (parentId) => {
    const replyText = replyTexts[parentId] || '';
    if (!replyText.trim()) return;
    setSubmitting(true);
    await onReply(parentId, replyText);
    setReplyTexts(prev => {
      const newTexts = { ...prev };
      delete newTexts[parentId];
      return newTexts;
    });
    setReplyingTo(null);
    setSubmitting(false);
  };

  const renderComment = (comment, depth = 0) => {
    const isJira = type === 'jira';
    const author = isJira ? comment.author?.displayName : comment.author;
    const avatarUrl = isJira ? comment.author?.avatarUrl : comment.authorAvatar;
    const body = isJira ? comment.renderedBody : comment.body;
    const date = isJira ? new Date(comment.created) : new Date(comment.createdDate);
    const daysAgo = Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
    const isReplying = replyingTo === comment.id;
    const replyText = replyTexts[comment.id] || '';

    return (
      <div key={comment.id} className={`threaded-comment ${depth > 0 ? 'threaded-reply' : ''}`} style={{ marginLeft: `${depth * 24}px` }}>
        <div className="comment-header">
          <div className="comment-author-info">
            {avatarUrl && (
              <img src={avatarUrl} alt="" className="comment-avatar" />
            )}
            <span className="comment-author">{author}</span>
          </div>
          <span className="comment-date">{daysAgo === 0 ? 'just now' : `${daysAgo} day${daysAgo !== 1 ? 's' : ''} ago`}</span>
        </div>
        <div 
          className="comment-body"
          dangerouslySetInnerHTML={{ __html: body }}
        />
        <div className="comment-actions">
          <button
            className="comment-reply-btn"
            onClick={() => setReplyingTo(isReplying ? null : comment.id)}
          >
            Reply
          </button>
        </div>
        {isReplying && (
          <div className="comment-reply-form">
            <MentionInput
              value={replyText}
              onChange={(text) => setReplyTexts(prev => ({ ...prev, [comment.id]: text }))}
              placeholder="Write a reply... (use @ to mention someone)"
              onSubmit={() => handleReply(comment.id)}
              disabled={submitting}
            />
            <div className="comment-reply-actions">
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  setReplyingTo(null);
                  setReplyTexts(prev => {
                    const newTexts = { ...prev };
                    delete newTexts[comment.id];
                    return newTexts;
                  });
                }}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => handleReply(comment.id)}
                disabled={!replyText.trim() || submitting}
              >
                {submitting ? 'Posting...' : 'Post Reply'}
              </button>
            </div>
          </div>
        )}
        {comment.replies && comment.replies.length > 0 && (
          <div className="comment-replies">
            {comment.replies.map(reply => renderComment(reply, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="threaded-comments">
      {loading ? (
        <div className="loading-state">
          <div className="spinner"></div>
          <span>Loading comments...</span>
        </div>
      ) : safeComments.length === 0 ? (
        <div className="empty-state">
          <span className="empty-icon">No comments</span>
          <p>No comments yet</p>
        </div>
      ) : (
        <div className="threaded-comments-list">
          {safeComments.map(comment => renderComment(comment))}
        </div>
      )}
    </div>
  );
};

// Comment modal component
const CommentModal = ({ page, comments, loading, onClose, onAddComment, type = 'confluence' }) => {
  const [newComment, setNewComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e?.preventDefault();
    if (!newComment.trim()) return;
    
    setSubmitting(true);
    
    if (type === 'confluence') {
      // Get the Confluence markup version of the comment
      const textarea = document.querySelector('.mention-input-container textarea');
      const confluenceMarkup = textarea?.getConfluenceMarkup?.() || newComment;
      await onAddComment(page.id, confluenceMarkup);
    } else {
      // For Jira, we'll handle it differently
      await onAddComment(newComment);
    }
    
    setNewComment('');
    setSubmitting(false);
  };

  const handleReply = async (parentId, replyText) => {
    if (type === 'jira') {
      // For Jira threaded replies
      await onAddComment(replyText, parentId);
    } else {
      // For Confluence threaded replies
      const textarea = document.querySelector('.mention-input-container textarea');
      const confluenceMarkup = textarea?.getConfluenceMarkup?.() || replyText;
      await onAddComment(page.id, confluenceMarkup, parentId);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{type === 'jira' ? `Jira Comments on ${page.jiraTicket}` : `Confluence Comments on "${page.title}"`}</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>
        
        <div className="modal-body">
          <ThreadedCommentViewer
            comments={comments}
            onAddComment={onAddComment}
            onReply={handleReply}
            loading={loading}
            type={type}
          />
          
          <form onSubmit={handleSubmit} className="add-comment-form">
            <MentionInput
              value={newComment}
              onChange={setNewComment}
              placeholder={`Add a ${type === 'jira' ? 'Jira' : 'Confluence'} comment... (use @ to mention someone)`}
              onSubmit={handleSubmit}
              disabled={submitting}
            />
            <button 
              type="submit" 
              className="btn btn-primary"
              disabled={!newComment.trim() || submitting}
            >
              {submitting ? 'Adding...' : 'Add Comment'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

// Confirm modal component (simple version for non-move actions)
const ConfirmModal = ({ title, message, confirmText, onConfirm, onCancel, loading }) => {
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{title}</h2>
        </div>
        <div className="modal-body">
          <p>{message}</p>
          <div className="modal-actions">
            <button className="btn btn-secondary" onClick={onCancel} disabled={loading}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={onConfirm} disabled={loading}>
              {loading ? 'Moving...' : confirmText || 'Confirm'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// LaunchNotes Import Modal Component
const LaunchNotesImportModal = ({ pages, onConfirm, onCancel, loading: externalLoading }) => {
  const [loading, setLoading] = useState(false);

  const handleConfirm = async () => {
    const credentials = getCredentials();
    if (!credentials || (!credentials.launchnotesApiKey && !credentials.launchnotesUseSandbox) || !credentials.launchnotesProjectId) {
      alert('Please configure LaunchNotes API settings in Settings first.');
      return;
    }

    setLoading(true);
    const results = [];

    for (const page of pages) {
      try {
        const response = await authenticatedFetch('/api/launchnotes/create-draft', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Launchnotes-Api-Url': credentials.launchnotesApiUrl || 'https://app.launchnotes.io',
            'X-Launchnotes-Api-Key': credentials.launchnotesApiKey,
            'X-Launchnotes-Project-Id': credentials.launchnotesProjectId,
            'X-Launchnotes-Use-Sandbox': credentials.launchnotesUseSandbox ? 'true' : 'false'
          },
          body: JSON.stringify({
            pageId: page.id,
            title: page.title,
            ...(page.content != null && page.content !== '' && { content: page.content }),
            ...(page.jiraTicket && { jiraTicket: page.jiraTicket })
          })
        });

        const data = await response.json();
        if (!data.success) {
          throw new Error(data.error || data.details || 'Failed to create LaunchNotes draft');
        }
        let movedToInProgress = false;
        let moveError = null;
        if (page.status === 'draft' && page.id) {
          try {
            const moveRes = await authenticatedFetch(`/api/pages/${page.id}/move`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ targetStatus: 'inProgress' })
            });
            if (!moveRes.ok) {
              const errBody = await moveRes.json().catch(() => ({}));
              moveError = errBody.details || errBody.error || 'Failed to move page to In Progress';
            } else {
              movedToInProgress = true;
            }
          } catch (moveErr) {
            moveError = moveErr.message || 'Failed to move page to In Progress';
          }
        }
        results.push({ pageId: page.id, success: true, page, movedToInProgress, moveError });
      } catch (err) {
        console.error(`Failed to create LaunchNotes draft for page ${page.id}:`, err);
        const errorMessage = err.response?.json ? (await err.response.json()).error || err.message : err.message;
        results.push({ pageId: page.id, success: false, page, error: errorMessage });
        // Don't alert for each failure, let the handler show a summary
      }
    }

    setLoading(false);
    if (onConfirm) {
      onConfirm(results);
    }
  };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Add to LaunchNotes</h2>
          <button className="close-btn" onClick={onCancel}>×</button>
        </div>
        <div className="modal-body">
          <div className="move-confirm-content">
            <p className="move-confirm-intro">
              Create draft release notes in LaunchNotes for {pages.length} page{pages.length !== 1 ? 's' : ''}:
            </p>
            <div className="move-confirm-pages">
              {pages.map(page => (
                <div key={page.id} className="move-confirm-page-item">
                  <h4>{page.title}</h4>
                  {page.jiraTicket && (
                    <span className="jira-ticket-badge">{page.jiraTicket}</span>
                  )}
                </div>
              ))}
            </div>
            <div className="move-confirm-hint">
              {pages[0]?.content != null && pages[0].content !== ''
                ? 'The rewritten content from each draft will be sent to LaunchNotes as a draft announcement (with Jira link when available).'
                : 'The page content will be converted to Markdown format and sent to LaunchNotes as a draft announcement.'}
              {' '}
              Pages still in <strong>Draft</strong> are moved to <strong>In Progress</strong> in Confluence after each successful LaunchNotes create.
            </div>
          </div>
          <div className="modal-actions">
            <button className="btn btn-secondary" onClick={onCancel} disabled={loading}>
              Cancel
            </button>
            <button 
              className="btn btn-primary" 
              onClick={handleConfirm} 
              disabled={loading || externalLoading}
            >
              {loading || externalLoading ? 'Creating...' : `Create ${pages.length} Draft${pages.length !== 1 ? 's' : ''} in LaunchNotes`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// Quick Comment Menu Component with customizable templates
const QuickCommentMenu = ({ jiraData, page, onSelect, mentions, setMentions }) => {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = React.useRef(null);
  const buttonRef = React.useRef(null);

  const [templates, setTemplates] = useState(() => getTemplates());

  // Update templates when localStorage changes (e.g., from Settings modal)
  useEffect(() => {
    const handleStorageChange = () => {
      setTemplates(getTemplates());
    };
    
    // Listen for storage events (when Settings modal saves in another tab)
    window.addEventListener('storage', handleStorageChange);
    
    // Also listen for custom event when settings are saved in same window
    const handleSettingsSaved = () => {
      setTemplates(getTemplates());
    };
    window.addEventListener('settingsSaved', handleSettingsSaved);
    
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('settingsSaved', handleSettingsSaved);
    };
  }, []);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target) && 
          buttonRef.current && !buttonRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  // Replace template variables with actual values
  const processTemplate = (templateText) => {
    const assigneeMention = jiraData?.assignee ? `@${jiraData.assignee.displayName}` : 'there';
    const pageUrl = page?.url || '';
    const reporterMention = jiraData?.reporter ? `@${jiraData.reporter.displayName}` : '';
    
    return templateText
      .replace(/{assignee}/g, assigneeMention)
      .replace(/{pageUrl}/g, pageUrl)
      .replace(/{reporter}/g, reporterMention)
      .replace(/{ticket}/g, page?.jiraTicket || '');
  };

  const handleSelect = (template) => {
    const processedTemplate = processTemplate(template.template);
    onSelect(processedTemplate);
    // Track the mention if assignee exists
    if (jiraData?.assignee && !mentions.find(m => m.accountId === jiraData.assignee.accountId)) {
      setMentions([{
        accountId: jiraData.assignee.accountId,
        displayName: jiraData.assignee.displayName
      }]);
    }
    setIsOpen(false);
  };


  return (
    <div className="quick-comment-menu" ref={menuRef}>
      <button
        ref={buttonRef}
        type="button"
        className="btn btn-secondary btn-sm quick-comment-btn"
        onClick={() => setIsOpen(!isOpen)}
        title="Quick comment templates"
      >
        Quick Comment
        <span className="quick-comment-arrow">{isOpen ? '▲' : '▼'}</span>
      </button>
      {isOpen && (
        <div className="quick-comment-dropdown">
          {templates.length === 0 ? (
            <div className="quick-comment-empty">
              No templates available. Add some in Settings.
            </div>
          ) : (
            templates.map(template => {
              const preview = processTemplate(template.template);
              return (
                <button
                  key={template.id}
                  type="button"
                  className="quick-comment-option"
                  onClick={() => handleSelect(template)}
                  title={preview.length > 150 ? preview.substring(0, 150) + '...' : preview}
                >
                  <span className="quick-comment-option-name">{template.name}</span>
                  <span className="quick-comment-option-preview">{preview.substring(0, 80)}{preview.length > 80 ? '...' : ''}</span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};

// Label Selector Component
const LabelSelector = ({ selectedLabels, onChange }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);

  const searchLabels = useCallback(async (query) => {
    if (!query || query.trim().length < 2) {
      setSearchResults([]);
      return;
    }

    setSearching(true);
    try {
      const response = await authenticatedFetch(`/api/jira/labels?query=${encodeURIComponent(query)}`);
      const data = await response.json();
      setSearchResults(data.labels || []);
    } catch (err) {
      console.error('Error searching labels:', err);
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (searchQuery) {
        searchLabels(searchQuery);
      } else {
        setSearchResults([]);
      }
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [searchQuery, searchLabels]);

  const handleAddLabel = (label) => {
    if (!selectedLabels.includes(label)) {
      onChange([...selectedLabels, label]);
    }
    setSearchQuery('');
    setSearchResults([]);
    setShowDropdown(false);
  };

  const handleRemoveLabel = (label) => {
    onChange(selectedLabels.filter(l => l !== label));
  };

  const handleInputKeyDown = (e) => {
    if (e.key === 'Enter' && searchQuery.trim() && !searchResults.includes(searchQuery.trim())) {
      e.preventDefault();
      handleAddLabel(searchQuery.trim());
    }
  };

  return (
    <div className="label-selector">
      <label className="jira-comment-label">Labels (optional)</label>
      <div className="label-input-wrapper">
        <input
          type="text"
          className="label-search-input"
          placeholder="Type to search labels or press Enter to add..."
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            setShowDropdown(true);
          }}
          onFocus={() => setShowDropdown(true)}
          onKeyDown={handleInputKeyDown}
        />
        {showDropdown && (searchResults.length > 0 || searching) && (
          <div className="label-dropdown">
            {searching ? (
              <div className="label-dropdown-item">Searching...</div>
            ) : searchResults.length > 0 ? (
              searchResults
                .filter(label => !selectedLabels.includes(label))
                .map(label => (
                  <div
                    key={label}
                    className="label-dropdown-item clickable"
                    onClick={() => handleAddLabel(label)}
                  >
                    {label}
                  </div>
                ))
            ) : searchQuery.length >= 2 ? (
              <div className="label-dropdown-item">
                No labels found. Press Enter to add "{searchQuery}"
              </div>
            ) : null}
          </div>
        )}
      </div>
      {selectedLabels.length > 0 && (
        <div className="selected-labels">
          {selectedLabels.map(label => (
            <span key={label} className="jira-label selected">
                {label}
                <button
                  type="button"
                  className="label-remove-btn"
                onClick={() => handleRemoveLabel(label)}
                  aria-label={`Remove ${label}`}
                >
                  ×
                </button>
              </span>
            ))}
        </div>
      )}
      <div className="jira-comment-hint">
        Search for existing labels or type a new label and press Enter
      </div>
    </div>
  );
};

// Bulk Edit Modal - unified modal for all bulk actions
const BulkEditModal = ({ pages, currentStatus, statuses, onConfirm, onCancel, loading, onAssignToMe, onAddToLaunchNotes }) => {
  const { launchnotes: canLn } = usePermissions();
  const [selectedStatus, setSelectedStatus] = useState(null); // null = keep current, or status key
  const [jiraComment, setJiraComment] = useState('');
  const [confluenceComment, setConfluenceComment] = useState('');
  const [commentType, setCommentType] = useState('jira'); // 'jira', 'confluence', 'both'
  const [useIndividualSelection, setUseIndividualSelection] = useState(false); // Toggle between mass and individual selection
  const [pageCommentDestinations, setPageCommentDestinations] = useState({}); // { pageId: { jira: boolean, confluence: boolean } }
  const [selectedLabels, setSelectedLabels] = useState([]);
  const [mentions, setMentions] = useState([]);
  const [jiraTickets, setJiraTickets] = useState([]);
  const [loadingTickets, setLoadingTickets] = useState(true);
  const [activeTab, setActiveTab] = useState('location'); // 'location', 'assign', 'labels', 'comments'

  useEffect(() => {
    if (!canLn && activeTab === 'launchnotes') setActiveTab('location');
  }, [canLn, activeTab]);

  // Load Jira ticket info for all pages with tickets
  useEffect(() => {
    const loadJiraTickets = async () => {
      const pagesWithTickets = pages.filter(p => p.jiraTicket);
      if (pagesWithTickets.length === 0) {
        setLoadingTickets(false);
        return;
      }

      setLoadingTickets(true);
      const ticketPromises = pagesWithTickets.map(async (page) => {
        try {
          const response = await authenticatedFetch(`/api/jira/issue/${page.jiraTicket}`);
          const data = await response.json();
          if (!data.error) {
            return { page, jiraData: data };
          }
        } catch (err) {
          console.error(`Failed to load Jira ticket ${page.jiraTicket}:`, err);
        }
        return { page, jiraData: null };
      });

      const results = await Promise.all(ticketPromises);
      setJiraTickets(results.filter(r => r.jiraData));
      setLoadingTickets(false);
    };

    loadJiraTickets();
  }, [pages]);

  const handleMentionClick = (user) => {
    const mentionText = `@${user.displayName} `;
    setJiraComment(prev => prev + mentionText);
    
    if (!mentions.find(m => m.accountId === user.accountId)) {
      setMentions(prev => [...prev, {
        accountId: user.accountId,
        displayName: user.displayName
      }]);
    }
  };

  // Initialize page comment destinations when switching to individual mode
  useEffect(() => {
    if (useIndividualSelection && Object.keys(pageCommentDestinations).length === 0) {
      const initialDestinations = {};
      pages.forEach(page => {
        initialDestinations[page.id] = {
          jira: page.jiraTicket ? (commentType === 'jira' || commentType === 'both') : false,
          confluence: commentType === 'confluence' || commentType === 'both'
        };
      });
      setPageCommentDestinations(initialDestinations);
    }
  }, [useIndividualSelection, pages, commentType]);

  const togglePageCommentDestination = (pageId, destination) => {
    setPageCommentDestinations(prev => ({
      ...prev,
      [pageId]: {
        ...prev[pageId],
        [destination]: !prev[pageId]?.[destination]
      }
    }));
  };

  const handleConfirm = () => {
    let jiraCommentData = null;
    let confluenceCommentData = null;
    const pageCommentMap = {}; // { pageId: { jira: boolean, confluence: boolean } }

    if (useIndividualSelection) {
      // Individual selection mode - build per-page comment map
      pages.forEach(page => {
        const destinations = pageCommentDestinations[page.id] || { jira: false, confluence: false };
        if (destinations.jira && page.jiraTicket && jiraComment.trim()) {
          if (!pageCommentMap[page.id]) pageCommentMap[page.id] = {};
          pageCommentMap[page.id].jira = true;
        }
        if (destinations.confluence && confluenceComment.trim()) {
          if (!pageCommentMap[page.id]) pageCommentMap[page.id] = {};
          pageCommentMap[page.id].confluence = true;
        }
      });

      // Set comment data if any pages need them
      const hasJiraComments = Object.values(pageCommentMap).some(m => m.jira);
      const hasConfluenceComments = Object.values(pageCommentMap).some(m => m.confluence);

      if (hasJiraComments && jiraComment.trim()) {
        jiraCommentData = {
          body: jiraComment,
          mentions: mentions,
          pageMap: pageCommentMap
        };
      }
      if (hasConfluenceComments && confluenceComment.trim()) {
        confluenceCommentData = {
          body: confluenceComment,
          pageMap: pageCommentMap
        };
      }
    } else {
      // Mass selection mode - use commentType
      if ((commentType === 'jira' || commentType === 'both') && jiraComment.trim()) {
        jiraCommentData = {
      body: jiraComment,
      mentions: mentions
        };
      }
      if ((commentType === 'confluence' || commentType === 'both') && confluenceComment.trim()) {
        confluenceCommentData = {
          body: confluenceComment
        };
      }
    }
    
    onConfirm(
      selectedStatus, // targetStatus (null = no move)
      jiraCommentData,
      confluenceCommentData,
      selectedLabels.length > 0 ? selectedLabels : null
    );
  };

  const pagesWithTickets = pages.filter(p => p.jiraTicket);
  const pagesWithoutTickets = pages.filter(p => !p.jiraTicket);
  
  // Calculate if there are comments to add
  let hasJiraComment = false;
  let hasConfluenceComment = false;
  
  if (useIndividualSelection) {
    hasJiraComment = jiraComment.trim() && Object.values(pageCommentDestinations).some(d => d?.jira);
    hasConfluenceComment = confluenceComment.trim() && Object.values(pageCommentDestinations).some(d => d?.confluence);
  } else {
    hasJiraComment = (commentType === 'jira' || commentType === 'both') && jiraComment.trim();
    hasConfluenceComment = (commentType === 'confluence' || commentType === 'both') && confluenceComment.trim();
  }
  
  const hasChanges = selectedStatus !== null || hasJiraComment || hasConfluenceComment || selectedLabels.length > 0;

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Edit {pages.length} Page{pages.length !== 1 ? 's' : ''}</h2>
          <button className="close-btn" onClick={onCancel}>×</button>
        </div>
        <div className="modal-body">
          <div className="bulk-edit-content">
            {/* Selected Pages Summary */}
            <div className="bulk-edit-summary">
              <div className="bulk-pages-list">
                <h4>Selected Pages ({pages.length}):</h4>
                <ul className="bulk-pages-ul">
                  {pages.slice(0, 5).map(page => (
                    <li key={page.id}>
                      {page.title}
                      {page.jiraTicket && (
                        <span className="jira-ticket-badge">{page.jiraTicket}</span>
                      )}
                    </li>
                  ))}
                  {pages.length > 5 && (
                    <li className="bulk-pages-more">... and {pages.length - 5} more</li>
                  )}
                </ul>
              </div>
            </div>

            {/* Tab Navigation */}
            <div className="bulk-edit-tabs">
              <button
                className={`bulk-edit-tab ${activeTab === 'location' ? 'active' : ''}`}
                onClick={() => setActiveTab('location')}
              >
                Location
              </button>
              <button
                className={`bulk-edit-tab ${activeTab === 'assign' ? 'active' : ''}`}
                onClick={() => setActiveTab('assign')}
              >
                Assign
              </button>
              <button
                className={`bulk-edit-tab ${activeTab === 'labels' ? 'active' : ''}`}
                onClick={() => setActiveTab('labels')}
              >
                Labels
              </button>
              <button
                className={`bulk-edit-tab ${activeTab === 'comments' ? 'active' : ''}`}
                onClick={() => setActiveTab('comments')}
              >
                Comments
              </button>
              {canLn && (
                <button
                  className={`bulk-edit-tab ${activeTab === 'launchnotes' ? 'active' : ''}`}
                  onClick={() => setActiveTab('launchnotes')}
                >
                  LaunchNotes
                </button>
              )}
            </div>

            {/* Location Tab */}
            {activeTab === 'location' && (
              <div className="bulk-edit-section">
                <h3>Change Location</h3>
                <p className="bulk-edit-hint">
                  Select a new location for these pages, or leave unchanged to keep them in their current location.
                </p>
                <div className="status-selection-grid">
                  <button
                    className={`status-option ${selectedStatus === null ? 'selected' : ''}`}
                    onClick={() => setSelectedStatus(null)}
                  >
                    <span className="status-option-name">Keep Current Location</span>
                  </button>
                  {Object.entries(statuses).map(([key, status]) => (
                    <button
                      key={key}
                      className={`status-option ${selectedStatus === key ? 'selected' : ''} ${key === currentStatus ? 'current' : ''}`}
                      onClick={() => setSelectedStatus(key)}
                    >
                      <span className="status-option-name">{status.name}</span>
                      {key === currentStatus && <span className="status-option-badge">Current</span>}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Assign Tab */}
            {activeTab === 'assign' && (
              <div className="bulk-edit-section">
                <h3>Assign to Me</h3>
                <p className="bulk-edit-hint">
                  Assign these {pages.length} page{pages.length !== 1 ? 's' : ''} to yourself. They will appear in "My Tasks".
                </p>
                <div className="bulk-assign-actions">
                  <button
                    className="btn btn-primary"
                    onClick={() => {
                      pages.forEach(page => onAssignToMe(page.id));
                      onCancel();
                    }}
                  >
                    Assign All {pages.length} Page{pages.length !== 1 ? 's' : ''} to Me
                  </button>
                </div>
              </div>
            )}

            {/* Labels Tab */}
            {activeTab === 'labels' && (
              <div className="bulk-edit-section">
                <h3>Add Labels</h3>
                <p className="bulk-edit-hint">
                  Add labels to all Jira tickets associated with these pages. Labels will be merged with existing ones.
                </p>
                {pagesWithTickets.length > 0 ? (
                  <LabelSelector
                    selectedLabels={selectedLabels}
                    onChange={setSelectedLabels}
                  />
                ) : (
                  <div className="bulk-edit-info">
                    <p>None of the selected pages have Jira tickets. Labels can only be added to pages with Jira tickets.</p>
                  </div>
                )}
              </div>
            )}

            {/* Comments Tab */}
            {activeTab === 'comments' && (
              <div className="bulk-edit-section">
                <h3>Add Comments</h3>
                <p className="bulk-edit-hint">
                  Add comments to Jira tickets, Confluence pages, or both.
                </p>
                
                {/* Selection Mode Toggle */}
                <div className="comment-selection-mode">
                  <label className="selection-mode-toggle">
                    <input
                      type="checkbox"
                      checked={useIndividualSelection}
                      onChange={(e) => setUseIndividualSelection(e.target.checked)}
                    />
                    <span>Select comment destination individually per page</span>
                  </label>
                </div>

                {!useIndividualSelection ? (
                  /* Mass Selection Mode */
                  <div className="comment-type-selector">
                    <label className="comment-type-label">Comment Destination (applies to all pages):</label>
                    <div className="comment-type-options">
                      <button
                        type="button"
                        className={`comment-type-btn ${commentType === 'jira' ? 'active' : ''}`}
                        onClick={() => setCommentType('jira')}
                        disabled={pagesWithTickets.length === 0}
                        title={pagesWithTickets.length === 0 ? 'No pages have Jira tickets' : 'Add comment to Jira tickets only'}
                      >
                        Jira Only
                      </button>
                      <button
                        type="button"
                        className={`comment-type-btn ${commentType === 'confluence' ? 'active' : ''}`}
                        onClick={() => setCommentType('confluence')}
                        title="Add comment to Confluence pages only"
                      >
                        Confluence Only
                      </button>
                      <button
                        type="button"
                        className={`comment-type-btn ${commentType === 'both' ? 'active' : ''}`}
                        onClick={() => setCommentType('both')}
                        disabled={pagesWithTickets.length === 0}
                        title={pagesWithTickets.length === 0 ? 'No pages have Jira tickets' : 'Add comment to both Jira tickets and Confluence pages'}
                      >
                        Both
                      </button>
                    </div>
                  </div>
                ) : (
                  /* Individual Selection Mode */
                  <div className="individual-comment-selection">
                    <label className="comment-type-label">Select comment destination for each page:</label>
                    <div className="page-comment-destinations">
                      {pages.map(page => {
                        const destinations = pageCommentDestinations[page.id] || { jira: false, confluence: false };
                        return (
                          <div key={page.id} className="page-comment-destination-item">
                            <div className="page-comment-destination-title">
                              <strong>{page.title}</strong>
                              {page.jiraTicket && (
                                <span className="jira-ticket-badge">{page.jiraTicket}</span>
                              )}
                            </div>
                            <div className="page-comment-destination-options">
                              <label className="destination-checkbox">
                                <input
                                  type="checkbox"
                                  checked={destinations.jira}
                                  onChange={() => togglePageCommentDestination(page.id, 'jira')}
                                  disabled={!page.jiraTicket}
                                />
                                <span>Jira</span>
                              </label>
                              <label className="destination-checkbox">
                                <input
                                  type="checkbox"
                                  checked={destinations.confluence}
                                  onChange={() => togglePageCommentDestination(page.id, 'confluence')}
                                />
                                <span>Confluence</span>
                              </label>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Jira Comment Section */}
                {((!useIndividualSelection && (commentType === 'jira' || commentType === 'both')) || 
                 (useIndividualSelection && Object.values(pageCommentDestinations).some(d => d?.jira))) && (
                  <>
                {pagesWithTickets.length > 0 ? (
                  <>
                    {loadingTickets ? (
                      <div className="detail-loading">
                        <span className="spinner"></span> Loading Jira ticket information...
                      </div>
                    ) : jiraTickets.length > 0 ? (
                      <div className="bulk-jira-tickets">
                        <p className="bulk-jira-info">
                          The comment below will be added to all {jiraTickets.length} Jira ticket{jiraTickets.length !== 1 ? 's' : ''}:
                        </p>
                        <div className="bulk-jira-tickets-list">
                          {jiraTickets.slice(0, 5).map(({ page, jiraData }) => (
                            <div key={page.id} className="bulk-jira-ticket-item">
                              <div className="jira-header">
                                <a 
                                  href={jiraData.url} 
                                  target="_blank" 
                                  rel="noopener noreferrer"
                                  className="jira-key"
                                >
                                  {jiraData.key}
                                </a>
                                <span className="jira-ticket-title">{page.title}</span>
                              </div>
                              {jiraData.assignee && (
                                <button
                                  className="jira-user-clickable"
                                  onClick={() => handleMentionClick(jiraData.assignee)}
                                  title="Click to @ mention"
                                >
                                  <span className="user-badge">
                                    Assignee: {jiraData.assignee.displayName}
                                  </span>
                                </button>
                              )}
                            </div>
                          ))}
                          {jiraTickets.length > 5 && (
                            <div className="bulk-jira-tickets-more">
                              ... and {jiraTickets.length - 5} more ticket{jiraTickets.length - 5 !== 1 ? 's' : ''}
                            </div>
                          )}
                        </div>
                      </div>
                    ) : null}

                    <div className="jira-comment-section">
                      <div className="jira-comment-header">
                        <label className="jira-comment-label">Comment (optional)</label>
                        {jiraTickets.length > 0 && jiraTickets[0]?.jiraData && (
                          <div className="comment-toolbar">
                            {jiraTickets[0]?.page?.url && (
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm comment-toolbar-btn"
                                onClick={() => {
                                  const pageLink = `(${jiraTickets[0].page.url})`;
                                  setJiraComment(prev => prev + (prev.trim() ? ' ' : '') + pageLink);
                                }}
                                title="Insert Confluence page link"
                              >
                                📄 Insert Page Link
                              </button>
                            )}
                            <QuickCommentMenu
                              jiraData={jiraTickets[0].jiraData}
                              page={jiraTickets[0].page}
                              onSelect={(template) => setJiraComment(template)}
                              mentions={mentions}
                              setMentions={setMentions}
                            />
                          </div>
                        )}
                      </div>
                      <MentionInput
                        value={jiraComment}
                        onChange={setJiraComment}
                        placeholder="Add a comment to all Jira tickets... (use @ to mention someone)"
                        onSubmit={handleConfirm}
                        disabled={loading}
                      />
                      <div className="jira-comment-hint">
                        Click on Assignee above to automatically @ mention them • This comment will be posted to all {pagesWithTickets.length} ticket{pagesWithTickets.length !== 1 ? 's' : ''}
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="bulk-edit-info">
                      <p>None of the selected pages have Jira tickets. Jira comments can only be added to pages with Jira tickets.</p>
                    </div>
                  )}
                </>
                )}

                {/* Confluence Comment Section */}
                {((!useIndividualSelection && (commentType === 'confluence' || commentType === 'both')) || 
                 (useIndividualSelection && Object.values(pageCommentDestinations).some(d => d?.confluence))) && (
                  <div className="confluence-comment-section">
                    <div className="confluence-comment-header">
                      <label className="confluence-comment-label">Confluence Comment</label>
                    </div>
                    <textarea
                      className="confluence-comment-input"
                      value={confluenceComment}
                      onChange={(e) => setConfluenceComment(e.target.value)}
                      placeholder={`Add a comment to all ${pages.length} Confluence page${pages.length !== 1 ? 's' : ''}...`}
                      rows={4}
                      disabled={loading}
                    />
                    <div className="confluence-comment-hint">
                      This comment will be posted to all {pages.length} Confluence page{pages.length !== 1 ? 's' : ''}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* LaunchNotes Tab */}
            {activeTab === 'launchnotes' && (
              <div className="bulk-edit-section">
                <h3>Add to LaunchNotes</h3>
                <p className="bulk-edit-hint">
                  Create release note drafts in LaunchNotes from the selected Confluence pages.
                </p>
                <div className="bulk-launchnotes-actions">
                  <button
                    className="btn btn-primary"
                    onClick={() => {
                      if (onAddToLaunchNotes) {
                        onAddToLaunchNotes(pages);
                        onCancel(); // Close the bulk edit modal
                      }
                    }}
                  >
                    Add {pages.length} Page{pages.length !== 1 ? 's' : ''} to LaunchNotes
                  </button>
                  <p className="bulk-edit-hint" style={{ marginTop: '12px', fontSize: '12px' }}>
                    This will create draft release notes in LaunchNotes for each selected page. You can review and edit them in LaunchNotes before publishing.
                  </p>
                </div>
              </div>
            )}

            {/* Summary of Changes */}
            {hasChanges && (
              <div className="bulk-edit-summary-changes">
                <h4>Summary of Changes:</h4>
                <ul>
                  {selectedStatus !== null && (
                    <li>Move to <strong>{statuses[selectedStatus]?.name}</strong></li>
                  )}
                  {selectedLabels.length > 0 && (
                    <li>Add {selectedLabels.length} label{selectedLabels.length !== 1 ? 's' : ''}: {selectedLabels.join(', ')}</li>
                  )}
                  {hasJiraComment && (
                    <li>
                      Add Jira comment to {
                        useIndividualSelection 
                          ? Object.values(pageCommentDestinations).filter(d => d?.jira).length 
                          : pagesWithTickets.length
                      } ticket{useIndividualSelection 
                        ? Object.values(pageCommentDestinations).filter(d => d?.jira).length !== 1 ? 's' : '' 
                        : pagesWithTickets.length !== 1 ? 's' : ''}
                    </li>
                  )}
                  {hasConfluenceComment && (
                    <li>
                      Add Confluence comment to {
                        useIndividualSelection 
                          ? Object.values(pageCommentDestinations).filter(d => d?.confluence).length 
                          : pages.length
                      } page{useIndividualSelection 
                        ? Object.values(pageCommentDestinations).filter(d => d?.confluence).length !== 1 ? 's' : '' 
                        : pages.length !== 1 ? 's' : ''}
                    </li>
                  )}
                </ul>
              </div>
            )}

            {pagesWithoutTickets.length > 0 && (
              <div className="bulk-edit-warning">
                <p>
                  {pagesWithoutTickets.length} page{pagesWithoutTickets.length !== 1 ? 's' : ''} {pagesWithoutTickets.length === 1 ? 'does' : 'do'} not have Jira tickets and will only be affected by location changes.
                </p>
              </div>
            )}
          </div>

          <div className="modal-actions">
            <button className="btn btn-secondary" onClick={onCancel} disabled={loading}>
              Cancel
            </button>
            <button 
              className="btn btn-primary" 
              onClick={handleConfirm} 
              disabled={loading || !hasChanges}
              title={!hasChanges ? 'Please make at least one change' : ''}
            >
              {loading ? 'Applying...' : hasChanges ? 'Apply Changes' : 'No Changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// Standalone Jira Comment Modal (for adding comments without moving)
const JiraCommentModal = ({ page, jiraData: initialJiraData, onConfirm, onCancel, loading }) => {
  const [jiraComment, setJiraComment] = useState('');
  const [selectedLabels, setSelectedLabels] = useState([]);
  const [mentions, setMentions] = useState([]);
  const [jiraData, setJiraData] = useState(initialJiraData);
  const [jiraLoading, setJiraLoading] = useState(false);

  useEffect(() => {
    if (page?.jiraTicket && !jiraData) {
      setJiraLoading(true);
      authenticatedFetch(`/api/jira/issue/${page.jiraTicket}`)
        .then(res => res.json())
        .then(data => {
          if (!data.error) {
            setJiraData(data);
          }
        })
        .catch(err => console.error('Failed to load Jira data:', err))
        .finally(() => setJiraLoading(false));
    }
  }, [page?.jiraTicket, jiraData]);

  const handleMentionClick = (user) => {
    const mentionText = `@${user.displayName} `;
    setJiraComment(prev => prev + mentionText);
    
    if (!mentions.find(m => m.accountId === user.accountId)) {
      setMentions(prev => [...prev, {
        accountId: user.accountId,
        displayName: user.displayName
      }]);
    }
  };

  const handleConfirm = () => {
    const commentData = jiraComment.trim() ? {
      body: jiraComment,
      mentions: mentions
    } : null;
    
    onConfirm(commentData, selectedLabels.length > 0 ? selectedLabels : null);
  };

  if (!page?.jiraTicket) {
    return (
      <div className="modal-overlay" onClick={onCancel}>
        <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
          <div className="modal-header">
            <h2>No Jira Ticket</h2>
            <button className="close-btn" onClick={onCancel}>×</button>
          </div>
          <div className="modal-body">
            <p>This page does not have a Jira ticket associated with it.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Add Comment to {page.jiraTicket}</h2>
          <button className="close-btn" onClick={onCancel}>×</button>
        </div>
        <div className="modal-body">
          <div className="move-confirm-content">
            <div className="move-confirm-page-info">
              <h3>{page.title}</h3>
            </div>

            {jiraLoading ? (
              <div className="detail-loading">
                <span className="spinner"></span> Loading Jira data...
              </div>
            ) : jiraData && (
              <div className="move-confirm-section">
                <h3>Jira Ticket Details</h3>
                <div className="jira-ticket-details">
                  <div className="jira-header">
                    <a 
                      href={jiraData.url} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="jira-key"
                    >
                      {jiraData.key}
                    </a>
                    <span 
                      className="jira-status"
                      style={{ backgroundColor: getStatusColor(jiraData.status?.category) }}
                    >
                      {jiraData.status?.name}
                    </span>
                  </div>
                  <p className="jira-summary">{jiraData.summary}</p>
                  
                  {jiraData.assignee && (
                    <div className="jira-detail-item">
                      <span className="jira-detail-label">Assignee</span>
                      <span className="jira-detail-value">
                        <button
                          className="jira-user-clickable"
                          onClick={() => handleMentionClick(jiraData.assignee)}
                          title="Click to @ mention"
                        >
                          <span className="user-badge">
                            {jiraData.assignee.displayName}
                          </span>
                        </button>
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="move-confirm-section">
              <div className="jira-comment-section">
                <div className="jira-comment-header">
                  <label className="jira-comment-label">Comment</label>
                  <div className="comment-toolbar">
                    {page?.url && (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm comment-toolbar-btn"
                        onClick={() => {
                          const pageLink = `(${page.url})`;
                          setJiraComment(prev => prev + (prev.trim() ? ' ' : '') + pageLink);
                        }}
                        title="Insert Confluence page link"
                      >
                        📄 Insert Page Link
                      </button>
                    )}
                    {jiraData && (
                      <QuickCommentMenu
                        jiraData={jiraData}
                        page={page}
                        onSelect={(template) => setJiraComment(template)}
                        mentions={mentions}
                        setMentions={setMentions}
                      />
                    )}
                  </div>
                </div>
                <MentionInput
                  value={jiraComment}
                  onChange={setJiraComment}
                  placeholder="Add a comment to the Jira ticket... (use @ to mention someone)"
                  onSubmit={handleConfirm}
                  disabled={loading}
                />
                <div className="jira-comment-hint">
                  💡 Click on Assignee above to automatically @ mention them
                </div>
              </div>

              <div className="jira-labels-section">
                <LabelSelector
                  selectedLabels={selectedLabels}
                  onChange={setSelectedLabels}
                />
              </div>
            </div>
          </div>

          <div className="modal-actions">
            <button className="btn btn-secondary" onClick={onCancel} disabled={loading}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={handleConfirm} disabled={loading || !jiraComment.trim()}>
              {loading ? 'Posting...' : 'Post Comment'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// Enhanced Move Confirmation Modal with Jira comment support
const MoveConfirmModal = ({ page, targetStatus, statuses, onConfirm, onCancel, loading, addComment }) => {
  const [jiraData, setJiraData] = useState(null);
  const [jiraLoading, setJiraLoading] = useState(false);
  const [jiraError, setJiraError] = useState(null);
  const [jiraComment, setJiraComment] = useState('');
  const [selectedLabels, setSelectedLabels] = useState([]);
  const [pageBody, setPageBody] = useState(null);
  const [pageBodyLoading, setPageBodyLoading] = useState(false);
  const [showPageBody, setShowPageBody] = useState(false);
  const [mentions, setMentions] = useState([]);

  const targetStatusConfig = statuses[targetStatus];

  useEffect(() => {
    if (page?.jiraTicket) {
      setJiraLoading(true);
      setJiraError(null);
      authenticatedFetch(`/api/jira/issue/${page.jiraTicket}`)
        .then(res => res.json())
        .then(data => {
          if (data.error) {
            setJiraError(data.details || data.error);
          } else {
            setJiraData(data);
          }
        })
        .catch(err => setJiraError(err.message))
        .finally(() => setJiraLoading(false));
    } else {
      setJiraData(null);
    }
  }, [page?.jiraTicket]);

  const fetchPageBody = useCallback(async () => {
    if (pageBody !== null) {
      setShowPageBody(!showPageBody);
      return;
    }
    
    setPageBodyLoading(true);
    try {
      const response = await authenticatedFetch(`/api/pages/${page.id}`);
      const data = await response.json();
      if (data.error) {
        setPageBody('<p>Error loading page content</p>');
      } else {
        setPageBody(data.body || '<p>No content available</p>');
        setShowPageBody(true);
      }
    } catch (err) {
      setPageBody('<p>Error loading page content</p>');
      setShowPageBody(true);
    } finally {
      setPageBodyLoading(false);
    }
  }, [page?.id, pageBody, showPageBody]);

  const handleMentionClick = (user) => {
    const mentionText = `@${user.displayName} `;
    setJiraComment(prev => prev + mentionText);
    
    // Track mention for API
    if (!mentions.find(m => m.accountId === user.accountId)) {
      setMentions(prev => [...prev, {
        accountId: user.accountId,
        displayName: user.displayName
      }]);
    }
  };

  const handleConfirm = () => {
    const commentData = jiraComment.trim() ? {
      body: jiraComment,
      mentions: mentions
    } : null;
    
    // If addComment is true, we're just adding a comment without moving
    if (addComment) {
      onConfirm(commentData, selectedLabels.length > 0 ? selectedLabels : null);
    } else {
      onConfirm(commentData, selectedLabels.length > 0 ? selectedLabels : null);
    }
  };

  // If addComment is true, show a simplified version focused on commenting
  if (addComment) {
    return (
      <div className="modal-overlay" onClick={onCancel}>
        <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
          <div className="modal-header">
            <h2>Add Comment to {page.jiraTicket}</h2>
            <button className="close-btn" onClick={onCancel}>×</button>
          </div>
          <div className="modal-body">
            <div className="move-confirm-content">
              <div className="move-confirm-page-info">
                <h3>{page.title}</h3>
              </div>

              {jiraData && (
                <div className="move-confirm-section">
                  <h3>Jira Ticket Details</h3>
                  <div className="jira-ticket-details">
                    <div className="jira-header">
                      <a 
                        href={jiraData.url} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="jira-key"
                      >
                        {jiraData.key}
                      </a>
                      <span 
                        className="jira-status"
                        style={{ backgroundColor: getStatusColor(jiraData.status?.category) }}
                      >
                        {jiraData.status?.name}
                      </span>
                    </div>
                    <p className="jira-summary">{jiraData.summary}</p>
                    
                    {jiraData.assignee && (
                      <div className="jira-detail-item">
                        <span className="jira-detail-label">Assignee</span>
                        <span className="jira-detail-value">
                          <button
                            className="jira-user-clickable"
                            onClick={() => handleMentionClick(jiraData.assignee)}
                            title="Click to @ mention"
                          >
                            <span className="user-badge">
                              {jiraData.assignee.displayName}
                            </span>
                          </button>
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="move-confirm-section">
                <div className="jira-comment-section">
                  <div className="jira-comment-header">
                    <label className="jira-comment-label">Comment</label>
                    <div className="comment-toolbar">
                      {page?.url && (
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm comment-toolbar-btn"
                          onClick={() => {
                            const pageLink = `(${page.url})`;
                            setJiraComment(prev => prev + (prev.trim() ? ' ' : '') + pageLink);
                          }}
                          title="Insert Confluence page link"
                        >
                          📄 Insert Page Link
                        </button>
                      )}
                      {jiraData && (
                        <QuickCommentMenu
                          jiraData={jiraData}
                          page={page}
                          onSelect={(template) => setJiraComment(template)}
                          mentions={mentions}
                          setMentions={setMentions}
                        />
                      )}
                    </div>
                  </div>
                  <MentionInput
                    value={jiraComment}
                    onChange={setJiraComment}
                    placeholder="Add a comment to the Jira ticket... (use @ to mention someone)"
                    onSubmit={handleConfirm}
                    disabled={loading}
                  />
                  <div className="jira-comment-hint">
                    💡 Click on Assignee above to automatically @ mention them
                  </div>
                </div>

                <div className="jira-labels-section">
                  <LabelSelector
                    selectedLabels={selectedLabels}
                    onChange={setSelectedLabels}
                  />
                </div>
              </div>
            </div>

          <div className="modal-actions">
            <button className="btn btn-secondary" onClick={onCancel} disabled={loading}>
              Cancel
              </button>
              <button className="btn btn-primary" onClick={handleConfirm} disabled={loading || !jiraComment.trim()}>
                {loading ? 'Posting...' : 'Post Comment'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Are you sure you want to move this page to {targetStatusConfig?.name}?</h2>
          <button className="close-btn" onClick={onCancel}>×</button>
        </div>
        <div className="modal-body">
          <div className="move-confirm-content">
            <div className="move-confirm-page-info">
              <h3>{page.title}</h3>
              <p className="move-confirm-message">
                This will move the page "{page.title}" to <strong>{targetStatusConfig?.name}</strong>.
              </p>
            </div>

            {/* Page Body (Expandable) */}
            <div className="move-confirm-section">
              <button 
                className="btn btn-secondary btn-sm"
                onClick={fetchPageBody}
                disabled={pageBodyLoading}
              >
                {pageBodyLoading ? (
                  <>Loading...</>
                ) : showPageBody ? (
                  <>▼ Hide Page Content</>
                ) : (
                  <>▶ Show Page Content</>
                )}
              </button>
              {showPageBody && pageBody && (
                <div 
                  className="page-body-content move-page-body"
                  dangerouslySetInnerHTML={{ __html: pageBody }}
                />
              )}
            </div>

            {/* Jira Ticket Section */}
            {page.jiraTicket && (
              <div className="move-confirm-section">
                <h3>Leave a comment on Jira ticket</h3>
                
                {jiraLoading ? (
                  <div className="detail-loading">
                    <span className="spinner"></span> Loading Jira data...
                  </div>
                ) : jiraError ? (
                  <div className="detail-error">
                    <span>{jiraError}</span>
                    <p>You can still leave a comment below.</p>
                  </div>
                ) : jiraData ? (
                  <div className="jira-ticket-details">
                    <div className="jira-header">
                      <a 
                        href={jiraData.url} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="jira-key"
                      >
                        {jiraData.key}
                      </a>
                      <span 
                        className="jira-status"
                        style={{ backgroundColor: getStatusColor(jiraData.status?.category) }}
                      >
                        {jiraData.status?.name}
                      </span>
                    </div>
                    <p className="jira-summary">{jiraData.summary}</p>
                    
                    <div className="jira-details-grid">
                      {shouldShowField('assignee') && (
                        <div className="jira-detail-item">
                          <span className="jira-detail-label">Assignee</span>
                          <span className="jira-detail-value">
                            {jiraData.assignee ? (
                              <button
                                className="jira-user-clickable"
                                onClick={() => handleMentionClick(jiraData.assignee)}
                                title="Click to @ mention"
                              >
                                <span className="user-badge">
                                  {jiraData.assignee.displayName}
                                </span>
                              </button>
                            ) : (
                              <span className="unassigned">Unassigned</span>
                            )}
                          </span>
                        </div>
                      )}
                      {shouldShowField('reporter') && (
                        <div className="jira-detail-item">
                          <span className="jira-detail-label">Reporter</span>
                          <span className="jira-detail-value">
                            {jiraData.reporter ? (
                              <button
                                className="jira-user-clickable"
                                onClick={() => handleMentionClick(jiraData.reporter)}
                                title="Click to @ mention"
                              >
                                <span className="user-badge">
                                  {jiraData.reporter.displayName}
                                </span>
                              </button>
                            ) : '—'}
                          </span>
                        </div>
                      )}
                      {shouldShowField('labels') && jiraData.labels && jiraData.labels.length > 0 && (
                        <div className="jira-detail-item">
                          <span className="jira-detail-label">Current Labels</span>
                          <span className="jira-detail-value">
                            <div className="jira-labels">
                              {jiraData.labels.map(label => (
                                <span key={label} className="jira-label">{label}</span>
                              ))}
                            </div>
                          </span>
                        </div>
                      )}
                      {shouldShowField('roadmapStatus') && (
                        <div className="jira-detail-item">
                          <span className="jira-detail-label">Roadmap Status</span>
                          <span className="jira-detail-value">
                            {jiraData.roadmapStatus || '—'}
                          </span>
                        </div>
                      )}
                      {shouldShowField('priority') && jiraData.priority && (
                        <div className="jira-detail-item">
                          <span className="jira-detail-label">Priority</span>
                          <span className="jira-detail-value">
                            <span className="priority-badge">
                              {jiraData.priority.iconUrl && (
                                <img src={jiraData.priority.iconUrl} alt="" className="priority-icon" />
                              )}
                              {jiraData.priority.name}
                            </span>
                          </span>
                        </div>
                      )}
                      {shouldShowField('dueDate') && jiraData.dueDate && (
                        <div className="jira-detail-item">
                          <span className="jira-detail-label">Due Date</span>
                          <span className="jira-detail-value">
                            {new Date(jiraData.dueDate).toLocaleDateString()}
                          </span>
                        </div>
                      )}
                      {shouldShowField('fixVersions') && jiraData.fixVersions && jiraData.fixVersions.length > 0 && (
                        <div className="jira-detail-item">
                          <span className="jira-detail-label">Fix Versions</span>
                          <span className="jira-detail-value">
                            {jiraData.fixVersions.join(', ')}
                          </span>
                        </div>
                      )}
                      {shouldShowField('components') && jiraData.components && jiraData.components.length > 0 && (
                        <div className="jira-detail-item">
                          <span className="jira-detail-label">Components</span>
                          <span className="jira-detail-value">
                            {jiraData.components.join(', ')}
                          </span>
                        </div>
                      )}
                      {shouldShowField('issueType') && jiraData.issueType && (
                        <div className="jira-detail-item">
                          <span className="jira-detail-label">Issue Type</span>
                          <span className="jira-detail-value">
                            {jiraData.issueType.name}
                          </span>
                        </div>
                      )}
                      {shouldShowField('epicKey') && jiraData.epicKey && (
                        <div className="jira-detail-item">
                          <span className="jira-detail-label">Epic Key</span>
                          <span className="jira-detail-value">
                            {jiraData.epicKey}
                          </span>
                        </div>
                      )}
                      {/* Display custom fields if they exist */}
                      {jiraData.customFields && Object.keys(jiraData.customFields).map(fieldKey => {
                        const field = jiraData.customFields[fieldKey];
                        // Show custom fields by default (user can't hide them in preferences yet)
                        if (field && field.value) {
                          return (
                            <div key={fieldKey} className="jira-detail-item">
                              <span className="jira-detail-label">{field.name}</span>
                              <span className="jira-detail-value">
                                {Array.isArray(field.value) ? field.value.join(', ') : String(field.value)}
                              </span>
                            </div>
                          );
                        }
                        return null;
                      })}
                    </div>
                  </div>
                ) : null}

                <div className="jira-comment-section">
                  <div className="jira-comment-header">
                    <label className="jira-comment-label">Comment (optional)</label>
                    <div className="comment-toolbar">
                      {page?.url && (
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm comment-toolbar-btn"
                          onClick={() => {
                            const pageLink = `(${page.url})`;
                            setJiraComment(prev => prev + (prev.trim() ? ' ' : '') + pageLink);
                          }}
                          title="Insert Confluence page link"
                        >
                          📄 Insert Page Link
                        </button>
                      )}
                      <QuickCommentMenu
                        jiraData={jiraData}
                        page={page}
                        onSelect={(template) => setJiraComment(template)}
                        mentions={mentions}
                        setMentions={setMentions}
                      />
                    </div>
                  </div>
                  <MentionInput
                    value={jiraComment}
                    onChange={setJiraComment}
                    placeholder="Add a comment to the Jira ticket... (use @ to mention someone)"
                    onSubmit={handleConfirm}
                    disabled={loading}
                  />
                  <div className="jira-comment-hint">
                    💡 Click on Assignee or Reporter above to automatically @ mention them
                  </div>
                </div>

                <div className="jira-labels-section">
                  <LabelSelector
                    selectedLabels={selectedLabels}
                    onChange={setSelectedLabels}
                  />
                </div>
              </div>
            )}
          </div>

          <div className="modal-actions">
            <button className="btn btn-secondary" onClick={onCancel} disabled={loading}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={handleConfirm} disabled={loading}>
              {loading ? 'Moving...' : `Move to ${targetStatusConfig?.name}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// Troubleshooting Panel Component
const TroubleshootingPanel = ({ onClose }) => {
  const [mainTab, setMainTab] = useState('http'); // 'http' | 'audit'
  const [logs, setLogs] = useState([]);
  const [selectedLog, setSelectedLog] = useState(null);
  const [filter, setFilter] = useState('all'); // 'all', 'errors', 'success'
  const [searchTerm, setSearchTerm] = useState('');
  const [fixVersionIssueKey, setFixVersionIssueKey] = useState('CPPL-386');
  const [fixVersionDebugResult, setFixVersionDebugResult] = useState(null);
  const [fixVersionDebugLoading, setFixVersionDebugLoading] = useState(false);
  const [fixVersionDebugError, setFixVersionDebugError] = useState(null);
  const [auditEntries, setAuditEntries] = useState([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState(null);
  const [auditSearch, setAuditSearch] = useState('');
  const [selectedAudit, setSelectedAudit] = useState(null);

  const categoryLabels = useMemo(
    () => ACTIVITY_CATEGORIES.reduce((acc, c) => {
      acc[c.id] = c.label;
      return acc;
    }, {}),
    []
  );

  const loadAuditEntries = useCallback(async () => {
    setAuditLoading(true);
    setAuditError(null);
    try {
      const res = await authenticatedFetch('/api/audit-log?limit=300');
      const data = await res.json().catch(() => ({}));
      if (res.status === 404 && data.auditLog === false) {
        setAuditEntries([]);
        setAuditError('Team audit log needs Supabase on the server (SUPABASE_JWT_SECRET, SUPABASE_URL, SUPABASE_ANON_KEY) and the app_audit_log table.');
        return;
      }
      if (!res.ok) throw new Error(data.error || data.details || 'Failed to load audit log');
      setAuditEntries(data.entries || []);
      setSelectedAudit(null);
    } catch (e) {
      setAuditError(e.message || String(e));
      setAuditEntries([]);
    } finally {
      setAuditLoading(false);
    }
  }, []);

  useEffect(() => {
    if (mainTab !== 'audit') return undefined;
    loadAuditEntries();
    return undefined;
  }, [mainTab, loadAuditEntries]);

  useEffect(() => {
    // Set up callback for log updates
    window.debugLogUpdateCallback = () => {
      setLogs(getDebugLogs());
    };
    
    // Initial load
    setLogs(getDebugLogs());
    
    // Poll for updates
    const interval = setInterval(() => {
      setLogs(getDebugLogs());
    }, 500);
    
    return () => {
      clearInterval(interval);
      window.debugLogUpdateCallback = null;
    };
  }, []);

  const filteredLogs = logs.filter(log => {
    const matchesFilter = filter === 'all' || 
      (filter === 'errors' && (log.error || (log.status && log.status >= 400))) ||
      (filter === 'success' && !log.error && log.status && log.status < 400);
    
    const matchesSearch = !searchTerm || 
      log.url.toLowerCase().includes(searchTerm.toLowerCase()) ||
      JSON.stringify(log.request).toLowerCase().includes(searchTerm.toLowerCase()) ||
      JSON.stringify(log.response).toLowerCase().includes(searchTerm.toLowerCase());
    
    return matchesFilter && matchesSearch;
  });

  const filteredAuditEntries = useMemo(() => {
    const q = auditSearch.trim().toLowerCase();
    if (!q) return auditEntries;
    return auditEntries.filter((row) => {
      const blob = `${row.user_email || ''} ${row.category || ''} ${row.description || ''} ${JSON.stringify(row.details || {})}`.toLowerCase();
      return blob.includes(q);
    });
  }, [auditEntries, auditSearch]);

  const handleClear = () => {
    clearDebugLogs();
    setLogs([]);
    setSelectedLog(null);
  };

  const runFixVersionDebug = async () => {
    const key = fixVersionIssueKey?.trim();
    if (!key) return;
    setFixVersionDebugLoading(true);
    setFixVersionDebugResult(null);
    setFixVersionDebugError(null);
    try {
      const res = await authenticatedFetch(`/api/jira/debug-fix-version?issueKey=${encodeURIComponent(key)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.details || 'Request failed');
      setFixVersionDebugResult(data);
    } catch (e) {
      setFixVersionDebugError(e.message || String(e));
    } finally {
      setFixVersionDebugLoading(false);
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-xl troubleshooting-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Troubleshooting Panel</h2>
          <div className="troubleshooting-header-actions">
            {mainTab === 'http' && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={handleClear}>
                Clear Logs
              </button>
            )}
            <button type="button" className="close-btn" onClick={onClose}>×</button>
          </div>
        </div>

        <div className="troubleshooting-main-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            className={`troubleshooting-main-tab ${mainTab === 'http' ? 'active' : ''}`}
            onClick={() => { setMainTab('http'); setSelectedAudit(null); }}
          >
            HTTP request log
          </button>
          <button
            type="button"
            role="tab"
            className={`troubleshooting-main-tab ${mainTab === 'audit' ? 'active' : ''}`}
            onClick={() => setMainTab('audit')}
          >
            Team audit log
          </button>
        </div>
        
        {mainTab === 'http' ? (
        <div className="troubleshooting-body">
          <div className="troubleshooting-sidebar">
            <div className="troubleshooting-debug-fix-version">
              <div className="troubleshooting-debug-label">Debug Fix Version (Jira)</div>
              <div className="troubleshooting-debug-row">
                <input
                  type="text"
                  className="troubleshooting-debug-input"
                  placeholder="e.g. CPPL-386"
                  value={fixVersionIssueKey}
                  onChange={(e) => setFixVersionIssueKey(e.target.value)}
                />
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={runFixVersionDebug}
                  disabled={fixVersionDebugLoading}
                >
                  {fixVersionDebugLoading ? '…' : 'Run'}
                </button>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm troubleshooting-debug-clear"
                onClick={() => { setFixVersionDebugResult(null); setFixVersionDebugError(null); }}
              >
                Clear result
              </button>
            </div>
            <div className="troubleshooting-filters">
              <input
                type="text"
                className="troubleshooting-search"
                placeholder="Search logs..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
              <div className="troubleshooting-filter-buttons">
                <button
                  className={`filter-btn ${filter === 'all' ? 'active' : ''}`}
                  onClick={() => setFilter('all')}
                >
                  All ({logs.length})
                </button>
                <button
                  className={`filter-btn ${filter === 'errors' ? 'active' : ''}`}
                  onClick={() => setFilter('errors')}
                >
                  Errors ({logs.filter(l => l.error || (l.status && l.status >= 400)).length})
                </button>
                <button
                  className={`filter-btn ${filter === 'success' ? 'active' : ''}`}
                  onClick={() => setFilter('success')}
                >
                  Success ({logs.filter(l => !l.error && l.status && l.status < 400).length})
                </button>
              </div>
            </div>
            
            <div className="troubleshooting-log-list">
              {filteredLogs.length === 0 ? (
                <div className="troubleshooting-empty">No logs found</div>
              ) : (
                filteredLogs.map(log => (
                  <div
                    key={log.id}
                    className={`troubleshooting-log-item ${selectedLog?.id === log.id ? 'selected' : ''} ${log.error || (log.status && log.status >= 400) ? 'error' : ''}`}
                    onClick={() => setSelectedLog(log)}
                  >
                    <div className="log-item-method">{log.method}</div>
                    <div className="log-item-url">{log.url}</div>
                    <div className="log-item-meta">
                      <span className={`log-status status-${log.status ? Math.floor(log.status / 100) : 'unknown'}`}>
                        {log.status || 'Pending'}
                      </span>
                      {log.duration && <span className="log-duration">{log.duration}ms</span>}
                      <span className="log-time">
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
          
          <div className="troubleshooting-detail">
            {fixVersionDebugResult ? (
              <div className="troubleshooting-detail-content">
                <div className="detail-section">
                  <div className="detail-section-header">
                    <h3>Fix Version debug: {fixVersionDebugResult.issueKey}</h3>
                    <button 
                      className="btn btn-secondary btn-sm"
                      onClick={() => copyToClipboard(JSON.stringify(fixVersionDebugResult, null, 2))}
                    >
                      Copy JSON
                    </button>
                  </div>
                  {fixVersionDebugError && (
                    <div className="detail-info detail-section-error">
                      <pre>{fixVersionDebugError}</pre>
                    </div>
                  )}
                  <div className="detail-json">
                    <pre>{JSON.stringify(fixVersionDebugResult, null, 2)}</pre>
                  </div>
                </div>
              </div>
            ) : fixVersionDebugError ? (
              <div className="troubleshooting-detail-content">
                <div className="detail-section detail-section-error">
                  <h3>Fix Version debug error</h3>
                  <pre>{fixVersionDebugError}</pre>
                </div>
              </div>
            ) : selectedLog ? (
              <div className="troubleshooting-detail-content">
                <div className="detail-section">
                  <div className="detail-section-header">
                    <h3>Request</h3>
                    <button 
                      className="btn btn-secondary btn-sm"
                      onClick={() => copyToClipboard(JSON.stringify(selectedLog.request, null, 2))}
                    >
                      Copy JSON
                    </button>
                  </div>
                  <div className="detail-info">
                    <div className="detail-info-row">
                      <span className="detail-label">Method:</span>
                      <span className="detail-value">{selectedLog.method}</span>
                    </div>
                    <div className="detail-info-row">
                      <span className="detail-label">URL:</span>
                      <span className="detail-value">{selectedLog.url}</span>
                    </div>
                    <div className="detail-info-row">
                      <span className="detail-label">Timestamp:</span>
                      <span className="detail-value">{new Date(selectedLog.timestamp).toLocaleString()}</span>
                    </div>
                    {selectedLog.duration && (
                      <div className="detail-info-row">
                        <span className="detail-label">Duration:</span>
                        <span className="detail-value">{selectedLog.duration}ms</span>
                      </div>
                    )}
                  </div>
                  <div className="detail-json">
                    <pre>{JSON.stringify(selectedLog.request, null, 2)}</pre>
                  </div>
                </div>
                
                {selectedLog.response && (
                  <div className="detail-section">
                    <div className="detail-section-header">
                      <h3>Response</h3>
                      <button 
                        className="btn btn-secondary btn-sm"
                        onClick={() => copyToClipboard(JSON.stringify(selectedLog.response, null, 2))}
                      >
                        Copy JSON
                      </button>
                    </div>
                    <div className="detail-info">
                      <div className="detail-info-row">
                        <span className="detail-label">Status:</span>
                        <span className={`detail-value status-${Math.floor(selectedLog.response.status / 100)}`}>
                          {selectedLog.response.status} {selectedLog.response.statusText}
                        </span>
                      </div>
                    </div>
                    <div className="detail-json">
                      <pre>{JSON.stringify(selectedLog.response, null, 2)}</pre>
                    </div>
                  </div>
                )}
                
                {selectedLog.error && (
                  <div className="detail-section detail-section-error">
                    <div className="detail-section-header">
                      <h3>Error</h3>
                      <button 
                        className="btn btn-secondary btn-sm"
                        onClick={() => copyToClipboard(JSON.stringify(selectedLog.error, null, 2))}
                      >
                        Copy JSON
                      </button>
                    </div>
                    <div className="detail-json error-json">
                      <pre>{JSON.stringify(selectedLog.error, null, 2)}</pre>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="troubleshooting-empty-detail">
                Select a log entry to view details
              </div>
            )}
          </div>
        </div>
        ) : (
        <div className="troubleshooting-body">
          <div className="troubleshooting-sidebar">
            <div className="troubleshooting-audit-toolbar">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={loadAuditEntries}
                disabled={auditLoading}
              >
                {auditLoading ? 'Loading…' : 'Refresh'}
              </button>
              <input
                type="search"
                className="troubleshooting-search"
                placeholder="Search by email, action, category…"
                value={auditSearch}
                onChange={(e) => setAuditSearch(e.target.value)}
              />
            </div>
            {auditError && (
              <div className="troubleshooting-audit-error">{auditError}</div>
            )}
            <div className="troubleshooting-log-list troubleshooting-audit-list">
              {!auditLoading && filteredAuditEntries.length === 0 && !auditError && (
                <div className="troubleshooting-empty">No audit entries yet</div>
              )}
              {filteredAuditEntries.map((row) => (
                <div
                  key={row.id}
                  className={`troubleshooting-log-item troubleshooting-audit-item ${selectedAudit?.id === row.id ? 'selected' : ''}`}
                  onClick={() => setSelectedAudit(row)}
                >
                  <div className="troubleshooting-audit-email">{row.user_email || '—'}</div>
                  <div className="troubleshooting-audit-desc">{row.description}</div>
                  <div className="log-item-meta">
                    <span className="troubleshooting-audit-cat">{categoryLabels[row.category] || row.category}</span>
                    <span className="log-time">
                      {row.created_at ? new Date(row.created_at).toLocaleString() : '—'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="troubleshooting-detail">
            {selectedAudit ? (
              <div className="troubleshooting-detail-content">
                <div className="detail-section">
                  <div className="detail-section-header">
                    <h3>Audit entry</h3>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => copyToClipboard(JSON.stringify(selectedAudit, null, 2))}
                    >
                      Copy JSON
                    </button>
                  </div>
                  <div className="detail-info">
                    <div className="detail-info-row">
                      <span className="detail-label">User</span>
                      <span className="detail-value">{selectedAudit.user_email}</span>
                    </div>
                    <div className="detail-info-row">
                      <span className="detail-label">When</span>
                      <span className="detail-value">
                        {selectedAudit.created_at ? new Date(selectedAudit.created_at).toLocaleString() : '—'}
                      </span>
                    </div>
                    <div className="detail-info-row">
                      <span className="detail-label">Category</span>
                      <span className="detail-value">{categoryLabels[selectedAudit.category] || selectedAudit.category}</span>
                    </div>
                    <div className="detail-info-row">
                      <span className="detail-label">Action</span>
                      <span className="detail-value">{selectedAudit.description}</span>
                    </div>
                  </div>
                  {selectedAudit.details != null && Object.keys(selectedAudit.details).length > 0 && (
                    <div className="detail-json">
                      <pre>{JSON.stringify(selectedAudit.details, null, 2)}</pre>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="troubleshooting-empty-detail">
                Select an entry to see details. All signed-in users can see actions from every teammate.
              </div>
            )}
          </div>
        </div>
        )}
      </div>
    </div>
  );
};

// Toast notification component
const Toast = ({ message, type, onClose, onUndo, undoLabel = 'Undo' }) => {
  useEffect(() => {
    const timer = setTimeout(onClose, 6000); // Longer timeout if undo is available
    return () => clearTimeout(timer);
  }, [onClose]);

  const icons = {
    success: '✓',
    error: '✕',
    info: 'ℹ'
  };

  return (
    <div className={`toast ${type}`}>
      <span className="toast-icon">{icons[type]}</span>
      <span className="toast-message">{message}</span>
      {onUndo && (
        <button className="toast-undo" onClick={onUndo}>
          {undoLabel}
        </button>
      )}
    </div>
  );
};

// My Tasks View Component (Asana/Monday.com style)
const MyTasksView = ({ tasksByStatus, statuses, onPageClick, onMove, onViewComments, loading, isPageAssignedToMe, assignPageToMe, unassignPageFromMe, onAddToLaunchNotes }) => {
  if (loading) {
    return (
      <div className="loading-state full">
        <div className="spinner large"></div>
        <span>Loading your tasks...</span>
      </div>
    );
  }

  const totalTasks = Object.values(tasksByStatus).reduce((sum, tasks) => sum + tasks.length, 0);

  if (totalTasks === 0) {
    return (
      <div className="empty-state full">
        <span className="empty-icon"></span>
        <h3>No tasks assigned to you</h3>
        <p>Assign release notes to yourself using "Assign to me" in the page menu to see them here</p>
      </div>
    );
  }

  return (
    <div className="my-tasks-view">
      <div className="my-tasks-header">
        <div className="my-tasks-user">
          <div>
            <h2>My Tasks</h2>
            <p className="my-tasks-subtitle">
              {totalTasks} release note{totalTasks !== 1 ? 's' : ''} assigned to you
            </p>
          </div>
        </div>
      </div>

      <div className="my-tasks-sections">
        {Object.entries(statuses).map(([statusKey, status]) => {
          const tasks = tasksByStatus[statusKey] || [];
          if (tasks.length === 0) return null;

          return (
            <div key={statusKey} className="my-tasks-section">
              <div className="my-tasks-section-header" style={{ '--section-color': status.color }}>
                <div className="section-header-left">
                  <h3 className="section-title">{status.name}</h3>
                  <span className="section-count">{tasks.length}</span>
                </div>
              </div>
              
              <div className="my-tasks-list">
                {tasks.map(page => (
                  <div 
                    key={page.id} 
                    className={`my-task-card ${page.isStale ? 'stale' : ''}`}
                    onClick={() => onPageClick(page)}
                  >
                    <div className="task-card-header">
                      <div className="task-title-row">
                        <h4 className="task-title">{page.title}</h4>
                        {page.hasNotes && (
                          <span className="note-indicator note-indicator-card note-count-badge" title="Has notes">
                            <span className="note-count-icon" aria-hidden="true">📝</span>
                            <span className="note-count-num">{page.noteCount ?? 1}</span>
                          </span>
                        )}
                        <span className="assigned-badge" title="Assigned to you">
                        </span>
                      </div>
                      {page.isStale && (
                        <span className="task-stale-badge" title={`No activity for ${status.staleThreshold}+ days`}>
                          Stale
                        </span>
                      )}
                    </div>
                    
                    <div className="task-card-meta">
                      <div className="task-meta-row">
                        <span className="task-meta-item">
                          <span className="task-meta-label">Jira:</span>
                          {page.jiraTicket ? (
                            <a 
                              href={page.jiraUrl} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="task-jira-link"
                              onClick={e => e.stopPropagation()}
                            >
                              {page.jiraTicket}
                            </a>
                          ) : (
                            <span className="task-no-jira">—</span>
                          )}
                        </span>
                        <span className="task-meta-item">
                          <span className="task-meta-label">Last Activity:</span>
                          <StatusBadge days={page.lastActivityDaysAgo} threshold={status.staleThreshold} />
                        </span>
                      </div>
                      
                      <div className="task-meta-row">
                        <span className="task-meta-item">
                          <span className="task-meta-label">Comments:</span>
                          <button 
                            className="task-comment-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              onViewComments(page);
                            }}
                          >
                            {page.commentCount || 0}
                          </button>
                        </span>
                        <span className="task-meta-item">
                          <span className="task-meta-label">Created:</span>
                          <StatusBadge days={page.createdDaysAgo} threshold={60} />
                        </span>
                      </div>
                    </div>

                    <div className="task-card-actions">
                      <button 
                        className="btn btn-secondary btn-sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          onPageClick(page);
                        }}
                      >
                        View Details
                      </button>
                      <OverflowMenu 
                        page={page}
                        statuses={statuses}
                        currentStatus={statusKey}
                        onMove={onMove}
                        onViewComments={onViewComments}
                        isAssigned={isPageAssignedToMe(page.id)}
                        onAssign={assignPageToMe}
                        onUnassign={unassignPageFromMe}
                        onAddToLaunchNotes={onAddToLaunchNotes}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// Bulk actions bar
const BulkActionsBar = ({
  selectedCount,
  onEdit,
  onClearSelection,
  onBatchAIGenerate,
  batchAIGenerating,
  onSyncFromConfluence,
  syncingFromConfluence,
  onRefreshFromJira,
  refreshingJira,
  hasJiraTickets,
  onExportToCursor,
  onCreateDocTickets,
  docTicketsCreating
}) => {
  const { ai: canAi, export: canExport } = usePermissions();
  if (selectedCount === 0) return null;

  return (
    <div className="bulk-actions-bar">
      <span className="bulk-count">{selectedCount} selected</span>
      <div className="bulk-actions">
        <button 
          className="btn btn-primary btn-sm"
          onClick={onEdit}
        >
          ✏️ Edit
        </button>
        {canExport && onExportToCursor && (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={onExportToCursor}
            title="Open Export to Cursor with only the selected pages (you can adjust filters in the modal)"
          >
            Export to Cursor…
          </button>
        )}
        {onSyncFromConfluence && (
          <button 
            className="btn btn-secondary btn-sm"
            onClick={onSyncFromConfluence}
            disabled={syncingFromConfluence}
            title="Re-fetch selected pages from Confluence to update Jira ticket, assignee, comments, and other details"
          >
            {syncingFromConfluence ? 'Syncing…' : '↻ Sync from Confluence'}
          </button>
        )}
        {onRefreshFromJira && (
          <button 
            className="btn btn-secondary btn-sm"
            onClick={onRefreshFromJira}
            disabled={refreshingJira || !hasJiraTickets}
            title={hasJiraTickets ? 'Fetch latest from Jira for selected pages (fix version, labels, assignee). Jira = source of truth.' : 'Select pages with Jira tickets to refresh'}
          >
            {refreshingJira ? 'Refreshing…' : '↻ Refresh from Jira'}
          </button>
        )}
        {canAi && (
          <button 
            className="btn btn-primary btn-sm"
            onClick={onBatchAIGenerate}
            disabled={batchAIGenerating}
            title="Generate AI release notes for selected pages"
          >
            {batchAIGenerating ? 'Generating...' : 'Batch AI Generate'}
          </button>
        )}
        {onCreateDocTickets && (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={onCreateDocTickets}
            disabled={docTicketsCreating || !hasJiraTickets}
            title={
              hasJiraTickets
                ? 'Create a DOC Story per page and link it (Relates) to each page’s reference Jira issue'
                : 'Select pages that have a linked Jira ticket'
            }
          >
            {docTicketsCreating ? 'Creating DOC…' : 'Create DOC ticket(s)'}
          </button>
        )}
        <button className="btn btn-secondary btn-sm" onClick={onClearSelection}>
          Clear
        </button>
      </div>
    </div>
  );
};

function App() {
  const perms = usePermissions();
  const [pages, setPages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [config, setConfig] = useState(null);
  const [currentStatus, setCurrentStatus] = useState('draft');
  const [selectedPage, setSelectedPage] = useState(null);
  const [launchNotesPages, setLaunchNotesPages] = useState(null);
  const [launchNotesLoading, setLaunchNotesLoading] = useState(false);
  const [comments, setComments] = useState([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentType, setCommentType] = useState('confluence'); // 'confluence' or 'jira'
  const [confirmAction, setConfirmAction] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [launchnotesPages, setLaunchnotesPages] = useState(null);
  const [launchnotesLoading, setLaunchnotesLoading] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [detailPage, setDetailPage] = useState(null); // Page shown in detail panel
  const [searchTerm, setSearchTerm] = useState('');
  const [sortColumn, setSortColumn] = useState('createdDaysAgo');
  const [sortDirection, setSortDirection] = useState('asc');
  const [selectedPages, setSelectedPages] = useState(new Set());
  const [stats, setStats] = useState(null);
  const [authorFilter, setAuthorFilter] = useState('');
  const [educationStatusFilter, setEducationStatusFilter] = useState('');
  const [fixVersionFilter, setFixVersionFilter] = useState('');
  const [timeFilter, setTimeFilter] = useState(''); // '', 'today', 'thisWeek', 'thisMonth'
  const [showSettings, setShowSettings] = useState(false);
  const [showExportForClaudeModal, setShowExportForClaudeModal] = useState(false);
  /** When non-null, Export to Cursor modal limits preview/export to these page ids (from board multi-select). */
  const [exportForClaudeInitialPageIds, setExportForClaudeInitialPageIds] = useState(null);
  const [showActivityLog, setShowActivityLog] = useState(false);
  const [showTroubleshooting, setShowTroubleshooting] = useState(false);
  const [lastMove, setLastMove] = useState(null); // Track last move for undo
  const [showRocketCelebration, setShowRocketCelebration] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(() => {
    const saved = localStorage.getItem('autoRefresh');
    return saved ? parseInt(saved, 10) : 0; // 0 = disabled, value in seconds
  });
  const [autoRefreshInterval, setAutoRefreshInterval] = useState(null);
  const [currentView, setCurrentView] = useState('status'); // 'status' or 'myTasks'
  const [adminPortal, setAdminPortal] = useState(() =>
    typeof window !== 'undefined' &&
    (window.location.hash === '#/admin' || (window.location.hash || '').startsWith('#/admin'))
  );

  useEffect(() => {
    const onHash = () => {
      setAdminPortal(
        window.location.hash === '#/admin' || (window.location.hash || '').startsWith('#/admin')
      );
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 900px)');
    const sync = () => setSidebarOpen(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  // Scheduled Jira notification rules: check periodically while app is open (uses saved credentials).
  useEffect(() => {
    if (!perms.loaded || perms.notifications === false) return undefined;
    const tick = async () => {
      if (!hasCredentials()) return;
      const rules = getNotificationRulesFromStorage();
      if (!rules.some((r) => r.enabled !== false)) return;
      try {
        await runDueNotificationRules();
      } catch (_) {
        /* ignore */
      }
    };
    const intervalId = window.setInterval(tick, 12 * 60 * 1000);
    const onSettingsSaved = () => {
      tick();
    };
    window.addEventListener('settingsSaved', onSettingsSaved);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('settingsSaved', onSettingsSaved);
    };
  }, [perms.loaded, perms.notifications]);

  const collapseSidebarOnNavigate = useCallback(() => {
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 899px)').matches) {
      setSidebarOpen(false);
    }
  }, []);

  useEffect(() => {
    if (!perms.loaded || perms.ai) return;
    setCurrentView((v) => (v === 'aiHub' ? 'status' : v));
  }, [perms.loaded, perms.ai]);

  const [currentUser, setCurrentUser] = useState(null);
  const [myTasks, setMyTasks] = useState([]);
  const [myTasksLoading, setMyTasksLoading] = useState(false);
  const [myTasksByStatus, setMyTasksByStatus] = useState({});
  const [allPagesForAI, setAllPagesForAI] = useState([]);
  const [allPagesLoading, setAllPagesLoading] = useState(false);
  const [assignedPageIds, setAssignedPageIds] = useState(() => {
    const saved = localStorage.getItem('assignedPageIds');
    return saved ? new Set(JSON.parse(saved)) : new Set();
  });
  const lastAssignedIdsRef = React.useRef('');
  
  // Save assigned pages to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem('assignedPageIds', JSON.stringify(Array.from(assignedPageIds)));
  }, [assignedPageIds]);

  const statuses = config?.statuses || {};
  const currentStatusConfig = statuses[currentStatus];

  const addToast = useCallback((message, type = 'info', undoAction = null) => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type, undoAction }]);
  }, []);

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  // Assign page to me
  const assignPageToMe = useCallback((pageId) => {
    setAssignedPageIds(prev => {
      const newSet = new Set(prev);
      newSet.add(pageId);
      return newSet;
    });
    logActivity('assignment', 'Assigned page to me', { pageTitle: pages.find(p => p.id === pageId)?.title });
    addToast('Page assigned to you', 'success');
  }, [addToast, pages]);

  // Unassign page from me
  const unassignPageFromMe = useCallback((pageId) => {
    setAssignedPageIds(prev => {
      const newSet = new Set(prev);
      newSet.delete(pageId);
      return newSet;
    });
    logActivity('assignment', 'Unassigned page', { pageTitle: pages.find(p => p.id === pageId)?.title });
    addToast('Page unassigned', 'info');
  }, [addToast, pages]);

  // Check if page is assigned to me
  const isPageAssignedToMe = useCallback((pageId) => {
    return assignedPageIds.has(pageId);
  }, [assignedPageIds]);

  const handleSaveSettings = async (settings) => {
    localStorage.setItem('confluenceSettings', JSON.stringify(settings));
    logActivity('settings', 'Settings saved', {});
    const cloudResult = await saveSettingsProfileToCloud(settings);
    setShowSettings(false);
    if (cloudResult === false) {
      addToast('Saved on this device; could not sync to your account.', 'warning');
    } else if (cloudResult === true) {
      addToast('Settings saved and synced to your account.', 'success');
    } else {
      addToast('Settings saved successfully', 'success');
    }
    fetchConfig();
    fetchPages();
    fetchStats();
  };

  const fetchConfig = useCallback(async () => {
    if (!hasCredentials()) return;
    try {
      const response = await authenticatedFetch('/api/config');
      const data = await response.json();
      // Merge with saved settings
      const creds = getCredentials();
      if (creds) {
        data.settings = creds;
      }
      setConfig(data);
    } catch (err) {
      console.error('Failed to fetch config:', err);
    }
  }, []);

  const fetchStats = useCallback(async () => {
    if (!hasCredentials()) return;
    try {
      const response = await authenticatedFetch('/api/pages/stats');
      const data = await response.json();
      setStats(data.stats);
    } catch (err) {
      console.error('Failed to fetch stats:', err);
    }
  }, []);

  const fetchNotesSummary = useCallback(async () => {
    try {
      const response = await authenticatedFetch('/api/notes/summary');
      if (!response.ok) return null;
      return await response.json();
    } catch {
      return null;
    }
  }, []);

  const fetchPages = useCallback(async (status = currentStatus) => {
    if (!hasCredentials()) return;
    setLoading(true);
    setError(null);
    setSelectedPages(new Set());
    try {
      const [pagesRes, summaryRes] = await Promise.all([
        authenticatedFetch(`/api/pages?status=${status}`),
        authenticatedFetch('/api/notes/summary').catch(() => null)
      ]);
      if (!pagesRes.ok) {
        const errorData = await pagesRes.json();
        throw new Error(errorData.details || 'Failed to fetch pages');
      }
      const data = await pagesRes.json();
      let pagesList = data.pages || [];
      let summary = null;
      if (summaryRes && summaryRes.ok) {
        try { summary = await summaryRes.json(); } catch (_) {}
      }
      if (summary && typeof summary === 'object') {
        pagesList = pagesList.map(p => {
          const hasNotes = !!(summary[p.id] && summary[p.id].hasNotes);
          return { ...p, hasNotes, noteCount: hasNotes ? 1 : 0 };
        });
      }
      setPages(pagesList);
    } catch (err) {
      setError(err.message);
      addToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [currentStatus, addToast]);

  // Fetch all pages for AI Hub (from all statuses)
  const fetchAllPagesForAI = useCallback(async () => {
    if (!hasCredentials() || !config) {
      setAllPagesForAI([]);
      return;
    }
    setAllPagesLoading(true);
    try {
      const statusesObj = config?.statuses || {};
      const statusKeys = Object.keys(statusesObj);
      const allPagesPromises = statusKeys.map(statusKey => 
        authenticatedFetch(`/api/pages?status=${statusKey}`)
          .then(res => {
            if (!res.ok) {
              // Don't log 401 errors - they're expected if credentials aren't set
              if (res.status !== 401) {
                console.warn(`Failed to fetch pages for ${statusKey}:`, res.status);
              }
              return { pages: [] };
            }
            return res.json();
          })
          .then(data => (data.pages || []).map(page => ({ ...page, status: statusKey })))
          .catch((err) => {
            // Silently handle errors - don't spam console
            return [];
          })
      );
      
      const pagesArrays = await Promise.all(allPagesPromises);
      const allPages = pagesArrays.flat();
      setAllPagesForAI(allPages);
    } catch (err) {
      // Only log unexpected errors
      if (err.message && !err.message.includes('401')) {
        console.error('Failed to fetch all pages for AI:', err);
      }
      setAllPagesForAI([]);
    } finally {
      setAllPagesLoading(false);
    }
  }, [config]);

  const fetchComments = useCallback(async (pageId) => {
    setCommentsLoading(true);
    setCommentType('confluence');
    try {
      console.log(`[Client] Fetching comments for page ${pageId}`);
      const response = await authenticatedFetch(`/api/pages/${pageId}/comments`);
      const data = await response.json();
      console.log(`[Client] Comments response:`, data);
      console.log(`[Client] Comments count:`, data.comments?.length || 0, 'Total:', data.total);
      
      if (data.total > 0 && (!data.comments || data.comments.length === 0)) {
        console.warn(`[Client] WARNING: API reports ${data.total} comments but returned ${data.comments?.length || 0} comments!`);
        console.warn(`[Client] Full response:`, JSON.stringify(data, null, 2));
      }
      
      setComments(data.comments || []);
    } catch (err) {
      console.error(`[Client] Error fetching comments:`, err);
      addToast('Failed to load comments', 'error');
    } finally {
      setCommentsLoading(false);
    }
  }, [addToast]);

  const fetchJiraComments = useCallback(async (issueKey) => {
    setCommentsLoading(true);
    setCommentType('jira');
    try {
      const response = await authenticatedFetch(`/api/jira/issue/${issueKey}/comments`);
      const data = await response.json();
      setComments(data.comments || []);
    } catch (err) {
      addToast('Failed to load Jira comments', 'error');
      setComments([]);
    } finally {
      setCommentsLoading(false);
    }
  }, [addToast]);

  const handleAddComment = useCallback(async (pageIdOrText, bodyOrParentId) => {
    try {
      // Check if this is a reply (parentId provided) or new comment
      if (typeof pageIdOrText === 'string' && bodyOrParentId) {
        // This is a reply - pageIdOrText is the pageId, bodyOrParentId is the body, third arg is parentId
        const pageId = pageIdOrText;
        const body = bodyOrParentId;
        const parentId = arguments[2];
        
        const formattedBody = body.includes('<ac:link>') 
          ? `<p>${body}</p>` 
          : `<p>${body.replace(/\n/g, '</p><p>')}</p>`;
        
        const response = await authenticatedFetch(`/api/pages/${pageId}/comments`, {
          method: 'POST',
          body: JSON.stringify({ body: formattedBody, parentId: parentId })
        });
        
        if (!response.ok) throw new Error('Failed to add reply');
        
        logActivity('comment_confluence', 'Added Confluence reply', { pageTitle: pages.find(p => p.id === pageId)?.title });
        addToast('Reply added successfully', 'success');
        fetchComments(pageId);
        fetchPages();
      } else {
        // This is a new comment
        const pageId = pageIdOrText;
        const body = bodyOrParentId;
        
        const formattedBody = body.includes('<ac:link>') 
          ? `<p>${body}</p>` 
          : `<p>${body.replace(/\n/g, '</p><p>')}</p>`;
        
        const response = await authenticatedFetch(`/api/pages/${pageId}/comments`, {
          method: 'POST',
          body: JSON.stringify({ body: formattedBody })
        });
        
        if (!response.ok) throw new Error('Failed to add comment');
        
        logActivity('comment_confluence', 'Added Confluence comment', { pageTitle: pages.find(p => p.id === pageId)?.title });
        addToast('Comment added successfully', 'success');
        fetchComments(pageId);
        fetchPages();
      }
    } catch (err) {
      addToast('Failed to add comment', 'error');
    }
  }, [addToast, fetchComments, fetchPages, pages]);

  // Handle Jira comment from comment modal (simple text)
  const handleAddJiraCommentFromModal = useCallback(async (commentText, parentId = null) => {
    if (!selectedPage?.jiraTicket) {
      addToast('This page does not have a Jira ticket', 'error');
      return;
    }
    
    setActionLoading(true);
    try {
      // Extract mentions from text (@username pattern)
      // For now, we'll let the server parse mentions from the text
      // In a full implementation, we'd track mentions as the user types
      const mentions = [];
      const mentionRegex = /@([^\s@]+)/g;
      let match;
      while ((match = mentionRegex.exec(commentText)) !== null) {
        // We'd need to look up the accountId for each mention
        // For now, we'll let the server handle it
      }
      
      const response = await authenticatedFetch(`/api/jira/issue/${selectedPage.jiraTicket}/comment`, {
        method: 'POST',
        body: JSON.stringify({
          body: commentText,
          mentions: mentions,
          parentId: parentId
        })
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.details || 'Failed to add comment');
      }
      
      logActivity('comment_jira', 'Added Jira comment', { pageTitle: selectedPage?.title, jiraTicket: selectedPage?.jiraTicket });
      addToast('Comment added successfully', 'success');
      // Refresh comments
      if (selectedPage.jiraTicket) {
        fetchJiraComments(selectedPage.jiraTicket);
      }
      fetchPages();
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setActionLoading(false);
    }
  }, [addToast, fetchPages, selectedPage, fetchJiraComments]);

  // Handle Jira comment from add comment modal (with page, jiraComment object, labels)
  const handleAddJiraComment = useCallback(async (page, jiraComment = null, labels = null) => {
    if (!page.jiraTicket) {
      addToast('This page does not have a Jira ticket', 'error');
      return;
    }

    setActionLoading(true);
    try {
      // Use the bulk-update-jira endpoint for a single page
      const response = await authenticatedFetch('/api/pages/bulk-update-jira', {
        method: 'POST',
        body: JSON.stringify({ 
          pageIds: [page.id],
          jiraComment: jiraComment,
          labels: labels
        })
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.details || 'Failed to add comment');
      }
      
      const result = await response.json();
      addToast(result.message, 'success');
      setConfirmAction(null);
      fetchPages();
      fetchStats();
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setActionLoading(false);
    }
  }, [addToast, fetchPages, fetchStats]);

  const handleMove = useCallback(async (page, targetStatus, jiraComment = null, labels = null) => {
    const previousStatus = page.status || currentStatus;
    setActionLoading(true);
    try {
      const response = await authenticatedFetch(`/api/pages/${page.id}/move`, {
        method: 'POST',
        body: JSON.stringify({ 
          targetStatus,
          jiraComment: jiraComment,
          labels: labels
        })
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.details || 'Failed to move page');
      }
      
      const result = await response.json();
      
      // Check if moving to Published status and trigger celebration
      const targetStatusConfig = statuses[targetStatus];
      const isPublished = targetStatusConfig?.name?.toLowerCase() === 'published' || 
                          targetStatus === 'published' ||
                          targetStatusConfig?.name?.toLowerCase().includes('publish');
      
      if (isPublished) {
        setShowRocketCelebration(true);
      }
      
      // Track move for undo
      const undoAction = async () => {
        try {
          await authenticatedFetch(`/api/pages/${page.id}/move`, {
            method: 'POST',
            body: JSON.stringify({ targetStatus: previousStatus })
          });
          addToast(`Moved "${page.title}" back to ${statuses[previousStatus]?.name || previousStatus}`, 'success');
          fetchPages();
          fetchStats();
        } catch (err) {
          addToast('Failed to undo move', 'error');
        }
      };
      
      setLastMove({ pageId: page.id, fromStatus: previousStatus, toStatus: targetStatus });
      const targetName = statuses[targetStatus]?.name || targetStatus;
      logActivity('page_move', `Moved to ${targetName}`, { pageTitle: page.title, targetStatus: targetName, jiraTicket: page.jiraTicket });
      if (jiraComment?.body?.trim()) {
        logActivity('comment_jira', 'Added Jira comment (during move)', { pageTitle: page.title, jiraTicket: page.jiraTicket });
      }
      addToast(result.message, 'success', undoAction);
      setConfirmAction(null);
      fetchPages();
      fetchStats();
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setActionLoading(false);
    }
  }, [addToast, fetchPages, fetchStats, currentStatus, statuses]);

  const executeBulkEdit = useCallback(async (targetStatus, pageIds, jiraComment = null, confluenceComment = null, labels = null) => {
    // Track previous statuses for undo - use pages state instead of sortedPages
    const pagesToEdit = pages.filter(p => pageIds.includes(p.id));
    const previousStatuses = pagesToEdit.map(p => ({ pageId: p.id, status: p.status || currentStatus }));
    
    setActionLoading(true);
    try {
      // If targetStatus is null, we're only adding labels/comments, not moving
      if (targetStatus === null) {
        // Only update Jira tickets (labels and comments), don't move pages
        const pagesWithTickets = pagesToEdit.filter(p => p.jiraTicket);
        
        if (pagesWithTickets.length === 0 && (!labels || labels.length === 0) && (!jiraComment || !jiraComment.body) && (!confluenceComment || !confluenceComment.body)) {
          addToast('No changes to apply', 'info');
          setBulkEditAction(null);
          setActionLoading(false);
          return;
        }

        // Handle Jira comments/labels if provided
        if ((jiraComment && jiraComment.body) || (labels && labels.length > 0)) {
          // If using individual selection, filter pageIds to only those that should get Jira comments
          const jiraPageIds = jiraComment?.pageMap 
            ? pageIds.filter(pageId => jiraComment.pageMap[pageId]?.jira)
            : pageIds;
          
          // Only proceed if there are pages to update
          if (jiraPageIds.length > 0 || (labels && labels.length > 0)) {
            const response = await authenticatedFetch('/api/pages/bulk-update-jira', {
              method: 'POST',
          body: JSON.stringify({ 
                pageIds: jiraPageIds.length > 0 ? jiraPageIds : pageIds, // Use filtered IDs for comments, all for labels
                jiraComment: jiraPageIds.length > 0 ? jiraComment : null, // Only include comment if there are pages
            labels
          })
            });
        
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.details || 'Failed to update Jira tickets');
        }
        
        const result = await response.json();
            if (result.message) {
        logActivity('jira_update', result.message, { count: jiraPageIds.length || pageIds.length });
        addToast(result.message, 'success');
            }
          }
        }

        // Handle Confluence comments if provided
        if (confluenceComment && confluenceComment.body) {
          const formattedBody = confluenceComment.body.includes('<ac:link>') 
            ? `<p>${confluenceComment.body}</p>` 
            : `<p>${confluenceComment.body.replace(/\n/g, '</p><p>')}</p>`;
          
          let successCount = 0;
          let failCount = 0;
          
          // Determine which pages should get Confluence comments
          const pagesToComment = confluenceComment.pageMap 
            ? pageIds.filter(pageId => confluenceComment.pageMap[pageId]?.confluence)
            : pageIds;
          
          // Add Confluence comment to each page individually
          for (const pageId of pagesToComment) {
            try {
              const response = await authenticatedFetch(`/api/pages/${pageId}/comments`, {
                method: 'POST',
                body: JSON.stringify({ body: formattedBody })
              });
              
              if (response.ok) {
                successCount++;
              } else {
                failCount++;
              }
            } catch (err) {
              console.error(`Failed to add Confluence comment to page ${pageId}:`, err);
              failCount++;
            }
          }
          
          if (pagesToComment.length > 0) {
            if (failCount === 0) {
              logActivity('comment_confluence', `Added Confluence comment to ${successCount} page(s)`, { count: successCount });
              addToast(`Added Confluence comment to ${successCount} page${successCount !== 1 ? 's' : ''}`, 'success');
            } else {
              addToast(`Added Confluence comment to ${successCount} page${successCount !== 1 ? 's' : ''}, ${failCount} failed`, 'error');
            }
          }
        }
        
        setBulkEditAction(null);
        fetchPages();
        fetchStats();
        setActionLoading(false);
        return;
      }

      // Handle Confluence comments separately if provided (bulk-move doesn't support it)
      if (confluenceComment && confluenceComment.body) {
        const formattedBody = confluenceComment.body.includes('<ac:link>') 
          ? `<p>${confluenceComment.body}</p>` 
          : `<p>${confluenceComment.body.replace(/\n/g, '</p><p>')}</p>`;
        
        // Determine which pages should get Confluence comments
        const pagesToComment = confluenceComment.pageMap 
          ? pageIds.filter(pageId => confluenceComment.pageMap[pageId]?.confluence)
          : pageIds;
        
        // Add Confluence comment to each page individually
        for (const pageId of pagesToComment) {
          try {
            await authenticatedFetch(`/api/pages/${pageId}/comments`, {
              method: 'POST',
              body: JSON.stringify({ body: formattedBody })
            });
          } catch (err) {
            console.error(`Failed to add Confluence comment to page ${pageId}:`, err);
          }
        }
      }
      
      // Filter Jira comments if using individual selection
      let jiraCommentToSend = jiraComment;
      if (jiraComment?.pageMap) {
        const jiraPageIds = pageIds.filter(pageId => jiraComment.pageMap[pageId]?.jira);
        if (jiraPageIds.length === 0) {
          jiraCommentToSend = null; // No pages should get Jira comments
        } else if (jiraPageIds.length < pageIds.length) {
          // Some pages should get comments, but not all - handle individually
          const pagesToComment = pagesToEdit.filter(p => jiraPageIds.includes(p.id) && p.jiraTicket);
          for (const page of pagesToComment) {
            try {
              await authenticatedFetch(`/api/jira/issue/${page.jiraTicket}/comment`, {
                method: 'POST',
                body: JSON.stringify({
                  body: jiraComment.body,
                  mentions: jiraComment.mentions
                })
              });
            } catch (err) {
              console.error(`Failed to add Jira comment to ${page.jiraTicket}:`, err);
            }
          }
          jiraCommentToSend = null; // Already handled individually
        }
      }

      // Use the existing bulk-move endpoint for Jira comments and moves
      const response = await authenticatedFetch('/api/pages/bulk-move', {
        method: 'POST',
        body: JSON.stringify({ 
          pageIds,
          targetStatus,
          jiraComment: jiraCommentToSend,
          labels
        })
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.details || 'Failed to move pages');
      }
      
      const result = await response.json();
      
      // Create undo action for bulk move
      const undoAction = async () => {
        let successCount = 0;
        let failCount = 0;
        
        // Move each page back to its previous status
        for (const { pageId, status } of previousStatuses) {
          const page = pagesToEdit.find(p => p.id === pageId);
          if (page) {
            try {
              await authenticatedFetch(`/api/pages/${pageId}/move`, {
                method: 'POST',
                body: JSON.stringify({ targetStatus: status })
              });
              successCount++;
            } catch (err) {
              console.error(`Failed to undo move for page ${pageId}:`, err);
              failCount++;
            }
          }
        }
        
        if (failCount === 0) {
          addToast(`Undid move for ${successCount} page${successCount !== 1 ? 's' : ''}`, 'success');
        } else {
          addToast(`Undid move for ${successCount} page${successCount !== 1 ? 's' : ''}, ${failCount} failed`, 'error');
        }
        
        fetchPages();
        fetchStats();
      };
      
      setLastMove({ pageIds, fromStatuses: previousStatuses, toStatus: targetStatus });
      
      // Check if moving to Published status and trigger celebration
      const targetStatusConfig = statuses[targetStatus];
      const isPublished = targetStatusConfig?.name?.toLowerCase() === 'published' || 
                          targetStatus === 'published' ||
                          targetStatusConfig?.name?.toLowerCase().includes('publish');
      
      if (isPublished && targetStatus !== null) {
        setShowRocketCelebration(true);
      }
      
      const targetName = statuses[targetStatus]?.name || targetStatus;
      logActivity('page_move', `Bulk move to ${targetName}`, { count: pageIds.length, targetStatus: targetName });
      addToast(result.message, 'success', undoAction);
      setSelectedPages(new Set());
      setBulkEditAction(null);
      fetchPages();
      fetchStats();
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setActionLoading(false);
    }
  }, [addToast, fetchPages, fetchStats, pages, currentStatus, statuses]);

  const openComments = useCallback((page) => {
    setSelectedPage(page);
    fetchComments(page.id);
  }, [fetchComments]);

  const openJiraComments = useCallback((page, jiraData) => {
    setSelectedPage({ ...page, jiraTicket: page.jiraTicket });
    if (page.jiraTicket) {
      fetchJiraComments(page.jiraTicket);
    }
  }, [fetchJiraComments]);

  const handleStatusChange = useCallback((status) => {
    setCurrentStatus(status);
    setSearchTerm('');
    setAuthorFilter('');
    setFixVersionFilter('');
    fetchPages(status);
  }, [fetchPages]);

  const togglePageSelection = useCallback((pageId) => {
    setSelectedPages(prev => {
      const newSet = new Set(prev);
      if (newSet.has(pageId)) {
        newSet.delete(pageId);
      } else {
        newSet.add(pageId);
      }
      return newSet;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (selectedPages.size === sortedPages.length) {
      setSelectedPages(new Set());
    } else {
      setSelectedPages(new Set(sortedPages.map(p => p.id)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPages.size]);

  const handleSort = (column) => {
    if (sortColumn === column) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('desc');
    }
  };

  // Fetch current user
  const fetchCurrentUser = useCallback(async () => {
    if (!hasCredentials()) return;
    try {
      const response = await authenticatedFetch('/api/user/current');
      const data = await response.json();
      if (data.error) {
        console.error('Failed to fetch current user:', data.details);
      } else {
        setCurrentUser(data);
      }
    } catch (err) {
      console.error('Error fetching current user:', err);
    }
  }, []);

  // Fetch my tasks - uses local assignments
  // Use refs to access the latest values without causing re-renders
  const assignedPageIdsRef = React.useRef(assignedPageIds);
  
  useEffect(() => {
    assignedPageIdsRef.current = assignedPageIds;
  }, [assignedPageIds]);

  const fetchMyTasks = useCallback(async () => {
    if (!hasCredentials()) return;
    const currentAssignedIds = Array.from(assignedPageIdsRef.current);
    if (currentAssignedIds.length === 0) {
      setMyTasks([]);
      setMyTasksByStatus({});
      return;
    }
    setMyTasksLoading(true);
    try {
      const [tasksRes, summaryRes] = await Promise.all([
        authenticatedFetch(
          `/api/pages/my-tasks?assignedPageIds=${encodeURIComponent(JSON.stringify(currentAssignedIds))}`
        ),
        authenticatedFetch('/api/notes/summary').catch(() => null)
      ]);
      const data = await tasksRes.json();
      let summary = null;
      if (summaryRes && summaryRes.ok) {
        try { summary = await summaryRes.json(); } catch (_) {}
      }
      const mergeHasNotes = (list) => (Array.isArray(list) && summary
        ? list.map(p => {
            const hasNotes = !!(summary[p.id] && summary[p.id].hasNotes);
            return { ...p, hasNotes, noteCount: hasNotes ? 1 : 0 };
          })
        : list || []);
      if (data.error) {
        setError(data.details || data.error);
      } else {
        setMyTasks(mergeHasNotes(data.pages || []));
        const byStatus = data.pagesByStatus || {};
        const mergedByStatus = {};
        for (const [k, arr] of Object.entries(byStatus)) {
          mergedByStatus[k] = mergeHasNotes(arr);
        }
        setMyTasksByStatus(mergedByStatus);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setMyTasksLoading(false);
    }
  }, []); // No dependencies - reads from ref

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await hydrateSettingsFromCloud();
      if (cancelled) return;
      if (!hasCredentials()) {
        setShowSettings(true);
      }
      await Promise.all([fetchConfig(), fetchStats(), fetchCurrentUser()]);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

  useEffect(() => {
    if (config) {
      if (currentView === 'status') {
        fetchPages();
      } else if (currentView === 'myTasks') {
        fetchMyTasks();
      } else if (currentView === 'aiHub') {
        fetchAllPagesForAI();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, currentView]); // Only depend on config and currentView, not callbacks

  // Refresh My Tasks when assignments change (only if we're on My Tasks view)
  useEffect(() => {
    if (currentView === 'myTasks' && config) {
      // Use a ref to prevent infinite loops - only refresh if assignments actually changed
      const assignedIdsArray = Array.from(assignedPageIds).sort().join(',');
      
      if (assignedIdsArray !== lastAssignedIdsRef.current) {
        lastAssignedIdsRef.current = assignedIdsArray;
        // Use setTimeout to debounce and prevent rapid refreshes
        const timeoutId = setTimeout(() => {
          fetchMyTasks();
        }, 300);
        return () => clearTimeout(timeoutId);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignedPageIds.size, currentView, config]); // fetchMyTasks is stable (no dependencies)


  // Auto-refresh functionality
  useEffect(() => {
    // Clear any existing interval
    if (autoRefreshInterval) {
      clearInterval(autoRefreshInterval);
      setAutoRefreshInterval(null);
    }
    
    if (autoRefresh > 0) {
      const interval = setInterval(() => {
        if (currentView === 'status') {
          fetchPages();
        } else if (currentView === 'myTasks') {
          fetchMyTasks();
        }
        // Skip fetchStats here: it scans every Confluence status (same cost as a full dashboard pull).
        // Header stats update on load, manual refresh, and after moves. Reduces load on slow hosts (e.g. Render free).
        addToast('Auto-refreshed', 'info');
      }, autoRefresh * 1000);
      setAutoRefreshInterval(interval);
      
      return () => {
        clearInterval(interval);
        setAutoRefreshInterval(null);
      };
    }
    
    return () => {
      if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
        setAutoRefreshInterval(null);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh, currentView]); // Only depend on autoRefresh and currentView, not callbacks


  const handleAutoRefreshChange = (seconds) => {
    setAutoRefresh(seconds);
    localStorage.setItem('autoRefresh', seconds.toString());
  };

  // Enhanced keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Don't trigger shortcuts when typing in inputs
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
        return;
      }

      // Escape - close modals, clear selection
      if (e.key === 'Escape') {
        setSelectedPages(new Set());
        setSelectedPage(null);
        setConfirmAction(null);
        setBulkEditAction(null);
        return;
      }

      // Cmd/Ctrl + R - refresh
      if ((e.metaKey || e.ctrlKey) && e.key === 'r') {
        e.preventDefault();
        if (currentView === 'status') {
          fetchPages();
        } else if (currentView === 'myTasks') {
          fetchMyTasks();
        } else if (currentView === 'aiHub') {
          fetchAllPagesForAI();
        }
        fetchStats();
        addToast('Refreshed', 'info');
        return;
      }

      // Cmd/Ctrl + K - focus search
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        const searchInput = document.querySelector('.search-input');
        if (searchInput) searchInput.focus();
        return;
      }

      // Cmd/Ctrl + A - select all (when not in input)
      if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
        e.preventDefault();
        toggleSelectAll();
        return;
      }

      // Number keys 1-5 - switch status tabs
      if (e.key >= '1' && e.key <= '5' && !e.metaKey && !e.ctrlKey) {
        const statusKeys = Object.keys(statuses);
        const index = parseInt(e.key) - 1;
        if (statusKeys[index]) {
          handleStatusChange(statusKeys[index]);
        }
        return;
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    statuses,
    handleStatusChange,
    toggleSelectAll,
    fetchPages,
    fetchStats,
    fetchMyTasks,
    fetchAllPagesForAI,
    currentView,
    addToast
  ]);

  // Get unique authors for filter
  const authors = useMemo(() => {
    const authorSet = new Set(pages.map(p => p.author).filter(Boolean));
    return Array.from(authorSet).sort();
  }, [pages]);

  // Get unique Education Project Status values for filter
  const educationStatusOptions = useMemo(() => {
    const statusSet = new Set(pages.map(p => p.educationProjectStatus).filter(Boolean));
    return Array.from(statusSet).sort();
  }, [pages]);

  // Get unique Fix Version values for filter (pages have fixVersions as array of strings)
  const fixVersionOptions = useMemo(() => {
    const versionSet = new Set();
    pages.forEach(p => {
      const versions = p.fixVersions;
      if (Array.isArray(versions)) {
        versions.forEach(v => { if (v && String(v).trim()) versionSet.add(String(v).trim()); });
      }
    });
    return Array.from(versionSet).sort();
  }, [pages]);

  const filteredPages = pages.filter(page => {
    const term = searchTerm.toLowerCase().trim();
    const matchesSearch = !term ||
      page.title.toLowerCase().includes(term) ||
      (page.jiraAssignee?.displayName && page.jiraAssignee.displayName.toLowerCase().includes(term)) ||
      (page.referenceAssignee && page.referenceAssignee.toLowerCase().includes(term));
    const matchesAuthor = !authorFilter || page.author === authorFilter;
    const matchesEducationStatus = !educationStatusFilter || page.educationProjectStatus === educationStatusFilter;
    const matchesFixVersion = !fixVersionFilter || (Array.isArray(page.fixVersions) && page.fixVersions.includes(fixVersionFilter));
    
    // Time filter: check if page was created or updated within the selected time period
    let matchesTime = true;
    if (timeFilter) {
      const now = new Date();
      let maxDaysAgo;
      
      if (timeFilter === 'today') {
        // Pages created or updated today (0 days ago)
        maxDaysAgo = 0;
      } else if (timeFilter === 'thisWeek') {
        // Calculate days since start of week (Monday)
        const dayOfWeek = now.getDay();
        const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
        maxDaysAgo = daysToMonday;
      } else if (timeFilter === 'thisMonth') {
        // Calculate days since start of month
        const dayOfMonth = now.getDate();
        maxDaysAgo = dayOfMonth - 1;
      }
      
      if (maxDaysAgo !== undefined) {
        // Check if page was created or had activity within the time period
        const createdWithinPeriod = page.createdDaysAgo !== null && page.createdDaysAgo <= maxDaysAgo;
        const activityWithinPeriod = page.lastActivityDaysAgo !== null && page.lastActivityDaysAgo <= maxDaysAgo;
        matchesTime = createdWithinPeriod || activityWithinPeriod;
      }
    }
    
    return matchesSearch && matchesAuthor && matchesEducationStatus && matchesFixVersion && matchesTime;
  });

  const sortedPages = useMemo(() => {
    return [...filteredPages].sort((a, b) => {
      // Use raw date strings for launch date columns so sort is chronological
      const sortKey = sortColumn === 'targetedLaunchDate' ? 'targetedLaunchDateRaw'
        : sortColumn === 'actualLaunchDate' ? 'actualLaunchDateRaw'
        : sortColumn;
      let aVal = a[sortKey];
      let bVal = b[sortKey];
      
      // Handle null values (use placeholder so nulls sort to end for asc, start for desc)
      if (aVal === null || aVal === undefined) aVal = sortDirection === 'asc' ? Infinity : -Infinity;
      if (bVal === null || bVal === undefined) bVal = sortDirection === 'asc' ? Infinity : -Infinity;
      
      // When one is string (date) and one is number (null placeholder), placeholders go to end for asc
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        if (sortDirection === 'asc') return aVal - bVal;
        return bVal - aVal;
      }
      if (typeof aVal === 'number') return sortDirection === 'asc' ? 1 : -1;
      if (typeof bVal === 'number') return sortDirection === 'asc' ? -1 : 1;
      
      // Handle string sorting (including ISO date strings: YYYY-MM-DD compare correctly as strings)
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        aVal = aVal.toLowerCase();
        bVal = bVal.toLowerCase();
        if (sortDirection === 'asc') {
          return aVal.localeCompare(bVal);
        }
        return bVal.localeCompare(aVal);
      }
      
      // Handle numeric sorting
      if (sortDirection === 'asc') {
        return aVal - bVal;
      }
      return bVal - aVal;
    });
  }, [filteredPages, sortColumn, sortDirection]);

  const handleExportToCsv = useCallback(() => {
    if (!perms.export) {
      addToast('Export is disabled for your account.', 'error');
      return;
    }
    const escapeCsvCell = (val) => {
      if (val === null || val === undefined) return '';
      const s = String(val).trim();
      if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    };
    const rows = [
      ['Page Title', 'Status', 'Confluence Link', 'Jira Link', 'Assignee', 'Created Date', 'Targeted Launch Date', 'Actual Launch Date', 'Education Project Status', 'Content']
    ];
    sortedPages.forEach(page => {
      const statusLabel = statuses[page.status]?.name || page.status || '';
      const createdDate = page.createdDate
        ? new Date(page.createdDate).toISOString().split('T')[0]
        : '';
      const assignee = page.jiraAssignee?.displayName || page.referenceAssignee || '';
      rows.push([
        page.title || '',
        statusLabel,
        page.url || '',
        page.jiraUrl || '',
        assignee,
        createdDate,
        page.targetedLaunchDate || '',
        page.actualLaunchDate || '',
        page.educationProjectStatus || '',
        page.contentText || ''
      ]);
    });
    const csv = rows.map(row => row.map(escapeCsvCell).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `release-notes-export-${currentStatus}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    addToast(`Exported ${sortedPages.length} page(s) to CSV. You can import this file into Google Sheets (File → Import → Upload).`, 'success');
    logActivity('export', `Exported ${sortedPages.length} page(s) to CSV (current board)`, {
      scope: 'status_csv',
      status: currentStatus,
      count: sortedPages.length
    });
  }, [sortedPages, statuses, currentStatus, addToast, perms.export]);

  const [masterExportLoading, setMasterExportLoading] = useState(false);
  const handleMasterExportToCsv = useCallback(async () => {
    if (!perms.export) {
      addToast('Export is disabled for your account.', 'error');
      return;
    }
    const statusKeys = config?.statuses ? Object.keys(config.statuses) : [];
    if (statusKeys.length === 0) {
      addToast('No statuses configured. Check settings.', 'error');
      return;
    }
    setMasterExportLoading(true);
    try {
      const results = await Promise.all(
        statusKeys.map(statusKey =>
          authenticatedFetch(`/api/pages?status=${statusKey}`)
            .then(res => (res.ok ? res.json() : { pages: [] }))
            .then(data => (data.pages || []).map(p => ({ ...p, status: p.status || statusKey })))
            .catch(() => [])
        )
      );
      const allPages = results.flat();
      const escapeCsvCell = (val) => {
        if (val === null || val === undefined) return '';
        const s = String(val).trim();
        if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
          return '"' + s.replace(/"/g, '""') + '"';
        }
        return s;
      };
      const rows = [
        ['Page Title', 'Status', 'Confluence Link', 'Jira Link', 'Assignee', 'Created Date', 'Targeted Launch Date', 'Actual Launch Date', 'Education Project Status', 'Content']
      ];
      allPages.forEach(page => {
        const statusLabel = statuses[page.status]?.name || page.status || '';
        const createdDate = page.createdDate
          ? new Date(page.createdDate).toISOString().split('T')[0]
          : '';
        const assignee = page.jiraAssignee?.displayName || page.referenceAssignee || '';
        rows.push([
          page.title || '',
          statusLabel,
          page.url || '',
          page.jiraUrl || '',
          assignee,
          createdDate,
          page.targetedLaunchDate || '',
          page.actualLaunchDate || '',
          page.educationProjectStatus || '',
          page.contentText || ''
        ]);
      });
      const csv = rows.map(row => row.map(escapeCsvCell).join(',')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `release-notes-master-export-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      addToast(`Exported ${allPages.length} page(s) from all statuses to CSV. Import into Google Sheets via File → Import → Upload.`, 'success');
      logActivity('export', `Exported ${allPages.length} page(s) to CSV (all statuses)`, {
        scope: 'master_csv',
        count: allPages.length
      });
    } catch (err) {
      addToast(err.message || 'Master export failed', 'error');
    } finally {
      setMasterExportLoading(false);
    }
  }, [config, statuses, addToast, authenticatedFetch, perms.export]);

  const [exportForClaudeLoading, setExportForClaudeLoading] = useState(false);
  const [importFromClaudeLoading, setImportFromClaudeLoading] = useState(false);
  const handleImportFromClaude = useCallback(async (file) => {
    if (!perms.export) {
      addToast('Export/import tools are disabled for your account.', 'error');
      return;
    }
    if (!file || !file.name) return;
    setImportFromClaudeLoading(true);
    try {
      const formData = new FormData();
      formData.append('zip', file);
      const headers = { ...getAuthHeaders(), ...(await getAppAuthHeaders()) };
      delete headers['Content-Type'];
      const response = await fetch('/api/import-from-claude', { method: 'POST', headers, body: formData });
      const data = await response.json();
      if (!response.ok) {
        addToast(data.details || data.error || 'Import failed', 'error');
        return;
      }
      if (!data.drafts || data.drafts.length === 0) {
        addToast('No draft files found in the zip. Zip the folder that contains the drafts/ folder (e.g. the whole export folder), not just the contents of drafts/.', 'warning');
        return;
      }
      setShowSettings(false);
      setLaunchnotesImportAction({ pages: data.drafts });
      addToast(`Imported ${data.drafts.length} draft(s). Review and send to LaunchNotes.`, 'success');
      logActivity('export', `Imported ${data.drafts.length} draft(s) from Claude zip`, {
        scope: 'claude_zip_import',
        count: data.drafts.length,
        fileName: file.name
      });
    } catch (err) {
      addToast(err.message || 'Import failed', 'error');
    } finally {
      setImportFromClaudeLoading(false);
    }
  }, [addToast, perms.export]);
  const handleExportForClaude = useCallback(async (payload) => {
    if (!perms.export) {
      addToast('Export is disabled for your account.', 'error');
      return;
    }
    setExportForClaudeLoading(true);
    try {
      const body = typeof payload === 'object' && payload !== null
        ? payload
        : (Array.isArray(payload) && payload.length > 0 ? { statuses: payload } : {});
      const response = await authenticatedFetch('/api/export-for-claude', {
        method: 'POST',
        body: JSON.stringify(body)
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'Export failed' }));
        addToast(err.details || err.error || 'Export failed', 'error');
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `release-notes-for-claude-${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      addToast('Export for Claude downloaded. Unzip and use with Claude Code or Cursor (see INSTRUCTIONS.md).', 'success');
      logActivity('export', 'Downloaded Export for Claude / Cursor zip', { scope: 'claude_zip_export' });
      setShowExportForClaudeModal(false);
      setExportForClaudeInitialPageIds(null);
    } catch (err) {
      addToast(err.message || 'Export for Claude failed', 'error');
    } finally {
      setExportForClaudeLoading(false);
    }
  }, [addToast, authenticatedFetch, perms.export]);

  const staleCount = pages.filter(p => p.isStale).length;

  const [bulkEditAction, setBulkEditAction] = useState(null);
  const [batchAIGenerating, setBatchAIGenerating] = useState(false);
  const [docTicketsCreating, setDocTicketsCreating] = useState(false);
  const [batchAIResults, setBatchAIResults] = useState(null);
  const [batchSendToLaunchNotesLoading, setBatchSendToLaunchNotesLoading] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState(null);
  const [complianceCheck, setComplianceCheck] = useState(null);
  const [draggedPage, setDraggedPage] = useState(null);
  const [launchnotesImportAction, setLaunchnotesImportAction] = useState(null);
  const [importedFromClaudePageIds, setImportedFromClaudePageIds] = useState(() => {
    try {
      const raw = localStorage.getItem('claudeImportedPageIds');
      return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch {
      return new Set();
    }
  });
  const [styleGuideStatus, setStyleGuideStatus] = useState(null);
  const [styleGuideRefreshing, setStyleGuideRefreshing] = useState(false);

  const handleBulkEdit = useCallback(() => {
    if (selectedPages.size === 0) return;
    
    // Get selected page objects from sortedPages
    const selectedPageObjects = sortedPages.filter(p => selectedPages.has(p.id));
    setBulkEditAction({ pages: selectedPageObjects });
  }, [selectedPages, sortedPages]);

  const handleBulkExportToCursor = useCallback(() => {
    if (!perms.export || selectedPages.size === 0) return;
    setExportForClaudeInitialPageIds(Array.from(selectedPages, id => String(id)));
    setShowExportForClaudeModal(true);
  }, [perms.export, selectedPages]);

  const handleCreateDocTickets = useCallback(
    async (pageIds) => {
      const ids = (Array.isArray(pageIds) ? pageIds : []).map(String).filter(Boolean);
      if (ids.length === 0) return;
      if (!hasCredentials()) {
        addToast('Configure Atlassian credentials first.', 'error');
        return;
      }
      if (ids.length > 1) {
        const ok = window.confirm(
          `Create DOC ticket(s) for ${ids.length} Confluence pages? Each page needs a reference Jira key in its body or title; a DOC Story is created and linked with “Relates” to that issue.`
        );
        if (!ok) return;
      }
      setDocTicketsCreating(true);
      try {
        const response = await authenticatedFetch('/api/jira/create-doc-tickets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pageIds: ids })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          addToast(data.details || data.error || 'Failed to create DOC tickets', 'error');
          return;
        }
        const results = data.results || [];
        const created = results.filter((r) => r.ok);
        const failed = results.filter((r) => !r.ok);
        if (created.length > 0) {
          const keys = created.map((r) => r.docKey).filter(Boolean).join(', ');
          addToast(`Created ${created.length} DOC ticket(s): ${keys}`, 'success');
          const linkProblems = created.filter((r) => r.relatedLinkOk === false);
          if (linkProblems.length > 0) {
            addToast(
              `${linkProblems.length} ticket(s) created but the Jira “relates” link step failed: ${linkProblems
                .map((r) => r.linkError || 'unknown')
                .slice(0, 2)
                .join('; ')}`,
              'warning'
            );
          }
          logActivity('jira_update', 'Created DOC ticket(s) from release notes', {
            count: created.length,
            docKeys: created.map((r) => r.docKey).filter(Boolean),
            referenceKeys: created.map((r) => r.referenceKey || r.parentKey).filter(Boolean),
            relatedLinkOk: created.map((r) => r.relatedLinkOk)
          });
        }
        if (failed.length > 0) {
          const msg = failed
            .map((f) => f.error || 'Unknown error')
            .slice(0, 2)
            .join('; ');
          addToast(`${failed.length} failed: ${msg}`, 'error');
        }
        if (created.length === 0 && failed.length === 0) {
          addToast('No tickets created.', 'info');
        }
      } catch (e) {
        addToast(e.message || 'Failed to create DOC tickets', 'error');
      } finally {
        setDocTicketsCreating(false);
      }
    },
    [addToast]
  );

  const handleAddToLaunchNotes = useCallback((pages) => {
    if (!perms.launchnotes) {
      addToast('LaunchNotes is disabled for your account.', 'error');
      return;
    }
    setBulkEditAction(null); // Close bulk edit modal if open
    setLaunchnotesImportAction({ pages });
  }, [perms.launchnotes, addToast]);

  const handleLaunchNotesImportComplete = useCallback(async (results) => {
    const successCount = results ? results.filter(r => r.success).length : 0;
    const failCount = results ? results.filter(r => !r.success).length : 0;
    const wasFromClaudeImport = results && results.some(r => r.page && r.page.content != null && r.page.content !== '');
    if (wasFromClaudeImport && results) {
      const ids = results.filter(r => r.success && r.page?.id).map(r => r.page.id);
      if (ids.length > 0) {
        setImportedFromClaudePageIds(prev => {
          const next = new Set(prev);
          ids.forEach(id => next.add(id));
          try {
            localStorage.setItem('claudeImportedPageIds', JSON.stringify([...next]));
          } catch (_) {}
          return next;
        });
      }
      const confluenceUpdates = results
        .filter(r => r.success && r.page?.id && r.page?.content != null && r.page.content !== '')
        .map(r => ({ pageId: r.page.id, content: r.page.content }));
      if (confluenceUpdates.length > 0) {
        try {
          const res = await authenticatedFetch('/api/pages/prepend-imported-content', {
            method: 'POST',
            body: JSON.stringify({ updates: confluenceUpdates })
          });
          const data = await res.json();
          if (res.ok && data.success) {
            const ok = data.success.length;
            const failed = (data.failed || []).length;
            if (failed === 0) {
              addToast(`Updated ${ok} Confluence page${ok !== 1 ? 's' : ''} with rewritten content.`, 'success');
            } else {
              addToast(`Updated ${ok} Confluence page(s); ${failed} failed.`, 'warning');
            }
          }
        } catch (_) {
          addToast('Confluence page update failed.', 'warning');
        }
      }
    }
    if (results && results.length > 0) {
      if (successCount > 0) {
        logActivity('launchnotes', `Created ${successCount} draft(s) in LaunchNotes`, { count: successCount });
      }
      const moveFailCount = results.filter(r => r.success && r.moveError).length;
      if (failCount === 0 && moveFailCount === 0) {
        addToast(`Successfully created ${successCount} draft${successCount !== 1 ? 's' : ''} in LaunchNotes`, 'success');
      } else if (failCount === 0 && moveFailCount > 0) {
        addToast(
          `Created ${successCount} draft${successCount !== 1 ? 's' : ''} in LaunchNotes; ${moveFailCount} could not be moved to In Progress.`,
          'warning'
        );
      } else {
        addToast(`Created ${successCount} draft${successCount !== 1 ? 's' : ''}, ${failCount} failed`, 'error');
      }
    }
    if (successCount > 0) {
      fetchPages();
      fetchStats();
    }
    setLaunchnotesImportAction(null);
  }, [addToast, authenticatedFetch, fetchPages, fetchStats]);

  // Batch AI Generation
  const handleBatchAIGenerate = useCallback(async () => {
    if (!perms.ai) {
      addToast('AI features are disabled for your account.', 'error');
      return;
    }
    if (selectedPages.size === 0) {
      addToast('Please select pages to generate release notes for', 'info');
      return;
    }

    const credentials = getCredentials();
    if (!credentials?.aiApiKey) {
      addToast('Please configure AI API key in Settings', 'error');
      return;
    }

    // Check style guide status before generating
    await checkStyleGuideStatus();

    const selectedPageIds = Array.from(selectedPages);
    setBatchAIGenerating(true);
    setBatchAIResults(null);

    try {
      const response = await authenticatedFetch('/api/ai/batch-generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-AI-Api-Key': credentials.aiApiKey,
          'X-AI-Provider': credentials.aiProvider || 'gemini'
        },
        body: JSON.stringify({ pageIds: selectedPageIds })
      });

      const data = await response.json();
      if (data.error) {
        throw new Error(data.error || data.details);
      }

      setBatchAIResults(data);
      const successCount = data.successful || 0;
      if (successCount > 0) {
        logActivity('ai_generate', `Generated ${successCount} release note(s)`, { count: successCount });
      }
      addToast(`Generated ${successCount} release note${successCount !== 1 ? 's' : ''}`, 'success');
    } catch (err) {
      addToast(err.message || 'Failed to generate release notes', 'error');
    } finally {
      setBatchAIGenerating(false);
    }
  }, [selectedPages, addToast, perms.ai]);

  // Send batch AI results to LaunchNotes (one draft per successful result)
  const handleBatchSendToLaunchNotes = useCallback(async () => {
    if (!perms.launchnotes) {
      addToast('LaunchNotes is disabled for your account.', 'error');
      return;
    }
    if (!batchAIResults?.results?.length) return;
    const credentials = getCredentials();
    if (!credentials?.launchnotesApiKey && !credentials?.launchnotesUseSandbox) {
      addToast('Please configure LaunchNotes API in Settings', 'error');
      return;
    }
    if (!credentials?.launchnotesProjectId) {
      addToast('Please set LaunchNotes Project ID in Settings', 'error');
      return;
    }
    const successful = batchAIResults.results.filter(r => r.success);
    if (successful.length === 0) {
      addToast('No successful results to send to LaunchNotes', 'info');
      return;
    }
    setBatchSendToLaunchNotesLoading(true);
    const results = [];
    for (const result of successful) {
      try {
        const response = await authenticatedFetch('/api/launchnotes/create-draft', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Launchnotes-Api-Url': credentials.launchnotesApiUrl || 'https://app.launchnotes.io',
            'X-Launchnotes-Api-Key': credentials.launchnotesApiKey || '',
            'X-Launchnotes-Project-Id': credentials.launchnotesProjectId,
            'X-Launchnotes-Use-Sandbox': credentials.launchnotesUseSandbox ? 'true' : 'false'
          },
          body: JSON.stringify({
            content: result.content,
            title: result.headline || result.pageTitle,
            jiraTicket: result.jiraTicket || undefined
          })
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.error || data.details || 'Failed to create draft');
        }
        results.push({ pageId: result.pageId, success: true, pageTitle: result.pageTitle });
      } catch (err) {
        results.push({ pageId: result.pageId, success: false, pageTitle: result.pageTitle, error: err.message });
      }
    }
    setBatchSendToLaunchNotesLoading(false);
    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;
    if (successCount > 0) {
      logActivity('launchnotes', `Sent ${successCount} batch AI draft(s) to LaunchNotes`, { count: successCount });
      addToast(`Created ${successCount} draft${successCount !== 1 ? 's' : ''} in LaunchNotes` + (failCount > 0 ? `, ${failCount} failed` : ''), failCount > 0 ? 'error' : 'success');
    } else {
      addToast('Failed to create LaunchNotes drafts', 'error');
    }
  }, [batchAIResults, addToast, perms.launchnotes]);

  // AI Suggestions
  const handleAISuggestions = useCallback(async (page) => {
    if (!perms.ai) {
      addToast('AI features are disabled for your account.', 'error');
      return;
    }
    const credentials = getCredentials();
    if (!credentials?.aiApiKey) {
      addToast('Please configure AI API key in Settings', 'error');
      return;
    }

    // Check style guide status before generating suggestions
    await checkStyleGuideStatus();

    try {
      const response = await authenticatedFetch('/api/ai/suggest-improvements', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-AI-Api-Key': credentials.aiApiKey,
          'X-AI-Provider': credentials.aiProvider || 'gemini'
        },
        body: JSON.stringify({ pageId: page.id })
      });

      const data = await response.json();
      if (data.error) {
        throw new Error(data.error || data.details);
      }

      logActivity('ai_suggestions', 'AI suggestions generated', { pageTitle: page.title });
      setAiSuggestions({ page, suggestions: data.suggestions });
    } catch (err) {
      addToast(err.message || 'Failed to generate suggestions', 'error');
    }
  }, [addToast, perms.ai]);

  // Style Guide Compliance Check
  const handleCheckCompliance = useCallback(async (page) => {
    if (!perms.ai) {
      addToast('AI features are disabled for your account.', 'error');
      return;
    }
    // Check style guide status before checking compliance
    await checkStyleGuideStatus();

    try {
      const response = await authenticatedFetch('/api/ai/check-compliance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId: page.id })
      });

      const data = await response.json();
      if (data.error) {
        throw new Error(data.error || data.details);
      }

      logActivity('ai_compliance', 'Compliance check run', { pageTitle: page.title });
      setComplianceCheck({ page, compliance: data.compliance });
    } catch (err) {
      addToast(err.message || 'Failed to check compliance', 'error');
    }
  }, [addToast, perms.ai]);

  // Sync from Confluence – re-aggregate page data (Jira ticket, assignee, comments, etc.) without creating duplicates
  const [syncingFromConfluence, setSyncingFromConfluence] = useState(false);
  const handleSyncFromConfluence = useCallback(async (pageIds) => {
    if (!pageIds || pageIds.length === 0) return null;
    setSyncingFromConfluence(true);
    try {
      const response = await authenticatedFetch('/api/pages/refresh', {
        method: 'POST',
        body: JSON.stringify({ pageIds, status: currentStatus })
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.details || errorData.error || 'Failed to sync from Confluence');
      }
      const data = await response.json();
      const updatedList = data.pages || [];
      setPages(prev => {
        const byId = new Map(updatedList.map(p => [p.id, p]));
        const merged = prev.map(p => byId.has(p.id) ? byId.get(p.id) : p);
        merged.sort((a, b) => (b.lastActivityDaysAgo ?? 0) - (a.lastActivityDaysAgo ?? 0));
        return merged;
      });
      if (detailPage && pageIds.includes(detailPage.id)) {
        const updated = updatedList.find(p => p.id === detailPage.id);
        if (updated) setDetailPage(updated);
      }
      const n = updatedList.length;
      logActivity('sync_confluence', n === 1 ? 'Synced page from Confluence' : `Synced ${n} pages from Confluence`, { count: n });
      addToast(n === 1 ? 'Page synced from Confluence' : `${n} pages synced from Confluence`, 'success');
      return updatedList;
    } catch (err) {
      addToast(err.message || 'Failed to sync from Confluence', 'error');
      return null;
    } finally {
      setSyncingFromConfluence(false);
    }
  }, [currentStatus, addToast, detailPage]);

  // Refresh from Jira only – one-way: fetch latest fix version, labels, assignee, etc. (Jira = source of truth)
  const [refreshingJira, setRefreshingJira] = useState(false);
  const handleRefreshFromJira = useCallback(async (pageIds) => {
    if (!pageIds || pageIds.length === 0) return null;
    const updates = pageIds
      .map(id => {
        const p = pages.find(x => x.id === id);
        return p && p.jiraTicket ? { pageId: id, jiraTicket: p.jiraTicket } : null;
      })
      .filter(Boolean);
    if (updates.length === 0) {
      addToast('No Jira tickets to refresh for selected pages', 'info');
      return null;
    }
    setRefreshingJira(true);
    try {
      const response = await authenticatedFetch('/api/pages/refresh-jira', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates })
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.details || errorData.error || 'Failed to refresh from Jira');
      }
      const data = await response.json();
      const updatedList = data.pages || [];
      setPages(prev => {
        const byId = new Map(updatedList.map(p => [p.id, p]));
        return prev.map(p => (byId.has(p.id) ? { ...p, ...byId.get(p.id) } : p));
      });
      if (detailPage && pageIds.includes(detailPage.id)) {
        const updated = updatedList.find(p => p.id === detailPage.id);
        if (updated) setDetailPage(prev => (prev && prev.id === detailPage.id ? { ...prev, ...updated } : prev));
      }
      const n = updatedList.length;
      logActivity('refresh_jira', n === 1 ? 'Refreshed page from Jira' : `Refreshed ${n} pages from Jira`, { count: n });
      addToast(n === 1 ? 'Refreshed from Jira' : `${n} pages refreshed from Jira`, 'success');
      return updatedList;
    } catch (err) {
      addToast(err.message || 'Failed to refresh from Jira', 'error');
      return null;
    } finally {
      setRefreshingJira(false);
    }
  }, [pages, addToast, detailPage]);

  // Drag and Drop handlers
  const handleDragStart = useCallback((e, page) => {
    setDraggedPage(page);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', page.id);
  }, []);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const handleDrop = useCallback((e, targetStatus) => {
    e.preventDefault();
    if (!draggedPage) return;

    // Don't move if already in target status
    if (draggedPage.status === targetStatus) {
      setDraggedPage(null);
      return;
    }

    setConfirmAction({ page: draggedPage, target: targetStatus });
    setDraggedPage(null);
  }, [draggedPage]);

  // Check style guide status (silently, without showing notifications)
  const checkStyleGuideStatus = useCallback(async (showNotification = false) => {
    try {
      const response = await authenticatedFetch('/api/style-guide/status');
      const data = await response.json();
      if (data.success) {
        setStyleGuideStatus(data);
        // Only show notification if explicitly requested and there was an actual update
        if (showNotification && data.styleGuide?.wasUpdated) {
          addToast('Style guide has been updated! AI tools and compliance checker will use the new version.', 'success');
        }
      }
    } catch (err) {
      console.error('Failed to check style guide status:', err);
      // Don't set status on error to avoid breaking the UI
    }
  }, [addToast]);

  // Refresh style guide
  const refreshStyleGuide = useCallback(async () => {
    setStyleGuideRefreshing(true);
    try {
      const response = await authenticatedFetch('/api/style-guide/refresh', {
        method: 'POST'
      });
      const data = await response.json();
      if (data.success) {
        // After refresh, get the full status including content for preview
        const statusResponse = await authenticatedFetch('/api/style-guide/status');
        const statusData = await statusResponse.json();
        if (statusData.success) {
          setStyleGuideStatus(statusData);
        } else {
          setStyleGuideStatus(data);
        }
        
        logActivity('style_guide', data.styleGuide?.wasUpdated ? 'Style guide refreshed' : 'Style guide status checked', {});
        if (data.styleGuide.wasUpdated) {
          addToast('Style guide refreshed - new version detected!', 'success');
        } else {
          addToast('Style guide is up to date', 'info');
        }
      }
    } catch (err) {
      addToast('Failed to refresh style guide', 'error');
    } finally {
      setStyleGuideRefreshing(false);
    }
  }, [addToast]);

  // Check style guide status on mount (silently) and periodically
  useEffect(() => {
    checkStyleGuideStatus(false); // Don't show notification on initial load
    // Check every 5 minutes (silently)
    const interval = setInterval(() => checkStyleGuideStatus(false), 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [checkStyleGuideStatus]);

  if (adminPortal) {
    if (!perms.loaded) {
      return (
        <div className="app admin-portal-loading">
          <div className="loading-state full">
            <div className="spinner large" />
            <span>Loading…</span>
          </div>
        </div>
      );
    }
    return (
      <AdminPortal
        onExit={() => {
          window.location.hash = '';
          setAdminPortal(false);
        }}
      />
    );
  }

  return (
    <div className={`app app-shell${sidebarOpen ? ' sidebar-drawer-open' : ''}`}>
      {showRocketCelebration && (
        <ConfettiCelebration onComplete={() => setShowRocketCelebration(false)} />
      )}
      <button
        type="button"
        className="sidebar-backdrop"
        aria-label="Close menu"
        onClick={() => setSidebarOpen(false)}
      />
      <aside id="app-sidebar-nav" className={`app-sidebar${sidebarOpen ? ' is-open' : ''}`} aria-label="Main navigation">
        <div className="sidebar-brand">
          <div className="sidebar-logo">
            <h1 className="sidebar-title">Release Notes</h1>
          </div>
          <p className="sidebar-tagline">Confluence release lifecycle</p>
        </div>

        {stats && (
          <div className="sidebar-stats">
            <div className="sidebar-stat">
              <span className="sidebar-stat-value">{stats.total}</span>
              <span className="sidebar-stat-label">Total pages</span>
            </div>
            <div className="sidebar-stat">
              <span className="sidebar-stat-value">{stats.avgDaysInDraft}</span>
              <span className="sidebar-stat-label">Avg days in draft</span>
            </div>
          </div>
        )}

        <nav className="sidebar-nav-views" aria-label="Views">
          <button
            type="button"
            className={`sidebar-nav-item view-tab ${currentView === 'status' ? 'active' : ''}`}
            onClick={() => {
              setCurrentView('status');
              setSearchTerm('');
              setAuthorFilter('');
              setFixVersionFilter('');
              collapseSidebarOnNavigate();
            }}
          >
            <span className="tab-name">All Pages</span>
          </button>
          <button
            type="button"
            className={`sidebar-nav-item view-tab ${currentView === 'myTasks' ? 'active' : ''}`}
            onClick={() => {
              setCurrentView('myTasks');
              setSearchTerm('');
              setAuthorFilter('');
              setFixVersionFilter('');
              fetchMyTasks();
              collapseSidebarOnNavigate();
            }}
          >
            <span className="tab-name">My Tasks</span>
            {myTasks.length > 0 && <span className="tab-count">{myTasks.length}</span>}
          </button>
          <button
            type="button"
            className={`sidebar-nav-item view-tab ${currentView === 'featureFlags' ? 'active' : ''}`}
            onClick={() => {
              setCurrentView('featureFlags');
              setSearchTerm('');
              setAuthorFilter('');
              setFixVersionFilter('');
              collapseSidebarOnNavigate();
            }}
          >
            <span className="tab-name">Feature Flags</span>
          </button>
          {(!perms.loaded || perms.ai) && (
            <button
              type="button"
              className={`sidebar-nav-item view-tab ${currentView === 'aiHub' ? 'active' : ''}`}
              onClick={() => {
                setCurrentView('aiHub');
                setSearchTerm('');
                setAuthorFilter('');
                setFixVersionFilter('');
                collapseSidebarOnNavigate();
              }}
            >
              <span className="tab-name">AI Hub</span>
            </button>
          )}
        </nav>

        <div className="sidebar-section-label">Auto-refresh</div>
        <div className="sidebar-auto-refresh">
          <select
            className="auto-refresh-select sidebar-select"
            value={autoRefresh}
            onChange={(e) => handleAutoRefreshChange(parseInt(e.target.value, 10))}
            title="Auto-refresh interval"
          >
            <option value="0">Off</option>
            <option value="30">30 seconds</option>
            <option value="60">1 minute</option>
            <option value="300">5 minutes</option>
            <option value="600">10 minutes</option>
          </select>
          {autoRefresh > 0 && (
            <span className="auto-refresh-indicator" title={`Refreshing data every ${autoRefresh}s (header totals refresh on manual reload)`}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </span>
          )}
        </div>

        <div className="sidebar-section-label">Actions</div>
        <nav className="sidebar-nav-actions" aria-label="Tools">
          <button
            type="button"
            className="btn btn-secondary sidebar-action-btn"
            onClick={() => {
              if (currentView === 'status') {
                fetchPages();
              } else if (currentView === 'myTasks') {
                fetchMyTasks();
              } else if (currentView === 'aiHub') {
                fetchAllPagesForAI();
              }
              fetchStats();
              collapseSidebarOnNavigate();
            }}
            disabled={loading || myTasksLoading || allPagesLoading}
            title="Refresh (⌘+R)"
          >
            {(loading || myTasksLoading || allPagesLoading) ? <span className="spinner" /> : null}
            Refresh
          </button>
          <button
            type="button"
            className="btn btn-secondary sidebar-action-btn"
            onClick={() => {
              setShowActivityLog(true);
              collapseSidebarOnNavigate();
            }}
            title="View and export your activity in the tool"
          >
            Activity log
          </button>
          <button
            type="button"
            className="btn btn-secondary sidebar-action-btn"
            onClick={() => {
              setShowTroubleshooting(true);
              collapseSidebarOnNavigate();
            }}
            title="Troubleshooting & Debug"
          >
            Troubleshooting
          </button>
          <button
            type="button"
            className="btn btn-secondary sidebar-action-btn"
            onClick={() => {
              setShowSettings(true);
              collapseSidebarOnNavigate();
            }}
            title="Settings"
          >
            Settings
          </button>
          {perms.loaded && perms.isAdmin && (
            <a
              href="#/admin"
              className="btn btn-secondary sidebar-action-btn"
              onClick={(e) => {
                e.preventDefault();
                window.location.hash = '#/admin';
                collapseSidebarOnNavigate();
              }}
              title="User invites and permissions"
            >
              Admin
            </a>
          )}
          {isSupabaseAuthConfigured() && (
            <button
              type="button"
              className="btn btn-secondary sidebar-action-btn"
              onClick={() => {
                signOutApp();
                collapseSidebarOnNavigate();
              }}
              title="Sign out of this app (Toast login)"
            >
              Sign out
            </button>
          )}
        </nav>

        <div className="sidebar-footer">
          <ThemePicker />
        </div>
      </aside>

      <div className="app-main-column">
        <div className="app-main-topbar">
          <button
            type="button"
            className="btn btn-secondary sidebar-mobile-toggle"
            onClick={() => setSidebarOpen((o) => !o)}
            aria-expanded={sidebarOpen}
            aria-controls="app-sidebar-nav"
            title="Menu"
          >
            ☰ Menu
          </button>
        </div>
        <main className="app-main">
      {/* Status tabs - only show in status view */}
      {currentView === 'status' && (
        <nav className="status-tabs">
          {Object.entries(statuses).map(([key, status]) => (
            <button
              key={key}
              className={`status-tab ${currentStatus === key ? 'active' : ''} ${draggedPage && draggedPage.status !== key ? 'drop-zone' : ''}`}
              onClick={() => handleStatusChange(key)}
              style={{ '--tab-color': status.color }}
              onDragOver={(e) => {
                e.preventDefault();
                if (draggedPage && draggedPage.status !== key) {
                  e.currentTarget.classList.add('drag-over');
                }
              }}
              onDragLeave={(e) => {
                e.currentTarget.classList.remove('drag-over');
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.currentTarget.classList.remove('drag-over');
                handleDrop(e, key);
              }}
              title={draggedPage && draggedPage.status !== key ? `Drop here to move to ${status.name}` : ''}
            >
              <span className="tab-name">{status.name}</span>
              {stats?.byStatus?.[key] !== undefined && (
                <span className="tab-count">{stats.byStatus[key]}</span>
              )}
              {stats?.staleByStatus?.[key] > 0 && (
                <span className="tab-stale" title="Stale pages">{stats.staleByStatus[key]} stale</span>
              )}
            </button>
          ))}
        </nav>
      )}

        {currentView === 'aiHub' ? (
          <AIHub
            pages={allPagesForAI}
            statuses={statuses}
            onRefresh={fetchAllPagesForAI}
            loading={allPagesLoading}
          />
        ) : currentView === 'myTasks' ? (
          <MyTasksView
            tasksByStatus={myTasksByStatus}
            statuses={statuses}
            onPageClick={setDetailPage}
            onMove={(page, target) => setConfirmAction({ page, target })}
            onViewComments={openComments}
            loading={myTasksLoading}
            isPageAssignedToMe={isPageAssignedToMe}
            assignPageToMe={assignPageToMe}
            unassignPageFromMe={unassignPageFromMe}
            onAddToLaunchNotes={handleAddToLaunchNotes}
          />
        ) : currentView === 'featureFlags' ? (
          <FeatureFlagsView config={config} />
        ) : (
          <>
            <div className="controls-bar">
              <div className="search-box">
                <span className="search-icon">🔍</span>
                <input
                  type="text"
                  className="search-input"
                  placeholder="Search pages... (⌘+K)"
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                />
              </div>
              
              {authors.length > 1 && (
                <select 
                  className="author-filter"
                  value={authorFilter}
                  onChange={e => setAuthorFilter(e.target.value)}
                >
                  <option value="">All authors</option>
                  {authors.map(author => (
                    <option key={author} value={author}>{author}</option>
                  ))}
                </select>
              )}
              
              <select 
                className="time-filter"
                value={timeFilter}
                onChange={e => setTimeFilter(e.target.value)}
                title="Filter by time period"
              >
                <option value="">All time</option>
                <option value="today">Today</option>
                <option value="thisWeek">This Week</option>
                <option value="thisMonth">This Month</option>
              </select>
              
              {educationStatusOptions.length > 0 && (
                <select 
                  className="education-status-filter"
                  value={educationStatusFilter}
                  onChange={e => setEducationStatusFilter(e.target.value)}
                  title="Filter by Education Project Status"
                >
                  <option value="">All education statuses</option>
                  {educationStatusOptions.map(status => (
                    <option key={status} value={status}>{status}</option>
                  ))}
                </select>
              )}
              
              {fixVersionOptions.length > 0 && (
                <select 
                  className="fix-version-filter"
                  value={fixVersionFilter}
                  onChange={e => setFixVersionFilter(e.target.value)}
                  title="Filter by Fix Version"
                >
                  <option value="">All fix versions</option>
                  {fixVersionOptions.map(version => (
                    <option key={version} value={version}>{version}</option>
                  ))}
                </select>
              )}
              
              <div className="controls-info">
                <span className="page-count">{sortedPages.length} pages</span>
                {staleCount > 0 && currentStatusConfig?.staleThreshold && (
                  <span className="stale-count">
                    {staleCount} stale ({'>'}= {currentStatusConfig.staleThreshold} days)
                  </span>
                )}
                <button
                  type="button"
                  className="export-csv-btn"
                  onClick={handleExportToCsv}
                  disabled={sortedPages.length === 0 || !perms.export}
                  title={
                    !perms.export
                      ? 'Export is disabled for your account'
                      : 'Export visible pages to CSV (import into Google Sheets via File → Import → Upload)'
                  }
                >
                  Export to CSV
                </button>
              </div>
            </div>

            <BulkActionsBar 
              selectedCount={selectedPages.size}
              onEdit={handleBulkEdit}
              onClearSelection={() => setSelectedPages(new Set())}
              onBatchAIGenerate={handleBatchAIGenerate}
              batchAIGenerating={batchAIGenerating}
              onSyncFromConfluence={selectedPages.size > 0 ? () => handleSyncFromConfluence(Array.from(selectedPages)) : undefined}
              syncingFromConfluence={syncingFromConfluence}
              onRefreshFromJira={selectedPages.size > 0 ? () => handleRefreshFromJira(Array.from(selectedPages)) : undefined}
              refreshingJira={refreshingJira}
              hasJiraTickets={Array.from(selectedPages).some(id => pages.find(p => p.id === id)?.jiraTicket)}
              onExportToCursor={handleBulkExportToCursor}
              onCreateDocTickets={() =>
                handleCreateDocTickets(Array.from(selectedPages, (id) => String(id)))
              }
              docTicketsCreating={docTicketsCreating}
            />

            {error && (
              <div className="error-banner">
                <span>{error}</span>
                <button onClick={() => setError(null)}>Dismiss</button>
              </div>
            )}

            {loading && pages.length === 0 ? (
              <div className="loading-state full">
                <div className="spinner large"></div>
                <span>Loading pages from Confluence...</span>
              </div>
            ) : sortedPages.length === 0 ? (
              <div className="empty-state full">
                <span className="empty-icon">{currentStatusConfig?.icon || '📭'}</span>
                <h3>No pages in {currentStatusConfig?.name || 'this status'}</h3>
                <p>
                  {searchTerm || authorFilter || educationStatusFilter || fixVersionFilter
                    ? 'Try adjusting your filters' 
                    : 'Pages moved here will appear in this list'}
                </p>
              </div>
            ) : (
              <div className="pages-table-container">
                <table className="pages-table">
                  <thead>
                    <tr>
                      <th className="col-checkbox">
                        <input 
                          type="checkbox"
                          checked={selectedPages.size === sortedPages.length && sortedPages.length > 0}
                          onChange={toggleSelectAll}
                          title="Select all"
                        />
                      </th>
                      <th 
                        className={`col-title sortable ${sortColumn === 'title' ? 'sorted' : ''}`}
                        onClick={() => handleSort('title')}
                      >
                        Page Title
                        <span className="sort-indicator">
                          {sortColumn === 'title' ? (sortDirection === 'asc' ? '↑' : '↓') : '⇅'}
                        </span>
                      </th>
                      <th 
                        className={`col-created sortable ${sortColumn === 'createdDaysAgo' ? 'sorted' : ''}`}
                        onClick={() => handleSort('createdDaysAgo')}
                      >
                        Created
                        <span className="sort-indicator">
                          {sortColumn === 'createdDaysAgo' ? (sortDirection === 'asc' ? '↑' : '↓') : '⇅'}
                        </span>
                      </th>
                      {/* Last Activity column – commented out to save space; restore if needed
                      <th 
                        className={`col-activity sortable ${sortColumn === 'lastActivityDaysAgo' ? 'sorted' : ''}`}
                        onClick={() => handleSort('lastActivityDaysAgo')}
                      >
                        Last Activity
                        <span className="sort-indicator">
                          {sortColumn === 'lastActivityDaysAgo' ? (sortDirection === 'asc' ? '↑' : '↓') : '⇅'}
                        </span>
                      </th>
                      */}
                      {/* Comments column – commented out to save space; restore if needed
                      <th 
                        className={`col-comments sortable ${sortColumn === 'commentCount' ? 'sorted' : ''}`}
                        onClick={() => handleSort('commentCount')}
                      >
                        Comments
                        <span className="sort-indicator">
                          {sortColumn === 'commentCount' ? (sortDirection === 'asc' ? '↑' : '↓') : '⇅'}
                        </span>
                      </th>
                      */}
                      <th className="col-jira">Jira Ticket</th>
                      <th 
                        className={`col-targeted-launch-date sortable ${sortColumn === 'targetedLaunchDate' ? 'sorted' : ''}`}
                        onClick={() => handleSort('targetedLaunchDate')}
                      >
                        Targeted Launch Date
                        <span className="sort-indicator">
                          {sortColumn === 'targetedLaunchDate' ? (sortDirection === 'asc' ? '↑' : '↓') : '⇅'}
                        </span>
                      </th>
                      <th 
                        className={`col-actual-launch-date sortable ${sortColumn === 'actualLaunchDate' ? 'sorted' : ''}`}
                        onClick={() => handleSort('actualLaunchDate')}
                      >
                        Actual Launch Date
                        <span className="sort-indicator">
                          {sortColumn === 'actualLaunchDate' ? (sortDirection === 'asc' ? '↑' : '↓') : '⇅'}
                        </span>
                      </th>
                      <th className="col-education-status">Education Project Status</th>
                      <th className="col-assignee">Assignee</th>
                      <th className="col-actions">Actions</th>
                      <th className="col-drag-handle"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedPages.map(page => (
                      <tr 
                        key={page.id} 
                        className={`${page.isStale ? 'stale-row' : ''} ${selectedPages.has(page.id) ? 'selected-row' : ''} ${draggedPage?.id === page.id ? 'dragging' : ''}`}
                      >
                        <td className="col-checkbox">
                          <input 
                            type="checkbox"
                            checked={selectedPages.has(page.id)}
                            onChange={() => togglePageSelection(page.id)}
                          />
                        </td>
                    <td className="col-title">
                      <div className="page-title-row">
                        {importedFromClaudePageIds.has(page.id) && (
                          <span className="claude-imported-icon" title="Imported from Claude / Cursor rewrite">
                            <span aria-hidden="true">✓</span>
                          </span>
                        )}
                        <button 
                          className="page-link-btn"
                          onClick={() => setDetailPage(page)}
                          title="View details"
                        >
                          {page.title}
                        </button>
                        {page.hasNotes && (
                          <span className="note-indicator note-count-badge" title="Has notes">
                            <span className="note-count-icon" aria-hidden="true">📝</span>
                            <span className="note-count-num">{page.noteCount ?? 1}</span>
                          </span>
                        )}
                        {isPageAssignedToMe(page.id) && (
                          <span className="assigned-badge" title="Assigned to you">
                          </span>
                        )}
                      </div>
                      <div className="page-meta">
                        <span className="page-author">by {page.author}</span>
                        {(page.jiraMetadataPills || []).map((pill) => (
                          <span
                            key={pill.label}
                            className="jira-metadata-pill"
                            title={`${pill.label}: ${pill.values.join(', ')}`}
                          >
                            {pill.values[0]}
                          </span>
                        ))}
                      </div>
                    </td>
                        <td className="col-created">
                          <StatusBadge days={page.createdDaysAgo} threshold={60} />
                        </td>
                        {/* Last Activity column – commented out to save space; restore if needed
                        <td className="col-activity">
                          <StatusBadge 
                            days={page.lastActivityDaysAgo} 
                            threshold={currentStatusConfig?.staleThreshold} 
                          />
                          {page.isStale && (
                            <span className="stale-indicator" title={`No activity for ${currentStatusConfig?.staleThreshold}+ days`}>
                            </span>
                          )}
                        </td>
                        */}
                        {/* Comments column – commented out to save space; restore if needed
                        <td className="col-comments">
                          <button 
                            className="comment-btn"
                            onClick={() => openComments(page)}
                          >
                            {page.commentCount || 0}
                          </button>
                        </td>
                        */}
                        <td className="col-jira">
                          {page.jiraTicket ? (
                            <a 
                              href={page.jiraUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="jira-link"
                              onClick={e => e.stopPropagation()}
                            >
                              {page.jiraTicket}
                            </a>
                          ) : (
                            <span className="no-jira">—</span>
                          )}
                        </td>
                        <td className="col-targeted-launch-date">
                          {page.targetedLaunchDate ? (
                            <span className="launch-date-cell" title={page.targetedLaunchDate}>{page.targetedLaunchDate}</span>
                          ) : (
                            <span className="no-value">—</span>
                          )}
                        </td>
                        <td className="col-actual-launch-date">
                          {page.actualLaunchDate ? (
                            <span className="launch-date-cell" title={page.actualLaunchDate}>{page.actualLaunchDate}</span>
                          ) : (
                            <span className="no-value">—</span>
                          )}
                        </td>
                        <td className="col-education-status">
                          {page.educationProjectStatus ? (
                            <span className="education-status-badge" title={page.educationProjectStatus}>{page.educationProjectStatus}</span>
                          ) : (
                            <span className="no-value">—</span>
                          )}
                        </td>
                        <td className="col-assignee">
                          {(page.jiraAssignee?.displayName || page.referenceAssignee) ? (
                            <div className="assignee-cell">
                              <span className="assignee-name" title={page.jiraAssignee?.displayName || page.referenceAssignee}>
                                {page.jiraAssignee?.displayName || page.referenceAssignee}
                              </span>
                            </div>
                          ) : (
                            <span className="no-assignee">—</span>
                          )}
                        </td>
                        <td className="col-actions">
                          <OverflowMenu 
                            page={page}
                            statuses={statuses}
                            currentStatus={currentStatus}
                            onMove={(page, target) => setConfirmAction({ page, target })}
                            onViewComments={openComments}
                            isAssigned={isPageAssignedToMe(page.id)}
                            onAssign={assignPageToMe}
                            onUnassign={unassignPageFromMe}
                            onAddToLaunchNotes={handleAddToLaunchNotes}
                          />
                        </td>
                        <td className="col-drag-handle">
                          <div 
                            className="drag-handle"
                            draggable
                            onDragStart={(e) => handleDragStart(e, page)}
                            onDragEnd={() => setDraggedPage(null)}
                            title="Drag to move to another status"
                          >
                            <span className="hamburger-icon"></span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
        </main>
      </div>

      {detailPage && (
        <PageDetailPanel
          page={detailPage}
          onClose={() => setDetailPage(null)}
          statuses={statuses}
          currentStatus={currentStatus}
          onMove={(page, target) => {
            setDetailPage(null);
            setConfirmAction({ page, target });
          }}
          onViewComments={(page) => {
            setDetailPage(null);
            openComments(page);
          }}
          onAddComment={(page) => {
            setConfirmAction({ page, target: currentStatus, addComment: true });
          }}
          onAddToLaunchNotes={handleAddToLaunchNotes}
          onViewJiraComments={openJiraComments}
          isAssigned={detailPage ? isPageAssignedToMe(detailPage.id) : false}
          onAssign={assignPageToMe}
          onUnassign={unassignPageFromMe}
          onAISuggestions={handleAISuggestions}
          onCheckCompliance={handleCheckCompliance}
          onSyncFromConfluence={handleSyncFromConfluence}
          syncingFromConfluence={syncingFromConfluence}
          onRefreshFromJira={handleRefreshFromJira}
          refreshingJira={refreshingJira}
          onNotesUpdated={(pageId) => {
            setPages(prev => prev.map(p => p.id === pageId ? { ...p, hasNotes: true, noteCount: 1 } : p));
            setMyTasks(prev => prev.map(p => p.id === pageId ? { ...p, hasNotes: true, noteCount: 1 } : p));
            setMyTasksByStatus(prev => {
              const next = {};
              for (const [k, arr] of Object.entries(prev)) {
                next[k] = (arr || []).map(p => p.id === pageId ? { ...p, hasNotes: true, noteCount: 1 } : p);
              }
              return next;
            });
          }}
          onCreateDocTicket={(pageId) => handleCreateDocTickets([pageId])}
          docTicketsBusy={docTicketsCreating}
          addToast={addToast}
        />
      )}

      {selectedPage && (
        <CommentModal
          page={selectedPage}
          comments={comments}
          loading={commentsLoading}
          onClose={() => setSelectedPage(null)}
          onAddComment={commentType === 'jira' ? handleAddJiraCommentFromModal : handleAddComment}
          type={commentType}
        />
      )}

      {confirmAction && (
        confirmAction.addComment ? (
          <JiraCommentModal
            page={confirmAction.page}
            jiraData={null} // Will be loaded in the modal
            onConfirm={(jiraComment, labels) => handleAddJiraComment(confirmAction.page, jiraComment, labels)}
            onCancel={() => setConfirmAction(null)}
            loading={actionLoading}
          />
        ) : (
          <MoveConfirmModal
            page={confirmAction.page}
            targetStatus={confirmAction.target}
            statuses={statuses}
            onConfirm={(jiraComment, labels) => handleMove(confirmAction.page, confirmAction.target, jiraComment, labels)}
            onCancel={() => setConfirmAction(null)}
            loading={actionLoading}
            addComment={false}
          />
        )
      )}

      {launchnotesImportAction && (
        <LaunchNotesImportModal
          pages={launchnotesImportAction.pages}
          onConfirm={handleLaunchNotesImportComplete}
          onCancel={() => setLaunchnotesImportAction(null)}
          loading={actionLoading}
        />
      )}
      {bulkEditAction && (
        <BulkEditModal
          pages={bulkEditAction.pages}
          currentStatus={currentStatus}
          statuses={statuses}
          onConfirm={(targetStatus, jiraComment, confluenceComment, labels) => executeBulkEdit(
            targetStatus,
            bulkEditAction.pages.map(p => p.id),
            jiraComment,
            confluenceComment,
            labels
          )}
          onAddToLaunchNotes={handleAddToLaunchNotes}
          onCancel={() => setBulkEditAction(null)}
          loading={actionLoading}
          onAssignToMe={assignPageToMe}
        />
      )}

      {showActivityLog && (
        <ActivityLogModal
          onClose={() => setShowActivityLog(false)}
          onCopyNotify={() => addToast('Activity log copied to clipboard', 'success')}
        />
      )}

      {showExportForClaudeModal && (
        <ExportForClaudeModal
          statuses={statuses}
          cachedPages={currentView === 'status' ? pages : null}
          cachedStatus={currentView === 'status' ? currentStatus : null}
          initialBoardSelectionIds={exportForClaudeInitialPageIds}
          onClose={() => {
            setShowExportForClaudeModal(false);
            setExportForClaudeInitialPageIds(null);
          }}
          onExport={handleExportForClaude}
          exportLoading={exportForClaudeLoading}
        />
      )}

      {showSettings && (
        <SettingsModal
          onSave={handleSaveSettings}
          onCancel={() => {
            if (hasCredentials()) {
              setShowSettings(false);
            } else {
              addToast('Please configure settings to continue', 'info');
            }
          }}
          initialSettings={getCredentials()}
          onRefreshStyleGuide={refreshStyleGuide}
          styleGuideStatus={styleGuideStatus}
          styleGuideRefreshing={styleGuideRefreshing}
          onMasterExport={handleMasterExportToCsv}
          masterExportLoading={masterExportLoading}
          exportStatuses={statuses}
          onOpenExportForClaudeModal={() => {
            setShowSettings(false);
            setExportForClaudeInitialPageIds(null);
            setShowExportForClaudeModal(true);
          }}
          onExportForClaude={handleExportForClaude}
          exportForClaudeLoading={exportForClaudeLoading}
          onImportFromClaude={handleImportFromClaude}
          importFromClaudeLoading={importFromClaudeLoading}
        />
      )}

      {showTroubleshooting && (
        <TroubleshootingPanel onClose={() => setShowTroubleshooting(false)} />
      )}


      {launchNotesPages && (
        <LaunchNotesImportModal
          pages={launchNotesPages}
          onConfirm={() => {
            setLaunchNotesPages(null);
            setLaunchNotesLoading(false);
            addToast('LaunchNotes drafts created successfully!', 'success');
          }}
          onCancel={() => {
            setLaunchNotesPages(null);
            setLaunchNotesLoading(false);
          }}
          loading={launchNotesLoading}
        />
      )}

      {/* Batch AI Results Modal */}
      {batchAIResults && (
        <div className="modal-overlay" onClick={() => setBatchAIResults(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Batch AI Generation Results</h2>
              <button className="close-btn" onClick={() => setBatchAIResults(null)}>×</button>
            </div>
            <div className="modal-body">
              <div className="batch-ai-summary">
                <p>
                  <strong>Total:</strong> {batchAIResults.total} | 
                  <strong> Successful:</strong> {batchAIResults.successful} | 
                  <strong> Failed:</strong> {batchAIResults.failed}
                </p>
              </div>
              <div className="batch-ai-results">
                {batchAIResults.results.map((result, idx) => (
                  <div key={idx} className={`batch-ai-result ${result.success ? 'success' : 'error'}`}>
                    <h4>{result.pageTitle || `Page ${result.pageId}`}</h4>
                    {result.success ? (
                      <div>
                        <p><strong>Headline:</strong> {result.headline}</p>
                        <details>
                          <summary>View Generated Content</summary>
                          <pre className="ai-generated-content">{result.content}</pre>
                        </details>
                      </div>
                    ) : (
                      <p className="error-message">Error: {result.error}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
            <div className="modal-footer">
              {batchAIResults.successful > 0 && (
                <button
                  className="btn btn-secondary launchnotes-btn"
                  onClick={handleBatchSendToLaunchNotes}
                  disabled={batchSendToLaunchNotesLoading}
                >
                  {batchSendToLaunchNotesLoading ? 'Sending...' : 'Send to LaunchNotes'}
                </button>
              )}
              <button className="btn btn-primary" onClick={() => setBatchAIResults(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* AI Suggestions Modal */}
      {aiSuggestions && (
        <div className="modal-overlay" onClick={() => setAiSuggestions(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>AI Suggestions for "{aiSuggestions.page.title}"</h2>
              <button className="close-btn" onClick={() => setAiSuggestions(null)}>×</button>
            </div>
            <div className="modal-body">
              <div className="ai-suggestions-content">
                <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{aiSuggestions.suggestions}</pre>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-primary" onClick={() => setAiSuggestions(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Compliance Check Modal */}
      {complianceCheck && (
        <div className="modal-overlay" onClick={() => setComplianceCheck(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Style Guide Compliance: "{complianceCheck.page.title}"</h2>
              <button className="close-btn" onClick={() => setComplianceCheck(null)}>×</button>
            </div>
            <div className="modal-body">
              <div className="compliance-score">
                <h3>Compliance Score: {complianceCheck.compliance.score}/100</h3>
                <div className={`score-badge ${complianceCheck.compliance.score >= 80 ? 'good' : complianceCheck.compliance.score >= 60 ? 'warning' : 'poor'}`}>
                  {complianceCheck.compliance.score >= 80 ? '✓ Good' : complianceCheck.compliance.score >= 60 ? '⚠ Needs Work' : '✗ Poor'}
                </div>
              </div>
              
              {complianceCheck.compliance.issues.length > 0 && (
                <div className="compliance-issues">
                  <h4>Issues ({complianceCheck.compliance.issues.length})</h4>
                  <ul>
                    {complianceCheck.compliance.issues.map((issue, idx) => (
                      <li key={idx} className={`issue-${issue.priority}`}>
                        <strong>[{issue.priority.toUpperCase()}]</strong> {issue.message}
                        <span className="issue-category">({issue.category})</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {complianceCheck.compliance.warnings.length > 0 && (
                <div className="compliance-warnings">
                  <h4>Warnings ({complianceCheck.compliance.warnings.length})</h4>
                  <ul>
                    {complianceCheck.compliance.warnings.map((warning, idx) => (
                      <li key={idx} className={`warning-${warning.priority}`}>
                        <strong>[{warning.priority.toUpperCase()}]</strong> {warning.message}
                        <span className="warning-category">({warning.category})</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {complianceCheck.compliance.issues.length === 0 && complianceCheck.compliance.warnings.length === 0 && (
                <div className="compliance-success">
                  <p>✓ No issues found! This release note appears to be compliant with the style guide.</p>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-primary" onClick={() => setComplianceCheck(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      <div className="toast-container">
        {toasts.map(toast => (
          <Toast
            key={toast.id}
            message={toast.message}
            type={toast.type}
            onClose={() => removeToast(toast.id)}
            onUndo={toast.undoAction ? () => { toast.undoAction(); removeToast(toast.id); } : null}
          />
        ))}
      </div>
    </div>
  );
}

export default App;
