import React, { useState, useMemo } from 'react';
import { authenticatedFetch, getCredentials } from './api';
import { usePermissions } from './permissionsContext';
import './App.css';

const AI_HUB_STATUS_ORDER = ['draft', 'inProgress', 'needsAction'];

function AIHub({ pages, statuses, onRefresh }) {
  const perms = usePermissions();
  const [step, setStep] = useState(1);
  const [selectedPages, setSelectedPages] = useState([]);
  const [customContent, setCustomContent] = useState('');
  const [headline, setHeadline] = useState('');
  const [generatedContent, setGeneratedContent] = useState('');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);
  const [launchNotesCreating, setLaunchNotesCreating] = useState(false);
  const [launchNotesError, setLaunchNotesError] = useState(null);
  const [useMCP, setUseMCP] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [collapsedSections, setCollapsedSections] = useState({});

  // Group pages by status
  const pagesByStatus = useMemo(() => {
    const grouped = {};
    AI_HUB_STATUS_ORDER.forEach(statusKey => {
      grouped[statusKey] = [];
    });
    
    pages.forEach(page => {
      const status = page.status || 'draft';
      if (grouped[status]) {
        grouped[status].push(page);
      } else {
        // If status not in order, add to draft
        grouped['draft'].push(page);
      }
    });
    
    return grouped;
  }, [pages]);

  // Filter pages by search term
  const filteredPagesByStatus = useMemo(() => {
    if (!searchTerm.trim()) {
      return pagesByStatus;
    }
    
    const searchLower = searchTerm.toLowerCase();
    const filtered = {};
    
    Object.keys(pagesByStatus).forEach(statusKey => {
      filtered[statusKey] = pagesByStatus[statusKey].filter(page => 
        page.title.toLowerCase().includes(searchLower) ||
        (page.jiraTicket && page.jiraTicket.toLowerCase().includes(searchLower)) ||
        (page.author && page.author.toLowerCase().includes(searchLower))
      );
    });
    
    return filtered;
  }, [pagesByStatus, searchTerm]);

  // Toggle section collapse
  const toggleSection = (statusKey) => {
    setCollapsedSections(prev => ({
      ...prev,
      [statusKey]: !prev[statusKey]
    }));
  };

  // Step 1: Select pages or enter custom content
  const handlePageToggle = (pageId, pageTitle) => {
    const isSelected = selectedPages.includes(pageId);
    
    if (isSelected) {
      setSelectedPages(prev => prev.filter(id => id !== pageId));
      // Clear headline if it was the only selected page
      if (selectedPages.length === 1 && headline === pageTitle) {
        setHeadline('');
      }
    } else {
      setSelectedPages(prev => [...prev, pageId]);
      // Auto-fill headline with the first selected page's title
      if (selectedPages.length === 0) {
        setHeadline(pageTitle);
      }
    }
  };

  const handleNext = () => {
    if (step === 1) {
      if (selectedPages.length === 0 && !customContent.trim()) {
        setError('Please select at least one page or enter custom content');
        return;
      }
      setError(null);
      setStep(2);
    } else if (step === 2) {
      if (!headline.trim()) {
        setError('Please enter a headline');
        return;
      }
      setError(null);
      handleGenerate();
    }
  };

  const handleBack = () => {
    setStep(prev => Math.max(1, prev - 1));
    setError(null);
  };

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    setGeneratedContent('');

    try {
      const credentials = getCredentials();
      const response = await authenticatedFetch('/api/ai/generate-release-note', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-AI-Api-Key': credentials.aiApiKey || '',
          'X-AI-Provider': credentials.aiProvider || 'gemini'
        },
        body: JSON.stringify({
          pageIds: selectedPages,
          customContent: customContent.trim() || null,
          headline: headline.trim()
        })
      });

      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to generate release note');
      }

      // Always show generated content if available, otherwise show error
      if (data.generatedContent) {
        setGeneratedContent(data.generatedContent);
        setStep(3);
      } else if (data.generationError) {
        throw new Error(data.generationError || 'AI generation failed');
      } else {
        throw new Error('No content generated. Please check your AI API key configuration.');
      }
    } catch (err) {
      setError(err.message || 'Failed to generate release note');
    } finally {
      setGenerating(false);
    }
  };

  const handleCreateLaunchNotesDraft = async () => {
    if (!generatedContent.trim()) {
      setLaunchNotesError('No content to create draft');
      return;
    }
    if (!perms.launchnotes) {
      setLaunchNotesError('LaunchNotes is disabled for your account.');
      return;
    }

    setLaunchNotesCreating(true);
    setLaunchNotesError(null);

    try {
      const credentials = getCredentials();
      
      if (useMCP) {
        // Generate MCP command text for Cursor
        const mcpCommand = `Create a LaunchNotes announcement draft with the following details:

Project ID: ${credentials.launchnotesProjectId || credentials.launchNotesProjectId || 'pro_EtBG4hh8w3LBq'}
Headline: ${headline.trim() || 'AI Generated Release Note'}

Content (Markdown):
${generatedContent}

Use the LaunchNotes MCP server to:
1. Create a draft announcement with the headline and content above
2. Use the project ID specified
3. Return the announcement ID when created

Command to use:
\`\`\`
mcp_launchnotes_launchnotes_create_announcement(
  project_id: "${credentials.launchnotesProjectId || credentials.launchNotesProjectId || 'pro_EtBG4hh8w3LBq'}",
  headline: "${headline.trim() || 'AI Generated Release Note'}",
  content_markdown: "${generatedContent.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"
)
\`\`\`

Or in natural language:
"Create a LaunchNotes draft announcement in project ${credentials.launchnotesProjectId || credentials.launchNotesProjectId || 'pro_EtBG4hh8w3LBq'} with headline '${headline.trim() || 'AI Generated Release Note'}' and the following content: [paste the content above]"
`;

        // Copy to clipboard and show
        try {
          await navigator.clipboard.writeText(mcpCommand);
          alert('MCP command text copied to clipboard! Paste it into Cursor to use the LaunchNotes MCP server.');
        } catch (err) {
          // Fallback: show in a textarea for manual copy
          const textarea = document.createElement('textarea');
          textarea.value = mcpCommand;
          textarea.style.position = 'fixed';
          textarea.style.opacity = '0';
          document.body.appendChild(textarea);
          textarea.select();
          try {
            document.execCommand('copy');
            alert('MCP command text copied to clipboard! Paste it into Cursor to use the LaunchNotes MCP server.');
          } catch (e) {
            // Show in alert as last resort
            prompt('Copy this MCP command text:', mcpCommand);
          }
          document.body.removeChild(textarea);
        }
        return;
      }

      // Build external content link from first selected page's Jira JPD ticket (so it appears on LaunchNotes announcement)
      let externalContentLinks = [];
      if (selectedPages.length > 0) {
        const firstSelected = pages.find(p => selectedPages.includes(p.id));
        if (firstSelected?.jiraTicket) {
          externalContentLinks = [{
            title: firstSelected.jiraTicket,
            url: firstSelected.jiraUrl || `${(credentials.baseUrl || '').replace(/\/wiki\/?$/, '')}/browse/${firstSelected.jiraTicket}`
          }];
        }
      }

      // Use API
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
          headline: headline.trim() || 'AI Generated Release Note',
          content: generatedContent,
          projectId: credentials.launchnotesProjectId || credentials.launchNotesProjectId,
          ...(externalContentLinks.length > 0 && { externalContentLinks })
        })
      });

      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to create LaunchNotes draft');
      }

      alert(`LaunchNotes draft created successfully! Announcement ID: ${data.announcementId || data.draftId || '—'}`);
      
      // Reset form
      setStep(1);
      setSelectedPages([]);
      setCustomContent('');
      setHeadline('');
      setGeneratedContent('');
      if (onRefresh) onRefresh();
    } catch (err) {
      setLaunchNotesError(err.message || 'Failed to create LaunchNotes draft');
    } finally {
      setLaunchNotesCreating(false);
    }
  };

  // Get total page count
  const totalPages = Object.values(filteredPagesByStatus).reduce((sum, pages) => sum + pages.length, 0);

  if (perms.loaded && !perms.ai) {
    return (
      <div className="ai-hub">
        <div className="ai-hub-header">
          <h2>AI Hub</h2>
          <p className="permission-denied-msg">AI features are disabled for your account. An admin can enable the <code>ai</code> permission.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="ai-hub">
      <div className="ai-hub-header">
        <h2>AI Release Note Generator</h2>
        <p>Generate release notes using AI based on Confluence pages and style guide</p>
      </div>

      <div className="ai-wizard">
        {/* Step 1: Select Content */}
        {step === 1 && (
          <div className="wizard-step">
            <h3>Step 1: Select Content Sources</h3>
            <p>Choose Confluence pages or enter custom content</p>
            
            <div className="content-selection">
              <div className="page-selection">
                <div className="page-selection-header">
                  <h4>Select Pages</h4>
                  <div className="page-search">
                    <input
                      type="text"
                      placeholder="Search pages..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="search-input"
                    />
                  </div>
                </div>
                
                <div className="page-list">
                  {totalPages > 0 ? (
                    AI_HUB_STATUS_ORDER.map(statusKey => {
                      const statusPages = filteredPagesByStatus[statusKey] || [];
                      if (statusPages.length === 0) return null;
                      
                      const statusConfig = statuses?.[statusKey] || { name: statusKey };
                      const isCollapsed = collapsedSections[statusKey];
                      
                      return (
                        <div key={statusKey} className="status-section">
                          <button
                            className="status-section-header"
                            onClick={() => toggleSection(statusKey)}
                          >
                            <span className="section-title">
                              {statusConfig?.name || statusKey}
                              <span className="page-count">({statusPages.length})</span>
                            </span>
                            <span className="collapse-icon">
                              {isCollapsed ? '▼' : '▲'}
                            </span>
                          </button>
                          
                          {!isCollapsed && (
                            <div className="status-section-content">
                              {statusPages.map(page => (
                                <label key={page.id} className="page-checkbox">
                                  <input
                                    type="checkbox"
                                    checked={selectedPages.includes(page.id)}
                                    onChange={() => handlePageToggle(page.id, page.title)}
                                  />
                                  <span className="page-title">{page.title}</span>
                                  {page.jiraTicket && (
                                    <span className="jira-badge">{page.jiraTicket}</span>
                                  )}
                                </label>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })
                  ) : (
                    <p className="empty-state">
                      {searchTerm ? 'No pages match your search' : 'No pages available'}
                    </p>
                  )}
                </div>
              </div>

              <div className="custom-content">
                <h4>Or Enter Custom Content</h4>
                <textarea
                  value={customContent}
                  onChange={(e) => setCustomContent(e.target.value)}
                  placeholder="Paste content here..."
                  rows={10}
                />
              </div>
            </div>

            {error && <div className="error-message">{error}</div>}

            <div className="wizard-actions">
              <button onClick={handleNext} className="btn btn-primary">
                Next: Set Headline
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Set Headline */}
        {step === 2 && (
          <div className="wizard-step">
            <h3>Step 2: Set Headline</h3>
            <p>Enter the headline for your release note</p>
            
            <div className="headline-input">
              <input
                type="text"
                value={headline}
                onChange={(e) => setHeadline(e.target.value)}
                placeholder="Enter release note headline..."
                className="headline-field"
              />
            </div>

            {error && <div className="error-message">{error}</div>}

            <div className="wizard-actions">
              <button onClick={handleBack} className="btn btn-secondary">
                Back
              </button>
              <button 
                onClick={handleNext} 
                className="btn btn-primary"
                disabled={generating}
              >
                {generating ? 'Generating...' : 'Generate Release Note'}
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Preview & Edit */}
        {step === 3 && (
          <div className="wizard-step">
            <h3>Step 3: Preview & Edit</h3>
            <p>Review the generated release note and make any edits</p>
            
            <div className="preview-section">
              <textarea
                value={generatedContent}
                onChange={(e) => setGeneratedContent(e.target.value)}
                rows={20}
                className="preview-editor"
              />
            </div>

            <div className="wizard-actions">
              <button onClick={handleBack} className="btn btn-secondary">
                Back
              </button>
              {perms.launchnotes && (
                <div className="launchnotes-actions">
                  <label className="mcp-toggle">
                    <input
                      type="checkbox"
                      checked={useMCP}
                      onChange={(e) => setUseMCP(e.target.checked)}
                    />
                    Use MCP Instead
                  </label>
                  <button
                    onClick={handleCreateLaunchNotesDraft}
                    className="btn btn-primary"
                    disabled={launchNotesCreating || !generatedContent.trim()}
                  >
                    {launchNotesCreating ? 'Creating...' : 'Add LaunchNotes Draft'}
                  </button>
                </div>
              )}
            </div>

            {launchNotesError && (
              <div className="error-message">{launchNotesError}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default AIHub;
