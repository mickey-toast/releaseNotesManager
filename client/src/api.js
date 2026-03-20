// API utility functions with credential management

import { supabase } from './supabaseClient';

export async function getAppAuthHeaders() {
  if (!supabase) return {};
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return {};
  return { Authorization: `Bearer ${session.access_token}` };
}

export const getCredentials = () => {
  const settings = localStorage.getItem('confluenceSettings');
  if (!settings) return null;
  try {
    return JSON.parse(settings);
  } catch {
    return null;
  }
};

export const getAuthHeaders = () => {
  const creds = getCredentials();
  if (!creds) return {};
  
  const headers = {
    'X-Atlassian-Email': creds.email,
    'X-Atlassian-Token': creds.apiToken,
    'X-Atlassian-Base-Url': creds.baseUrl || 'https://toasttab.atlassian.net/wiki'
  };
  
  // Add page IDs if available
  if (creds.spaceKey) headers['X-Space-Key'] = creds.spaceKey;
  if (creds.parentPageId) headers['X-Draft-Page-Id'] = creds.parentPageId;
  if (creds.inProgressPageId) headers['X-In-Progress-Page-Id'] = creds.inProgressPageId;
  if (creds.needsActionPageId) headers['X-Needs-Action-Page-Id'] = creds.needsActionPageId;
  if (creds.publishedPageId) headers['X-Published-Page-Id'] = creds.publishedPageId;
  if (creds.discardPageId) headers['X-Discard-Page-Id'] = creds.discardPageId;
  
  return headers;
};

// Debug logging for API calls
const debugLogs = [];
const MAX_LOGS = 100;

export const getDebugLogs = () => [...debugLogs].reverse(); // Reverse for chronological display
export const clearDebugLogs = () => {
  debugLogs.length = 0;
  // Trigger update if listener is set
  if (window.debugLogUpdateCallback) {
    window.debugLogUpdateCallback();
  }
};

export const authenticatedFetch = async (url, options = {}) => {
  const headers = {
    'Content-Type': 'application/json',
    ...getAuthHeaders(),
    ...(await getAppAuthHeaders()),
    ...options.headers
  };
  
  const requestId = Date.now() + Math.random();
  const startTime = Date.now();
  
  // Sanitize headers for logging (redact sensitive information)
  const sanitizedHeaders = { ...headers };
  if (sanitizedHeaders['X-Atlassian-Token']) {
    sanitizedHeaders['X-Atlassian-Token'] = '***REDACTED***';
  }
  if (sanitizedHeaders['X-AI-Api-Key']) {
    sanitizedHeaders['X-AI-Api-Key'] = '***REDACTED***';
  }
  if (sanitizedHeaders['X-Atlassian-Email']) {
    // Optionally redact email too, or just show domain
    const email = sanitizedHeaders['X-Atlassian-Email'];
    sanitizedHeaders['X-Atlassian-Email'] = email.includes('@') 
      ? `***@${email.split('@')[1]}` 
      : '***REDACTED***';
  }
  if (sanitizedHeaders.Authorization) {
    sanitizedHeaders.Authorization = 'Bearer ***REDACTED***';
  }
  
  // Log request
  const logEntry = {
    id: requestId,
    timestamp: new Date().toISOString(),
    method: options.method || 'GET',
    url,
    request: {
      headers: sanitizedHeaders,
      body: options.body ? (typeof options.body === 'string' ? JSON.parse(options.body) : options.body) : null
    },
    response: null,
    error: null,
    duration: null,
    status: null
  };
  
  debugLogs.push(logEntry);
  if (debugLogs.length > MAX_LOGS) {
    debugLogs.shift(); // Remove oldest
  }
  
  // Trigger update if listener is set
  if (window.debugLogUpdateCallback) {
    window.debugLogUpdateCallback();
  }
  
  try {
    const response = await fetch(url, {
      ...options,
      headers
    });
    
    const endTime = Date.now();
    logEntry.duration = endTime - startTime;
    logEntry.status = response.status;
    
    // Clone response for logging (can only clone once)
    const responseClone = response.clone();
    const contentType = response.headers.get('content-type');
    let responseData = null;
    
    // Read the cloned response for logging
    try {
      const text = await responseClone.text();
      if (contentType && contentType.includes('application/json')) {
        responseData = text ? JSON.parse(text) : null;
      } else {
        responseData = text;
      }
    } catch (e) {
      responseData = `Error reading response: ${e.message}`;
    }
    
    logEntry.response = {
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
      body: responseData
    };
    
    // Trigger update
    if (window.debugLogUpdateCallback) {
      window.debugLogUpdateCallback();
    }
    
    return response;
  } catch (error) {
    const endTime = Date.now();
    logEntry.duration = endTime - startTime;
    logEntry.error = {
      message: error.message,
      stack: error.stack,
      name: error.name
    };
    
    // Trigger update
    if (window.debugLogUpdateCallback) {
      window.debugLogUpdateCallback();
    }
    
    throw error;
  }
};

export const hasCredentials = () => getCredentials() !== null;

// Get Jira field preferences
export const getFieldPreferences = () => {
  const saved = localStorage.getItem('jiraFieldPreferences');
  if (saved) {
    try {
      return JSON.parse(saved);
    } catch {
      // Fall through to defaults
    }
  }
  // Return default preferences
  return {
    assignee: true,
    reporter: true,
    labels: true,
    priority: false,
    status: false,
    roadmapStatus: true,
    dueDate: false,
    fixVersions: false,
    components: false,
    issueType: false,
    epicKey: false
  };
};

// Check if a field should be displayed
export const shouldShowField = (fieldId) => {
  const preferences = getFieldPreferences();
  return preferences[fieldId] === true;
};
