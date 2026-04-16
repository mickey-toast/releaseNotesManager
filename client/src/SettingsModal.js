import React, { useState, useMemo, useEffect } from 'react';
import { authenticatedFetch } from './api';
import { isSupabaseAuthConfigured, supabase } from './supabaseClient';
import { isSettingsSuperAdmin } from './settingsAdminAccess';
import { usePermissions } from './permissionsContext';
import { DEFAULT_TEMPLATES, getTemplates } from './templateConstants';
import { getAuditCategoryPreferences, setAuditCategoryPreferences, ACTIVITY_CATEGORIES } from './activityLog';
import NotificationRulesSettings from './NotificationRulesSettings';
import { getNotificationRulesFromStorage } from './notificationRulesClient';

// Available Jira fields that can be displayed
const AVAILABLE_FIELDS = [
  { id: 'assignee', label: 'Assignee', default: true },
  { id: 'reporter', label: 'Reporter', default: true },
  { id: 'labels', label: 'Labels', default: true },
  { id: 'priority', label: 'Priority', default: false },
  { id: 'status', label: 'Status', default: false },
  { id: 'roadmapStatus', label: 'Roadmap Status', default: true },
  { id: 'dueDate', label: 'Due Date', default: false },
  { id: 'fixVersions', label: 'Fix Versions', default: false },
  { id: 'components', label: 'Components', default: false },
  { id: 'issueType', label: 'Issue Type', default: false },
  { id: 'epicKey', label: 'Epic Key', default: false }
];

const SettingsModal = ({ onSave, onCancel, initialSettings, onRefreshStyleGuide, styleGuideStatus, styleGuideRefreshing, onMasterExport, masterExportLoading, onOpenExportForClaudeModal, onImportFromClaude, importFromClaudeLoading }) => {
  const perms = usePermissions();
  const [activeSection, setActiveSection] = useState('authentication');

  // Get field preferences from localStorage or use defaults
  const getDefaultFieldPreferences = () => {
    const saved = localStorage.getItem('jiraFieldPreferences');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        // Fall through to defaults
      }
    }
    // Return default preferences
    const defaults = {};
    AVAILABLE_FIELDS.forEach(field => {
      defaults[field.id] = field.default;
    });
    return defaults;
  };

  // Get templates from localStorage or use defaults
  const getDefaultTemplates = () => {
    return getTemplates();
  };

  const [settings, setSettings] = useState({
    baseUrl: initialSettings?.baseUrl || 'https://toasttab.atlassian.net/wiki',
    email: initialSettings?.email || '',
    apiToken: initialSettings?.apiToken || '',
    spaceKey: initialSettings?.spaceKey || 'RD',
    parentPageId: initialSettings?.parentPageId || '',
    inProgressPageId: initialSettings?.inProgressPageId || '',
    needsActionPageId: initialSettings?.needsActionPageId || '',
    publishedPageId: initialSettings?.publishedPageId || '',
    discardPageId: initialSettings?.discardPageId || '',
    launchnotesApiUrl: initialSettings?.launchnotesApiUrl || 'https://app.launchnotes.io',
    launchnotesApiKey: initialSettings?.launchnotesApiKey || '',
    launchnotesProjectId: initialSettings?.launchnotesProjectId || 'pro_EtBG4hh8w3LBq',
    launchnotesUseSandbox: initialSettings?.launchnotesUseSandbox || false,
    launchdarklyApiKey: initialSettings?.launchdarklyApiKey || '',
    aiProvider: initialSettings?.aiProvider || 'gemini',
    aiApiKey: initialSettings?.aiApiKey || ''
  });
  const [fieldPreferences, setFieldPreferences] = useState(getDefaultFieldPreferences());
  const [templates, setTemplates] = useState(getDefaultTemplates());
  const [auditCategories, setAuditCategories] = useState(getAuditCategoryPreferences());
  const [notificationRules, setNotificationRules] = useState(() => getNotificationRulesFromStorage());
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [appAuthEmail, setAppAuthEmail] = useState(null);

  useEffect(() => {
    if (!isSupabaseAuthConfigured() || !supabase) {
      setAppAuthEmail(null);
      return undefined;
    }
    let cancelled = false;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!cancelled) setAppAuthEmail(session?.user?.email ?? null);
    });
    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setAppAuthEmail(session?.user?.email ?? null);
    });
    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  const showSettingsAdminSection =
    isSupabaseAuthConfigured() && isSettingsSuperAdmin(appAuthEmail);

  const handleChange = (field, value) => {
    setSettings(prev => ({ ...prev, [field]: value }));
    setTestResult(null);
  };

  const testConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const response = await authenticatedFetch('/api/test-connection', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Atlassian-Email': settings.email,
          'X-Atlassian-Token': settings.apiToken,
          'X-Atlassian-Base-Url': settings.baseUrl
        },
        body: JSON.stringify({ spaceKey: settings.spaceKey })
      });
      
      const data = await response.json();
      if (data.success) {
        setTestResult({ success: true, message: 'Connection successful!' });
      } else {
        setTestResult({ success: false, message: data.error || 'Connection failed' });
      }
    } catch (err) {
      setTestResult({ success: false, message: err.message || 'Connection failed' });
    } finally {
      setTesting(false);
    }
  };

  const handleFieldToggle = (fieldId) => {
    setFieldPreferences(prev => ({
      ...prev,
      [fieldId]: !prev[fieldId]
    }));
  };

  // Template management functions
  const [newTemplate, setNewTemplate] = useState({ name: '', template: '' });
  
  const handleTemplateAdd = () => {
    if (!newTemplate.name.trim() || !newTemplate.template.trim()) return;
    const id = `custom-${Date.now()}`;
    setTemplates([...templates, { ...newTemplate, id }]);
    setNewTemplate({ name: '', template: '' });
  };

  const handleTemplateUpdate = (id, field, value) => {
    setTemplates(templates.map(t => 
      t.id === id ? { ...t, [field]: value } : t
    ));
  };

  const handleTemplateDelete = (id) => {
    // Don't allow deleting hardcoded templates
    const template = templates.find(t => t.id === id);
    if (template?.hardcoded) {
      return;
    }
    setTemplates(templates.filter(t => t.id !== id));
  };


  const handleSave = () => {
    if (!settings.email || !settings.apiToken) {
      setTestResult({ success: false, message: 'Email and API Token are required' });
      return;
    }
    // Save field preferences to localStorage
    localStorage.setItem('jiraFieldPreferences', JSON.stringify(fieldPreferences));
    
    // Save all templates to localStorage (including edited hardcoded ones)
    // We save all templates, but mark which ones are hardcoded
    // When loading, hardcoded templates will be merged with saved custom versions
    const templatesToSave = templates.map(t => {
      const { hardcoded, ...template } = t;
      return template;
    });
    localStorage.setItem('quickCommentTemplates', JSON.stringify(templatesToSave));
    
    // Save activity log category preferences
    setAuditCategoryPreferences(auditCategories);

    localStorage.setItem('notificationRules', JSON.stringify(notificationRules));
    
    // Trigger event to update QuickCommentMenu components
    window.dispatchEvent(new Event('settingsSaved'));
    
    onSave(settings);
  };

  const handleAuditCategoryToggle = (categoryId) => {
    setAuditCategories(prev => ({ ...prev, [categoryId]: !prev[categoryId] }));
  };

  const sections = useMemo(() => {
    const all = [
      { id: 'authentication', label: 'Authentication' },
      { id: 'configuration', label: 'Configuration' },
      { id: 'ai', label: 'AI Settings' },
      { id: 'styleGuide', label: 'Style Guide' },
      { id: 'launchnotes', label: 'LaunchNotes' },
      { id: 'jiraFields', label: 'Jira Fields' },
      { id: 'templates', label: 'Templates' },
      { id: 'export', label: 'Export' },
      { id: 'notifications', label: 'Scheduled notifications' },
      { id: 'activityLog', label: 'Activity Log' },
      { id: 'superAdmin', label: 'Admin' }
    ];
    return all.filter((s) => {
      if (s.id === 'ai' && !perms.ai) return false;
      if (s.id === 'styleGuide' && !perms.ai) return false;
      if (s.id === 'launchnotes' && !perms.launchnotes) return false;
      if (s.id === 'export' && !perms.export) return false;
      if (s.id === 'notifications' && !perms.notifications) return false;
      if (s.id === 'superAdmin' && !showSettingsAdminSection) return false;
      return true;
    });
  }, [perms.ai, perms.launchnotes, perms.export, perms.notifications, showSettingsAdminSection]);

  useEffect(() => {
    if (!sections.find((s) => s.id === activeSection)) {
      setActiveSection('authentication');
    }
  }, [sections, activeSection]);

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal modal-lg settings-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Settings</h2>
          <button className="close-btn" onClick={onCancel}>×</button>
        </div>
        <div className="modal-body settings-modal-body">
          <div className="settings-sidebar">
            <nav className="settings-nav">
              {sections.map(section => (
                <button
                  key={section.id}
                  className={`settings-nav-item ${activeSection === section.id ? 'active' : ''}`}
                  onClick={() => setActiveSection(section.id)}
                >
                  <span className="settings-nav-label">{section.label}</span>
                </button>
              ))}
            </nav>
          </div>
          <div className="settings-content">
            <>
            {activeSection === 'authentication' && (
              <div className="settings-section">
                <h3>Authentication</h3>
                <p className="settings-intro">
                  {isSupabaseAuthConfigured()
                    ? 'Enter your Atlassian credentials. They are saved in your browser and synced to your account (Postgres) when you click Save — only you can read them via login.'
                    : 'Enter your Atlassian credentials. These will be stored locally in your browser and never shared.'}
                </p>
                <div className="settings-field">
                  <label>Confluence Base URL</label>
                  <input
                    type="text"
                    value={settings.baseUrl}
                    onChange={(e) => handleChange('baseUrl', e.target.value)}
                    placeholder="https://toasttab.atlassian.net/wiki"
                  />
                </div>
                <div className="settings-field">
                  <label>Email Address</label>
                  <input
                    type="email"
                    value={settings.email}
                    onChange={(e) => handleChange('email', e.target.value)}
                    placeholder="your-email@toasttab.com"
                    required
                  />
                </div>
                <div className="settings-field">
                  <label>API Token</label>
                  <input
                    type="password"
                    value={settings.apiToken}
                    onChange={(e) => handleChange('apiToken', e.target.value)}
                    placeholder="Your Atlassian API token"
                    required
                  />
                  <small>
                    <a 
                      href="https://id.atlassian.com/manage-profile/security/api-tokens" 
                      target="_blank" 
                      rel="noopener noreferrer"
                    >
                      Get your API token here →
                    </a>
                  </small>
                </div>
              </div>
            )}

            {activeSection === 'configuration' && (
              <div className="settings-section">
                <h3>Configuration</h3>
                <div className="settings-field">
                  <label>Space Key</label>
                  <input
                    type="text"
                    value={settings.spaceKey}
                    onChange={(e) => handleChange('spaceKey', e.target.value)}
                    placeholder="RD"
                  />
                </div>
                <div className="settings-field">
                  <label>Draft Parent Page ID <span className="read-only-label">(read-only)</span></label>
                  <input
                    type="text"
                    value={settings.parentPageId}
                    onChange={(e) => handleChange('parentPageId', e.target.value)}
                    placeholder="5530845756"
                    disabled
                    readOnly
                    className="read-only-input"
                  />
                </div>
                <div className="settings-field">
                  <label>In Progress Page ID <span className="read-only-label">(read-only)</span></label>
                  <input
                    type="text"
                    value={settings.inProgressPageId}
                    onChange={(e) => handleChange('inProgressPageId', e.target.value)}
                    placeholder="5530550421"
                    disabled
                    readOnly
                    className="read-only-input"
                  />
                </div>
                <div className="settings-field">
                  <label>Needs Action Page ID <span className="read-only-label">(read-only)</span></label>
                  <input
                    type="text"
                    value={settings.needsActionPageId}
                    onChange={(e) => handleChange('needsActionPageId', e.target.value)}
                    placeholder="5529731171"
                    disabled
                    readOnly
                    className="read-only-input"
                  />
                </div>
                <div className="settings-field">
                  <label>Published Page ID <span className="read-only-label">(read-only)</span></label>
                  <input
                    type="text"
                    value={settings.publishedPageId}
                    onChange={(e) => handleChange('publishedPageId', e.target.value)}
                    placeholder="5529862458"
                    disabled
                    readOnly
                    className="read-only-input"
                  />
                </div>
                <div className="settings-field">
                  <label>Discard Page ID <span className="read-only-label">(read-only)</span></label>
                  <input
                    type="text"
                    value={settings.discardPageId}
                    onChange={(e) => handleChange('discardPageId', e.target.value)}
                    placeholder="5529600531"
                    disabled
                    readOnly
                    className="read-only-input"
                  />
                </div>
              </div>
            )}

            {activeSection === 'ai' && (
              <div className="settings-section">
                <h3>AI Settings</h3>
                <p className="settings-intro" style={{ marginBottom: '1rem' }}>
                  Configure AI provider and API key for generating release notes. The tool supports Google Gemini (default), Anthropic Claude, and OpenAI.
                </p>
                <div className="settings-field">
                  <label>AI Provider</label>
                  <select
                    value={settings.aiProvider}
                    onChange={(e) => handleChange('aiProvider', e.target.value)}
                  >
                    <option value="gemini">Google Gemini</option>
                    <option value="anthropic">Anthropic Claude</option>
                    <option value="openai">OpenAI</option>
                  </select>
                  <small>
                    Choose your preferred AI provider. Gemini is the default and recommended option.
                  </small>
                </div>
                <div className="settings-field">
                  <label>AI API Key <span style={{ color: '#ef4444' }}>*</span></label>
                  <input
                    type="password"
                    value={settings.aiApiKey}
                    onChange={(e) => handleChange('aiApiKey', e.target.value)}
                    placeholder="Your AI API key"
                  />
                  <small>
                    {settings.aiProvider === 'gemini' && (
                      <>Get your Gemini API key from <a href="https://makersuite.google.com/app/apikey" target="_blank" rel="noopener noreferrer">Google AI Studio</a>.</>
                    )}
                    {settings.aiProvider === 'anthropic' && (
                      <>Get your Anthropic API key from <a href="https://console.anthropic.com/" target="_blank" rel="noopener noreferrer">Anthropic Console</a>.</>
                    )}
                    {settings.aiProvider === 'openai' && (
                      <>Get your OpenAI API key from <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer">OpenAI Platform</a>.</>
                    )}
                  </small>
                </div>
              </div>
            )}

            {activeSection === 'styleGuide' && (
              <div className="settings-section">
                <h3>Style Guide</h3>
                <p className="settings-intro" style={{ marginBottom: '1rem' }}>
                  The style guide is automatically fetched from Confluence and used by AI tools and the compliance checker. Refresh to check for updates.
                </p>
                
                {styleGuideStatus && (
                  <div className="style-guide-status" style={{ marginBottom: '1rem', padding: '12px', background: 'var(--bg-tertiary)', borderRadius: '8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <div>
                        <strong>Status:</strong> {styleGuideStatus.styleGuide ? `Version ${styleGuideStatus.styleGuide.version || '?'}` : 'Not loaded'}
                      </div>
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => {
                          if (onRefreshStyleGuide) {
                            onRefreshStyleGuide();
                          }
                        }}
                        disabled={styleGuideRefreshing || !settings.email || !settings.apiToken}
                      >
                        {styleGuideRefreshing ? (
                          <>
                            <span className="spinner" style={{ width: '12px', height: '12px', marginRight: '6px' }}></span>
                            Refreshing...
                          </>
                        ) : (
                          'Refresh Style Guide'
                        )}
                      </button>
                    </div>
                    {styleGuideStatus.styleGuide && (
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                        <div>Last modified: {styleGuideStatus.styleGuide.lastModified ? new Date(styleGuideStatus.styleGuide.lastModified).toLocaleString() : 'Unknown'}</div>
                        <div>Cached: {styleGuideStatus.styleGuide.cachedAt ? new Date(styleGuideStatus.styleGuide.cachedAt).toLocaleString() : 'Never'}</div>
                        {styleGuideStatus.cacheInfo && (
                          <div>Cache age: {styleGuideStatus.cacheInfo.cacheAge !== null && styleGuideStatus.cacheInfo.cacheAge !== undefined ? `${styleGuideStatus.cacheInfo.cacheAge} minutes` : 'Unknown'}</div>
                        )}
                      </div>
                    )}
                  </div>
                )}
                
                <div className="style-guide-preview">
                  <h4>Preview</h4>
                  <div className="style-guide-preview-content">
                    {styleGuideStatus?.styleGuide?.content ? (
                      <pre style={{ 
                        whiteSpace: 'pre-wrap', 
                        wordWrap: 'break-word',
                        padding: '16px',
                        background: 'var(--bg-primary)',
                        border: '1px solid var(--border-light)',
                        borderRadius: '8px',
                        fontSize: '13px',
                        lineHeight: '1.6',
                        maxHeight: '400px',
                        overflowY: 'auto',
                        fontFamily: 'inherit'
                      }}>
                        {styleGuideStatus.styleGuide.content}
                      </pre>
                    ) : (
                      <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)' }}>
                        {settings.email && settings.apiToken ? (
                          'Click "Refresh Style Guide" to load preview'
                        ) : (
                          'Configure authentication to view style guide preview'
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {activeSection === 'launchnotes' && (
              <div className="settings-section">
                <h3>LaunchNotes Integration</h3>
                <p className="settings-intro" style={{ marginBottom: '1rem' }}>
                  Configure LaunchNotes API credentials to create release note drafts from Confluence pages.
                </p>
                <div className="settings-field">
                  <label>
                    <input
                      type="checkbox"
                      checked={settings.launchnotesUseSandbox}
                      onChange={(e) => handleChange('launchnotesUseSandbox', e.target.checked)}
                      style={{ marginRight: '8px' }}
                    />
                    Use Sandbox (hardcoded test credentials)
                  </label>
                  <small>
                    When enabled, uses hardcoded sandbox credentials for testing. Your configured credentials will be ignored.
                  </small>
                </div>
                <div className="settings-field">
                  <label>LaunchNotes API URL</label>
                  <input
                    type="text"
                    value={settings.launchnotesUseSandbox ? 'https://app.launchnotes.io' : settings.launchnotesApiUrl}
                    onChange={(e) => handleChange('launchnotesApiUrl', e.target.value)}
                    placeholder="https://app.launchnotes.io"
                    disabled={settings.launchnotesUseSandbox}
                  />
                  <small>
                    The GraphQL endpoint will be automatically appended. Default: https://app.launchnotes.io
                  </small>
                </div>
                <div className="settings-field">
                  <label>LaunchNotes API Client <span style={{ color: '#ef4444' }}>*</span></label>
                  <input
                    type="password"
                    value={settings.launchnotesUseSandbox ? 'manage_5Vpg4TSKelwDJ8mLLof5UKW2' : settings.launchnotesApiKey}
                    onChange={(e) => handleChange('launchnotesApiKey', e.target.value)}
                    placeholder="Your LaunchNotes API client token"
                    required
                    disabled={settings.launchnotesUseSandbox}
                  />
                  <small>
                    {settings.launchnotesUseSandbox ? (
                      'Sandbox credentials are hardcoded and will be used automatically.'
                    ) : (
                      'Get your API client token from Settings &gt; API, Embed &amp; RSS in the LaunchNotes management portal. Create a Management API token for read/write access.'
                    )}
                  </small>
                </div>
                <div className="settings-field">
                  <label>LaunchNotes Project ID <span style={{ color: '#ef4444' }}>*</span></label>
                  <input
                    type="text"
                    value={settings.launchnotesUseSandbox ? 'pro_c3ZUp1d2X9bpj' : settings.launchnotesProjectId}
                    onChange={(e) => handleChange('launchnotesProjectId', e.target.value)}
                    placeholder="pro_EtBG4hh8w3LBq"
                    disabled={settings.launchnotesUseSandbox}
                  />
                  <small>
                    {settings.launchnotesUseSandbox ? (
                      'Sandbox project ID is hardcoded and will be used automatically.'
                    ) : (
                      'Required. Format: pro_XXXXX. You can find your Project ID in your LaunchNotes project settings or URL.'
                    )}
                  </small>
                </div>
                <div className="settings-field">
                  <label>LaunchDarkly API Key</label>
                  <input
                    type="password"
                    value={settings.launchdarklyApiKey}
                    onChange={(e) => handleChange('launchdarklyApiKey', e.target.value)}
                    placeholder="api-XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX"
                  />
                  <small>
                    Optional. Required for Feature Flags dashboard view. Get your personal API key from LaunchDarkly Account Settings → Authorization.
                  </small>
                </div>
              </div>
            )}

            {activeSection === 'jiraFields' && (
              <div className="settings-section">
                <h3>Jira Field Preferences</h3>
                <p className="settings-intro" style={{ marginBottom: '1rem' }}>
                  Choose which Jira ticket fields to display when moving pages. Custom fields (like Feature Flags) will appear automatically if they exist on the ticket.
                </p>
                <div className="field-preferences-grid">
                  {AVAILABLE_FIELDS.map(field => (
                    <label key={field.id} className="field-preference-item">
                      <input
                        type="checkbox"
                        checked={fieldPreferences[field.id] || false}
                        onChange={() => handleFieldToggle(field.id)}
                      />
                      <span>{field.label}</span>
                    </label>
                ))}
              </div>
              </div>
            )}

            {activeSection === 'export' && (
              <div className="settings-section">
                <h3>Export</h3>
                <p className="settings-intro">
                  Export a master CSV of all release note pages across every status (Draft, In Progress, Needs Action, Published, Discarded). Use this for a single spreadsheet you can upload to Google Sheets. The per-status &quot;Export to CSV&quot; button on each board exports only that status.
                </p>
                <div className="settings-field">
                  <button
                    type="button"
                    className="btn btn-primary export-master-btn"
                    onClick={() => onMasterExport?.()}
                    disabled={masterExportLoading || !onMasterExport}
                  >
                    {masterExportLoading ? 'Exporting…' : 'Export all statuses to CSV (master)'}
                  </button>
                </div>
                <div className="export-claude-block">
                  <p className="settings-intro" style={{ marginBottom: '8px' }}>
                    <strong>Export to Cursor</strong> — Zip with style guide, manifest, and one .md per page. Opens a preferences modal to filter by status, assignee, fix version, LOB, and launch date; then export to zip.
                  </p>
                  <button
                    type="button"
                    className="btn btn-primary export-master-btn"
                    onClick={() => onOpenExportForClaudeModal?.()}
                    disabled={!onOpenExportForClaudeModal}
                  >
                    Export to Cursor (zip)
                  </button>
                </div>
                <div className="import-claude-block" style={{ marginTop: '1.25rem' }}>
                  <p className="settings-intro" style={{ marginBottom: '8px' }}>
                    <strong>Import from Claude output</strong> — Upload a zip of your edited folder (with a <strong>drafts</strong> folder). Drafts are listed so you can send them to LaunchNotes.
                  </p>
                  <label className="import-from-claude-label">
                    <span className="btn btn-secondary export-master-btn" style={{ display: 'inline-block', pointerEvents: importFromClaudeLoading ? 'none' : 'auto' }}>
                      {importFromClaudeLoading ? 'Importing…' : 'Choose zip to import drafts'}
                    </span>
                    <input
                      type="file"
                      accept=".zip"
                      style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) onImportFromClaude?.(file);
                        e.target.value = '';
                      }}
                      disabled={importFromClaudeLoading || !onImportFromClaude}
                    />
                  </label>
                </div>
              </div>
            )}

            {activeSection === 'notifications' && (
              <NotificationRulesSettings rules={notificationRules} setRules={setNotificationRules} />
            )}

            {activeSection === 'activityLog' && (
              <div className="settings-section">
                <h3>Activity Log</h3>
                <p className="settings-intro">
                  Choose which actions to record in the Activity Log. Use the Activity Log (header button) to view, filter by date, and copy or export your work for reporting.
                </p>
                <div className="activity-log-settings">
                  {ACTIVITY_CATEGORIES.map(c => (
                    <label key={c.id} className="activity-log-setting-check">
                      <input
                        type="checkbox"
                        checked={auditCategories[c.id] !== false}
                        onChange={() => handleAuditCategoryToggle(c.id)}
                      />
                      <span>{c.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {activeSection === 'superAdmin' && showSettingsAdminSection && (
              <div className="settings-section settings-section-admin">
                <h3>Admin</h3>
                <p className="settings-intro">
                  Shortcuts for operations that apply to the whole app (not your personal Confluence/Jira profile). The admin portal is where you invite users, grant or revoke feature permissions, and manage who has the admin role in Supabase.
                </p>
                <p className="settings-intro settings-admin-note">
                  This section is only shown for designated app-login accounts. Changing permissions still requires your user to be listed in <code>app_admins</code> and the server to have <code>SUPABASE_SERVICE_ROLE_KEY</code>.
                </p>
                <div className="settings-field settings-admin-actions">
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => {
                      onCancel?.();
                      window.location.hash = '#/admin';
                    }}
                  >
                    Open admin portal
                  </button>
                </div>
              </div>
            )}

            {activeSection === 'templates' && (
              <div className="settings-section">
                <h3>Quick Comment Templates</h3>
                <p className="settings-intro" style={{ marginBottom: '1rem' }}>
                  Manage your quick comment templates. Use variables: <code>{'{assignee}'}</code>, <code>{'{pageUrl}'}</code>, <code>{'{reporter}'}</code>, <code>{'{ticket}'}</code>
                </p>
                
                <div className="template-list">
                  {templates.map(template => {
                    const isHardcoded = template.hardcoded || DEFAULT_TEMPLATES.find(dt => dt.id === template.id);
                    return (
                      <div key={template.id} className={`template-item ${isHardcoded ? 'template-item-hardcoded' : ''}`}>
                        <div className="template-header">
                          <input
                            type="text"
                            className="template-name-input"
                            value={template.name}
                            onChange={(e) => handleTemplateUpdate(template.id, 'name', e.target.value)}
                            placeholder="Template name"
                            disabled={isHardcoded}
                          />
                          {isHardcoded && (
                            <span className="template-badge" title="This is a default template">Default</span>
                          )}
                          {!isHardcoded && (
                            <button
                              className="btn btn-danger btn-sm"
                              onClick={() => handleTemplateDelete(template.id)}
                              title="Delete template"
                            >
                              Delete
                            </button>
                          )}
                        </div>
                        <textarea
                          className="template-content-input"
                          value={template.template}
                          onChange={(e) => handleTemplateUpdate(template.id, 'template', e.target.value)}
                          placeholder="Template content (use {assignee}, {pageUrl}, etc.)"
                          rows={3}
                          disabled={isHardcoded}
                        />
                        {isHardcoded && (
                          <small className="template-hardcoded-note">
                            This is a default template and cannot be deleted, but you can edit it for your session.
                          </small>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="template-add">
                  <h4>Add New Template</h4>
                  <input
                    type="text"
                    className="template-name-input"
                    value={newTemplate.name}
                    onChange={(e) => setNewTemplate({ ...newTemplate, name: e.target.value })}
                    placeholder="Template name"
                  />
                  <textarea
                    className="template-content-input"
                    value={newTemplate.template}
                    onChange={(e) => setNewTemplate({ ...newTemplate, template: e.target.value })}
                    placeholder="Template content (use {assignee}, {pageUrl}, etc.)"
                    rows={3}
                  />
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={handleTemplateAdd}
                    disabled={!newTemplate.name.trim() || !newTemplate.template.trim()}
                  >
                    Add Template
                  </button>
                </div>
              </div>
            )}

              {testResult && (
                <div className={`test-result ${testResult.success ? 'success' : 'error'}`}>
                  {testResult.success ? '✓' : '✕'} {testResult.message}
                </div>
              )}

              <div className="modal-actions">
              <button 
                className="btn btn-secondary" 
                onClick={testConnection}
                disabled={testing || !settings.email || !settings.apiToken}
              >
                {testing ? 'Testing...' : 'Test Connection'}
              </button>
              <div style={{ flex: 1 }} />
              <button className="btn btn-secondary" onClick={onCancel}>
                Cancel
              </button>
              <button 
                className="btn btn-primary" 
                onClick={handleSave}
                disabled={!settings.email || !settings.apiToken}
              >
                Save Settings
              </button>
              </div>
            </>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
