const path = require('path');
require('dotenv').config();
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const compression = require('compression');
const cors = require('cors');
const axios = require('axios');
const fs = require('fs');
const archiver = require('archiver');
const AdmZip = require('adm-zip');
const multer = require('multer');
const { marked } = require('marked');
const { requireSupabaseAuth } = require('./authMiddleware');

marked.use({ gfm: true, breaks: false });
const userProfileRoutes = require('./userProfileRoutes');
const auditLogRoutes = require('./auditLogRoutes');
const meRoutes = require('./meRoutes');
const adminRoutes = require('./adminRoutes');
const { requirePermission } = require('./permissionMiddleware');
const {
  launchRawFromPage,
  pageMatchesLaunchDayRange,
  computeSendInstantMillis,
  buildDedupeKey,
  interpolateTemplate,
  buildTemplateVars,
  normalizeRulesList,
  trimDeliveryLog
} = require('./notificationRulesEngine');
const { confluenceStorageHtmlToJiraAdf } = require('./confluenceHtmlToJiraAdf');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(compression({ threshold: 1024 }));
app.use(express.json({ limit: '2mb' }));
app.use('/api', requireSupabaseAuth);
app.use('/api', userProfileRoutes);
app.use('/api', auditLogRoutes);
app.use('/api', meRoutes);
app.use('/api', adminRoutes);

// Page statuses configuration
const PAGE_STATUSES = {
  draft: {
    id: 'draft',
    name: 'Draft',
    pageId: process.env.CONFLUENCE_PARENT_PAGE_ID || '5530845756',
    icon: '',
    color: '#6366f1',
    staleThreshold: 30 // days before considered stale
  },
  inProgress: {
    id: 'inProgress',
    name: 'In Progress',
    pageId: process.env.CONFLUENCE_IN_PROGRESS_PAGE_ID || '5530550421',
    icon: '',
    color: '#3b82f6',
    staleThreshold: 14
  },
  needsAction: {
    id: 'needsAction',
    name: 'Needs Action',
    pageId: process.env.CONFLUENCE_NEEDS_ACTION_PAGE_ID || '5529731171',
    icon: '',
    color: '#f59e0b',
    staleThreshold: 7
  },
  published: {
    id: 'published',
    name: 'Published',
    pageId: process.env.CONFLUENCE_PUBLISHED_PAGE_ID || '5529862458',
    icon: '',
    color: '#10b981',
    staleThreshold: null // no stale threshold for published
  },
  discard: {
    id: 'discard',
    name: 'Discarded',
    pageId: process.env.CONFLUENCE_DISCARD_PAGE_ID || '5529600531',
    icon: '',
    color: '#64748b',
    staleThreshold: null
  }
};

/**
 * Jira fields to show as metadata pills on each page row (next to "by Author").
 * Order here = display order: Author | Fix Version | Line of business.
 * - standardKey: Jira API field key (e.g. fixVersions); valueKey = property on each item (e.g. name).
 * - fieldNameMatch: match Jira field display name (case-insensitive); use for custom or standard fields by name.
 * - customFieldId: optional env JIRA_FIX_VERSION_FIELD_ID for JPD/custom Fix Version (e.g. customfield_10123).
 */
const JIRA_FIX_VERSION_CUSTOM_FIELD_ID = process.env.JIRA_FIX_VERSION_FIELD_ID || null;

const JIRA_METADATA_PILL_FIELDS = [
  { id: 'fixVersion', label: 'Fix Version', standardKey: 'fixVersions', valueKey: 'name', fieldNameMatch: ['fix version', 'fix versions', 'target version', 'release version', 'release'] },
  { id: 'lineOfBusiness', label: 'Line of business', fieldNameMatch: ['line of business', 'product line', 'productline', 'product area'] }
];

function extractValueFromVersionLike(raw, valueKey = 'name') {
  if (raw == null) return [];
  if (Array.isArray(raw)) {
    return raw.map(v =>
      typeof v === 'object' && v !== null ? (v[valueKey] || v.value || v.name || v.id || String(v)) : String(v)
    ).filter(Boolean).map(String);
  }
  if (typeof raw === 'object') {
    const v = raw[valueKey] || raw.value || raw.name || raw.id;
    return v != null ? [String(v)] : [];
  }
  return [String(raw)];
}

function extractJiraMetadataPills(fields, fieldNames, globalFieldNames = null) {
  if (!fields) return [];
  const pills = [];
  const fieldNamesMap = { ...(globalFieldNames || {}), ...(fieldNames || {}) };
  for (const config of JIRA_METADATA_PILL_FIELDS) {
    let values = [];
    if (config.id === 'fixVersion' && JIRA_FIX_VERSION_CUSTOM_FIELD_ID && fields[JIRA_FIX_VERSION_CUSTOM_FIELD_ID] != null) {
      values = extractValueFromVersionLike(fields[JIRA_FIX_VERSION_CUSTOM_FIELD_ID], config.valueKey || 'name');
    }
    if (values.length === 0 && config.standardKey && fields[config.standardKey]) {
      const raw = fields[config.standardKey];
      values = extractValueFromVersionLike(raw, config.valueKey || 'name');
    }
    // If no values yet, try matching by field display name (e.g. custom "Fix Version" in JPD)
    if (values.length === 0 && config.fieldNameMatch && config.fieldNameMatch.length) {
      const matchTerms = config.fieldNameMatch.map(m => m.toLowerCase().trim());
      for (const [fieldKey, fieldValue] of Object.entries(fields)) {
        if (fieldValue == null) continue;
        // Skip the standard key we already tried (e.g. fixVersions) so we don't match its empty value and miss a custom field
        if (config.standardKey && fieldKey === config.standardKey) continue;
        const displayName = (fieldNamesMap[fieldKey] || fieldKey).toLowerCase().trim();
        const matched = matchTerms.some(term => displayName === term || displayName.includes(term));
        if (!matched) continue;
        values = extractValueFromVersionLike(fieldValue, config.valueKey || 'name');
        break;
      }
    }
    if (values.length) pills.push({ label: config.label, values });
  }
  return pills;
}

// Jira custom field IDs for Launch Dates and Education Project Status (from Jira REST API names)
// Override via env: JIRA_TARGETED_LAUNCH_DATE_FIELD_ID, JIRA_ACTUAL_LAUNCH_DATE_FIELD_ID, JIRA_EDUCATION_PROJECT_STATUS_FIELD_ID
const JIRA_TARGETED_LAUNCH_DATE_FIELD_ID = process.env.JIRA_TARGETED_LAUNCH_DATE_FIELD_ID || 'customfield_15045';
const JIRA_ACTUAL_LAUNCH_DATE_FIELD_ID = process.env.JIRA_ACTUAL_LAUNCH_DATE_FIELD_ID || 'customfield_15012';
const JIRA_EDUCATION_PROJECT_STATUS_FIELD_ID = process.env.JIRA_EDUCATION_PROJECT_STATUS_FIELD_ID || 'customfield_18597';

// Fallback: display names for matching if field IDs are not present in response
const JIRA_TARGETED_LAUNCH_DATE_MATCH = ['targeted launch date'];
const JIRA_ACTUAL_LAUNCH_DATE_MATCH = ['actual launch date'];
const JIRA_EDUCATION_PROJECT_STATUS_MATCH = ['education project status'];

function formatJiraDateForDisplay(value) {
  if (value == null) return null;
  let str = null;
  if (typeof value === 'string') {
    str = value.trim();
  } else if (typeof value === 'object') {
    str = (value.value != null ? String(value.value) : null) ||
          (value.name != null ? String(value.name) : null) ||
          (value.startDate != null ? String(value.startDate) : null) ||
          (value.start != null ? String(value.start) : null) ||
          (typeof value === 'object' && value !== null && !Array.isArray(value)
            ? Object.values(value).find(v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v))
            : null);
  }
  if (!str || !str.trim()) return null;
  const d = new Date(str.trim());
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Extract raw date string (ISO or YYYY-MM-DD) from Jira date field for sorting. Returns null if none. */
function parseJiraLaunchDateFieldRaw(raw) {
  if (raw == null) return null;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed);
        return parsed.start || parsed.end || parsed.startDate || parsed.endDate || null;
      } catch (e) {
        return /^\d{4}-\d{2}-\d{2}/.test(trimmed) ? trimmed : null;
      }
    }
    return /^\d{4}-\d{2}-\d{2}/.test(trimmed) ? trimmed : null;
  }
  if (typeof raw === 'object') {
    const dateStr = raw.start || raw.end || raw.startDate || raw.value || raw.name;
    return dateStr && /^\d{4}-\d{2}-\d{2}/.test(String(dateStr)) ? String(dateStr) : null;
  }
  return null;
}

/** Parse Jira date range field: value can be JSON string e.g. {"start":"2026-03-05","end":"2026-03-05"} or a simple date string. Returns formatted display string. */
function parseJiraLaunchDateField(raw) {
  const rawStr = parseJiraLaunchDateFieldRaw(raw);
  return rawStr ? formatJiraDateForDisplay(rawStr) : null;
}

function extractJiraFieldValueByDisplayName(fields, fieldNames, globalFieldNames, matchTerms, options = {}) {
  if (!fields || !matchTerms || !matchTerms.length) return null;
  const fieldNamesMap = { ...(globalFieldNames || {}), ...(fieldNames || {}) };
  const terms = matchTerms.map(t => t.toLowerCase().trim());
  for (const [fieldKey, fieldValue] of Object.entries(fields)) {
    if (fieldValue == null) continue;
    const displayName = (fieldNamesMap[fieldKey] || fieldKey).toLowerCase().trim();
    const matched = terms.some(term => displayName === term || displayName.includes(term));
    if (!matched) continue;
    if (options.isDate) {
      const formatted = options.useLaunchDateParser ? parseJiraLaunchDateField(fieldValue) : formatJiraDateForDisplay(fieldValue);
      return formatted || null;
    }
    if (typeof fieldValue === 'string') return fieldValue.trim() || null;
    if (typeof fieldValue === 'object') {
      const v = fieldValue.value ?? fieldValue.name ?? fieldValue.id;
      return v != null ? String(v).trim() : null;
    }
    return String(fieldValue).trim() || null;
  }
  return null;
}

function extractLaunchDatesAndEducationStatus(fields, fieldNames, globalFieldNames) {
  let targeted = null;
  let actual = null;
  let targetedRaw = null;
  let actualRaw = null;
  let educationStatus = null;

  if (fields) {
    if (fields[JIRA_TARGETED_LAUNCH_DATE_FIELD_ID] != null) {
      targetedRaw = parseJiraLaunchDateFieldRaw(fields[JIRA_TARGETED_LAUNCH_DATE_FIELD_ID]);
      targeted = targetedRaw ? formatJiraDateForDisplay(targetedRaw) : null;
    }
    if (fields[JIRA_ACTUAL_LAUNCH_DATE_FIELD_ID] != null) {
      actualRaw = parseJiraLaunchDateFieldRaw(fields[JIRA_ACTUAL_LAUNCH_DATE_FIELD_ID]);
      actual = actualRaw ? formatJiraDateForDisplay(actualRaw) : null;
    }
    if (fields[JIRA_EDUCATION_PROJECT_STATUS_FIELD_ID] != null) {
      const raw = fields[JIRA_EDUCATION_PROJECT_STATUS_FIELD_ID];
      if (typeof raw === 'object' && raw !== null && 'value' in raw) {
        educationStatus = raw.value ? String(raw.value).trim() : null;
      } else if (typeof raw === 'string') {
        educationStatus = raw.trim() || null;
      }
    }
  }

  if (targeted == null) {
    targeted = extractJiraFieldValueByDisplayName(
      fields, fieldNames, globalFieldNames, JIRA_TARGETED_LAUNCH_DATE_MATCH, { isDate: true, useLaunchDateParser: true }
    );
    if (targeted && !targetedRaw) targetedRaw = null; // no raw from fallback
  }
  if (actual == null) {
    actual = extractJiraFieldValueByDisplayName(
      fields, fieldNames, globalFieldNames, JIRA_ACTUAL_LAUNCH_DATE_MATCH, { isDate: true, useLaunchDateParser: true }
    );
    if (actual && !actualRaw) actualRaw = null;
  }
  if (educationStatus == null) {
    educationStatus = extractJiraFieldValueByDisplayName(
      fields, fieldNames, globalFieldNames, JIRA_EDUCATION_PROJECT_STATUS_MATCH, { isDate: false }
    );
  }

  const parts = [targeted, actual].filter(Boolean);
  const launchDates = parts.length ? parts.join(' | ') : null;
  return {
    targetedLaunchDate: targeted,
    actualLaunchDate: actual,
    targetedLaunchDateRaw: targetedRaw,
    actualLaunchDateRaw: actualRaw,
    educationProjectStatus: educationStatus,
    launchDates
  };
}

// Helper function to get credentials from request (headers or .env fallback)
function getCredentialsFromRequest(req) {
  const email = req.headers['x-atlassian-email'] || process.env.CONFLUENCE_EMAIL;
  const token = req.headers['x-atlassian-token'] || process.env.CONFLUENCE_API_TOKEN;
  const baseUrl = req.headers['x-atlassian-base-url'] || process.env.CONFLUENCE_BASE_URL || 'https://toasttab.atlassian.net/wiki';
  
  if (!email || !token) {
    throw new Error('Missing Atlassian credentials. Please configure settings.');
  }
  
  return { email, token, baseUrl };
}

// Helper function to create API clients from credentials
function createApiClients(credentials) {
  const confluenceApi = axios.create({
    baseURL: credentials.baseUrl,
    auth: {
      username: credentials.email,
      password: credentials.token
    },
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    }
  });

  // Extract Jira base URL from Confluence base URL
  const jiraBaseUrl = credentials.baseUrl.replace('/wiki', '');
  
  const jiraApi = axios.create({
    baseURL: jiraBaseUrl,
    auth: {
      username: credentials.email,
      password: credentials.token
    },
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    }
  });

  return { confluenceApi, jiraApi };
}

// Cache for Jira field id -> name (so we can match "Fix Version" etc. when issue response doesn't include names)
const jiraFieldNamesCache = new Map();
const JIRA_FIELD_NAMES_TTL_MS = 5 * 60 * 1000;

async function getJiraFieldNames(jiraApi) {
  const cacheKey = jiraApi.defaults?.baseURL || 'jira';
  const cached = jiraFieldNamesCache.get(cacheKey);
  if (cached && Date.now() - cached.at < JIRA_FIELD_NAMES_TTL_MS) return cached.map;
  try {
    const res = await jiraApi.get('/rest/api/3/field');
    const list = res.data || [];
    const map = {};
    list.forEach(f => { if (f.id && f.name) map[f.id] = f.name; });
    jiraFieldNamesCache.set(cacheKey, { map, at: Date.now() });
    return map;
  } catch (e) {
    if (cached) return cached.map;
    return {};
  }
}

// Legacy API clients for backward compatibility (using .env)
const confluenceApi = axios.create({
  baseURL: process.env.CONFLUENCE_BASE_URL || 'https://toasttab.atlassian.net/wiki',
  auth: {
    username: process.env.CONFLUENCE_EMAIL || '',
    password: process.env.CONFLUENCE_API_TOKEN || ''
  },
  headers: {
    'Accept': 'application/json',
    'Content-Type': 'application/json'
  }
});

const jiraApi = axios.create({
  baseURL: 'https://toasttab.atlassian.net',
  auth: {
    username: process.env.CONFLUENCE_EMAIL || '',
    password: process.env.CONFLUENCE_API_TOKEN || ''
  },
  headers: {
    'Accept': 'application/json',
    'Content-Type': 'application/json'
  }
});

// Helper function to extract Jira ticket from Confluence page content
function extractJiraTicket(htmlContent) {
  if (!htmlContent) return null;
  
  // List of ticket prefixes to exclude (e.g., RF tickets should not be used)
  const excludedPrefixes = ['RF'];
  
  // Helper to check if a ticket should be excluded
  const isExcluded = (ticketId) => {
    const prefix = (ticketId || '').split('-')[0];
    return excludedPrefixes.includes(prefix);
  };
  
  // Pattern 1a: "Reference Ticket" then (within ~600 chars) href with /browse/KEY – allows tags/newlines between
  const referenceLinkLoose = /Reference\s*Ticket[\s\S]{0,600}?href="[^"]*\/browse\/([A-Z0-9]+-\d+)[^"]*"/i;
  const refLinkLoose = htmlContent.match(referenceLinkLoose);
  if (refLinkLoose && !isExcluded(refLinkLoose[1])) {
    return refLinkLoose[1];
  }
  
  // Pattern 1b: "Reference Ticket" then (within ~600 chars) plain ticket ID – allows tags/newlines, alphanumeric key (e.g. FN1-699)
  const referenceTextLoose = /Reference\s*Ticket[\s\S]{0,600}?([A-Z0-9]{2,}-\d+)/i;
  const refTextLoose = htmlContent.match(referenceTextLoose);
  if (refTextLoose && !isExcluded(refTextLoose[1])) {
    return refTextLoose[1];
  }
  
  // Pattern 2: Link with ticket ID in href near "Reference Ticket" (original strict)
  const referenceSectionPattern = /Reference\s*Ticket[^<]*?(?:<[^>]*>)*[^<]*?href="[^"]*\/browse\/([A-Z0-9]+-\d+)[^"]*"/i;
  const referenceLinkMatch = htmlContent.match(referenceSectionPattern);
  if (referenceLinkMatch && !isExcluded(referenceLinkMatch[1])) {
    return referenceLinkMatch[1];
  }
  
  // Pattern 3: Plain text ticket ID near "Reference Ticket" (original strict)
  const textPattern = /Reference\s*Ticket[^<]*?([A-Z0-9]+-\d+)/i;
  const textMatch = htmlContent.match(textPattern);
  if (textMatch && !isExcluded(textMatch[1])) {
    return textMatch[1];
  }
  
  // Pattern 4: Link with ticket ID in href anywhere (but exclude RF tickets)
  const linkPattern = /href="[^"]*\/browse\/([A-Z0-9]+-\d+)[^"]*"/gi;
  const linkMatches = [];
  let linkMatch;
  while ((linkMatch = linkPattern.exec(htmlContent)) !== null) {
    if (!isExcluded(linkMatch[1])) {
      linkMatches.push(linkMatch[1]);
    }
  }
  if (linkMatches.length > 0) {
    return linkMatches[0];
  }
  
  // Pattern 5: Any Jira-style ticket ID in the content (but exclude RF tickets)
  // Allow alphanumeric prefix (e.g. FN1-699, CNSMR-310)
  const anyTicketPattern = /\b([A-Z0-9]{2,}-\d+)\b/gi;
  const allMatches = [];
  let anyMatch;
  while ((anyMatch = anyTicketPattern.exec(htmlContent)) !== null) {
    if (!isExcluded(anyMatch[1])) {
      allMatches.push(anyMatch[1]);
    }
  }
  if (allMatches.length > 0) {
    return allMatches[0];
  }
  
  return null;
}

// Helper function to extract Reference Ticket Assignee from content
function extractReferenceAssignee(htmlContent) {
  if (!htmlContent) return null;
  
  // Strict: "Reference Ticket Assignee:" on same line / same block
  const strict = /Reference\s*Ticket\s*Assignee[:\s]*([^<\n]+)/i;
  let match = htmlContent.match(strict);
  if (match) return match[1].trim();
  
  // Loose: "Reference Ticket Assignee" then within ~200 chars capture non-tag text (allows HTML between)
  const loose = /Reference\s*Ticket\s*Assignee[\s\S]{0,200}?>([^<]+)</i;
  match = htmlContent.match(loose);
  if (match) return match[1].trim();
  
  return null;
}

// Extract Jira ticket from page title (e.g. "FN1-699: Instant Deposit..." or "CNSMR-310: Post Checkout...")
function extractJiraTicketFromTitle(title) {
  if (!title || typeof title !== 'string') return null;
  const excludedPrefixes = ['RF'];
  const isExcluded = (ticketId) => {
    const prefix = (ticketId || '').split('-')[0];
    return excludedPrefixes.includes(prefix);
  };
  // Jira keys: PROJECT-123 or FN1-699 (allow letters and digits in prefix)
  const jiraKeyPattern = /\b([A-Z0-9]{2,}-\d+)\b/i;
  // Title often starts with "KEY-123: " or "KEY-123 - "
  const leading = title.match(/^([A-Z0-9]{2,}-\d+)\s*[:\-–—]/i);
  if (leading && !isExcluded(leading[1])) return leading[1];
  // Or first Jira-style key anywhere in title
  const anyInTitle = title.match(jiraKeyPattern);
  if (anyInTitle && !isExcluded(anyInTitle[1])) return anyInTitle[1];
  return null;
}

// Helper function to calculate days ago
function daysAgo(dateString) {
  if (!dateString) return null;
  const date = new Date(dateString);
  const now = new Date();
  const diffTime = Math.abs(now - date);
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
}

// Test connection endpoint
app.post('/api/test-connection', async (req, res) => {
  try {
    const credentials = getCredentialsFromRequest(req);
    const { confluenceApi } = createApiClients(credentials);
    const spaceKey = req.body.spaceKey || process.env.CONFLUENCE_SPACE_KEY;
    
    // Try to access Confluence space
    await confluenceApi.get(`/rest/api/space/${spaceKey}`);
    
    res.json({ success: true, message: 'Connection successful' });
  } catch (error) {
    res.status(401).json({
      success: false,
      error: error.response?.data?.message || error.message || 'Connection failed'
    });
  }
});

// Get configuration including all statuses
app.get('/api/config', (req, res) => {
  try {
    const credentials = getCredentialsFromRequest(req);
    
    // Use page IDs from request headers (user settings) or fallback to .env
    const statuses = {
      draft: {
        ...PAGE_STATUSES.draft,
        pageId: req.headers['x-draft-page-id'] || PAGE_STATUSES.draft.pageId
      },
      inProgress: {
        ...PAGE_STATUSES.inProgress,
        pageId: req.headers['x-in-progress-page-id'] || PAGE_STATUSES.inProgress.pageId
      },
      needsAction: {
        ...PAGE_STATUSES.needsAction,
        pageId: req.headers['x-needs-action-page-id'] || PAGE_STATUSES.needsAction.pageId
      },
      published: {
        ...PAGE_STATUSES.published,
        pageId: req.headers['x-published-page-id'] || PAGE_STATUSES.published.pageId
      },
      discard: {
        ...PAGE_STATUSES.discard,
        pageId: req.headers['x-discard-page-id'] || PAGE_STATUSES.discard.pageId
      }
    };
    
    res.json({
      statuses,
      spaceKey: req.headers['x-space-key'] || process.env.CONFLUENCE_SPACE_KEY,
      baseUrl: credentials.baseUrl
    });
  } catch (error) {
    res.status(401).json({
      error: error.message,
      requiresAuth: true
    });
  }
});

/**
 * Load lightweight page lists for every status (Confluence: expand version,history only).
 * Used for dashboard stats and optional full JSON for /api/pages/all.
 */
async function computeDashboardAllPagesAndStats(req) {
  const credentials = getCredentialsFromRequest(req);
  const { confluenceApi } = createApiClients(credentials);

  const allPages = {};
  const stats = {
    total: 0,
    byStatus: {},
    staleByStatus: {},
    avgDaysInDraft: 0
  };

  const PAGE_LIMIT = 100;

  for (const [statusKey, status] of Object.entries(PAGE_STATUSES)) {
    try {
      const allResults = [];
      let start = 0;
      let hasMore = true;

      while (hasMore) {
        const response = await confluenceApi.get(`/rest/api/content/${status.pageId}/child/page`, {
          params: {
            expand: 'version,history',
            limit: PAGE_LIMIT,
            start
          }
        });

        const results = response.data.results || [];
        allResults.push(...results);
        hasMore = results.length === PAGE_LIMIT;
        start += results.length;
      }

      const pages = allResults.map(page => ({
        id: page.id,
        title: page.title,
        status: statusKey,
        createdDaysAgo: daysAgo(page.history?.createdDate),
        lastModifiedDaysAgo: daysAgo(page.version?.when),
        author: page.history?.createdBy?.displayName
      }));

      allPages[statusKey] = pages;
      stats.byStatus[statusKey] = pages.length;
      stats.total += pages.length;

      if (status.staleThreshold) {
        stats.staleByStatus[statusKey] = pages.filter(
          p => p.lastModifiedDaysAgo >= status.staleThreshold
        ).length;
      }
    } catch (e) {
      const errorMsg = e.message || e.response?.statusText || String(e);
      const isAuthError = e.response?.status === 401 ||
        errorMsg.includes('401') ||
        errorMsg.includes('Missing Atlassian credentials') ||
        errorMsg.includes('Unauthorized');
      if (!isAuthError) {
        console.log(`Could not fetch pages for status ${statusKey}:`, errorMsg);
      }
      allPages[statusKey] = [];
      stats.byStatus[statusKey] = 0;
    }
  }

  if (allPages.draft && allPages.draft.length > 0) {
    const totalDays = allPages.draft.reduce((sum, p) => sum + (p.createdDaysAgo || 0), 0);
    stats.avgDaysInDraft = Math.round(totalDays / allPages.draft.length);
  }

  return { allPages, stats };
}

// Small JSON for header stats — same Confluence work as /all, less bandwidth than full page trees
app.get('/api/pages/stats', async (req, res) => {
  try {
    const { stats } = await computeDashboardAllPagesAndStats(req);
    res.json({ stats });
  } catch (error) {
    console.error('Error fetching page stats:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// Get all pages across all statuses (for dashboard)
app.get('/api/pages/all', async (req, res) => {
  try {
    const { allPages, stats } = await computeDashboardAllPagesAndStats(req);
    res.json({ pages: allPages, stats });
  } catch (error) {
    console.error('Error fetching all pages:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to fetch pages' });
  }
});

/**
 * List release-note pages under a status parent (same payload as GET /api/pages).
 * options.globalFieldNames — if set, skips getJiraFieldNames (used when export loads multiple statuses).
 */
async function listPagesForStatus(req, status, options = {}) {
  const credentials = getCredentialsFromRequest(req);
  const { confluenceApi, jiraApi } = createApiClients(credentials);

  if (!PAGE_STATUSES[status]) {
    const err = new Error('Invalid status');
    err.statusCode = 400;
    throw err;
  }

  const pageIdMap = {
    draft: req.headers['x-draft-page-id'] || PAGE_STATUSES.draft.pageId,
    inProgress: req.headers['x-in-progress-page-id'] || PAGE_STATUSES.inProgress.pageId,
    needsAction: req.headers['x-needs-action-page-id'] || PAGE_STATUSES.needsAction.pageId,
    published: req.headers['x-published-page-id'] || PAGE_STATUSES.published.pageId,
    discard: req.headers['x-discard-page-id'] || PAGE_STATUSES.discard.pageId
  };

  const statusConfig = { ...PAGE_STATUSES[status], pageId: pageIdMap[status] };
  const parentPageId = statusConfig.pageId;

  const PAGE_LIMIT = 100;
  const allRawPages = [];
  let start = 0;
  let hasMore = true;
  while (hasMore) {
    const response = await confluenceApi.get(`/rest/api/content/${parentPageId}/child/page`, {
      params: {
        expand: 'version,history,metadata.labels,body.storage',
        limit: PAGE_LIMIT,
        start
      }
    });
    const results = response.data.results || [];
    allRawPages.push(...results);
    hasMore = results.length === PAGE_LIMIT;
    start += results.length;
  }

  const globalFieldNames =
    options.globalFieldNames !== undefined
      ? options.globalFieldNames
      : await getJiraFieldNames(jiraApi);

  const pages = await Promise.all(allRawPages.map(async (page) => {
    const bodyContent = page.body?.storage?.value || '';
    const jiraTicket = extractJiraTicket(bodyContent) || extractJiraTicketFromTitle(page.title);
    const referenceAssignee = extractReferenceAssignee(bodyContent);

    let jiraAssignee = null;
    let jiraMetadataPills = [];
    let launchDatesForPage = null;
    let targetedLaunchDateForPage = null;
    let actualLaunchDateForPage = null;
    let targetedLaunchDateRawForPage = null;
    let actualLaunchDateRawForPage = null;
    let educationProjectStatusForPage = null;
    if (jiraTicket) {
      try {
        let jiraResponse = await jiraApi.get(`/rest/api/3/issue/${jiraTicket}`, {
          params: { expand: 'names' }
        });
        if (!jiraResponse.data?.fields) {
          jiraResponse = await jiraApi.get(`/rest/api/3/issue/${jiraTicket}`);
        }
        const issue = jiraResponse.data;
        const fields = issue?.fields;
        const fieldNames = issue?.names || {};
        if (fields) {
          const assignee = fields.assignee;
          if (assignee) {
            jiraAssignee = {
              displayName: assignee.displayName,
              email: assignee.emailAddress,
              avatarUrl: assignee.avatarUrls?.['48x48'] || assignee.avatarUrls?.['24x24']
            };
          }
          jiraMetadataPills = extractJiraMetadataPills(fields, fieldNames, globalFieldNames);
          const extracted = extractLaunchDatesAndEducationStatus(fields, fieldNames, globalFieldNames);
          launchDatesForPage = extracted.launchDates;
          targetedLaunchDateForPage = extracted.targetedLaunchDate;
          actualLaunchDateForPage = extracted.actualLaunchDate;
          targetedLaunchDateRawForPage = extracted.targetedLaunchDateRaw;
          actualLaunchDateRawForPage = extracted.actualLaunchDateRaw;
          educationProjectStatusForPage = extracted.educationProjectStatus;
        }
      } catch (e) {
        const httpStatus = e.response?.status;
        if (httpStatus === 404) {
          // Bad or inaccessible key (e.g. typo, wrong site) — skip enrichment, no stack noise
        } else if (e.code === 'ECONNRESET' || e.code === 'ETIMEDOUT') {
          console.warn(`[Jira] Transient error for ${jiraTicket}:`, e.message);
        } else {
          console.warn(`[Jira] Could not fetch issue ${jiraTicket}:`, e.message);
        }
      }
    }
    const fixVersions = (jiraMetadataPills.find(p => p.label === 'Fix Version')?.values) || null;

    let lastComment = null;
    let commentCount = 0;

    try {
      const commentsResponse = await confluenceApi.get(`/rest/api/content/${page.id}/child/comment`, {
        params: {
          expand: 'version,history',
          limit: 1,
          order: 'desc'
        }
      });

      commentCount = commentsResponse.data.size || 0;
      if (commentsResponse.data.results && commentsResponse.data.results.length > 0) {
        const comment = commentsResponse.data.results[0];
        lastComment = {
          id: comment.id,
          date: comment.version?.when || comment.history?.createdDate,
          author: comment.version?.by?.displayName || comment.history?.createdBy?.displayName
        };
      }
    } catch (e) {
      // Silently fail for comments
    }

    const createdDate = page.history?.createdDate;
    const lastModified = page.version?.when;

    let lastActivityDate = lastModified;
    if (lastComment && lastComment.date) {
      const commentDate = new Date(lastComment.date);
      const modifiedDate = new Date(lastModified);
      if (commentDate > modifiedDate) {
        lastActivityDate = lastComment.date;
      }
    }

    return {
      id: page.id,
      title: page.title,
      url: `${credentials.baseUrl}${page._links.webui}`,
      status,
      createdDate,
      createdDaysAgo: daysAgo(createdDate),
      lastModified,
      lastModifiedDaysAgo: daysAgo(lastModified),
      lastActivityDate,
      lastActivityDaysAgo: daysAgo(lastActivityDate),
      lastComment,
      lastCommentDaysAgo: lastComment ? daysAgo(lastComment.date) : null,
      commentCount,
      version: page.version?.number,
      author: page.history?.createdBy?.displayName,
      labels: page.metadata?.labels?.results?.map(l => l.name) || [],
      isStale: statusConfig.staleThreshold
        ? daysAgo(lastActivityDate) >= statusConfig.staleThreshold
        : false,
      jiraTicket: jiraTicket,
      jiraUrl: jiraTicket ? `https://toasttab.atlassian.net/browse/${jiraTicket}` : null,
      jiraAssignee: jiraAssignee,
      referenceAssignee: referenceAssignee,
      fixVersions: fixVersions,
      jiraMetadataPills: jiraMetadataPills,
      launchDates: launchDatesForPage,
      targetedLaunchDate: targetedLaunchDateForPage,
      actualLaunchDate: actualLaunchDateForPage,
      targetedLaunchDateRaw: targetedLaunchDateRawForPage,
      actualLaunchDateRaw: actualLaunchDateRawForPage,
      educationProjectStatus: educationProjectStatusForPage,
      contentText: convertConfluenceToText(bodyContent)
    };
  }));

  pages.sort((a, b) => b.lastActivityDaysAgo - a.lastActivityDaysAgo);

  return {
    pages,
    total: pages.length,
    status,
    statusConfig
  };
}

// Get child pages of a specific status/parent page
app.get('/api/pages', async (req, res) => {
  try {
    const status = req.query.status || 'draft';
    const payload = await listPagesForStatus(req, status);
    res.json(payload);
  } catch (error) {
    const code = error.statusCode || error.response?.status;
    if (code === 400) {
      return res.status(400).json({ error: 'Invalid status', details: error.message });
    }
    console.error('Error fetching pages:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: 'Failed to fetch pages',
      details: error.response?.data?.message || error.message
    });
  }
});

// Re-aggregate selected pages from Confluence (sync/refresh) – updates Jira ticket, assignee, comments, etc. without creating duplicates
app.post('/api/pages/refresh', async (req, res) => {
  try {
    const credentials = getCredentialsFromRequest(req);
    const { confluenceApi, jiraApi } = createApiClients(credentials);
    const pageIds = Array.isArray(req.body.pageIds) ? req.body.pageIds : [];
    const status = req.body.status || 'draft';

    if (pageIds.length === 0) {
      return res.status(400).json({ error: 'pageIds array is required and must not be empty' });
    }

    const pageIdMap = {
      draft: req.headers['x-draft-page-id'] || PAGE_STATUSES.draft.pageId,
      inProgress: req.headers['x-in-progress-page-id'] || PAGE_STATUSES.inProgress.pageId,
      needsAction: req.headers['x-needs-action-page-id'] || PAGE_STATUSES.needsAction.pageId,
      published: req.headers['x-published-page-id'] || PAGE_STATUSES.published.pageId,
      discard: req.headers['x-discard-page-id'] || PAGE_STATUSES.discard.pageId
    };
    const statusConfig = { ...PAGE_STATUSES[status], pageId: pageIdMap[status] };

    const globalFieldNames = await getJiraFieldNames(jiraApi);
    const pages = [];
    for (const pageId of pageIds) {
      let page;
      try {
        const response = await confluenceApi.get(`/rest/api/content/${pageId}`, {
          params: {
            expand: 'version,history,metadata.labels,body.storage'
          }
        });
        page = response.data;
      } catch (e) {
        console.warn(`[Refresh] Could not fetch Confluence page ${pageId}:`, e.message);
        continue;
      }
      const bodyContent = page.body?.storage?.value || '';
      const jiraTicket = extractJiraTicket(bodyContent) || extractJiraTicketFromTitle(page.title);
      const referenceAssignee = extractReferenceAssignee(bodyContent);

      let jiraAssignee = null;
      let jiraMetadataPills = [];
      let launchDatesForPage = null;
      let targetedLaunchDateForPage = null;
      let actualLaunchDateForPage = null;
      let targetedLaunchDateRawForPage = null;
      let actualLaunchDateRawForPage = null;
      let educationProjectStatusForPage = null;
      if (jiraTicket) {
        try {
          let jiraResponse;
          try {
            jiraResponse = await jiraApi.get(`/rest/api/3/issue/${jiraTicket}`, {
              params: { expand: 'names' }
            });
            if (!jiraResponse.data?.fields) {
              jiraResponse = await jiraApi.get(`/rest/api/3/issue/${jiraTicket}`);
            }
          } catch (error) {
            console.error(`[Refresh] Error fetching Jira issue ${jiraTicket}:`, error.message);
            throw error;
          }
          const issue = jiraResponse.data;
          const fields = issue?.fields;
          const fieldNames = issue?.names || {};
          if (fields) {
            const assignee = fields.assignee;
            if (assignee) {
              jiraAssignee = {
                displayName: assignee.displayName,
                email: assignee.emailAddress,
                avatarUrl: assignee.avatarUrls?.['48x48'] || assignee.avatarUrls?.['24x24']
              };
            }
            jiraMetadataPills = extractJiraMetadataPills(fields, fieldNames, globalFieldNames);
            const extracted = extractLaunchDatesAndEducationStatus(fields, fieldNames, globalFieldNames);
            launchDatesForPage = extracted.launchDates;
            targetedLaunchDateForPage = extracted.targetedLaunchDate;
            actualLaunchDateForPage = extracted.actualLaunchDate;
            targetedLaunchDateRawForPage = extracted.targetedLaunchDateRaw;
            actualLaunchDateRawForPage = extracted.actualLaunchDateRaw;
            educationProjectStatusForPage = extracted.educationProjectStatus;
          }
        } catch (e) {
          console.log(`Could not fetch Jira data for ${jiraTicket} during refresh:`, e.message);
        }
      }
      const fixVersions = (jiraMetadataPills.find(p => p.label === 'Fix Version')?.values) || null;

      let lastComment = null;
      let commentCount = 0;
      try {
        const commentsResponse = await confluenceApi.get(`/rest/api/content/${page.id}/child/comment`, {
          params: {
            expand: 'version,history',
            limit: 1,
            order: 'desc'
          }
        });
        commentCount = commentsResponse.data.size || 0;
        if (commentsResponse.data.results && commentsResponse.data.results.length > 0) {
          const comment = commentsResponse.data.results[0];
          lastComment = {
            id: comment.id,
            date: comment.version?.when || comment.history?.createdDate,
            author: comment.version?.by?.displayName || comment.history?.createdBy?.displayName
          };
        }
      } catch (e) {
        // Silently fail for comments
      }

      const createdDate = page.history?.createdDate;
      const lastModified = page.version?.when;
      let lastActivityDate = lastModified;
      if (lastComment && lastComment.date) {
        const commentDate = new Date(lastComment.date);
        const modifiedDate = new Date(lastModified);
        if (commentDate > modifiedDate) {
          lastActivityDate = lastComment.date;
        }
      }

      const pageObj = {
        id: page.id,
        title: page.title,
        url: `${credentials.baseUrl}${page._links.webui}`,
        status,
        createdDate,
        createdDaysAgo: daysAgo(createdDate),
        lastModified,
        lastModifiedDaysAgo: daysAgo(lastModified),
        lastActivityDate,
        lastActivityDaysAgo: daysAgo(lastActivityDate),
        lastComment,
        lastCommentDaysAgo: lastComment ? daysAgo(lastComment.date) : null,
        commentCount,
        version: page.version?.number,
        author: page.history?.createdBy?.displayName,
        labels: page.metadata?.labels?.results?.map(l => l.name) || [],
        isStale: statusConfig.staleThreshold
          ? daysAgo(lastActivityDate) >= statusConfig.staleThreshold
          : false,
        jiraTicket: jiraTicket,
        jiraUrl: jiraTicket ? `https://toasttab.atlassian.net/browse/${jiraTicket}` : null,
        jiraAssignee: jiraAssignee,
        referenceAssignee: referenceAssignee,
        fixVersions: fixVersions,
        jiraMetadataPills: jiraMetadataPills,
        launchDates: launchDatesForPage,
        targetedLaunchDate: targetedLaunchDateForPage,
        actualLaunchDate: actualLaunchDateForPage,
        targetedLaunchDateRaw: targetedLaunchDateRawForPage,
        actualLaunchDateRaw: actualLaunchDateRawForPage,
        educationProjectStatus: educationProjectStatusForPage,
        contentText: convertConfluenceToText(bodyContent)
      };
      pages.push(pageObj);
    }

    res.json({
      pages,
      total: pages.length
    });
  } catch (error) {
    console.error('Error refreshing pages:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: 'Failed to refresh pages',
      details: error.response?.data?.message || error.message
    });
  }
});

// Refresh Jira-only data for given pages (one-way: Jira = source of truth; updates fix version, labels, assignee, etc. in our tool only)
app.post('/api/pages/refresh-jira', async (req, res) => {
  try {
    const credentials = getCredentialsFromRequest(req);
    const { jiraApi } = createApiClients(credentials);
    const updates = Array.isArray(req.body.updates) ? req.body.updates : [];
    if (updates.length === 0) {
      return res.status(400).json({ error: 'Body must include updates: [{ pageId, jiraTicket }]' });
    }

    const globalFieldNames = await getJiraFieldNames(jiraApi);
    const pages = [];
    for (const { pageId, jiraTicket } of updates) {
      if (!pageId || !jiraTicket) continue;
      try {
        const jiraResponse = await jiraApi.get(`/rest/api/3/issue/${jiraTicket}`, { params: { expand: 'names' } });
        const issue = jiraResponse.data;
        const fields = issue?.fields;
        const fieldNames = issue?.names || {};
        if (!fields) {
          pages.push({ id: pageId, jiraTicket, jiraUrl: null, jiraAssignee: null, fixVersions: null, jiraMetadataPills: [], launchDates: null, targetedLaunchDate: null, actualLaunchDate: null, targetedLaunchDateRaw: null, actualLaunchDateRaw: null, educationProjectStatus: null });
          continue;
        }
        const assignee = fields.assignee;
        const jiraAssignee = assignee ? {
          displayName: assignee.displayName,
          email: assignee.emailAddress,
          avatarUrl: assignee.avatarUrls?.['48x48'] || assignee.avatarUrls?.['24x24']
        } : null;
        const jiraMetadataPills = extractJiraMetadataPills(fields, fieldNames, globalFieldNames);
        const fixVersions = (jiraMetadataPills.find(p => p.label === 'Fix Version')?.values) || null;
        const extracted = extractLaunchDatesAndEducationStatus(fields, fieldNames, globalFieldNames);
        const jiraBaseUrl = credentials.baseUrl.replace('/wiki', '');
        pages.push({
          id: pageId,
          jiraTicket,
          jiraUrl: `${jiraBaseUrl}/browse/${jiraTicket}`,
          jiraAssignee,
          fixVersions,
          jiraMetadataPills,
          labels: fields.labels || [],
          launchDates: extracted.launchDates,
          targetedLaunchDate: extracted.targetedLaunchDate,
          actualLaunchDate: extracted.actualLaunchDate,
          targetedLaunchDateRaw: extracted.targetedLaunchDateRaw,
          actualLaunchDateRaw: extracted.actualLaunchDateRaw,
          educationProjectStatus: extracted.educationProjectStatus
        });
      } catch (e) {
        console.warn(`[Refresh Jira] Failed to fetch ${jiraTicket} for page ${pageId}:`, e.message);
        pages.push({ id: pageId, jiraTicket, jiraUrl: null, jiraAssignee: null, fixVersions: null, jiraMetadataPills: [], launchDates: null, targetedLaunchDate: null, actualLaunchDate: null, targetedLaunchDateRaw: null, actualLaunchDateRaw: null, educationProjectStatus: null, _error: e.message });
      }
    }

    res.json({ pages, total: pages.length });
  } catch (error) {
    console.error('Error refreshing from Jira:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: 'Failed to refresh from Jira',
      details: error.response?.data?.message || error.message
    });
  }
});

// Get comments for a specific page
app.get('/api/pages/:pageId/comments', async (req, res) => {
  try {
    const { pageId } = req.params;
    console.log(`[GET /api/pages/${pageId}/comments] Request received`);
    
    // Get credentials from request
    const credentials = getCredentialsFromRequest(req);
    const { confluenceApi: userConfluenceApi } = createApiClients(credentials);
    
    console.log(`[GET /api/pages/${pageId}/comments] Fetching comments from Confluence API v2`);
    
    // Try Confluence v2 API first, fallback to v1 if it fails
    let response;
    let usingV2 = false;
    try {
      response = await userConfluenceApi.get(`/wiki/api/v2/footer-comments`, {
        params: {
          pageId: pageId,
          limit: 100,
          sort: 'created-date-desc'
        }
      });
      usingV2 = true;
      console.log(`[GET /api/pages/${pageId}/comments] Confluence API v2 response status: ${response.status}`);
      console.log(`[GET /api/pages/${pageId}/comments] v2 Response data:`, JSON.stringify(response.data, null, 2).substring(0, 500));
    } catch (v2Error) {
      console.log(`[GET /api/pages/${pageId}/comments] v2 API failed (${v2Error.response?.status || v2Error.message}), trying v1 API`);
      // Fallback to v1 API
      try {
        response = await userConfluenceApi.get(`/rest/api/content/${pageId}/child/comment`, {
          params: {
            expand: 'body.view,version,history,children.comment',
            limit: 100,
            order: 'desc'
          }
        });
        usingV2 = false;
        console.log(`[GET /api/pages/${pageId}/comments] Confluence API v1 response status: ${response.status}`);
        console.log(`[GET /api/pages/${pageId}/comments] v1 API returned ${response.data?.results?.length || 0} comments`);
        console.log(`[GET /api/pages/${pageId}/comments] v1 Response data:`, JSON.stringify(response.data, null, 2).substring(0, 500));
      } catch (v1Error) {
        console.error(`[GET /api/pages/${pageId}/comments] Both v2 and v1 API failed`);
        console.error(`[GET /api/pages/${pageId}/comments] v1 Error:`, v1Error.response?.status, v1Error.response?.data || v1Error.message);
        throw v1Error; // Re-throw to be caught by outer catch
      }
    }

    // Process comments and build thread structure
    // Handle both v2 and v1 API response formats
    let allComments = [];
    const commentsData = response.data.results || [];
    
    console.log(`[GET /api/pages/${pageId}/comments] Using ${usingV2 ? 'v2' : 'v1'} API`);
    console.log(`[GET /api/pages/${pageId}/comments] Processing ${commentsData.length} comments from API`);
    console.log(`[GET /api/pages/${pageId}/comments] Response data keys:`, Object.keys(response.data || {}));
    console.log(`[GET /api/pages/${pageId}/comments] Full response.data:`, JSON.stringify(response.data, null, 2));
    
    if (commentsData.length > 0) {
      console.log(`[GET /api/pages/${pageId}/comments] First comment keys:`, Object.keys(commentsData[0]));
      console.log(`[GET /api/pages/${pageId}/comments] First comment:`, JSON.stringify(commentsData[0], null, 2));
      console.log(`[GET /api/pages/${pageId}/comments] First comment body structure:`, commentsData[0].body ? Object.keys(commentsData[0].body) : 'no body');
    }
    
    if (commentsData.length > 0) {
      // Check which format we have
      const firstComment = commentsData[0];
      const isV2Format = firstComment.body?.value !== undefined || firstComment.createdAt !== undefined;
      
      console.log(`[GET /api/pages/${pageId}/comments] Detected format: ${isV2Format ? 'v2' : 'v1'}`);
      
      if (isV2Format) {
        // v2 API format (has body.value)
        allComments = commentsData.map(comment => {
          const processed = {
            id: comment.id,
            body: comment.body?.value || comment.body || '',
            author: comment.author?.displayName || comment.author?.publicName || 'Unknown',
            authorAvatar: comment.author?.profilePicture?.path || null,
            createdDate: comment.createdAt || comment.created?.at,
            daysAgo: daysAgo(comment.createdAt || comment.created?.at),
            parentId: comment.parentCommentId || null // Confluence v2 threading
          };
          console.log(`[GET /api/pages/${pageId}/comments] Processed v2 comment:`, processed.id, processed.author);
          return processed;
        });
      } else {
      // v1 API format (has body.view.value)
      // For v1 API, comments that are replies are nested in children.comment.results
      // Top-level comments in the results array are root comments
      const allV1Comments = [];
      
      const processV1Comment = (comment, parentId = null) => {
        // Add this comment
        const processed = {
          id: comment.id,
          body: comment.body?.view?.value || comment.body?.storage?.value || '',
          author: comment.version?.by?.displayName || comment.history?.createdBy?.displayName || 'Unknown',
          authorAvatar: comment.version?.by?.profilePicture?.path || comment.history?.createdBy?.profilePicture?.path || null,
          createdDate: comment.history?.createdDate,
          daysAgo: daysAgo(comment.history?.createdDate),
          parentId: parentId // Set parentId only if this is a nested comment (reply)
        };
        allV1Comments.push(processed);
        console.log(`[GET /api/pages/${pageId}/comments] Processed v1 comment:`, processed.id, processed.author, parentId ? `(reply to ${parentId})` : '(root)');
        
        // Process nested comments (replies) - these are the actual threaded replies
        if (comment.children?.comment?.results && comment.children.comment.results.length > 0) {
          comment.children.comment.results.forEach(childComment => {
            // Recursively process nested comments
            processV1Comment(childComment, comment.id);
          });
        }
      };
      
      // Process all top-level comments (these are root comments, not replies)
      commentsData.forEach(comment => {
        processV1Comment(comment, null); // null means it's a root comment
      });
      
      allComments = allV1Comments;
      }
    }

    console.log(`[GET /api/pages/${pageId}/comments] Processed ${allComments.length} comments before threading`);
    
    // If we have no processed comments but the API says there are comments, log a warning
    if (allComments.length === 0 && (response.data.totalSize > 0 || response.data.size > 0)) {
      console.warn(`[GET /api/pages/${pageId}/comments] WARNING: API reports comments exist but none were processed!`);
      console.warn(`[GET /api/pages/${pageId}/comments] Response structure:`, JSON.stringify(response.data, null, 2));
    }
    
    // Build thread structure (group by parent)
    const threadMap = new Map();
    const rootComments = [];
    
    allComments.forEach(comment => {
      // Only add to threading if comment has required fields
      if (!comment.id) {
        console.warn(`[GET /api/pages/${pageId}/comments] Skipping comment without id:`, comment);
        return;
      }
      
      // Handle parentId - if it exists and is not null, it's a reply
      if (comment.parentId) {
        const parentIdStr = String(comment.parentId);
        if (!threadMap.has(parentIdStr)) {
          threadMap.set(parentIdStr, []);
        }
        threadMap.get(parentIdStr).push(comment);
        console.log(`[GET /api/pages/${pageId}/comments] Comment ${comment.id} is a reply to ${parentIdStr}`);
      } else {
        // Root comment (no parent)
        rootComments.push(comment);
        console.log(`[GET /api/pages/${pageId}/comments] Comment ${comment.id} is a root comment`);
      }
    });
    
    console.log(`[GET /api/pages/${pageId}/comments] Found ${rootComments.length} root comments and ${Array.from(threadMap.values()).flat().length} reply comments`);
    
    // Attach replies to their parents
    const buildThread = (comment) => {
      const commentIdStr = String(comment.id);
      const replies = threadMap.get(commentIdStr) || [];
      return {
        ...comment,
        replies: replies.map(buildThread).sort((a, b) => {
          const dateA = new Date(a.createdDate);
          const dateB = new Date(b.createdDate);
          return dateA - dateB;
        })
      };
    };
    
    const threadedComments = rootComments.map(buildThread).sort((a, b) => {
      const dateA = new Date(a.createdDate);
      const dateB = new Date(b.createdDate);
      return dateB - dateA; // Descending (newest first)
    });
    
    // If we have processed comments but no threaded comments, return the processed comments as-is
    if (allComments.length > 0 && threadedComments.length === 0) {
      console.warn(`[GET /api/pages/${pageId}/comments] WARNING: Comments processed but none in threaded structure. Returning flat list.`);
      threadedComments.push(...allComments.map(c => ({ ...c, replies: [] })));
    }

    console.log(`[GET /api/pages/${pageId}/comments] Returning ${threadedComments.length} threaded comments`);
    console.log(`[GET /api/pages/${pageId}/comments] Total from API: ${response.data.totalSize || response.data.size || 'unknown'}`);
    console.log(`[GET /api/pages/${pageId}/comments] All comments count: ${allComments.length}`);

    res.json({
      comments: threadedComments,
      total: response.data.totalSize || response.data.size || allComments.length
    });
  } catch (error) {
    const pageId = req.params.pageId;
    console.error(`[GET /api/pages/${pageId}/comments] Error occurred:`, error.message);
    console.error(`[GET /api/pages/${pageId}/comments] Error status:`, error.response?.status);
    console.error(`[GET /api/pages/${pageId}/comments] Error response data:`, JSON.stringify(error.response?.data, null, 2));
    console.error(`[GET /api/pages/${pageId}/comments] Error config URL:`, error.config?.url);
    console.error(`[GET /api/pages/${pageId}/comments] Error stack:`, error.stack);
    
    const statusCode = error.response?.status || 500;
    const errorMessage = error.response?.data?.message || error.response?.data?.errorMessages?.join(', ') || error.message || 'Unknown error';
    
    res.status(statusCode).json({
      error: 'Failed to fetch comments',
      details: errorMessage
    });
  }
});

// Add a comment to a page
app.post('/api/pages/:pageId/comments', async (req, res) => {
  try {
    const { pageId } = req.params;
    const { body, parentId } = req.body; // parentId for threading

    // Get credentials from request
    const credentials = getCredentialsFromRequest(req);
    const { confluenceApi: userConfluenceApi } = createApiClients(credentials);

    // Use Confluence v2 API for threaded comments
    // For replies, use /wiki/api/v2/footer-comments with parentCommentId
    // For new comments, we can use either v1 or v2 API
    if (parentId) {
      // Threaded reply - use v2 API
      const commentPayload = {
        pageId: pageId,
        parentCommentId: parentId,
        body: {
          representation: 'storage',
          value: body
        }
      };

      console.log('Posting Confluence threaded comment with payload:', JSON.stringify(commentPayload, null, 2));

      const response = await userConfluenceApi.post(`/wiki/api/v2/footer-comments`, commentPayload);

      res.json({
        success: true,
        comment: {
          id: response.data.id,
          body: body
        }
      });
    } else {
      // New comment - use v1 API (backward compatible)
      const commentPayload = {
        type: 'comment',
        container: {
          id: pageId,
          type: 'page'
        },
        body: {
          storage: {
            value: body,
            representation: 'storage'
          }
        }
      };

      const response = await userConfluenceApi.post(`/rest/api/content`, commentPayload);

      res.json({
        success: true,
        comment: {
          id: response.data.id,
          body: body
        }
      });
    }
  } catch (error) {
    console.error('Error adding comment:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: 'Failed to add comment',
      details: error.response?.data?.message || error.message
    });
  }
});

// Move a page to a different status
app.post('/api/pages/:pageId/move', async (req, res) => {
  try {
    const { pageId } = req.params;
    const { targetStatus, jiraComment } = req.body; // Optional Jira comment

    const targetStatusConfig = PAGE_STATUSES[targetStatus];
    if (!targetStatusConfig) {
      return res.status(400).json({ error: 'Invalid target status' });
    }

    // Get credentials and create API clients
    const credentials = getCredentialsFromRequest(req);
    const { confluenceApi } = createApiClients(credentials);

    // Get the current page
    const currentPage = await confluenceApi.get(`/rest/api/content/${pageId}`, {
      params: {
        expand: 'version,body.storage,ancestors'
      }
    });

    // Extract Jira ticket from page body
    const bodyContent = currentPage.data.body?.storage?.value || '';
    const jiraTicket = extractJiraTicket(bodyContent);

    // Move the page by updating its ancestors
    const response = await confluenceApi.put(`/rest/api/content/${pageId}`, {
      id: pageId,
      type: 'page',
      title: currentPage.data.title,
      version: {
        number: currentPage.data.version.number + 1
      },
      ancestors: [{
        id: targetStatusConfig.pageId
      }],
      body: currentPage.data.body
    });

    // If Jira comment or labels are provided and we have a Jira ticket, update the ticket
    if (jiraTicket) {
      const credentials = getCredentialsFromRequest(req);
      const { jiraApi: userJiraApi } = createApiClients(credentials);
      
      // Post comment if provided
      if (jiraComment && jiraComment.body && jiraComment.body.trim()) {
        try {
          const commentContent = jiraComment.mentions && jiraComment.mentions.length > 0
            ? parseMentionsToADF(jiraComment.body, jiraComment.mentions)
            : [{ type: 'text', text: jiraComment.body }];
          
          await userJiraApi.post(`/rest/api/3/issue/${jiraTicket}/comment`, {
            body: {
              type: 'doc',
              version: 1,
              content: [
                {
                  type: 'paragraph',
                  content: commentContent
                }
              ]
            }
          });
        } catch (jiraError) {
          console.error('Error posting Jira comment during move:', jiraError.response?.data || jiraError.message);
          // Don't fail the move if comment fails, just log it
        }
      }

      // Add labels if provided
      if (req.body.labels && Array.isArray(req.body.labels) && req.body.labels.length > 0) {
        try {
          // Get current issue to merge labels
          const currentIssue = await userJiraApi.get(`/rest/api/3/issue/${jiraTicket}`, {
            params: { fields: 'labels' }
          });
          const currentLabels = currentIssue.data.fields.labels || [];
          
          // Merge new labels with existing ones (avoid duplicates)
          const allLabels = [...new Set([...currentLabels, ...req.body.labels])];
          
          await userJiraApi.put(`/rest/api/3/issue/${jiraTicket}`, {
            fields: {
              labels: allLabels
            }
          });
        } catch (labelError) {
          console.error('Error adding labels during move:', labelError.response?.data || labelError.message);
          // Don't fail the move if labels fail, just log it
        }
      }
    }

    res.json({
      success: true,
      message: `Page "${currentPage.data.title}" moved to ${targetStatusConfig.name}`,
      page: {
        id: response.data.id,
        title: response.data.title,
        newStatus: targetStatus
      }
    });
  } catch (error) {
    console.error('Error moving page:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: 'Failed to move page',
      details: error.response?.data?.message || error.message
    });
  }
});

// Helper function to parse mentions in text and convert to Jira ADF format
function parseMentionsToADF(text, mentions) {
  const parts = [];
  let lastIndex = 0;
  // Match full URLs (http:// or https://) or specific domain patterns like updates.toasttab.com
  // URLs can have trailing punctuation which we'll strip when creating the link
  const urlRegex = /(https?:\/\/[^\s<>"']+)|(\bupdates\.toasttab\.com[^\s<>"']*)/gi;
  let match;
  const mentionMap = new Map();
  const displayNames = [];
  
  // Build a map of displayName -> accountId from mentions array
  // Also build a sorted array of displayNames (longest first) for matching
  if (mentions && Array.isArray(mentions)) {
    mentions.forEach(m => {
      if (m.displayName && m.accountId) {
        // Store both exact match and lowercase for flexibility
        mentionMap.set(m.displayName, m.accountId);
        mentionMap.set(m.displayName.toLowerCase(), m.accountId);
        displayNames.push(m.displayName);
      }
    });
    // Sort by length (longest first) so we match "Shivani Gupta" before "Shivani"
    displayNames.sort((a, b) => b.length - a.length);
  }

  // Collect all matches (mentions and URLs) with their positions
  const allMatches = [];
  
  // Find all mentions by trying to match each displayName
  // We need to match the full display name, not just the first word
  let textIndex = 0;
  while (textIndex < text.length) {
    const atIndex = text.indexOf('@', textIndex);
    if (atIndex === -1) break;
    
    // Try to match each displayName starting at this @ position
    // Sort by length (longest first) to match "Shivani Gupta" before "Shivani"
    let bestMatch = null;
    for (const displayName of displayNames) {
      // Check if the displayName matches at this position (case-insensitive)
      // The text after @ should match the displayName, followed by space, punctuation, or end of text
      const textAfterAt = text.substring(atIndex + 1);
      // Escape special regex characters in displayName
      const escapedName = displayName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Match the name, allowing for spaces in the name, and requiring it to end at word boundary
      const regex = new RegExp(`^${escapedName}(?=[\\s.,!?;:)\\]}]|$)`, 'i');
      if (regex.test(textAfterAt)) {
        const matchedLength = displayName.length;
        if (!bestMatch || matchedLength > bestMatch.length) {
          bestMatch = {
            type: 'mention',
            index: atIndex,
            length: matchedLength + 1, // +1 for the @
            displayName: displayName,
            fullMatch: `@${displayName}`
          };
        }
      }
    }
    
    if (bestMatch) {
      allMatches.push(bestMatch);
      textIndex = bestMatch.index + bestMatch.length;
    } else {
      // No match found, skip this @ and continue
      textIndex = atIndex + 1;
    }
  }
  
  // Find all URLs
  urlRegex.lastIndex = 0; // Reset regex
  while ((match = urlRegex.exec(text)) !== null) {
    // Skip if this URL is part of a mention (already handled)
    const isInMention = allMatches.some(m => 
      m.type === 'mention' && 
      match.index >= m.index && 
      match.index < m.index + m.length
    );
    
    if (!isInMention) {
      // Check if this URL overlaps with another URL (avoid duplicates)
      const overlaps = allMatches.some(m => 
        m.type === 'url' && 
        ((match.index >= m.index && match.index < m.index + m.length) ||
         (m.index >= match.index && m.index < match.index + match[0].length))
      );
      
      if (!overlaps) {
        allMatches.push({
          type: 'url',
          index: match.index,
          length: match[0].length,
          url: match[1] || match[2], // match[1] is full URL, match[2] is domain pattern
          fullMatch: match[0]
        });
      }
    }
  }
  
  // Sort matches by position
  allMatches.sort((a, b) => a.index - b.index);
  
  // Process matches in order
  for (const matchItem of allMatches) {
    // Add text before this match
    if (matchItem.index > lastIndex) {
      const textBefore = text.substring(lastIndex, matchItem.index);
      if (textBefore) {
        parts.push({
          type: 'text',
          text: textBefore
        });
      }
    }

    if (matchItem.type === 'mention') {
      // Add mention
      const displayName = matchItem.displayName;
      const accountId = mentionMap.get(displayName) || mentionMap.get(displayName.toLowerCase());
      
      if (accountId) {
        // For Jira Cloud ADF format, mentions only need the id (accountId)
        // The text attribute is not needed and may cause issues
        // Jira will automatically resolve the display name from the accountId
        parts.push({
          type: 'mention',
          attrs: {
            id: String(accountId)
          }
        });
      } else {
        // If we can't find the accountId, just add the text as-is (fallback)
        parts.push({
          type: 'text',
          text: matchItem.fullMatch
        });
      }
    } else if (matchItem.type === 'url') {
      // Add URL as link
      let url = matchItem.url;
      // If it's just a domain (like updates.toasttab.com), add https://
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
      }
      
      parts.push({
        type: 'text',
        text: matchItem.fullMatch,
        marks: [{
          type: 'link',
          attrs: {
            href: url
          }
        }]
      });
    }

    lastIndex = matchItem.index + matchItem.length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    const remainingText = text.substring(lastIndex);
    if (remainingText) {
      parts.push({
        type: 'text',
        text: remainingText
      });
    }
  }

  const result = parts.length > 0 ? parts : [{ type: 'text', text: text }];
  
  // Debug logging
  if (mentions && mentions.length > 0) {
    console.log('parseMentionsToADF - Input text:', text);
    console.log('parseMentionsToADF - Mentions:', JSON.stringify(mentions, null, 2));
    console.log('parseMentionsToADF - Result:', JSON.stringify(result, null, 2));
  }
  
  return result;
}

// Search for Jira labels
app.get('/api/jira/labels', async (req, res) => {
  try {
    const { query } = req.query;
    const credentials = getCredentialsFromRequest(req);
    const { jiraApi: userJiraApi } = createApiClients(credentials);
    
    if (!query || query.trim().length === 0) {
      return res.json({ labels: [] });
    }

    // Search for labels using Jira's label search API
    try {
      const response = await userJiraApi.get('/rest/api/3/label', {
        params: {
          query: query,
          maxResults: 50
        }
      });
      
      const labels = response.data.values || [];
      res.json({ labels });
    } catch (error) {
      // If label search API doesn't work, try alternative approach
      // Search issues with matching labels
      try {
        const searchResponse = await userJiraApi.get('/rest/api/3/search', {
          params: {
            jql: `labels ~ "${query}"`,
            fields: 'labels',
            maxResults: 100
          }
        });
        
        const labelSet = new Set();
        searchResponse.data.issues.forEach(issue => {
          if (issue.fields.labels) {
            issue.fields.labels.forEach(label => {
              if (label.toLowerCase().includes(query.toLowerCase())) {
                labelSet.add(label);
              }
            });
          }
        });
        
        const labels = Array.from(labelSet).sort();
        res.json({ labels });
      } catch (searchError) {
        console.error('Error searching labels:', searchError.response?.data || searchError.message);
        res.json({ labels: [], message: 'Label search not available' });
      }
    }
  } catch (error) {
    console.error('Error fetching labels:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: 'Failed to fetch labels',
      details: error.response?.data?.errorMessages?.join(', ') || error.message
    });
  }
});

// Bulk update Jira tickets (labels and comments only, no page move)
app.post('/api/pages/bulk-update-jira', async (req, res) => {
  try {
    const { pageIds, jiraComment, labels } = req.body;
    const credentials = getCredentialsFromRequest(req);
    const { confluenceApi, jiraApi: userJiraApi } = createApiClients(credentials);

    const results = {
      success: [],
      failed: [],
      jiraComments: {
        posted: [],
        failed: []
      },
      labels: {
        added: [],
        failed: []
      }
    };

    // Prepare comment content if provided
    let commentContent = null;
    if (jiraComment && jiraComment.body && jiraComment.body.trim()) {
      commentContent = jiraComment.mentions && jiraComment.mentions.length > 0
        ? parseMentionsToADF(jiraComment.body, jiraComment.mentions)
        : [{ type: 'text', text: jiraComment.body }];
    }

    for (const pageId of pageIds) {
      try {
        const currentPage = await confluenceApi.get(`/rest/api/content/${pageId}`, {
          params: {
            expand: 'body.storage'
          }
        });

        // Extract Jira ticket
        const bodyContent = currentPage.data.body?.storage?.value || '';
        const jiraTicket = extractJiraTicket(bodyContent);
        
        if (!jiraTicket) {
          continue; // Skip pages without Jira tickets
        }

        // Add labels if provided
        if (labels && Array.isArray(labels) && labels.length > 0) {
          try {
            const currentIssue = await userJiraApi.get(`/rest/api/3/issue/${jiraTicket}`, {
              params: { fields: 'labels' }
            });
            const currentLabels = currentIssue.data.fields.labels || [];
            const allLabels = [...new Set([...currentLabels, ...labels])];
            
            await userJiraApi.put(`/rest/api/3/issue/${jiraTicket}`, {
              fields: {
                labels: allLabels
              }
            });
            results.labels.added.push({ pageId, jiraTicket });
          } catch (labelError) {
            console.error(`Error adding labels to ${jiraTicket}:`, labelError.response?.data || labelError.message);
            results.labels.failed.push({ pageId, jiraTicket, error: labelError.message });
          }
        }

        // Post comment if provided
        if (commentContent) {
          try {
            await userJiraApi.post(`/rest/api/3/issue/${jiraTicket}/comment`, {
              body: {
                type: 'doc',
                version: 1,
                content: [
                  {
                    type: 'paragraph',
                    content: commentContent
                  }
                ]
              }
            });
            results.jiraComments.posted.push({ pageId, jiraTicket, title: currentPage.data.title });
          } catch (jiraError) {
            console.error(`Error posting comment to ${jiraTicket}:`, jiraError.response?.data || jiraError.message);
            results.jiraComments.failed.push({ pageId, jiraTicket, error: jiraError.message });
          }
        }

        results.success.push({ pageId, jiraTicket });
      } catch (error) {
        console.error(`Error processing page ${pageId}:`, error.response?.data || error.message);
        results.failed.push({ pageId, error: error.message });
      }
    }

    res.json({
      success: true,
      message: `Updated ${results.success.length} Jira ticket${results.success.length !== 1 ? 's' : ''}`,
      results
    });
  } catch (error) {
    console.error('Error in bulk Jira update:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: 'Failed to update Jira tickets',
      details: error.response?.data?.message || error.message
    });
  }
});

// Bulk move pages
app.post('/api/pages/bulk-move', async (req, res) => {
  try {
    const { pageIds, targetStatus, jiraComment, labels } = req.body;
    const credentials = getCredentialsFromRequest(req);
    const { confluenceApi, jiraApi: userJiraApi } = createApiClients(credentials);

    const targetStatusConfig = PAGE_STATUSES[targetStatus];
    if (!targetStatusConfig) {
      return res.status(400).json({ error: 'Invalid target status' });
    }

    const results = {
      success: [],
      failed: [],
      jiraComments: {
        posted: [],
        failed: []
      }
    };

    // Prepare comment content if provided
    let commentContent = null;
    if (jiraComment && jiraComment.body && jiraComment.body.trim()) {
      commentContent = jiraComment.mentions && jiraComment.mentions.length > 0
        ? parseMentionsToADF(jiraComment.body, jiraComment.mentions)
        : [{ type: 'text', text: jiraComment.body }];
    }

    for (const pageId of pageIds) {
      try {
        const currentPage = await confluenceApi.get(`/rest/api/content/${pageId}`, {
          params: {
            expand: 'version,body.storage'
          }
        });

        // Move the page
        await confluenceApi.put(`/rest/api/content/${pageId}`, {
          id: pageId,
          type: 'page',
          title: currentPage.data.title,
          version: {
            number: currentPage.data.version.number + 1
          },
          ancestors: [{
            id: targetStatusConfig.pageId
          }],
          body: currentPage.data.body
        });

        // Extract Jira ticket and update if needed
        const bodyContent = currentPage.data.body?.storage?.value || '';
        const jiraTicket = extractJiraTicket(bodyContent);
        
        if (jiraTicket) {
          // Post comment if provided
          if (commentContent) {
            try {
              await userJiraApi.post(`/rest/api/3/issue/${jiraTicket}/comment`, {
                body: {
                  type: 'doc',
                  version: 1,
                  content: [
                    {
                      type: 'paragraph',
                      content: commentContent
                    }
                  ]
                }
              });
              results.jiraComments.posted.push({ pageId, jiraTicket, title: currentPage.data.title });
            } catch (jiraError) {
              console.error(`Error posting Jira comment for ${jiraTicket}:`, jiraError.response?.data || jiraError.message);
              results.jiraComments.failed.push({ pageId, jiraTicket, error: jiraError.message });
            }
          }

          // Add labels if provided
          if (labels && Array.isArray(labels) && labels.length > 0) {
            try {
              // Get current issue to merge labels
              const currentIssue = await userJiraApi.get(`/rest/api/3/issue/${jiraTicket}`, {
                params: { fields: 'labels' }
              });
              const currentLabels = currentIssue.data.fields.labels || [];
              
              // Merge new labels with existing ones (avoid duplicates)
              const allLabels = [...new Set([...currentLabels, ...labels])];
              
              await userJiraApi.put(`/rest/api/3/issue/${jiraTicket}`, {
                fields: {
                  labels: allLabels
                }
              });
            } catch (labelError) {
              console.error(`Error adding labels to ${jiraTicket}:`, labelError.response?.data || labelError.message);
              // Don't fail the move if labels fail, just log it
            }
          }
        }

        results.success.push({ id: pageId, title: currentPage.data.title });
      } catch (e) {
        results.failed.push({ id: pageId, error: e.message });
      }
    }

    let message = `Moved ${results.success.length} page${results.success.length !== 1 ? 's' : ''} to ${targetStatusConfig.name}`;
    if (commentContent && results.jiraComments.posted.length > 0) {
      message += `. Posted comment to ${results.jiraComments.posted.length} Jira ticket${results.jiraComments.posted.length !== 1 ? 's' : ''}.`;
    }
    if (results.jiraComments.failed.length > 0) {
      message += ` Failed to post comment to ${results.jiraComments.failed.length} ticket${results.jiraComments.failed.length !== 1 ? 's' : ''}.`;
    }

    res.json({
      success: true,
      message,
      results
    });
  } catch (error) {
    console.error('Error bulk moving pages:', error.message);
    res.status(500).json({
      error: 'Failed to bulk move pages',
      details: error.message
    });
  }
});

// Debug: see how Fix Version is resolved for an issue (helps with JPD/custom fields)
app.get('/api/jira/debug-fix-version', async (req, res) => {
  try {
    const issueKey = req.query.issueKey;
    if (!issueKey) {
      return res.status(400).json({ error: 'Query param issueKey required (e.g. ?issueKey=CPPL-386)' });
    }
    const credentials = getCredentialsFromRequest(req);
    const { jiraApi } = createApiClients(credentials);
    const globalFieldNames = await getJiraFieldNames(jiraApi);
    const issueRes = await jiraApi.get(`/rest/api/3/issue/${issueKey}`, { params: { expand: 'names' } });
    const fields = issueRes.data?.fields || {};
    const issueNames = issueRes.data?.names || {};
    const mergedNames = { ...globalFieldNames, ...issueNames };
    const fixVersionCandidates = [];
    const matchTerms = ['fix version', 'fix versions', 'target version', 'release version', 'release'];
    for (const [key, value] of Object.entries(fields)) {
      if (value == null) continue;
      const displayName = (mergedNames[key] || key).toLowerCase();
      const matched = matchTerms.some(term => displayName === term || displayName.includes(term));
      if (matched) {
        fixVersionCandidates.push({
          fieldKey: key,
          displayName: mergedNames[key] || key,
          rawValue: value,
          extracted: extractValueFromVersionLike(value, 'name')
        });
      }
    }
    res.json({
      issueKey,
      globalFieldNamesCount: Object.keys(globalFieldNames).length,
      pills: extractJiraMetadataPills(fields, issueNames, globalFieldNames),
      fixVersionCandidates
    });
  } catch (e) {
    console.error('[debug-fix-version]', e.message);
    res.status(e.response?.status || 500).json({
      error: e.message,
      details: e.response?.data?.errorMessages || e.response?.data?.message
    });
  }
});

// Get Jira issue details
app.get('/api/jira/issue/:issueKey', async (req, res) => {
  try {
    const { issueKey } = req.params;
    const credentials = getCredentialsFromRequest(req);
    const { jiraApi: userJiraApi } = createApiClients(credentials);
    
    // Fetch issue with all fields (use * to get all fields including custom fields)
    const response = await userJiraApi.get(`/rest/api/3/issue/${issueKey}`, {
      params: {
        expand: 'names'
      }
    });

    const issue = response.data;
    const fields = issue.fields;
    const fieldNames = issue.names || {}; // Maps field IDs to human-readable names

    // Try to get roadmap status from common custom fields
    let roadmapStatus = null;
    if (fields.customfield_10020) {
      roadmapStatus = fields.customfield_10020.value || fields.customfield_10020;
    } else if (fields.customfield_10021) {
      roadmapStatus = fields.customfield_10021.value || fields.customfield_10021;
    }

    // Extract all custom fields dynamically
    const customFields = {};
    Object.keys(fields).forEach(fieldKey => {
      if (fieldKey.startsWith('customfield_')) {
        const fieldValue = fields[fieldKey];
        const fieldName = fieldNames[fieldKey] || fieldKey;
        
        // Handle different field types
        if (fieldValue === null || fieldValue === undefined) {
          return; // Skip null/undefined fields
        }
        
        if (Array.isArray(fieldValue)) {
          customFields[fieldKey] = {
            name: fieldName,
            value: fieldValue.map(v => v.name || v.value || v),
            raw: fieldValue
          };
        } else if (typeof fieldValue === 'object' && fieldValue !== null) {
          customFields[fieldKey] = {
            name: fieldName,
            value: fieldValue.name || fieldValue.value || fieldValue,
            raw: fieldValue
          };
        } else {
          customFields[fieldKey] = {
            name: fieldName,
            value: fieldValue,
            raw: fieldValue
          };
        }
      }
    });

    res.json({
      key: issue.key,
      id: issue.id,
      url: `${credentials.baseUrl.replace('/wiki', '')}/browse/${issue.key}`,
      summary: fields.summary,
      status: {
        name: fields.status?.name,
        category: fields.status?.statusCategory?.name,
        color: fields.status?.statusCategory?.colorName
      },
      assignee: fields.assignee ? {
        accountId: fields.assignee.accountId,
        displayName: fields.assignee.displayName,
        email: fields.assignee.emailAddress,
        avatarUrl: fields.assignee.avatarUrls?.['48x48']
      } : null,
      reporter: fields.reporter ? {
        accountId: fields.reporter.accountId,
        displayName: fields.reporter.displayName,
        email: fields.reporter.emailAddress,
        avatarUrl: fields.reporter.avatarUrls?.['48x48']
      } : null,
      priority: fields.priority ? {
        name: fields.priority.name,
        iconUrl: fields.priority.iconUrl
      } : null,
      issueType: fields.issuetype ? {
        name: fields.issuetype.name,
        iconUrl: fields.issuetype.iconUrl
      } : null,
      created: fields.created,
      updated: fields.updated,
      dueDate: fields.duedate,
      labels: fields.labels || [],
      components: fields.components?.map(c => c.name) || [],
      fixVersions: fields.fixVersions?.map(v => v.name) || [],
      resolution: fields.resolution?.name || null,
      epicKey: fields.customfield_10014, // Epic link field (may vary)
      roadmapStatus: roadmapStatus,
      customFields: customFields,
      allFields: fields // Include all fields for flexibility
    });
  } catch (error) {
    console.error('Error fetching Jira issue:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: 'Failed to fetch Jira issue',
      details: error.response?.data?.errorMessages?.join(', ') || error.message
    });
  }
});

// Get comments for a Jira issue
app.get('/api/jira/issue/:issueKey/comments', async (req, res) => {
  try {
    const { issueKey } = req.params;
    const credentials = getCredentialsFromRequest(req);
    const { jiraApi: userJiraApi } = createApiClients(credentials);
    
    const response = await userJiraApi.get(`/rest/api/3/issue/${issueKey}/comment`, {
      params: {
        expand: 'renderedBody'
      }
    });

    // Process comments and build thread structure
    const comments = response.data.comments.map(comment => ({
      id: comment.id,
      body: comment.body?.content || [],
      renderedBody: comment.renderedBody || '',
      author: {
        accountId: comment.author?.accountId,
        displayName: comment.author?.displayName,
        avatarUrl: comment.author?.avatarUrls?.['48x48']
      },
      created: comment.created,
      updated: comment.updated,
      parentId: comment.parent?.id || null, // Thread parent
      jsdPublic: comment.jsdPublic || false
    }));

    // Build thread structure (group by parent)
    const threadMap = new Map();
    const rootComments = [];
    
    comments.forEach(comment => {
      if (comment.parentId) {
        if (!threadMap.has(comment.parentId)) {
          threadMap.set(comment.parentId, []);
        }
        threadMap.get(comment.parentId).push(comment);
      } else {
        rootComments.push(comment);
      }
    });
    
    // Attach replies to their parents
    const buildThread = (comment) => {
      const replies = threadMap.get(comment.id) || [];
      return {
        ...comment,
        replies: replies.map(buildThread).sort((a, b) => new Date(a.created) - new Date(b.created))
      };
    };
    
    const threadedComments = rootComments.map(buildThread).sort((a, b) => new Date(b.created) - new Date(a.created));

    res.json({
      comments: threadedComments,
      total: comments.length
    });
  } catch (error) {
    console.error('Error fetching Jira comments:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: 'Failed to fetch comments',
      details: error.response?.data?.errorMessages?.join(', ') || error.message
    });
  }
});

// Post a comment to a Jira issue
app.post('/api/jira/issue/:issueKey/comment', async (req, res) => {
  try {
    const { issueKey } = req.params;
    const { body, mentions, parentId } = req.body; // mentions is array of { accountId, displayName }, parentId for threading

    if (!body || !body.trim()) {
      return res.status(400).json({
        error: 'Comment body is required'
      });
    }

    // Get credentials from request
    const credentials = getCredentialsFromRequest(req);
    const { jiraApi: userJiraApi } = createApiClients(credentials);

    // Always use parseMentionsToADF to handle mentions and URLs, even if mentions array is empty
    // This ensures URLs are converted to links
    const content = parseMentionsToADF(body, mentions || []);

    // Log the comment payload for debugging
    const commentPayload = {
      type: 'doc',
      version: 1,
      content: [
        {
          type: 'paragraph',
          content: content
        }
      ]
    };
    
    // Note: Jira REST API v3 does not currently support threaded comments via the parent field
    // The parent field causes INVALID_INPUT errors
    // Threading support may be available in future API versions or through different endpoints
    // For now, we'll post as a regular comment
    // TODO: Re-enable threading when Jira API supports it
    // if (parentId) {
    //   commentPayload.parent = {
    //     id: parentId
    //   };
    // }
    
    console.log('Posting Jira comment with payload:', JSON.stringify(commentPayload, null, 2));
    console.log('Mentions array:', JSON.stringify(mentions, null, 2));
    if (parentId) {
      console.log('Note: parentId provided but threading not supported by Jira API v3');
    }
    
    const response = await userJiraApi.post(`/rest/api/3/issue/${issueKey}/comment`, {
      body: commentPayload
    });

    res.json({
      success: true,
      comment: {
        id: response.data.id,
        body: response.data.body
      }
    });
  } catch (error) {
    console.error('Error posting Jira comment:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: 'Failed to post comment',
      details: error.response?.data?.errorMessages?.join(', ') || error.message
    });
  }
});

const DOC_TICKET_PROJECT_KEY = process.env.RELEASENOTES_DOC_PROJECT_KEY || 'DOC';

/** Plain text → minimal Jira Cloud ADF for issue description. */
function plainTextToJiraDescriptionAdf(rawText) {
  const maxTotal = 24000;
  let t = String(rawText || '').trim();
  if (!t) t = '(No Confluence body captured)';
  if (t.length > maxTotal) {
    t = `${t.slice(0, maxTotal)}\n\n… (truncated for Jira size limit)`;
  }
  const paragraphs = t
    .split(/\n{2,}/)
    .map((s) => s.replace(/\n+/g, ' ').trim())
    .filter(Boolean);
  const blocks = (paragraphs.length ? paragraphs : ['(empty)']).map((text) => ({
    type: 'paragraph',
    content: [{ type: 'text', text: text.length > 8000 ? `${text.slice(0, 8000)}…` : text }]
  }));
  return { type: 'doc', version: 1, content: blocks };
}

function scoreRelatesLikeLinkType(lt) {
  const name = (lt.name || '').toLowerCase();
  const inward = (lt.inward || '').toLowerCase();
  const outward = (lt.outward || '').toLowerCase();
  if (name === 'relates') return 100;
  if (name === 'relates to' || name === 'related') return 95;
  if (/relat/.test(name)) return 88;
  if (/relat/.test(inward) || /relat/.test(outward)) return 75;
  return 0;
}

/**
 * Link DOC issue ↔ reference Jira issue (cross-project).
 * Uses GET /rest/api/3/issueLinkType so we send the exact `id` Jira expects (names differ per site).
 * Jira requires "Link issues" on the outward issue's project — we try both inward/outward orderings.
 * @see https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-links/#api-rest-api-3-issuelink-post
 */
async function postJiraRelatesLink(jiraApi, docKey, referenceKey, preloadedLinkTypes = null) {
  let allTypes = preloadedLinkTypes;
  if (!Array.isArray(allTypes) || allTypes.length === 0) {
    try {
      const listRes = await jiraApi.get('/rest/api/3/issueLinkType');
      allTypes = listRes.data?.issueLinkTypes || [];
    } catch (e) {
      return {
        ok: false,
        error: `Could not list issue link types: ${e.response?.data?.errorMessages?.join('; ') || e.message}`
      };
    }
  }

  const configured = process.env.RELEASENOTES_DOC_RELATES_LINK_TYPE;
  let orderedTypes = [];
  if (configured) {
    const wanted = configured.split(',').map((s) => s.trim()).filter(Boolean);
    for (const w of wanted) {
      const wl = w.toLowerCase();
      const found = allTypes.find(
        (t) =>
          String(t.id) === w ||
          (t.name && t.name.toLowerCase() === wl) ||
          (t.name && t.name.toLowerCase().includes(wl))
      );
      if (found && !orderedTypes.find((x) => x.id === found.id)) orderedTypes.push(found);
    }
  }
  if (orderedTypes.length === 0) {
    const ranked = [...allTypes]
      .map((t) => ({ t, s: scoreRelatesLikeLinkType(t) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.t);
    orderedTypes = ranked;
  }
  if (orderedTypes.length === 0) {
    const names = allTypes.map((t) => t.name).filter(Boolean);
    return {
      ok: false,
      error: `No relates-like issue link type found on this Jira site. Available types: ${names.join(', ') || '(none)'}. Set RELEASENOTES_DOC_RELATES_LINK_TYPE to the exact type name or numeric id.`
    };
  }

  const orders = [
    { inwardIssue: { key: docKey }, outwardIssue: { key: referenceKey } },
    { inwardIssue: { key: referenceKey }, outwardIssue: { key: docKey } }
  ];

  const typePayloadsFor = (lt) => {
    const out = [];
    if (lt.id != null && lt.id !== '') out.push({ id: String(lt.id) });
    if (lt.name) out.push({ name: lt.name });
    return out;
  };

  let lastErr = null;
  for (const lt of orderedTypes) {
    for (const typePayload of typePayloadsFor(lt)) {
      for (const sides of orders) {
        try {
          await jiraApi.post('/rest/api/3/issueLink', {
            type: typePayload,
            ...sides
          });
          return { ok: true, linkType: lt.name, linkTypeId: lt.id != null ? String(lt.id) : undefined };
        } catch (err) {
          lastErr = err;
        }
      }
    }
  }

  const names = allTypes.map((t) => t.name).filter(Boolean);
  const msg =
    lastErr?.response?.data?.errorMessages?.join('; ') ||
    (lastErr?.response?.data?.errors && JSON.stringify(lastErr.response.data.errors)) ||
    lastErr?.message ||
    'Link failed';
  const hint =
    names.length > 0
      ? ` Known link types on this site: ${names.slice(0, 25).join(', ')}${names.length > 25 ? '…' : ''}. Set RELEASENOTES_DOC_RELATES_LINK_TYPE to an exact name or id if needed.`
      : '';
  return { ok: false, error: (typeof msg === 'string' ? msg : String(msg)) + hint };
}

/**
 * Create DOC Story from release note page; link to reference Jira (e.g. CPPL-462) with "Relates" (no parent — cross-project safe).
 * POST body: { pageIds: string[] } — max 25; each page must resolve a reference issue key from Confluence body/title.
 */
app.post('/api/jira/create-doc-tickets', async (req, res) => {
  try {
    const credentials = getCredentialsFromRequest(req);
    if (!credentials || !credentials.email || !credentials.token) {
      return res.status(401).json({ error: 'Atlassian credentials required' });
    }
    const rawIds = Array.isArray(req.body?.pageIds) ? req.body.pageIds : [];
    const pageIds = [...new Set(rawIds.map(String).filter(Boolean))].slice(0, 25);
    if (pageIds.length === 0) {
      return res.status(400).json({ error: 'pageIds must be a non-empty array' });
    }

    const { confluenceApi, jiraApi: userJiraApi } = createApiClients(credentials);
    const jiraBaseUrl = credentials.baseUrl.replace(/\/wiki\/?$/, '');

    let myself;
    try {
      const meRes = await userJiraApi.get('/rest/api/3/myself');
      myself = meRes.data;
    } catch (e) {
      return res.status(401).json({
        error: 'Could not load Jira profile',
        details: e.response?.data?.message || e.message
      });
    }
    const accountId = myself.accountId;
    if (!accountId) {
      return res.status(500).json({ error: 'Jira /myself returned no accountId' });
    }

    let issueLinkTypes = null;
    try {
      const ltRes = await userJiraApi.get('/rest/api/3/issueLinkType');
      issueLinkTypes = ltRes.data?.issueLinkTypes || [];
    } catch (e) {
      console.warn('[create-doc-tickets] Could not prefetch issue link types:', e.message);
    }

    const results = [];

    for (const pageId of pageIds) {
      try {
        const currentPage = await confluenceApi.get(`/rest/api/content/${pageId}`, {
          params: { expand: 'body.storage,title' }
        });
        const bodyContent = currentPage.data.body?.storage?.value || '';
        const pageTitle = currentPage.data.title || '';
        const referenceKey =
          extractJiraTicket(bodyContent) || extractJiraTicketFromTitle(pageTitle);
        if (!referenceKey) {
          results.push({
            pageId,
            ok: false,
            error: 'No Jira reference key found on this Confluence page (body or title)'
          });
          continue;
        }

        let descriptionAdf;
        try {
          descriptionAdf = confluenceStorageHtmlToJiraAdf(bodyContent);
        } catch (convErr) {
          console.warn('[create-doc-tickets] Rich ADF from Confluence HTML failed, using plain text:', convErr.message);
          descriptionAdf = plainTextToJiraDescriptionAdf(convertConfluenceToText(bodyContent));
        }
        const summary = `RELNOTE - ${referenceKey}`;

        const baseFields = {
          project: { key: DOC_TICKET_PROJECT_KEY },
          summary,
          description: descriptionAdf,
          assignee: { accountId }
        };

        const attempts = [
          ['Story', true],
          ['Story', false]
        ];
        let created = null;
        let issueTypeUsed = null;
        let lastErr = null;
        for (const [typeName, useReporter] of attempts) {
          const fields = {
            ...baseFields,
            issuetype: { name: typeName }
          };
          if (useReporter) {
            fields.reporter = { accountId };
          }
          try {
            const issueRes = await userJiraApi.post('/rest/api/3/issue', { fields });
            created = issueRes.data;
            issueTypeUsed = typeName;
            break;
          } catch (err) {
            lastErr = err;
          }
        }
        if (!created) {
          const msg =
            lastErr?.response?.data?.errors &&
            Object.keys(lastErr.response.data.errors).length
              ? JSON.stringify(lastErr.response.data.errors)
              : lastErr?.response?.data?.errorMessages?.join('; ') ||
                lastErr?.message ||
                'Create failed';
          results.push({ pageId, ok: false, referenceKey, error: msg });
          continue;
        }

        const key = created.key;
        const linkResult = await postJiraRelatesLink(userJiraApi, key, referenceKey, issueLinkTypes);
        results.push({
          pageId,
          ok: true,
          referenceKey,
          parentKey: referenceKey,
          docKey: key,
          jiraUrl: key ? `${jiraBaseUrl}/browse/${key}` : null,
          issueTypeUsed,
          relatedLinkOk: linkResult.ok,
          relatedLinkType: linkResult.ok ? linkResult.linkType : undefined,
          linkError: linkResult.ok ? undefined : linkResult.error
        });
      } catch (err) {
        results.push({
          pageId,
          ok: false,
          error: err.response?.data?.message || err.message || 'Request failed'
        });
      }
    }

    const okCount = results.filter((r) => r.ok).length;
    res.json({
      ok: okCount > 0 || results.every((r) => r.ok),
      results,
      summary: { created: okCount, failed: results.length - okCount }
    });
  } catch (error) {
    console.error('Error in create-doc-tickets:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: 'Failed to create DOC tickets',
      details: error.response?.data?.message || error.message
    });
  }
});

// Get current user information
app.get('/api/user/current', async (req, res) => {
  try {
    const credentials = getCredentialsFromRequest(req);
    const { jiraApi: userJiraApi } = createApiClients(credentials);
    
    // Get current user from Jira API
    const response = await userJiraApi.get('/rest/api/3/myself');
    
    res.json({
      accountId: response.data.accountId,
      displayName: response.data.displayName,
      email: response.data.emailAddress,
      avatarUrl: response.data.avatarUrls?.['48x48'] || null
    });
  } catch (error) {
    console.error('Error fetching current user:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: 'Failed to fetch current user',
      details: error.response?.data?.errorMessages?.join(', ') || error.message
    });
  }
});

// Get pages assigned to current user (My Tasks) - uses local assignments from client
app.get('/api/pages/my-tasks', async (req, res) => {
  try {
    const credentials = getCredentialsFromRequest(req);
    const { confluenceApi, jiraApi } = createApiClients(credentials);
    
    // Get assigned page IDs from request (sent from client's localStorage)
    const assignedPageIds = req.query.assignedPageIds 
      ? JSON.parse(req.query.assignedPageIds) 
      : [];
    
    if (assignedPageIds.length === 0) {
      return res.json({
        pages: [],
        pagesByStatus: {},
        total: 0
      });
    }
    
    // Get all pages across all statuses
    const allPages = [];
    const globalFieldNames = await getJiraFieldNames(jiraApi);

    for (const [statusKey, status] of Object.entries(PAGE_STATUSES)) {
      try {
        const pageIdMap = {
          draft: req.headers['x-draft-page-id'] || PAGE_STATUSES.draft.pageId,
          inProgress: req.headers['x-in-progress-page-id'] || PAGE_STATUSES.inProgress.pageId,
          needsAction: req.headers['x-needs-action-page-id'] || PAGE_STATUSES.needsAction.pageId,
          published: req.headers['x-published-page-id'] || PAGE_STATUSES.published.pageId,
          discard: req.headers['x-discard-page-id'] || PAGE_STATUSES.discard.pageId
        };
        
        const parentPageId = pageIdMap[statusKey] || status.pageId;
        
        const response = await confluenceApi.get(`/rest/api/content/${parentPageId}/child/page`, {
          params: {
            expand: 'version,history,metadata.labels,body.storage',
            limit: 100
          }
        });

        for (const page of response.data.results) {
          // Only include pages that are in the assigned list
          if (assignedPageIds.includes(page.id)) {
            const bodyContent = page.body?.storage?.value || '';
            const jiraTicket = extractJiraTicket(bodyContent) || extractJiraTicketFromTitle(page.title);
            let jiraAssignee = null;
            let jiraMetadataPills = [];
            let launchDatesForAll = null;
            let targetedLaunchDateForAll = null;
            let actualLaunchDateForAll = null;
            let targetedLaunchDateRawForAll = null;
            let actualLaunchDateRawForAll = null;
            let educationProjectStatusForAll = null;
            if (jiraTicket && jiraApi) {
              try {
                const jiraResponse = await jiraApi.get(`/rest/api/3/issue/${jiraTicket}`, {
                  params: { expand: 'names' }
                });
                const fields = jiraResponse.data?.fields;
                const fieldNames = jiraResponse.data?.names || {};
                if (fields) {
                  const assignee = fields.assignee;
                  if (assignee) {
                    jiraAssignee = {
                      displayName: assignee.displayName,
                      email: assignee.emailAddress,
                      avatarUrl: assignee.avatarUrls?.['48x48'] || assignee.avatarUrls?.['24x24']
                    };
                  }
                  jiraMetadataPills = extractJiraMetadataPills(fields, fieldNames, globalFieldNames);
                  const extracted = extractLaunchDatesAndEducationStatus(fields, fieldNames, globalFieldNames);
                  launchDatesForAll = extracted.launchDates;
                  targetedLaunchDateForAll = extracted.targetedLaunchDate;
                  actualLaunchDateForAll = extracted.actualLaunchDate;
                  targetedLaunchDateRawForAll = extracted.targetedLaunchDateRaw;
                  actualLaunchDateRawForAll = extracted.actualLaunchDateRaw;
                  educationProjectStatusForAll = extracted.educationProjectStatus;
                }
              } catch (e) {
                // Silently fail
              }
            }
            const fixVersions = (jiraMetadataPills.find(p => p.label === 'Fix Version')?.values) || null;

            // Get last comment
            let lastComment = null;
            let commentCount = 0;
            
            try {
              const commentsResponse = await confluenceApi.get(`/rest/api/content/${page.id}/child/comment`, {
                params: {
                  expand: 'version,history',
                  limit: 1,
                  order: 'desc'
                }
              });
              
              commentCount = commentsResponse.data.size || 0;
              if (commentsResponse.data.results && commentsResponse.data.results.length > 0) {
                const comment = commentsResponse.data.results[0];
                lastComment = {
                  id: comment.id,
                  date: comment.version?.when || comment.history?.createdDate,
                  author: comment.version?.by?.displayName || comment.history?.createdBy?.displayName
                };
              }
            } catch (e) {
              // Silently fail for comments
            }

            const createdDate = page.history?.createdDate;
            const lastModified = page.version?.when;
            
            let lastActivityDate = lastModified;
            if (lastComment && lastComment.date) {
              const commentDate = new Date(lastComment.date);
              const modifiedDate = new Date(lastModified);
              if (commentDate > modifiedDate) {
                lastActivityDate = lastComment.date;
              }
            }

            allPages.push({
              id: page.id,
              title: page.title,
              url: `${credentials.baseUrl}${page._links.webui}`,
              status: statusKey,
              createdDate,
              createdDaysAgo: daysAgo(createdDate),
              lastModified,
              lastModifiedDaysAgo: daysAgo(lastModified),
              lastActivityDate,
              lastActivityDaysAgo: daysAgo(lastActivityDate),
              lastComment,
              lastCommentDaysAgo: lastComment ? daysAgo(lastComment.date) : null,
              commentCount,
              version: page.version?.number,
              author: page.history?.createdBy?.displayName,
              labels: page.metadata?.labels?.results?.map(l => l.name) || [],
              isStale: status.staleThreshold 
                ? daysAgo(lastActivityDate) >= status.staleThreshold 
                : false,
              jiraTicket: jiraTicket,
              jiraUrl: jiraTicket ? `${credentials.baseUrl.replace('/wiki', '')}/browse/${jiraTicket}` : null,
              jiraAssignee: jiraAssignee,
              fixVersions: fixVersions || null,
              jiraMetadataPills: jiraMetadataPills,
              launchDates: launchDatesForAll,
              targetedLaunchDate: targetedLaunchDateForAll,
              actualLaunchDate: actualLaunchDateForAll,
              targetedLaunchDateRaw: targetedLaunchDateRawForAll,
              actualLaunchDateRaw: actualLaunchDateRawForAll,
              educationProjectStatus: educationProjectStatusForAll
            });
          }
        }
      } catch (e) {
        // Only log if it's not a credentials error (401) - those are expected when credentials aren't set
        const errorMsg = e.message || e.response?.statusText || String(e);
        const isAuthError = e.response?.status === 401 || 
                           errorMsg.includes('401') || 
                           errorMsg.includes('Missing Atlassian credentials') ||
                           errorMsg.includes('Unauthorized');
        if (!isAuthError) {
          console.log(`Could not fetch pages for status ${statusKey}:`, errorMsg);
        }
      }
    }

    // Group pages by status
    const pagesByStatus = {};
    for (const [statusKey] of Object.entries(PAGE_STATUSES)) {
      pagesByStatus[statusKey] = allPages.filter(p => p.status === statusKey);
    }

    res.json({
      pages: allPages,
      pagesByStatus,
      total: allPages.length
    });
  } catch (error) {
    console.error('Error fetching my tasks:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: 'Failed to fetch my tasks',
      details: error.response?.data?.message || error.message
    });
  }
});

// Search for users (for @mentions)
app.get('/api/users/search', async (req, res) => {
  try {
    const query = req.query.q || '';
    
    if (query.length < 2) {
      return res.json({ users: [] });
    }

    // Get credentials and create API clients
    const credentials = getCredentialsFromRequest(req);
    const { confluenceApi, jiraApi } = createApiClients(credentials);

    // Try multiple API approaches since Atlassian has different endpoints
    const approaches = [
      // Approach 1: Atlassian user picker API (most reliable for @mentions)
      async () => {
        const response = await jiraApi.get('/rest/api/3/user/picker', {
          params: {
            query: query,
            maxResults: 10
          }
        });
        return response.data.users?.map(user => ({
          accountId: user.accountId,
          displayName: user.displayName,
          email: user.emailAddress || null,
          avatarUrl: user.avatarUrl || null
        })) || [];
      },
      
      // Approach 2: Jira user search
      async () => {
        const response = await jiraApi.get('/rest/api/3/user/search', {
          params: {
            query: query,
            maxResults: 10
          }
        });
        return response.data?.map(user => ({
          accountId: user.accountId,
          displayName: user.displayName,
          email: user.emailAddress || null,
          avatarUrl: user.avatarUrls?.['48x48'] || null
        })) || [];
      },
      
      // Approach 3: Confluence user search with CQL
      async () => {
        const response = await confluenceApi.get('/rest/api/search', {
          params: {
            cql: `type=user AND (user.fullname~"${query}" OR title~"${query}")`,
            limit: 10
          }
        });
        return response.data.results?.map(result => ({
          accountId: result.user?.accountId,
          displayName: result.user?.displayName || result.title,
          email: result.user?.email || null,
          avatarUrl: result.user?.profilePicture?.path 
            ? `${credentials.baseUrl}${result.user.profilePicture.path}`
            : null
        })).filter(u => u.accountId) || [];
      },

      // Approach 4: Atlassian user search (assignable users)
      async () => {
        const response = await jiraApi.get('/rest/api/3/user/assignable/search', {
          params: {
            query: query,
            maxResults: 10
          }
        });
        return response.data?.map(user => ({
          accountId: user.accountId,
          displayName: user.displayName,
          email: user.emailAddress || null,
          avatarUrl: user.avatarUrls?.['48x48'] || null
        })) || [];
      }
    ];

    for (let i = 0; i < approaches.length; i++) {
      try {
        const users = await approaches[i]();
        if (users && users.length > 0) {
          console.log(`User search succeeded with approach ${i + 1}`);
          return res.json({ users });
        }
      } catch (error) {
        console.log(`User search approach ${i + 1} failed:`, error.response?.status, error.response?.data?.message || error.message);
        // Continue to next approach
      }
    }

    // If all approaches fail, return empty
    console.log('All user search approaches failed for query:', query);
    res.json({ users: [], message: 'User search not available' });
  } catch (error) {
    console.error('Error in user search:', error.message);
    res.status(500).json({ users: [], error: error.message });
  }
});

// Get a specific page's details
app.get('/api/pages/:pageId', async (req, res) => {
  try {
    const { pageId } = req.params;
    const credentials = getCredentialsFromRequest(req);
    const { confluenceApi } = createApiClients(credentials);
    
    const response = await confluenceApi.get(`/rest/api/content/${pageId}`, {
      params: {
        expand: 'version,history,body.view,metadata.labels,ancestors'
      }
    });

    const page = response.data;
    
    // Determine current status based on parent
    let currentStatus = null;
    if (page.ancestors && page.ancestors.length > 0) {
      const parentId = page.ancestors[page.ancestors.length - 1].id;
      for (const [key, status] of Object.entries(PAGE_STATUSES)) {
        if (status.pageId === parentId) {
          currentStatus = key;
          break;
        }
      }
    }
    
    res.json({
      id: page.id,
      title: page.title,
      url: `${credentials.baseUrl}${page._links.webui}`,
      body: page.body?.view?.value,
      status: currentStatus,
      createdDate: page.history?.createdDate,
      createdDaysAgo: daysAgo(page.history?.createdDate),
      lastModified: page.version?.when,
      lastModifiedDaysAgo: daysAgo(page.version?.when),
      version: page.version?.number,
      author: page.history?.createdBy?.displayName,
      labels: page.metadata?.labels?.results?.map(l => l.name) || [],
      ancestors: page.ancestors?.map(a => ({ id: a.id, title: a.title })) || []
    });
  } catch (error) {
    console.error('Error fetching page:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: 'Failed to fetch page',
      details: error.response?.data?.message || error.message
    });
  }
});

// --- Page notes (local app-only notes per page) ---
const NOTES_FILE = path.join(__dirname, 'data', 'page-notes.json');

function readPageNotes() {
  try {
    const dir = path.dirname(NOTES_FILE);
    if (!fs.existsSync(dir)) return {};
    if (!fs.existsSync(NOTES_FILE)) return {};
    const raw = fs.readFileSync(NOTES_FILE, 'utf8');
    const data = JSON.parse(raw);
    return typeof data === 'object' && data !== null ? data : {};
  } catch (e) {
    return {};
  }
}

function writePageNotes(data) {
  try {
    const dir = path.dirname(NOTES_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(NOTES_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('Failed to write page notes:', e);
    throw e;
  }
}

app.get('/api/pages/:pageId/notes', (req, res) => {
  try {
    const { pageId } = req.params;
    const notes = readPageNotes();
    const entry = notes[pageId];
    if (!entry || (entry.text === undefined && entry.updatedAt === undefined)) {
      return res.json({ text: '', updatedAt: null });
    }
    res.json({
      text: entry.text || '',
      updatedAt: entry.updatedAt || null
    });
  } catch (e) {
    console.error('Error reading page notes:', e);
    res.status(500).json({ error: 'Failed to load notes' });
  }
});

app.put('/api/pages/:pageId/notes', (req, res) => {
  try {
    const { pageId } = req.params;
    const { text } = req.body || {};
    const notes = readPageNotes();
    const updatedAt = new Date().toISOString();
    notes[pageId] = { text: String(text ?? '').trim(), updatedAt };
    writePageNotes(notes);
    res.json({
      text: notes[pageId].text,
      updatedAt: notes[pageId].updatedAt
    });
  } catch (e) {
    console.error('Error saving page notes:', e);
    res.status(500).json({ error: 'Failed to save notes' });
  }
});

app.get('/api/notes/summary', (req, res) => {
  try {
    const notes = readPageNotes();
    const summary = {};
    for (const [pageId, entry] of Object.entries(notes)) {
      if (entry && (entry.text != null && String(entry.text).trim() !== '')) {
        summary[pageId] = { hasNotes: true, updatedAt: entry.updatedAt || null };
      }
    }
    res.json(summary);
  } catch (e) {
    console.error('Error reading notes summary:', e);
    res.status(500).json({});
  }
});

// Get page content for LaunchNotes import
app.get('/api/pages/:pageId/content', async (req, res) => {
  try {
    const { pageId } = req.params;
    const credentials = getCredentialsFromRequest(req);
    const { confluenceApi } = createApiClients(credentials);
    
    const response = await confluenceApi.get(`/rest/api/content/${pageId}`, {
      params: {
        expand: 'body.storage,body.view,version,history'
      }
    });
    
    const page = response.data;
    const bodyStorage = page.body?.storage?.value || '';
    const bodyView = page.body?.view?.value || '';
    
    res.json({
      id: page.id,
      title: page.title,
      bodyStorage: bodyStorage,
      bodyView: bodyView,
      version: page.version?.number,
      created: page.history?.createdDate,
      modified: page.version?.when,
      author: page.history?.createdBy?.displayName,
      url: `${credentials.baseUrl}${page._links.webui}`
    });
  } catch (error) {
    console.error('Error fetching page content:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: 'Failed to fetch page content',
      details: error.response?.data?.message || error.message
    });
  }
});

// Get available sections/blocks from a Confluence page for section selection
app.get('/api/pages/:pageId/sections', async (req, res) => {
  try {
    const { pageId } = req.params;
    const credentials = getCredentialsFromRequest(req);
    const { confluenceApi } = createApiClients(credentials);
    const response = await confluenceApi.get(`/rest/api/content/${pageId}`, {
      params: { expand: 'body.storage,version,history' }
    });
    const page = response.data;
    const htmlContent = page.body?.storage?.value || '';
    
    if (!htmlContent) {
      return res.json({ sections: [] });
    }

    // Parse HTML to extract sections/blocks
    const sections = [];
    
    // Remove Confluence-specific macros
    let html = htmlContent
      .replace(/<ac:structured-macro[^>]*>[\s\S]*?<\/ac:structured-macro>/gi, '')
      .replace(/<ac:inline-comment-marker[^>]*>[\s\S]*?<\/ac:inline-comment-marker>/gi, '')
      .replace(/<ac:parameter[^>]*>[\s\S]*?<\/ac:parameter>/gi, '')
      .replace(/<ac:[^>]*>/gi, '')
      .replace(/<\/ac:[^>]*>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '');

    // Extract headings
    const headingRegex = /<(h[1-6])[^>]*>([\s\S]*?)<\/h[1-6]>/gi;
    let headingMatch;
    let sectionIndex = 0;
    
    while ((headingMatch = headingRegex.exec(html)) !== null) {
      const level = parseInt(headingMatch[1].substring(1));
      const headingText = headingMatch[2].replace(/<[^>]+>/g, '').trim();
      if (headingText) {
        sections.push({
          id: `section-${sectionIndex++}`,
          type: 'heading',
          level: level,
          title: headingText,
          startIndex: headingMatch.index,
          endIndex: headingMatch.index + headingMatch[0].length
        });
      }
    }

    // Extract paragraphs (grouped by headings)
    const paraRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
    let paraMatch;
    while ((paraMatch = paraRegex.exec(html)) !== null) {
      const paraText = paraMatch[1].replace(/<[^>]+>/g, '').trim();
      if (paraText && paraText.length > 20) { // Only include substantial paragraphs
        sections.push({
          id: `section-${sectionIndex++}`,
          type: 'paragraph',
          title: paraText.substring(0, 100) + (paraText.length > 100 ? '...' : ''),
          startIndex: paraMatch.index,
          endIndex: paraMatch.index + paraMatch[0].length
        });
      }
    }

    // Extract lists
    const listRegex = /<(ul|ol)[^>]*>([\s\S]*?)<\/(ul|ol)>/gi;
    let listMatch;
    while ((listMatch = listRegex.exec(html)) !== null) {
      const listText = listMatch[2].replace(/<[^>]+>/g, '').trim();
      if (listText) {
        sections.push({
          id: `section-${sectionIndex++}`,
          type: listMatch[1] === 'ul' ? 'bulletList' : 'orderedList',
          title: listText.substring(0, 100) + (listText.length > 100 ? '...' : ''),
          startIndex: listMatch.index,
          endIndex: listMatch.index + listMatch[0].length
        });
      }
    }

    // Sort sections by position in document
    sections.sort((a, b) => a.startIndex - b.startIndex);

    res.json({ sections });
  } catch (error) {
    console.error('Error fetching page sections:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: 'Failed to fetch page sections',
      details: error.response?.data?.message || error.message
    });
  }
});

// Helper function to convert Confluence storage format to plain text
function convertConfluenceToText(htmlContent) {
  if (!htmlContent) return '';
  
  let text = htmlContent;
  
  // Remove Confluence-specific macros and their content
  text = text.replace(/<ac:structured-macro[^>]*>[\s\S]*?<\/ac:structured-macro>/gi, '');
  text = text.replace(/<ac:inline-comment-marker[^>]*>[\s\S]*?<\/ac:inline-comment-marker>/gi, '');
  text = text.replace(/<ac:parameter[^>]*>[\s\S]*?<\/ac:parameter>/gi, '');
  
  // Remove other Confluence-specific tags but keep their text content
  text = text.replace(/<ac:[^>]*>/gi, '');
  text = text.replace(/<\/ac:[^>]*>/gi, '');
  
  // Remove HTML comments
  text = text.replace(/<!--[\s\S]*?-->/g, '');
  
  // Convert headings
  text = text.replace(/<h1[^>]*>/gi, '\n\n# ');
  text = text.replace(/<h2[^>]*>/gi, '\n\n## ');
  text = text.replace(/<h3[^>]*>/gi, '\n\n### ');
  text = text.replace(/<h4[^>]*>/gi, '\n\n#### ');
  text = text.replace(/<h5[^>]*>/gi, '\n\n##### ');
  text = text.replace(/<h6[^>]*>/gi, '\n\n###### ');
  text = text.replace(/<\/h[1-6]>/gi, '\n');
  
  // Convert paragraphs
  text = text.replace(/<p[^>]*>/gi, '\n\n');
  text = text.replace(/<\/p>/gi, '');
  
  // Convert line breaks
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<hr[^>]*>/gi, '\n\n---\n\n');
  
  // Convert lists
  text = text.replace(/<ul[^>]*>/gi, '\n');
  text = text.replace(/<\/ul>/gi, '\n');
  text = text.replace(/<ol[^>]*>/gi, '\n');
  text = text.replace(/<\/ol>/gi, '\n');
  text = text.replace(/<li[^>]*>/gi, '• ');
  text = text.replace(/<\/li>/gi, '\n');
  
  // Convert emphasis
  text = text.replace(/<strong[^>]*>/gi, '**');
  text = text.replace(/<\/strong>/gi, '**');
  text = text.replace(/<b[^>]*>/gi, '**');
  text = text.replace(/<\/b>/gi, '**');
  text = text.replace(/<em[^>]*>/gi, '*');
  text = text.replace(/<\/em>/gi, '*');
  text = text.replace(/<i[^>]*>/gi, '*');
  text = text.replace(/<\/i>/gi, '*');
  
  // Convert links - extract href and text
  text = text.replace(/<a[^>]*href=["']([^"']+)["'][^>]*>([^<]*)<\/a>/gi, '$2 ($1)');
  text = text.replace(/<a[^>]*>([^<]*)<\/a>/gi, '$1');
  
  // Convert code blocks
  text = text.replace(/<pre[^>]*>/gi, '\n```\n');
  text = text.replace(/<\/pre>/gi, '\n```\n');
  text = text.replace(/<code[^>]*>/gi, '`');
  text = text.replace(/<\/code>/gi, '`');
  
  // Remove all remaining HTML tags
  text = text.replace(/<[^>]+>/g, '');
  
  // Decode HTML entities
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&trade;/g, '™');
  text = text.replace(/&copy;/g, '©');
  text = text.replace(/&reg;/g, '®');
  
  // Clean up whitespace
  text = text.replace(/\n{3,}/g, '\n\n'); // Max 2 consecutive newlines
  text = text.replace(/[ \t]+/g, ' '); // Multiple spaces to single space
  text = text.replace(/^\s+|\s+$/gm, ''); // Trim each line
  
  return text.trim();
}

// Helper function to convert Confluence storage format to plain text
function convertConfluenceToText(htmlContent) {
  if (!htmlContent) return '';
  
  let text = htmlContent;
  
  // Remove Confluence-specific macros and their content
  text = text.replace(/<ac:structured-macro[^>]*>[\s\S]*?<\/ac:structured-macro>/gi, '');
  text = text.replace(/<ac:inline-comment-marker[^>]*>[\s\S]*?<\/ac:inline-comment-marker>/gi, '');
  text = text.replace(/<ac:parameter[^>]*>[\s\S]*?<\/ac:parameter>/gi, '');
  
  // Remove other Confluence-specific tags but keep their text content
  text = text.replace(/<ac:[^>]*>/gi, '');
  text = text.replace(/<\/ac:[^>]*>/gi, '');
  
  // Remove HTML comments
  text = text.replace(/<!--[\s\S]*?-->/g, '');
  
  // Convert headings
  text = text.replace(/<h1[^>]*>/gi, '\n\n# ');
  text = text.replace(/<h2[^>]*>/gi, '\n\n## ');
  text = text.replace(/<h3[^>]*>/gi, '\n\n### ');
  text = text.replace(/<h4[^>]*>/gi, '\n\n#### ');
  text = text.replace(/<h5[^>]*>/gi, '\n\n##### ');
  text = text.replace(/<h6[^>]*>/gi, '\n\n###### ');
  text = text.replace(/<\/h[1-6]>/gi, '\n');
  
  // Convert paragraphs
  text = text.replace(/<p[^>]*>/gi, '\n\n');
  text = text.replace(/<\/p>/gi, '');
  
  // Convert line breaks
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<hr[^>]*>/gi, '\n\n---\n\n');
  
  // Convert lists
  text = text.replace(/<ul[^>]*>/gi, '\n');
  text = text.replace(/<\/ul>/gi, '\n');
  text = text.replace(/<ol[^>]*>/gi, '\n');
  text = text.replace(/<\/ol>/gi, '\n');
  text = text.replace(/<li[^>]*>/gi, '• ');
  text = text.replace(/<\/li>/gi, '\n');
  
  // Convert emphasis
  text = text.replace(/<strong[^>]*>/gi, '**');
  text = text.replace(/<\/strong>/gi, '**');
  text = text.replace(/<b[^>]*>/gi, '**');
  text = text.replace(/<\/b>/gi, '**');
  text = text.replace(/<em[^>]*>/gi, '*');
  text = text.replace(/<\/em>/gi, '*');
  text = text.replace(/<i[^>]*>/gi, '*');
  text = text.replace(/<\/i>/gi, '*');
  
  // Convert links - extract href and text
  text = text.replace(/<a[^>]*href=["']([^"']+)["'][^>]*>([^<]*)<\/a>/gi, '$2 ($1)');
  text = text.replace(/<a[^>]*>([^<]*)<\/a>/gi, '$1');
  
  // Convert code blocks
  text = text.replace(/<pre[^>]*>/gi, '\n```\n');
  text = text.replace(/<\/pre>/gi, '\n```\n');
  text = text.replace(/<code[^>]*>/gi, '`');
  text = text.replace(/<\/code>/gi, '`');
  
  // Remove all remaining HTML tags
  text = text.replace(/<[^>]+>/g, '');
  
  // Decode HTML entities
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&trade;/g, '™');
  text = text.replace(/&copy;/g, '©');
  text = text.replace(/&reg;/g, '®');
  
  // Clean up whitespace
  text = text.replace(/\n{3,}/g, '\n\n'); // Max 2 consecutive newlines
  text = text.replace(/[ \t]+/g, ' '); // Multiple spaces to single space
  text = text.replace(/^\s+|\s+$/gm, ''); // Trim each line
  
  return text.trim();
}

// Helper function to convert Confluence HTML to LaunchNotes structured JSON format
function convertConfluenceToStructuredJSON(htmlContent) {
  if (!htmlContent) {
    return {
      type: 'doc',
      content: []
    };
  }

  // Remove Confluence-specific macros and their content
  let html = htmlContent
    .replace(/<ac:structured-macro[^>]*>[\s\S]*?<\/ac:structured-macro>/gi, '')
    .replace(/<ac:inline-comment-marker[^>]*>[\s\S]*?<\/ac:inline-comment-marker>/gi, '')
    .replace(/<ac:parameter[^>]*>[\s\S]*?<\/ac:parameter>/gi, '')
    .replace(/<ac:[^>]*>/gi, '')
    .replace(/<\/ac:[^>]*>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');

  const content = [];
  let currentIndex = 0;

  // Helper to decode HTML entities
  function decodeEntities(text) {
    return text
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&trade;/g, '™')
      .replace(/&copy;/g, '©')
      .replace(/&reg;/g, '®');
  }

  // Helper to parse inline formatting (bold, italic, links, code) from text
  function parseInlineContent(text) {
    if (!text || !text.trim()) return [];
    
    const nodes = [];
    let pos = 0;
    const parts = [];
    
    // Extract all formatting tags and their positions
    const tags = [];
    const tagRegex = /<(strong|b|em|i|code|a[^>]*href=["']([^"']+)["'][^>]*|a)>|<\/(strong|b|em|i|code|a)>/gi;
    let match;
    
    while ((match = tagRegex.exec(text)) !== null) {
      tags.push({
        index: match.index,
        endIndex: match.index + match[0].length,
        type: match[1] || match[3],
        isOpen: !match[3],
        href: match[2] || null,
        fullMatch: match[0]
      });
    }
    
    // Sort tags by position
    tags.sort((a, b) => a.index - b.index);
    
    // Build text nodes with marks
    let lastPos = 0;
    const markStack = [];
    
    for (let i = 0; i <= tags.length; i++) {
      const tag = tags[i];
      const nextPos = tag ? tag.index : text.length;
      
      if (nextPos > lastPos) {
        const textContent = decodeEntities(text.substring(lastPos, nextPos));
        if (textContent) {
          const marks = [...markStack];
          const node = { type: 'text', text: textContent };
          if (marks.length > 0) {
            node.marks = marks.map(mark => {
              if (typeof mark === 'object') {
                return mark; // Already a mark object (e.g., link)
              }
              return { type: mark }; // Simple mark (bold, italic, code)
            });
          }
          parts.push(node);
        }
      }
      
      if (tag) {
        if (tag.isOpen) {
          if (tag.type === 'strong' || tag.type === 'b') {
            markStack.push('bold');
          } else if (tag.type === 'em' || tag.type === 'i') {
            markStack.push('italic');
          } else if (tag.type === 'code') {
            markStack.push('code');
          } else if (tag.type.startsWith('a')) {
            markStack.push({ type: 'link', attrs: { href: tag.href || '' } });
          }
        } else {
          if (tag.type === 'strong' || tag.type === 'b') {
            markStack.pop();
          } else if (tag.type === 'em' || tag.type === 'i') {
            markStack.pop();
          } else if (tag.type === 'code') {
            markStack.pop();
          } else if (tag.type === 'a') {
            markStack.pop();
          }
        }
      }
      
      if (tag) lastPos = tag.endIndex;
    }
    
    return parts.length > 0 ? parts : [{ type: 'text', text: decodeEntities(text) }];
  }

  // Process headings (h1-h6)
  const headingRegex = /<(h[1-6])[^>]*>([\s\S]*?)<\/h[1-6]>/gi;
  let headingMatch;
  const headingPositions = [];
  
  while ((headingMatch = headingRegex.exec(html)) !== null) {
    headingPositions.push({
      start: headingMatch.index,
      end: headingMatch.index + headingMatch[0].length,
      level: parseInt(headingMatch[1].substring(1)),
      content: headingMatch[2]
    });
  }

  // Process paragraphs
  const paraRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  let paraMatch;
  const paraPositions = [];
  
  while ((paraMatch = paraRegex.exec(html)) !== null) {
    paraPositions.push({
      start: paraMatch.index,
      end: paraMatch.index + paraMatch[0].length,
      content: paraMatch[1]
    });
  }

  // Process lists
  const listRegex = /<(ul|ol)[^>]*>([\s\S]*?)<\/(ul|ol)>/gi;
  let listMatch;
  const listPositions = [];
  
  while ((listMatch = listRegex.exec(html)) !== null) {
    listPositions.push({
      start: listMatch.index,
      end: listMatch.index + listMatch[0].length,
      type: listMatch[1],
      content: listMatch[2]
    });
  }

  // Process code blocks
  const codeBlockRegex = /<pre[^>]*>([\s\S]*?)<\/pre>/gi;
  let codeMatch;
  const codePositions = [];
  
  while ((codeMatch = codeBlockRegex.exec(html)) !== null) {
    codePositions.push({
      start: codeMatch.index,
      end: codeMatch.index + codeMatch[0].length,
      content: codeMatch[1]
    });
  }

  // Combine all block positions and sort
  const allBlocks = [
    ...headingPositions.map(h => ({ ...h, blockType: 'heading' })),
    ...paraPositions.map(p => ({ ...p, blockType: 'paragraph' })),
    ...listPositions.map(l => ({ ...l, blockType: 'list' })),
    ...codePositions.map(c => ({ ...c, blockType: 'code' }))
  ].sort((a, b) => a.start - b.start);

  // Process each block
  for (const block of allBlocks) {
    if (block.blockType === 'heading') {
      const inlineContent = parseInlineContent(block.content);
      if (inlineContent.length > 0) {
        content.push({
          type: 'heading',
          attrs: { level: block.level },
          content: inlineContent
        });
      }
    } else if (block.blockType === 'paragraph') {
      const inlineContent = parseInlineContent(block.content);
      if (inlineContent.length > 0) {
        content.push({
          type: 'paragraph',
          content: inlineContent
        });
      }
    } else if (block.blockType === 'list') {
      const listItems = [];
      const liRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
      let liMatch;
      
      while ((liMatch = liRegex.exec(block.content)) !== null) {
        const inlineContent = parseInlineContent(liMatch[1]);
        if (inlineContent.length > 0) {
          listItems.push({
            type: 'listItem',
            content: [{
              type: 'paragraph',
              content: inlineContent
            }]
          });
        }
      }
      
      if (listItems.length > 0) {
        content.push({
          type: block.type === 'ul' ? 'bulletList' : 'orderedList',
          content: listItems
        });
      }
    } else if (block.blockType === 'code') {
      const codeText = decodeEntities(block.content.replace(/<code[^>]*>|<\/code>/gi, ''));
      if (codeText.trim()) {
        content.push({
          type: 'codeBlock',
          content: [{
            type: 'text',
            text: codeText
          }]
        });
      }
    }
  }

  // If no blocks found, try to extract any remaining text
  if (content.length === 0) {
    const textOnly = html.replace(/<[^>]+>/g, ' ').trim();
    if (textOnly) {
      content.push({
        type: 'paragraph',
        content: [{ type: 'text', text: decodeEntities(textOnly) }]
      });
    }
  }

  return {
    type: 'doc',
    content: content.length > 0 ? content : [{
      type: 'paragraph',
      content: []
    }]
  };
}

// Helper function to convert Confluence HTML to LaunchNotes structured JSON format
function convertConfluenceToStructuredJSON(htmlContent) {
  if (!htmlContent) {
    return {
      type: 'doc',
      content: []
    };
  }

  // Remove Confluence-specific macros and their content
  let html = htmlContent
    .replace(/<ac:structured-macro[^>]*>[\s\S]*?<\/ac:structured-macro>/gi, '')
    .replace(/<ac:inline-comment-marker[^>]*>[\s\S]*?<\/ac:inline-comment-marker>/gi, '')
    .replace(/<ac:parameter[^>]*>[\s\S]*?<\/ac:parameter>/gi, '')
    .replace(/<ac:[^>]*>/gi, '')
    .replace(/<\/ac:[^>]*>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');

  const content = [];

  // Helper to decode HTML entities
  function decodeEntities(text) {
    return text
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&trade;/g, '™')
      .replace(/&copy;/g, '©')
      .replace(/&reg;/g, '®');
  }

  // Helper to parse inline formatting (bold, italic, links, code) from text
  function parseInlineContent(text) {
    if (!text || !text.trim()) return [];
    
    const parts = [];
    
    // Extract all formatting tags and their positions
    const tags = [];
    const tagRegex = /<(strong|b|em|i|code|a[^>]*href=["']([^"']+)["'][^>]*|a)>|<\/(strong|b|em|i|code|a)>/gi;
    let match;
    
    while ((match = tagRegex.exec(text)) !== null) {
      tags.push({
        index: match.index,
        endIndex: match.index + match[0].length,
        type: match[1] || match[3],
        isOpen: !match[3],
        href: match[2] || null,
        fullMatch: match[0]
      });
    }
    
    // Sort tags by position
    tags.sort((a, b) => a.index - b.index);
    
    // Build text nodes with marks
    let lastPos = 0;
    const markStack = [];
    
    for (let i = 0; i <= tags.length; i++) {
      const tag = tags[i];
      const nextPos = tag ? tag.index : text.length;
      
      if (nextPos > lastPos) {
        const textContent = decodeEntities(text.substring(lastPos, nextPos));
        if (textContent) {
          const marks = [...markStack];
          const node = { type: 'text', text: textContent };
          if (marks.length > 0) {
            node.marks = marks.map(mark => {
              if (typeof mark === 'object') {
                return mark; // Already a mark object (e.g., link)
              }
              return { type: mark }; // Simple mark (bold, italic, code)
            });
          }
          parts.push(node);
        }
      }
      
      if (tag) {
        if (tag.isOpen) {
          if (tag.type === 'strong' || tag.type === 'b') {
            markStack.push('bold');
          } else if (tag.type === 'em' || tag.type === 'i') {
            markStack.push('italic');
          } else if (tag.type === 'code') {
            markStack.push('code');
          } else if (tag.type.startsWith('a')) {
            markStack.push({ type: 'link', attrs: { href: tag.href || '' } });
          }
        } else {
          if (tag.type === 'strong' || tag.type === 'b') {
            markStack.pop();
          } else if (tag.type === 'em' || tag.type === 'i') {
            markStack.pop();
          } else if (tag.type === 'code') {
            markStack.pop();
          } else if (tag.type === 'a') {
            markStack.pop();
          }
        }
      }
      
      if (tag) lastPos = tag.endIndex;
    }
    
    return parts.length > 0 ? parts : [{ type: 'text', text: decodeEntities(text) }];
  }

  // Process headings (h1-h6)
  const headingRegex = /<(h[1-6])[^>]*>([\s\S]*?)<\/h[1-6]>/gi;
  let headingMatch;
  const headingPositions = [];
  
  while ((headingMatch = headingRegex.exec(html)) !== null) {
    headingPositions.push({
      start: headingMatch.index,
      end: headingMatch.index + headingMatch[0].length,
      level: parseInt(headingMatch[1].substring(1)),
      content: headingMatch[2]
    });
  }

  // Process paragraphs
  const paraRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  let paraMatch;
  const paraPositions = [];
  
  while ((paraMatch = paraRegex.exec(html)) !== null) {
    paraPositions.push({
      start: paraMatch.index,
      end: paraMatch.index + paraMatch[0].length,
      content: paraMatch[1]
    });
  }

  // Process lists
  const listRegex = /<(ul|ol)[^>]*>([\s\S]*?)<\/(ul|ol)>/gi;
  let listMatch;
  const listPositions = [];
  
  while ((listMatch = listRegex.exec(html)) !== null) {
    listPositions.push({
      start: listMatch.index,
      end: listMatch.index + listMatch[0].length,
      type: listMatch[1],
      content: listMatch[2]
    });
  }

  // Process code blocks
  const codeBlockRegex = /<pre[^>]*>([\s\S]*?)<\/pre>/gi;
  let codeMatch;
  const codePositions = [];
  
  while ((codeMatch = codeBlockRegex.exec(html)) !== null) {
    codePositions.push({
      start: codeMatch.index,
      end: codeMatch.index + codeMatch[0].length,
      content: codeMatch[1]
    });
  }

  // Combine all block positions and sort
  const allBlocks = [
    ...headingPositions.map(h => ({ ...h, blockType: 'heading' })),
    ...paraPositions.map(p => ({ ...p, blockType: 'paragraph' })),
    ...listPositions.map(l => ({ ...l, blockType: 'list' })),
    ...codePositions.map(c => ({ ...c, blockType: 'code' }))
  ].sort((a, b) => a.start - b.start);

  // Process each block
  for (const block of allBlocks) {
    if (block.blockType === 'heading') {
      const inlineContent = parseInlineContent(block.content);
      if (inlineContent.length > 0) {
        content.push({
          type: 'heading',
          attrs: { level: block.level },
          content: inlineContent
        });
      }
    } else if (block.blockType === 'paragraph') {
      const inlineContent = parseInlineContent(block.content);
      if (inlineContent.length > 0) {
        content.push({
          type: 'paragraph',
          content: inlineContent
        });
      }
    } else if (block.blockType === 'list') {
      const listItems = [];
      const liRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
      let liMatch;
      
      while ((liMatch = liRegex.exec(block.content)) !== null) {
        const inlineContent = parseInlineContent(liMatch[1]);
        if (inlineContent.length > 0) {
          listItems.push({
            type: 'listItem',
            content: [{
              type: 'paragraph',
              content: inlineContent
            }]
          });
        }
      }
      
      if (listItems.length > 0) {
        content.push({
          type: block.type === 'ul' ? 'bulletList' : 'orderedList',
          content: listItems
        });
      }
    } else if (block.blockType === 'code') {
      const codeText = decodeEntities(block.content.replace(/<code[^>]*>|<\/code>/gi, ''));
      if (codeText.trim()) {
        content.push({
          type: 'codeBlock',
          content: [{
            type: 'text',
            text: codeText
          }]
        });
      }
    }
  }

  // If no blocks found, try to extract any remaining text
  if (content.length === 0) {
    const textOnly = html.replace(/<[^>]+>/g, ' ').trim();
    if (textOnly) {
      content.push({
        type: 'paragraph',
        content: [{ type: 'text', text: decodeEntities(textOnly) }]
      });
    }
  }

  return {
    type: 'doc',
    content: content.length > 0 ? content : [{
      type: 'paragraph',
      content: []
    }]
  };
}

// Helper function to extract selected sections from Confluence content
function extractSections(htmlContent, sectionIds) {
  if (!htmlContent || !sectionIds || sectionIds.length === 0) {
    return htmlContent;
  }
  
  // Parse HTML to find sections by their IDs (which correspond to positions)
  // First, extract all sections with their positions
  const sections = [];
  
  // Remove Confluence-specific macros for parsing
  let html = htmlContent
    .replace(/<ac:structured-macro[^>]*>[\s\S]*?<\/ac:structured-macro>/gi, '')
    .replace(/<ac:inline-comment-marker[^>]*>[\s\S]*?<\/ac:inline-comment-marker>/gi, '')
    .replace(/<ac:parameter[^>]*>[\s\S]*?<\/ac:parameter>/gi, '')
    .replace(/<ac:[^>]*>/gi, '')
    .replace(/<\/ac:[^>]*>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');

  // Extract headings
  const headingRegex = /<(h[1-6])[^>]*>([\s\S]*?)<\/h[1-6]>/gi;
  let headingMatch;
  let sectionIndex = 0;
  
  while ((headingMatch = headingRegex.exec(html)) !== null) {
    const id = `section-${sectionIndex++}`;
    if (sectionIds.includes(id)) {
      sections.push({
        id: id,
        startIndex: headingMatch.index,
        endIndex: headingMatch.index + headingMatch[0].length,
        content: headingMatch[0]
      });
    }
  }

  // Extract paragraphs
  const paraRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  let paraMatch;
  sectionIndex = 0;
  while ((paraMatch = paraRegex.exec(html)) !== null) {
    const paraText = paraMatch[1].replace(/<[^>]+>/g, '').trim();
    if (paraText && paraText.length > 20) {
      const id = `section-${sectionIndex++}`;
      if (sectionIds.includes(id)) {
        sections.push({
          id: id,
          startIndex: paraMatch.index,
          endIndex: paraMatch.index + paraMatch[0].length,
          content: paraMatch[0]
        });
      }
    }
  }

  // Extract lists
  const listRegex = /<(ul|ol)[^>]*>([\s\S]*?)<\/(ul|ol)>/gi;
  let listMatch;
  sectionIndex = 0;
  while ((listMatch = listRegex.exec(html)) !== null) {
    const id = `section-${sectionIndex++}`;
    if (sectionIds.includes(id)) {
      sections.push({
        id: id,
        startIndex: listMatch.index,
        endIndex: listMatch.index + listMatch[0].length,
        content: listMatch[0]
      });
    }
  }

  // Sort sections by position and combine
  sections.sort((a, b) => a.startIndex - b.startIndex);
  
  if (sections.length === 0) {
    return htmlContent; // Return original if no matches
  }

  // Combine selected sections with some spacing
  return sections.map(s => s.content).join('\n\n');
}

// Helper function to convert Confluence storage format to Markdown (preserving formatting and images)
function convertConfluenceToMarkdown(confluenceHtml, baseUrl = '') {
  if (!confluenceHtml) return '';
  
  let markdown = confluenceHtml;
  
  // Extract and convert images FIRST (before removing tags)
  // Confluence images can be in several formats:
  // 1. <ac:image><ri:attachment ri:filename="image.png" /></ac:image>
  // 2. <ac:image><ri:url ri:value="https://..." /></ac:image>
  // 3. <ac:image ac:align="center"><ri:attachment ri:filename="screenshot.png" /></ac:image>
  
  // Extract image attachments (Confluence attachments)
  markdown = markdown.replace(
    /<ac:image[^>]*>.*?<ri:attachment[^>]*ri:filename="([^"]*)"[^>]*\/>.*?<\/ac:image>/gi,
    (match, filename) => {
      // Build Confluence attachment URL
      // Format: {baseUrl}/download/attachments/{pageId}/{filename}
      // Since we don't have pageId here, we'll use a placeholder that can be replaced
      const imageUrl = baseUrl ? `${baseUrl}/download/attachments/{PAGE_ID}/${encodeURIComponent(filename)}` : filename;
      return `\n\n![${filename}](${imageUrl})\n\n`;
    }
  );
  
  // Extract image URLs (external or direct URLs)
  markdown = markdown.replace(
    /<ac:image[^>]*>.*?<ri:url[^>]*ri:value="([^"]*)"[^>]*\/>.*?<\/ac:image>/gi,
    (match, url) => {
      // Extract alt text if available
      const altMatch = match.match(/<ac:plain-text-link-body[^>]*><!\[CDATA\[([^\]]*)\]\]><\/ac:plain-text-link-body>/i);
      const altText = altMatch ? altMatch[1] : 'Image';
      return `\n\n![${altText}](${url})\n\n`;
    }
  );
  
  // Handle simple img tags (if any)
  markdown = markdown.replace(
    /<img[^>]*src="([^"]*)"[^>]*(?:alt="([^"]*)")?[^>]*\/?>/gi,
    (match, src, alt) => {
      return `\n\n![${alt || 'Image'}](${src})\n\n`;
    }
  );
  
  // Convert Confluence links to markdown-style links
  markdown = markdown
    .replace(/<ac:link[^>]*>.*?<ri:page[^>]*ri:content-title="([^"]*)"[^>]*\/>.*?<\/ac:link>/gi, '[$1]') // Convert page links
    .replace(/<ac:link[^>]*>.*?<ri:url[^>]*ri:value="([^"]*)"[^>]*\/>.*?<ac:plain-text-link-body[^>]*><!\[CDATA\[([^\]]*)\]\]><\/ac:plain-text-link-body>.*?<\/ac:link>/gi, '[$3]($1)') // Convert URL links with text
    .replace(/<ac:link[^>]*>.*?<ri:url[^>]*ri:value="([^"]*)"[^>]*\/>.*?<\/ac:link>/gi, '($1)') // Convert URL links without text
    .replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)'); // Convert regular HTML links
  
  // Remove Confluence-specific macros (but keep their text content if any)
  markdown = markdown.replace(/<ac:structured-macro[^>]*>[\s\S]*?<\/ac:structured-macro>/gi, '');
  markdown = markdown.replace(/<ac:inline-comment-marker[^>]*>[\s\S]*?<\/ac:inline-comment-marker>/gi, '');
  markdown = markdown.replace(/<ac:parameter[^>]*>[\s\S]*?<\/ac:parameter>/gi, '');
  
  // Convert headings
  markdown = markdown.replace(/<h1[^>]*>(.*?)<\/h1>/gi, '\n\n# $1\n\n');
  markdown = markdown.replace(/<h2[^>]*>(.*?)<\/h2>/gi, '\n\n## $1\n\n');
  markdown = markdown.replace(/<h3[^>]*>(.*?)<\/h3>/gi, '\n\n### $1\n\n');
  markdown = markdown.replace(/<h4[^>]*>(.*?)<\/h4>/gi, '\n\n#### $1\n\n');
  markdown = markdown.replace(/<h5[^>]*>(.*?)<\/h5>/gi, '\n\n##### $1\n\n');
  markdown = markdown.replace(/<h6[^>]*>(.*?)<\/h6>/gi, '\n\n###### $1\n\n');
  
  // Convert lists - preserve structure
  // Handle nested lists by tracking depth
  markdown = markdown.replace(/<ul[^>]*>/gi, '\n');
  markdown = markdown.replace(/<\/ul>/gi, '\n');
  markdown = markdown.replace(/<ol[^>]*>/gi, '\n');
  markdown = markdown.replace(/<\/ol>/gi, '\n');
  markdown = markdown.replace(/<li[^>]*>/gi, '- ');
  markdown = markdown.replace(/<\/li>/gi, '\n');
  
  // Convert paragraphs
  markdown = markdown.replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n\n');
  
  // Convert line breaks
  markdown = markdown.replace(/<br\s*\/?>/gi, '\n');
  markdown = markdown.replace(/<hr[^>]*>/gi, '\n\n---\n\n');
  
  // Convert emphasis and formatting
  markdown = markdown.replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**');
  markdown = markdown.replace(/<b[^>]*>(.*?)<\/b>/gi, '**$1**');
  markdown = markdown.replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*');
  markdown = markdown.replace(/<i[^>]*>(.*?)<\/i>/gi, '*$1*');
  markdown = markdown.replace(/<code[^>]*>(.*?)<\/code>/gi, '`$1`');
  
  // Convert code blocks
  markdown = markdown.replace(/<pre[^>]*><code[^>]*>(.*?)<\/code><\/pre>/gi, '\n```\n$1\n```\n');
  markdown = markdown.replace(/<pre[^>]*>(.*?)<\/pre>/gi, '\n```\n$1\n```\n');
  
  // Convert blockquotes
  markdown = markdown.replace(/<blockquote[^>]*>(.*?)<\/blockquote>/gi, '\n> $1\n');
  
  // Convert tables (basic support)
  markdown = markdown.replace(/<table[^>]*>/gi, '\n\n');
  markdown = markdown.replace(/<\/table>/gi, '\n\n');
  markdown = markdown.replace(/<thead[^>]*>/gi, '');
  markdown = markdown.replace(/<\/thead>/gi, '');
  markdown = markdown.replace(/<tbody[^>]*>/gi, '');
  markdown = markdown.replace(/<\/tbody>/gi, '');
  markdown = markdown.replace(/<tr[^>]*>/gi, '| ');
  markdown = markdown.replace(/<\/tr>/gi, ' |\n');
  markdown = markdown.replace(/<th[^>]*>(.*?)<\/th>/gi, '$1 | ');
  markdown = markdown.replace(/<td[^>]*>(.*?)<\/td>/gi, '$1 | ');
  
  // Remove remaining Confluence-specific tags
  markdown = markdown.replace(/<ac:[^>]*>/gi, '');
  markdown = markdown.replace(/<\/ac:[^>]*>/gi, '');
  markdown = markdown.replace(/<ri:[^>]*>/gi, '');
  markdown = markdown.replace(/<\/ri:[^>]*>/gi, '');
  
  // Remove HTML comments
  markdown = markdown.replace(/<!--[\s\S]*?-->/g, '');
  
  // Remove all remaining HTML tags
  markdown = markdown.replace(/<[^>]+>/g, '');
  
  // Decode HTML entities
  markdown = markdown.replace(/&nbsp;/g, ' ');
  markdown = markdown.replace(/&amp;/g, '&');
  markdown = markdown.replace(/&lt;/g, '<');
  markdown = markdown.replace(/&gt;/g, '>');
  markdown = markdown.replace(/&quot;/g, '"');
  markdown = markdown.replace(/&#39;/g, "'");
  markdown = markdown.replace(/&trade;/g, '™');
  markdown = markdown.replace(/&copy;/g, '©');
  markdown = markdown.replace(/&reg;/g, '®');
  markdown = markdown.replace(/<!\[CDATA\[(.*?)\]\]>/gi, '$1'); // Extract CDATA content
  
  // Clean up whitespace
  markdown = markdown.replace(/\n{4,}/g, '\n\n\n'); // Max 3 consecutive newlines
  markdown = markdown.replace(/[ \t]+/g, ' '); // Multiple spaces to single space
  markdown = markdown.replace(/^\s+|\s+$/gm, ''); // Trim each line
  
  return markdown.trim();
}

// Helper function to convert Confluence storage format to plain text (kept for backward compatibility)
function convertConfluenceToText(confluenceHtml) {
  if (!confluenceHtml) return '';
  
  // First, convert Confluence links to markdown-style links
  let text = confluenceHtml
    .replace(/<ac:link[^>]*>.*?<ri:page[^>]*ri:content-title="([^"]*)"[^>]*\/>.*?<\/ac:link>/gi, '[$1]') // Convert page links
    .replace(/<ac:link[^>]*>.*?<ri:url[^>]*ri:value="([^"]*)"[^>]*\/>.*?<ac:plain-text-link-body[^>]*><!\[CDATA\[([^\]]*)\]\]><\/ac:plain-text-link-body>.*?<\/ac:link>/gi, '[$2]($1)') // Convert URL links with text
    .replace(/<ac:link[^>]*>.*?<ri:url[^>]*ri:value="([^"]*)"[^>]*\/>.*?<\/ac:link>/gi, '($1)') // Convert URL links without text
    .replace(/<ac:image[^>]*>.*?<\/ac:image>/gi, '') // Remove images
    .replace(/<ac:structured-macro[^>]*>.*?<\/ac:structured-macro>/gi, '') // Remove macros
    .replace(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/gi, '\n\n$1\n\n') // Convert headings to newlines
    .replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n\n') // Convert paragraphs
    .replace(/<br[^>]*\/?>/gi, '\n') // Convert line breaks
    .replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**') // Convert bold
    .replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*') // Convert italic
    .replace(/<[^>]+>/g, '') // Remove remaining HTML tags
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/<!\[CDATA\[(.*?)\]\]>/gi, '$1') // Extract CDATA content
    .replace(/\n{3,}/g, '\n\n') // Normalize multiple newlines
    .replace(/[ \t]+/g, ' ') // Normalize spaces
    .trim();
  
  return text;
}

// Helper function to extract specific sections from content
function extractSections(content, sectionIds) {
  // This is a placeholder - you'll need to implement based on your content structure
  // For now, return the full content
  return content;
}

// Style guide page ID
const STYLE_GUIDE_PAGE_ID = '4462543017';

// Style guide cache with version tracking
let styleGuideCache = {
  content: null,
  title: null,
  version: null,
  lastModified: null,
  lastChecked: null,
  cachedAt: null
};

// Fetch style guide with caching and update detection
async function fetchStyleGuide(credentials, forceRefresh = false) {
  const { confluenceApi } = createApiClients(credentials);
  
  try {
    // Fetch page with version info
    const styleGuideResponse = await confluenceApi.get(`/rest/api/content/${STYLE_GUIDE_PAGE_ID}`, {
      params: { expand: 'body.storage,version' }
    });
    
    const page = styleGuideResponse.data;
    const currentVersion = page.version?.number;
    const currentLastModified = page.version?.when || page.history?.lastUpdated?.when;
    const currentContent = convertConfluenceToText(page.body?.storage?.value || '');
    
    // Check if style guide has been updated
    const isUpdated = forceRefresh || 
      !styleGuideCache.content || 
      styleGuideCache.version !== currentVersion ||
      styleGuideCache.lastModified !== currentLastModified;
    
    if (isUpdated) {
      const wasCached = !!styleGuideCache.content;
      const oldVersion = styleGuideCache.version;
      
      styleGuideCache = {
        content: currentContent,
        title: page.title,
        version: currentVersion,
        lastModified: currentLastModified,
        lastChecked: new Date().toISOString(),
        cachedAt: new Date().toISOString()
      };
      
      if (wasCached) {
        console.log(`[Style Guide] Update detected! Version ${currentVersion} (was ${oldVersion || 'none'})`);
        console.log(`[Style Guide] Last modified: ${currentLastModified}`);
        console.log(`[Style Guide] Cache updated - AI tools and compliance checker will use new version`);
      } else {
        console.log(`[Style Guide] Initial load - Version ${currentVersion}`);
      }
      
      return {
        title: styleGuideCache.title,
        content: styleGuideCache.content,
        version: styleGuideCache.version,
        lastModified: styleGuideCache.lastModified,
        cachedAt: styleGuideCache.cachedAt,
        lastChecked: styleGuideCache.lastChecked,
        wasUpdated: wasCached // Only true if there was a cached version before (actual update, not initial load)
      };
    } else {
      // Update last checked time even if content hasn't changed
      styleGuideCache.lastChecked = new Date().toISOString();
      
      return {
        title: styleGuideCache.title,
        content: styleGuideCache.content,
        version: styleGuideCache.version,
        lastModified: styleGuideCache.lastModified,
        cachedAt: styleGuideCache.cachedAt,
        lastChecked: styleGuideCache.lastChecked,
        wasUpdated: false // No update detected
      };
    }
  } catch (e) {
    console.warn('[Style Guide] Could not fetch style guide:', e.message);
    // Return cached version if available, even if stale
    if (styleGuideCache.content) {
      console.log('[Style Guide] Using cached version due to fetch error');
      return {
        title: styleGuideCache.title,
        content: styleGuideCache.content,
        version: styleGuideCache.version,
        lastModified: styleGuideCache.lastModified,
        cachedAt: styleGuideCache.cachedAt,
        lastChecked: styleGuideCache.lastChecked,
        wasUpdated: false,
        error: e.message
      };
    }
    throw e;
  }
}

// Endpoint to check style guide status and force refresh
app.get('/api/style-guide/status', async (req, res) => {
  try {
    const credentials = getCredentialsFromRequest(req);
    const styleGuide = await fetchStyleGuide(credentials, false);
    
    res.json({
      success: true,
      styleGuide: {
        title: styleGuide.title,
        content: styleGuide.content, // Include content for preview
        version: styleGuide.version,
        lastModified: styleGuide.lastModified,
        cachedAt: styleGuide.cachedAt,
        lastChecked: styleGuide.lastChecked,
        wasUpdated: styleGuide.wasUpdated
      },
      cacheInfo: {
        isCached: !!styleGuideCache.content,
        cacheAge: styleGuideCache.cachedAt 
          ? Math.floor((Date.now() - new Date(styleGuideCache.cachedAt).getTime()) / 1000 / 60)
          : null // age in minutes
      }
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to fetch style guide status',
      details: error.message
    });
  }
});

// Endpoint to force refresh style guide
app.post('/api/style-guide/refresh', requirePermission('ai'), async (req, res) => {
  try {
    const credentials = getCredentialsFromRequest(req);
    const styleGuide = await fetchStyleGuide(credentials, true);
    
    res.json({
      success: true,
      message: styleGuide.wasUpdated ? 'Style guide updated' : 'Style guide refreshed (no changes)',
      styleGuide: {
        title: styleGuide.title,
        version: styleGuide.version,
        lastModified: styleGuide.lastModified,
        cachedAt: styleGuide.cachedAt,
        wasUpdated: styleGuide.wasUpdated
      }
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to refresh style guide',
      details: error.message
    });
  }
});

// Shared: fetch pages for statuses and apply export filters (assignees, fixVersions, lobs, date range)
async function fetchPagesForStatuses(statusKeys, req, credentials) {
  const { jiraApi } = createApiClients(credentials);
  const globalFieldNames = await getJiraFieldNames(jiraApi);
  const allPages = [];
  for (const status of statusKeys) {
    try {
      const { pages } = await listPagesForStatus(req, status, { globalFieldNames });
      for (const p of pages) {
        allPages.push({ ...p, status: p.status || status });
      }
    } catch (e) {
      console.warn(`[Export] Failed to fetch status ${status}:`, e.message);
    }
  }
  return allPages;
}

function applyExportFilters(pages, filters) {
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
      const pill = (p.jiraMetadataPills || []).find(x => (x.label || '').toLowerCase().includes('line of business') || (x.label || '').toLowerCase().includes('product area'));
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

const NOTIFICATION_FETCH_STATUSES = Object.keys(PAGE_STATUSES).filter((k) => k !== 'discard');

// Run due Jira notification rules (scheduled comments). Client sends rules + delivery log; server posts when due.
// Each rule is independent: a page is only considered for rule R if (1) R's status filter passes, (2) it has Jira,
// (3) launch date is set, (4) whole calendar days until launch is in [R.minDays, R.withinDays], (5) now >= R's
// scheduled send instant, (6) R has not already posted for this page+launch. No other rule or path sends here.
app.post('/api/notifications/run-due', requirePermission('notifications'), async (req, res) => {
  try {
    const credentials = getCredentialsFromRequest(req);
    if (!credentials || !credentials.email || !credentials.token) {
      return res.status(401).json({ error: 'Atlassian credentials required' });
    }
    const rules = normalizeRulesList(req.body && req.body.rules);
    const enabledRules = rules.filter((r) => r.enabled);
    if (enabledRules.length === 0) {
      return res.json({
        ok: true,
        posted: [],
        skipped: [],
        failed: [],
        message: 'No enabled notification rules.',
        deliveryLog: trimDeliveryLog(req.body && req.body.deliveryLog)
      });
    }

    let deliveryLog = trimDeliveryLog(
      req.body && req.body.deliveryLog && typeof req.body.deliveryLog === 'object' && !Array.isArray(req.body.deliveryLog)
        ? req.body.deliveryLog
        : {}
    );

    const statusUnion = new Set();
    for (const rule of enabledRules) {
      if (rule.statuses && rule.statuses.length > 0) {
        rule.statuses.forEach((s) => {
          if (PAGE_STATUSES[s]) statusUnion.add(s);
        });
      }
    }
    const statusKeys =
      statusUnion.size > 0 ? [...statusUnion] : NOTIFICATION_FETCH_STATUSES;

    const { jiraApi: userJiraApi } = createApiClients(credentials);
    const allPages = await fetchPagesForStatuses(statusKeys, req, credentials);
    const now = Date.now();

    const posted = [];
    const skipped = [];
    const failed = [];

    for (const rule of enabledRules) {
      const tz = rule.schedule.timeZone;
      const pagesForRule = allPages.filter((p) => {
        if (!p.jiraTicket) return false;
        if (rule.statuses && rule.statuses.length > 0 && !rule.statuses.includes(p.status)) {
          return false;
        }
        return true;
      });

      for (const page of pagesForRule) {
        const launchRaw = launchRawFromPage(page, rule.criteria.dateField);
        if (!launchRaw) {
          skipped.push({ ruleId: rule.id, pageId: page.id, reason: 'no_launch_date' });
          continue;
        }
        if (
          !pageMatchesLaunchDayRange(
            launchRaw,
            rule.criteria.minDaysUntilLaunch ?? 0,
            rule.criteria.withinDays,
            tz,
            now
          )
        ) {
          skipped.push({ ruleId: rule.id, pageId: page.id, reason: 'outside_launch_window' });
          continue;
        }
        const sendAt = computeSendInstantMillis(
          launchRaw,
          rule.schedule.offsetDaysFromLaunch,
          rule.schedule.timeLocal,
          tz
        );
        if (sendAt == null) {
          skipped.push({ ruleId: rule.id, pageId: page.id, reason: 'invalid_schedule' });
          continue;
        }
        if (now < sendAt) {
          skipped.push({ ruleId: rule.id, pageId: page.id, reason: 'not_yet_due' });
          continue;
        }
        const dedupeKey = buildDedupeKey(rule.id, page.id, launchRaw);
        if (deliveryLog[dedupeKey]) {
          skipped.push({ ruleId: rule.id, pageId: page.id, reason: 'already_sent' });
          continue;
        }

        const vars = buildTemplateVars(page, credentials);
        const text = interpolateTemplate(rule.action.bodyTemplate, vars);
        if (!text.trim()) {
          skipped.push({ ruleId: rule.id, pageId: page.id, reason: 'empty_body' });
          continue;
        }

        try {
          const content = parseMentionsToADF(text, []);
          await userJiraApi.post(`/rest/api/3/issue/${page.jiraTicket}/comment`, {
            body: {
              type: 'doc',
              version: 1,
              content: [{ type: 'paragraph', content }]
            }
          });
          deliveryLog = {
            ...deliveryLog,
            [dedupeKey]: {
              sentAt: new Date().toISOString(),
              jiraTicket: page.jiraTicket,
              title: page.title,
              ruleId: rule.id,
              ruleName: rule.name
            }
          };
          posted.push({
            ruleId: rule.id,
            pageId: page.id,
            jiraTicket: page.jiraTicket,
            title: page.title
          });
        } catch (jiraError) {
          console.error('[notifications/run-due]', page.jiraTicket, jiraError.response?.data || jiraError.message);
          failed.push({
            ruleId: rule.id,
            pageId: page.id,
            jiraTicket: page.jiraTicket,
            error: jiraError.response?.data?.errorMessages?.join(', ') || jiraError.message
          });
        }
      }
    }

    deliveryLog = trimDeliveryLog(deliveryLog);

    res.json({
      ok: true,
      posted,
      skipped: skipped.slice(0, 200),
      failed,
      skippedTruncated: skipped.length > 200,
      deliveryLog
    });
  } catch (error) {
    console.error('Error in notifications/run-due:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: 'Failed to run notification rules',
      details: error.response?.data?.message || error.message
    });
  }
});

// Get filter options for Export for Claude (assignees, fix versions, LOB) for the given statuses
app.post('/api/export-for-claude-options', requirePermission('export'), async (req, res) => {
  try {
    const credentials = getCredentialsFromRequest(req);
    if (!credentials || !credentials.email || !credentials.token) {
      return res.status(401).json({ error: 'Atlassian credentials required' });
    }
    const statusesFilter = req.body.statuses;
    const allStatusKeys = Object.keys(PAGE_STATUSES);
    const statusKeys = Array.isArray(statusesFilter) && statusesFilter.length > 0
      ? statusesFilter.filter(s => allStatusKeys.includes(s))
      : allStatusKeys;
    const pages = await fetchPagesForStatuses(statusKeys, req, credentials);
    const assignees = [];
    const fixVersions = new Set();
    const lobs = new Set();
    pages.forEach(p => {
      const name = p.jiraAssignee?.displayName || p.referenceAssignee;
      if (name) assignees.push(name);
      const fv = p.fixVersions;
      if (fv) (Array.isArray(fv) ? fv : [fv]).forEach(v => fixVersions.add(String(v)));
      const pill = (p.jiraMetadataPills || []).find(x => (x.label || '').toLowerCase().includes('line of business') || (x.label || '').toLowerCase().includes('product area'));
      (pill?.values || []).forEach(v => lobs.add(String(v)));
    });
    res.json({
      assignees: [...new Set(assignees)].sort(),
      fixVersions: [...fixVersions].sort(),
      lobs: [...lobs].sort()
    });
  } catch (error) {
    console.error('Export options failed:', error.message);
    res.status(500).json({ error: 'Failed to load options', details: error.message });
  }
});

// Preview filtered pages for Export for Claude
app.post('/api/export-for-claude-preview', requirePermission('export'), async (req, res) => {
  try {
    const credentials = getCredentialsFromRequest(req);
    if (!credentials || !credentials.email || !credentials.token) {
      return res.status(401).json({ error: 'Atlassian credentials required' });
    }
    const statusesFilter = req.body.statuses;
    const allStatusKeys = Object.keys(PAGE_STATUSES);
    const statusKeys = Array.isArray(statusesFilter) && statusesFilter.length > 0
      ? statusesFilter.filter(s => allStatusKeys.includes(s))
      : allStatusKeys;
    const pages = await fetchPagesForStatuses(statusKeys, req, credentials);
    const filters = {
      assignees: req.body.assignees,
      fixVersions: req.body.fixVersions,
      lobs: req.body.lobs,
      actualLaunchDateFrom: req.body.actualLaunchDateFrom,
      actualLaunchDateTo: req.body.actualLaunchDateTo,
      targetedLaunchDateFrom: req.body.targetedLaunchDateFrom,
      targetedLaunchDateTo: req.body.targetedLaunchDateTo
    };
    const filtered = applyExportFilters(pages, filters);
    res.json({
      pages: filtered.map(p => ({
        id: p.id,
        title: p.title,
        status: p.status,
        assignee: p.jiraAssignee?.displayName || p.referenceAssignee,
        fixVersions: p.fixVersions,
        lob: (p.jiraMetadataPills || []).find(x => (x.label || '').toLowerCase().includes('line of business') || (x.label || '').toLowerCase().includes('product area'))?.values,
        actualLaunchDate: p.actualLaunchDate,
        targetedLaunchDate: p.targetedLaunchDate
      }))
    });
  } catch (error) {
    console.error('Export preview failed:', error.message);
    res.status(500).json({ error: 'Failed to load preview', details: error.message });
  }
});

// Export for Claude: produce a zip of style guide, manifest, and one file per page for use with Claude Code / Cursor
app.post('/api/export-for-claude', requirePermission('export'), async (req, res) => {
  try {
    const credentials = getCredentialsFromRequest(req);
    if (!credentials || !credentials.email || !credentials.token) {
      return res.status(401).json({ error: 'Atlassian credentials required' });
    }

    const statusesFilter = req.body.statuses; // optional: array of status keys to include
    const allStatusKeys = Object.keys(PAGE_STATUSES);
    const statusKeys = Array.isArray(statusesFilter) && statusesFilter.length > 0
      ? statusesFilter.filter(s => allStatusKeys.includes(s))
      : allStatusKeys;

    const styleGuide = await fetchStyleGuide(credentials, false);

    const allPages = await fetchPagesForStatuses(statusKeys, req, credentials);
    const filters = {
      assignees: req.body.assignees,
      fixVersions: req.body.fixVersions,
      lobs: req.body.lobs,
      actualLaunchDateFrom: req.body.actualLaunchDateFrom,
      actualLaunchDateTo: req.body.actualLaunchDateTo,
      targetedLaunchDateFrom: req.body.targetedLaunchDateFrom,
      targetedLaunchDateTo: req.body.targetedLaunchDateTo
    };

    const previewPageIds = Array.isArray(req.body.previewPageIds)
      ? req.body.previewPageIds.map(String).filter(Boolean)
      : [];

    let pages;
    if (previewPageIds.length > 0) {
      const byId = new Map(allPages.map(p => [String(p.id), p]));
      const ordered = [];
      const seen = new Set();
      for (const id of previewPageIds) {
        if (seen.has(id)) continue;
        seen.add(id);
        const p = byId.get(id);
        if (p) ordered.push(p);
      }
      pages = ordered;
    } else {
      pages = applyExportFilters(allPages, filters);
    }

    const exportedAt = new Date().toISOString();
    const manifest = {
      exportedAt,
      styleGuideTitle: styleGuide.title || 'Style Guide',
      styleGuideVersion: styleGuide.version,
      totalPages: pages.length,
      statusFilter: statusKeys.length === allStatusKeys.length ? 'all' : statusKeys,
      pages: pages.map(p => ({
        id: p.id,
        title: p.title,
        status: p.status,
        jiraTicket: p.jiraTicket,
        jiraUrl: p.jiraUrl,
        url: p.url,
        contentPath: `pages/${p.id}.md`
      }))
    };

    const instructions = `# Release notes export for Claude / Cursor

This folder was exported from the Confluence Release Notes Manager.

## Quick start (Cursor)

1. **Open in Cursor** – **Mac:** Open Terminal, go to this folder (\`cd\` to the unzipped folder), and run \`bash start.sh\` (no admin or security prompt). **Windows:** Double-click **start.bat**. Or from any terminal in this folder run \`cursor .\` (install the \`cursor\` command from Cursor: Command Palette → "Shell Command: Install 'cursor' command").
2. **Agent instructions** – Cursor will automatically load **AGENTS.md** when this folder is open. Ask the Cursor Agent to "rewrite all pages to the style guide" or "follow AGENTS.md"; it will read the style guide and \`pages/*.md\` and write rewritten notes to **drafts/*.md**.

## Contents

- **AGENTS.md** – Instructions for the Cursor Agent (loaded automatically when the folder is open).
- **AGENT_COMMAND.md** – Copy-paste command to give the Agent each time (same instructions in one block).
- **style-guide.md** – Our release note style guide. Rewrite all page content to match this guide.
- **manifest.json** – List of pages with metadata (id, title, status, Jira link, etc.).
- **pages/*.md** – One file per Confluence page. Each file has YAML frontmatter (metadata) and the page body as plain text.
- **start.sh** (Mac: run \`bash start.sh\` from Terminal) / **start.bat** (Windows: double-click) – Opens Cursor with this folder so the Agent has full context.

## Your task (if not using Cursor Agent)

1. Read **style-guide.md** and **manifest.json**.
2. For each file in **pages/**:
   - If the page is a template or the body says things like "please add details" (placeholder content), **ignore it** – do not write a draft for it.
   - Otherwise: read the frontmatter (metadata) and the body (current Confluence content), rewrite the body to meet the style guide (tone, structure, clarity), and write the improved release note to **drafts/<page-id>.md** (create the \`drafts\` folder). Use the same frontmatter and your rewritten body.

## After you're done

- **Import into the tool:** In the Confluence Release Notes Manager, open **Settings → Export**. Use **Choose zip to import drafts** and select a zip of this folder (containing the **drafts** folder). The tool will list the drafts and let you send them to LaunchNotes in one go.
- Or copy content from **drafts/** manually into the tool and use its LaunchNotes flow.

Exported: ${exportedAt}
Total pages: ${pages.length}
`;

    const agentsMd = `# Release notes rewrite (for Cursor Agent)

When this folder is opened in Cursor, follow these instructions.

## Context

- **style-guide.md** – Our release note style guide. All rewritten content must match this guide.
- **manifest.json** – List of pages (id, title, status, Jira link, Confluence URL). Each has a corresponding file in **pages/<id>.md**.
- **pages/*.md** – One file per Confluence page: YAML frontmatter (metadata) + plain-text body (current content).

## Task

1. Read **style-guide.md** and **manifest.json**.
2. For each file in **pages/**:
   - If the page is a template or the body says things like "please add details" (placeholder content), **ignore it** – do not write a draft for it.
   - Otherwise: read the frontmatter and the body, rewrite the body to match the style guide (tone, structure, clarity), keep the same meaning and key facts, and write the result to **drafts/<page-id>.md** with the same frontmatter and your rewritten body. Create the \`drafts\` folder if it does not exist.
3. Do not modify files in **pages/**; only write to **drafts/**.

## Output

- All rewritten release notes in **drafts/*.md**, ready for manual copy into the Confluence Release Notes Manager or a future "Import from Claude output" flow into LaunchNotes.
`;

    const agentCommandMd = `# Agent command

Copy the block below and paste it into the Cursor Agent (or any compatible AI) each time you run a rewrite.

\`\`\`
Read style-guide.md and manifest.json. For every file in pages/, rewrite the body to match the style guide. Keep the same meaning and facts. Write each result to drafts/<page-id>.md with the same YAML frontmatter as the source file and your rewritten body. Create the drafts folder if it doesn't exist. If a source page is a template or says "please add details" (placeholder content), ignore it and do not write a draft for it.
\`\`\`
`;

    const startShMac = `#!/bin/bash
# Open this folder in Cursor (run from Terminal: bash start.sh - no admin needed).
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if command -v cursor &>/dev/null; then
  cursor "$SCRIPT_DIR"
else
  open -a "Cursor" "$SCRIPT_DIR"
fi
`;

    const startBatWindows = `@echo off
REM Open this folder in Cursor so the Agent can run the rewrite (see AGENTS.md).
cd /d "%~dp0"
if where cursor >nul 2>nul (
  cursor .
) else (
  start "" "Cursor" "%~dp0"
  echo If Cursor did not open, install the 'cursor' command from Cursor's Command Palette, or open Cursor and File > Open Folder > this folder.
)
pause
`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="release-notes-for-claude-${new Date().toISOString().slice(0, 10)}.zip"`);

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (err) => {
      console.error('[Export] Archiver error:', err);
      if (!res.headersSent) res.status(500).json({ error: 'Export archive failed' });
    });
    archive.pipe(res);

    archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });
    archive.append(styleGuide.content || '# No style guide content', { name: 'style-guide.md' });
    archive.append(instructions, { name: 'INSTRUCTIONS.md' });
    archive.append(agentsMd, { name: 'AGENTS.md' });
    archive.append(agentCommandMd, { name: 'AGENT_COMMAND.md' });
    archive.append(startShMac, { name: 'start.sh' });
    archive.append(startBatWindows, { name: 'start.bat' });

    for (const p of pages) {
      const assignee = p.jiraAssignee?.displayName || p.referenceAssignee || '';
      const createdDate = p.createdDate ? new Date(p.createdDate).toISOString().split('T')[0] : '';
      const frontmatter = `---
id: "${String(p.id).replace(/"/g, '\\"')}"
title: "${String(p.title || '').replace(/"/g, '\\"')}"
status: "${String(p.status || '').replace(/"/g, '\\"')}"
jiraTicket: "${String(p.jiraTicket || '').replace(/"/g, '\\"')}"
jiraUrl: "${String(p.jiraUrl || '').replace(/"/g, '\\"')}"
confluenceUrl: "${String(p.url || '').replace(/"/g, '\\"')}"
assignee: "${String(assignee).replace(/"/g, '\\"')}"
createdDate: "${createdDate}"
targetedLaunchDate: "${String(p.targetedLaunchDate || '').replace(/"/g, '\\"')}"
actualLaunchDate: "${String(p.actualLaunchDate || '').replace(/"/g, '\\"')}"
educationProjectStatus: "${String(p.educationProjectStatus || '').replace(/"/g, '\\"')}"
---

`;
      const body = (p.contentText || '').replace(/\r\n/g, '\n').trim();
      archive.append(Buffer.from(frontmatter + body, 'utf8'), { name: `pages/${p.id}.md` });
    }

    await archive.finalize();
  } catch (error) {
    console.error('Export for Claude failed:', error.response?.data || error.message);
    if (!res.headersSent) {
      res.status(500).json({
        error: 'Export failed',
        details: error.message
      });
    }
  }
});

// Parse frontmatter and body from a markdown string (--- ... --- then body)
function parseDraftMarkdown(raw) {
  const trimmed = (raw || '').trim();
  const dashMatch = trimmed.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!dashMatch) return { frontmatter: {}, body: trimmed };
  const frontmatterRaw = dashMatch[1];
  const body = (dashMatch[2] || '').trim();
  const frontmatter = {};
  frontmatterRaw.split(/\r?\n/).forEach(line => {
    const m = line.match(/^([a-zA-Z0-9_]+):\s*"((?:[^"\\]|\\.)*)"\s*$/);
    if (m) frontmatter[m[1]] = m[2].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  });
  return { frontmatter, body };
}

/**
 * Render markdown as HTML for Confluence storage format so pages view correctly without a Markdown macro/app.
 * (The ac:name="markdown" macro often shows "Error loading the extension!" when the app fails or conflicts with page builders.)
 */
function markdownToConfluenceStorageHtml(markdown) {
  const src = String(markdown || '').trim();
  if (!src) return '';
  let html = marked.parse(src);
  html = html
    .replace(/<br\s*\/?>/gi, '<br/>')
    .replace(/<hr\s*\/?>/gi, '<hr/>');
  return html;
}

// Import from Claude output: upload a zip containing drafts/*.md (or any .md), get back list of drafts for LaunchNotes
app.post('/api/import-from-claude', requirePermission('export'), upload.single('zip'), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'No file uploaded', details: 'Send a zip file in field "zip".' });
    }
    const zip = new AdmZip(req.file.buffer);
    const entries = zip.getEntries();
    const drafts = [];
    for (const entry of entries) {
      if (entry.isDirectory) continue;
      const name = (entry.entryName || '').replace(/\\/g, '/');
      if (!name.endsWith('.md')) continue;
      if (!name.includes('drafts/')) continue;
      const basename = name.replace(/.*\//, '');
      if (basename.startsWith('._')) continue;
      const raw = entry.getData().toString('utf8');
      const { frontmatter, body } = parseDraftMarkdown(raw);
      const id = frontmatter.id || name.replace(/.*\//, '').replace(/\.md$/, '');
      drafts.push({
        id,
        title: frontmatter.title || id,
        jiraTicket: frontmatter.jiraTicket || null,
        jiraUrl: frontmatter.jiraUrl || null,
        confluenceUrl: frontmatter.confluenceUrl || null,
        content: body
      });
    }
    res.json({ success: true, drafts });
  } catch (error) {
    console.error('Import from Claude failed:', error.message);
    res.status(500).json({
      error: 'Import failed',
      details: error.message
    });
  }
});

// Prepend rewritten (imported) content to Confluence pages – rendered HTML at top, then separator, then existing body
app.post('/api/pages/prepend-imported-content', async (req, res) => {
  try {
    const credentials = getCredentialsFromRequest(req);
    const { confluenceApi } = createApiClients(credentials);
    const updates = Array.isArray(req.body.updates) ? req.body.updates : [];
    if (updates.length === 0) {
      return res.status(400).json({ error: 'Body must include updates: [{ pageId, content }]' });
    }
    const success = [];
    const failed = [];
    for (const { pageId, content } of updates) {
      if (!pageId || content == null) {
        failed.push({ pageId: pageId || null, error: 'Missing pageId or content' });
        continue;
      }
      try {
        const getRes = await confluenceApi.get(`/rest/api/content/${pageId}`, {
          params: { expand: 'version,body.storage,ancestors' }
        });
        const page = getRes.data;
        const currentVersion = page.version?.number;
        const existingBody = page.body?.storage?.value || '';
        const ancestors = Array.isArray(page.ancestors) && page.ancestors.length > 0
          ? page.ancestors.map(a => ({ id: a.id }))
          : [];
        if (currentVersion == null) {
          failed.push({ pageId, error: 'Could not read page version' });
          continue;
        }
        const prependedHtml = markdownToConfluenceStorageHtml(content);
        const separator = prependedHtml ? '<p><hr/></p>' : '';
        const cdataContent = String(content).replace(/\]\]>/g, ']]]]><![CDATA[>');
        const codeBlock =
          '<ac:structured-macro ac:name="code"><ac:parameter ac:name="language">markdown</ac:parameter><ac:plain-text-body><![CDATA[' + cdataContent + ']]></ac:plain-text-body></ac:structured-macro>' +
          '<p><hr/></p>';
        let newBodyValue = prependedHtml + separator + existingBody;
        const putPayload = {
          id: pageId,
          type: 'page',
          title: page.title,
          version: { number: currentVersion + 1 },
          body: {
            storage: {
              value: newBodyValue,
              representation: 'storage'
            }
          }
        };
        if (ancestors.length > 0) putPayload.ancestors = ancestors;
        try {
          await confluenceApi.put(`/rest/api/content/${pageId}`, putPayload);
        } catch (macroErr) {
          const errMsg = (macroErr.response?.data?.message || macroErr.message || '').toLowerCase();
          if (errMsg.includes('macro') || errMsg.includes('storage') || macroErr.response?.status === 400) {
            newBodyValue = codeBlock + existingBody;
            putPayload.body.storage.value = newBodyValue;
            await confluenceApi.put(`/rest/api/content/${pageId}`, putPayload);
          } else {
            throw macroErr;
          }
        }
        success.push({ pageId, title: page.title });
      } catch (err) {
        const msg = err.response?.data?.message || err.message || 'Unknown error';
        failed.push({ pageId, error: msg });
      }
    }
    res.json({ success, failed });
  } catch (error) {
    console.error('Prepend imported content failed:', error.message);
    res.status(500).json({
      error: 'Update failed',
      details: error.message
    });
  }
});

// Helper function to convert Confluence HTML to plain text
function convertConfluenceToText(htmlContent) {
  if (!htmlContent) return '';
  let text = htmlContent
    .replace(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/gi, '\n\n$1\n\n')
    .replace(/<p[^>]*>(.*?)<\/p>/gi, '\n$1\n')
    .replace(/<li[^>]*>(.*?)<\/li>/gi, '\n- $1')
    .replace(/<ul[^>]*>|<\/ul>|<ol[^>]*>|<\/ol>/gi, '')
    .replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**')
    .replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*')
    .replace(/<code[^>]*>(.*?)<\/code>/gi, '`$1`')
    .replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text;
}

// Helper function to convert Jira ADF to text
function convertJiraADFToText(adf) {
  if (!adf || typeof adf !== 'object') return '';
  
  function processNode(node) {
    if (typeof node === 'string') return node;
    if (!node || typeof node !== 'object') return '';
    
    let text = '';
    
    if (node.type === 'paragraph') {
      if (node.content && Array.isArray(node.content)) {
        text = node.content.map(processNode).join('') + '\n';
      }
    } else if (node.type === 'heading') {
      const level = node.attrs?.level || 1;
      const prefix = '#'.repeat(level) + ' ';
      if (node.content && Array.isArray(node.content)) {
        text = prefix + node.content.map(processNode).join('') + '\n\n';
      }
    } else if (node.type === 'bulletList' || node.type === 'orderedList') {
      if (node.content && Array.isArray(node.content)) {
        text = node.content.map(item => {
          if (item.content && Array.isArray(item.content)) {
            return '- ' + item.content.map(processNode).join('') + '\n';
          }
          return '';
        }).join('');
      }
    } else if (node.type === 'listItem') {
      if (node.content && Array.isArray(node.content)) {
        text = node.content.map(processNode).join('');
      }
    } else if (node.type === 'text') {
      text = node.text || '';
      // Apply marks
      if (node.marks && Array.isArray(node.marks)) {
        node.marks.forEach(mark => {
          if (mark.type === 'strong' || mark.type === 'bold') {
            text = `**${text}**`;
          } else if (mark.type === 'em' || mark.type === 'italic') {
            text = `*${text}*`;
          } else if (mark.type === 'code') {
            text = `\`${text}\``;
          } else if (mark.type === 'link' && mark.attrs?.href) {
            text = `[${text}](${mark.attrs.href})`;
          }
        });
      }
    } else if (node.content && Array.isArray(node.content)) {
      text = node.content.map(processNode).join('');
    }
    
    return text;
  }
  
  if (adf.content && Array.isArray(adf.content)) {
    return adf.content.map(processNode).join('').trim();
  }
  
  return processNode(adf).trim();
}

// Extract Jira ticket from content
function extractJiraTicket(htmlContent) {
  if (!htmlContent) return null;
  // Look for Jira ticket patterns like PROJ-123 or similar
  const match = htmlContent.match(/([A-Z]+-\d+)/);
  return match ? match[1] : null;
}

// Clean generated release note content
function cleanGeneratedReleaseNote(content, headline) {
  if (!content) return '';
  
  let cleaned = content;
  
  // Remove markdown headers from the beginning
  cleaned = cleaned.replace(/^#{1,6}\s+/gm, '');
  
  // If headline is provided and appears at the start, remove it
  if (headline) {
    const headlineRegex = new RegExp(`^\\s*${headline.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\n+`, 'i');
    cleaned = cleaned.replace(headlineRegex, '');
  }
  
  // Remove duplicate titles (if the first line is a title and appears again)
  const lines = cleaned.split('\n');
  if (lines.length > 1) {
    const firstLine = lines[0].trim();
    if (firstLine.length > 0 && firstLine.length < 200) {
      // Check if this title appears again in the content
      const restOfContent = lines.slice(1).join('\n');
      if (restOfContent.includes(firstLine)) {
        // Remove the duplicate from the body
        cleaned = lines[0] + '\n' + restOfContent.replace(new RegExp(`^\\s*${firstLine.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\n+`, 'im'), '');
      }
    }
  }
  
  // Clean up excessive newlines
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();
  
  return cleaned;
}

// Single AI Generation - Generate release note for one or more pages or custom content
app.post('/api/ai/generate-release-note', requirePermission('ai'), async (req, res) => {
  try {
    const { pageIds = [], customContent, headline } = req.body;
    
    if ((!pageIds || pageIds.length === 0) && !customContent) {
      return res.status(400).json({ error: 'Either pageIds or customContent is required' });
    }

    const credentials = getCredentialsFromRequest(req);
    const { confluenceApi, jiraApi } = createApiClients(credentials);
    
    // Get AI API key
    const aiApiKey = req.headers['x-ai-api-key'] || req.headers['X-AI-Api-Key'] || process.env.GEMINI_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY;
    const aiProvider = (req.headers['x-ai-provider'] || req.headers['X-AI-Provider'] || process.env.AI_PROVIDER || 'gemini').toLowerCase();
    
    // Fetch style guide (with caching and update detection)
    let styleGuide = null;
    try {
      const styleGuideData = await fetchStyleGuide(credentials);
      styleGuide = {
        title: styleGuideData.title,
        content: styleGuideData.content
      };
    } catch (e) {
      console.warn('Could not fetch style guide:', e.message);
    }

    // Build content sources
    const contentSources = [];
    const jiraDataList = [];
    
    // Process pages
    for (const pageId of pageIds) {
      try {
        const pageResponse = await confluenceApi.get(`/rest/api/content/${pageId}`, {
          params: { expand: 'body.storage,version,history' }
        });
        const page = pageResponse.data;
        const bodyContent = page.body?.storage?.value || '';
        const jiraTicket = extractJiraTicket(bodyContent);
        
        contentSources.push({
          type: 'confluence',
          title: page.title,
          content: convertConfluenceToText(bodyContent),
          pageId: page.id
        });
        
        // Fetch Jira ticket data if available
        if (jiraTicket) {
          try {
            const jiraResponse = await jiraApi.get(`/rest/api/3/issue/${jiraTicket}`, {
              params: { fields: 'summary,description,assignee,reporter,status,priority,labels,fixVersions,components,issuetype' }
            });
            const fields = jiraResponse.data.fields;
            jiraDataList.push({
              key: jiraTicket,
              summary: fields?.summary,
              description: convertJiraADFToText(fields?.description),
              status: fields?.status?.name,
              assignee: fields?.assignee?.displayName,
              issueType: fields?.issuetype?.name
            });
          } catch (e) {
            console.warn(`Could not fetch Jira ticket ${jiraTicket}:`, e.message);
          }
        }
      } catch (e) {
        console.warn(`Could not fetch page ${pageId}:`, e.message);
      }
    }
    
    // Add custom content if provided
    if (customContent) {
      contentSources.push({
        type: 'custom',
        title: 'Custom Content',
        content: customContent
      });
    }
    
    // Build AI prompt
    let prompt = `You are an expert technical writer creating a product release note. Follow the style guide exactly.\n\n`;
    if (styleGuide) {
      prompt += `## STYLE GUIDE\n\n${styleGuide.content}\n\n`;
    }
    prompt += `## SOURCE CONTENT\n\n`;
    contentSources.forEach((source, idx) => {
      prompt += `### Source ${idx + 1}: ${source.title}\n`;
      prompt += `${source.content}\n\n`;
    });
    
    if (jiraDataList.length > 0) {
      prompt += `## JIRA TICKETS\n\n`;
      jiraDataList.forEach(jira => {
        prompt += `Ticket: ${jira.key}\n`;
        prompt += `Summary: ${jira.summary}\n`;
        if (jira.description) {
          prompt += `Description:\n${jira.description}\n`;
        }
        prompt += `\n`;
      });
    }
    
    prompt += `## INSTRUCTIONS\n\n`;
    prompt += `Based on the style guide and source content above, create a professional release note that:\n`;
    prompt += `1. Follows the style guide requirements exactly\n`;
    prompt += `2. Incorporates relevant information from the source content\n`;
    prompt += `3. Is clear, concise, and customer-focused\n`;
    prompt += `4. Uses appropriate formatting and structure\n`;
    prompt += `5. Highlights key features and improvements\n\n`;
    prompt += `IMPORTANT FORMATTING NOTES:\n`;
    prompt += `- Use markdown headers (##, ###, etc.) for section titles\n`;
    prompt += `- DO NOT use markdown headers (##, ### etc...) for titles\n`;
    prompt += `- Write titles and headings as plain text on their own lines\n`;
    prompt += `- Do NOT repeat the main title/headline in the body content\n`;
    prompt += `- Use bullet points (- or *) for lists\n`;
    prompt += `- Keep formatting simple and clean\n\n`;
    
    if (headline) {
      prompt += `Headline: ${headline}\n\n`;
    }
    
    prompt += `Generate the release note now:\n\n`;
    
    let generatedContent = null;
    let generationError = null;
    
    // If AI API key is provided, actually generate the release note
    if (aiApiKey) {
      try {
        if (aiProvider === 'gemini' || (!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY)) {
          // Use Google Gemini
          const { GoogleGenerativeAI } = require('@google/generative-ai');
          const genAI = new GoogleGenerativeAI(aiApiKey);
          
          // Try multiple model names
          const modelNames = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-1.5-flash', 'gemini-1.5-pro'];
          let lastError = null;
          
          for (const modelName of modelNames) {
            try {
              const model = genAI.getGenerativeModel({ model: modelName });
              const result = await model.generateContent(prompt);
              const response = await result.response;
              generatedContent = response.text();
              break;
            } catch (modelError) {
              lastError = modelError;
              continue;
            }
          }
          
          if (!generatedContent && lastError) {
            throw lastError;
          }
        } else if (aiProvider === 'anthropic' || !process.env.OPENAI_API_KEY) {
          // Use Anthropic Claude
          const { Anthropic } = require('@anthropic-ai/sdk');
          const anthropic = new Anthropic({
            apiKey: aiApiKey
          });
          
          const message = await anthropic.messages.create({
            model: 'claude-3-5-sonnet-20241022',
            max_tokens: 4096,
            messages: [{
              role: 'user',
              content: prompt
            }]
          });
          
          generatedContent = message.content[0].text;
        } else {
          // Use OpenAI
          const openaiResponse = await axios.post('https://api.openai.com/v1/chat/completions', {
            model: 'gpt-4',
            messages: [{
              role: 'user',
              content: prompt
            }],
            max_tokens: 4096
          }, {
            headers: {
              'Authorization': `Bearer ${aiApiKey}`,
              'Content-Type': 'application/json'
            }
          });
          
          generatedContent = openaiResponse.data.choices[0].message.content;
        }
        
        // Clean the generated content
        if (generatedContent) {
          generatedContent = cleanGeneratedReleaseNote(generatedContent, headline);
        }
      } catch (aiError) {
        console.error('AI generation error:', aiError.response?.data || aiError.message);
        generationError = aiError.response?.data?.message || aiError.message;
        generatedContent = null;
      }
    }
    
    res.json({
      prompt: prompt,
      context: {
        styleGuide: styleGuide,
        contentSources: contentSources,
        jiraData: jiraDataList
      },
      generatedContent: generatedContent,
      generationError: generationError,
      aiUsed: !!aiApiKey,
      headline: headline || (contentSources.length > 0 ? contentSources[0].title : 'AI Generated Release Note'),
      message: generatedContent 
        ? 'Release note generated successfully.' 
        : 'Prompt prepared. Use this with an AI model to generate the release note.'
    });
  } catch (error) {
    console.error('Error generating release note:', error);
    res.status(500).json({
      error: 'Failed to generate release note',
      details: error.message
    });
  }
});

// Batch AI Generation - Generate release notes for multiple pages
app.post('/api/ai/batch-generate', requirePermission('ai'), async (req, res) => {
  try {
    const { pageIds, options = {} } = req.body;
    
    if (!pageIds || !Array.isArray(pageIds) || pageIds.length === 0) {
      return res.status(400).json({ error: 'pageIds array is required' });
    }

    const credentials = getCredentialsFromRequest(req);
    const { confluenceApi, jiraApi } = createApiClients(credentials);
    
    // Get AI API key
    const aiApiKey = req.headers['x-ai-api-key'] || req.headers['X-AI-Api-Key'] || process.env.GEMINI_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY;
    const aiProvider = (req.headers['x-ai-provider'] || req.headers['X-AI-Provider'] || process.env.AI_PROVIDER || 'gemini').toLowerCase();
    
    if (!aiApiKey) {
      return res.status(400).json({ error: 'AI API key not configured' });
    }

    // Fetch style guide (with caching and update detection)
    let styleGuide = null;
    try {
      const styleGuideData = await fetchStyleGuide(credentials);
      styleGuide = {
        title: styleGuideData.title,
        content: styleGuideData.content
      };
      if (styleGuideData.wasUpdated) {
        console.log('[Batch AI] Style guide was updated, using new version');
      }
    } catch (e) {
      console.warn('Could not fetch style guide:', e.message);
    }

    const results = [];
    
    // Process each page
    for (const pageId of pageIds) {
      try {
        // Fetch page content
        const pageResponse = await confluenceApi.get(`/rest/api/content/${pageId}`, {
          params: { expand: 'body.storage,version,history' }
        });
        const page = pageResponse.data;
        const bodyContent = page.body?.storage?.value || '';
        const jiraTicket = extractJiraTicket(bodyContent);
        
        // Fetch Jira ticket data if available
        let jiraData = null;
        if (jiraTicket) {
          try {
            const jiraResponse = await jiraApi.get(`/rest/api/3/issue/${jiraTicket}`, {
              params: { fields: 'summary,description,assignee,reporter,status,priority,labels,fixVersions,components,issuetype' }
            });
            const fields = jiraResponse.data.fields;
            jiraData = {
              key: jiraTicket,
              summary: fields?.summary,
              description: convertJiraADFToText(fields?.description),
              status: fields?.status?.name,
              assignee: fields?.assignee?.displayName,
              issueType: fields?.issuetype?.name
            };
          } catch (e) {
            console.warn(`Could not fetch Jira ticket ${jiraTicket}:`, e.message);
          }
        }

        // Build AI prompt
        let prompt = `You are an expert technical writer creating a product release note. Follow the style guide exactly.\n\n`;
        if (styleGuide) {
          prompt += `## STYLE GUIDE\n\n${styleGuide.content}\n\n`;
        }
        prompt += `## SOURCE CONTENT\n\n`;
        prompt += `Page Title: ${page.title}\n`;
        const pageText = convertConfluenceToText(bodyContent);
        prompt += `Content:\n${pageText}\n\n`;
        if (jiraData) {
          prompt += `## JIRA TICKET\n\n`;
          prompt += `Ticket: ${jiraData.key}\n`;
          prompt += `Summary: ${jiraData.summary}\n`;
          if (jiraData.description) {
            prompt += `Description:\n${jiraData.description}\n`;
          }
        }
        prompt += `\n## INSTRUCTIONS\n\n`;
        prompt += `Based on the style guide and source content above, create a professional release note that:\n`;
        prompt += `1. Follows the style guide requirements exactly\n`;
        prompt += `2. Incorporates relevant information from the source content\n`;
        prompt += `3. Is clear, concise, and customer-focused\n`;
        prompt += `4. Uses appropriate formatting and structure\n`;
        prompt += `5. Highlights key features and improvements\n\n`;
        prompt += `IMPORTANT FORMATTING NOTES:\n`;
        prompt += `- Do NOT use markdown headers (##, ###, etc.) for section titles or the main title\n`;
        prompt += `- Write titles and headings as plain text on their own lines\n`;
        prompt += `- Do NOT repeat the main title/headline in the body content\n`;
        prompt += `- Use bullet points (- or *) for lists\n`;
        prompt += `- Keep formatting simple and clean\n\n`;
        prompt += `Generate the release note now:\n\n`;

        // Call AI API
        let generatedContent = null;
        try {
          if (aiProvider === 'gemini' || (!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY)) {
            const { GoogleGenerativeAI } = require('@google/generative-ai');
            const genAI = new GoogleGenerativeAI(aiApiKey);
            const batchModelNames = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-1.5-flash', 'gemini-1.5-pro'];
            let lastBatchError = null;
            for (const modelName of batchModelNames) {
              try {
                const model = genAI.getGenerativeModel({ model: modelName });
                const result = await model.generateContent(prompt);
                const response = await result.response;
                generatedContent = response.text();
                break;
              } catch (modelError) {
                lastBatchError = modelError;
                continue;
              }
            }
            if (!generatedContent && lastBatchError) throw lastBatchError;
          } else if (aiProvider === 'anthropic') {
            const { Anthropic } = require('@anthropic-ai/sdk');
            const anthropic = new Anthropic({ apiKey: aiApiKey });
            const message = await anthropic.messages.create({
              model: 'claude-3-5-sonnet-20241022',
              max_tokens: 4096,
              messages: [{ role: 'user', content: prompt }]
            });
            generatedContent = message.content[0].text;
          }
        } catch (aiError) {
          console.error(`AI generation error for page ${pageId}:`, aiError.message);
          results.push({
            pageId,
            success: false,
            error: aiError.message
          });
          continue;
        }

        // Clean generated content
        if (generatedContent) {
          generatedContent = generatedContent
            .replace(/^#{1,6}\s+/gm, '') // Remove markdown headers
            .replace(/\n{3,}/g, '\n\n')
            .trim();
        }

        // Extract headline
        let headline = page.title;
        if (generatedContent) {
          const lines = generatedContent.split('\n');
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.length > 0 && trimmed.length < 200 && !trimmed.startsWith('*') && !trimmed.startsWith('-')) {
              headline = trimmed;
              break;
            }
          }
        }

        results.push({
          pageId,
          success: true,
          headline,
          content: generatedContent,
          pageTitle: page.title,
          jiraTicket: jiraTicket || null
        });
      } catch (error) {
        console.error(`Error processing page ${pageId}:`, error.message);
        results.push({
          pageId,
          success: false,
          error: error.message
        });
      }
    }

    res.json({
      success: true,
      results,
      total: pageIds.length,
      successful: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length
    });
  } catch (error) {
    console.error('Error in batch AI generation:', error);
    res.status(500).json({
      error: 'Failed to generate release notes',
      details: error.message
    });
  }
});

// AI-powered suggestions for improving existing release notes
app.post('/api/ai/suggest-improvements', requirePermission('ai'), async (req, res) => {
  try {
    const { pageId, content } = req.body;
    
    if (!pageId && !content) {
      return res.status(400).json({ error: 'pageId or content is required' });
    }

    const credentials = getCredentialsFromRequest(req);
    const { confluenceApi } = createApiClients(credentials);
    
    // Get AI API key
    const aiApiKey = req.headers['x-ai-api-key'] || req.headers['X-AI-Api-Key'] || process.env.GEMINI_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY;
    const aiProvider = (req.headers['x-ai-provider'] || req.headers['X-AI-Provider'] || process.env.AI_PROVIDER || 'gemini').toLowerCase();
    
    if (!aiApiKey) {
      return res.status(400).json({ error: 'AI API key not configured' });
    }

    // Fetch style guide (with caching and update detection)
    let styleGuide = null;
    try {
      const styleGuideData = await fetchStyleGuide(credentials);
      styleGuide = styleGuideData.content;
      if (styleGuideData.wasUpdated) {
        console.log('[AI Suggestions] Style guide was updated, using new version');
      }
    } catch (e) {
      console.warn('Could not fetch style guide:', e.message);
    }

    // Get page content if pageId provided
    let pageContent = content;
    let pageTitle = '';
    if (pageId && !content) {
      const pageResponse = await confluenceApi.get(`/rest/api/content/${pageId}`, {
        params: { expand: 'body.storage' }
      });
      pageContent = convertConfluenceToText(pageResponse.data.body?.storage?.value || '');
      pageTitle = pageResponse.data.title;
    }

    // Build AI prompt
    let prompt = `You are an expert technical writer reviewing a release note for improvements.\n\n`;
    if (styleGuide) {
      prompt += `## STYLE GUIDE\n\n${styleGuide}\n\n`;
    }
    prompt += `## CURRENT RELEASE NOTE\n\n`;
    if (pageTitle) {
      prompt += `Title: ${pageTitle}\n\n`;
    }
    prompt += `Content:\n${pageContent}\n\n`;
    prompt += `## TASK\n\n`;
    prompt += `Review this release note and provide specific, actionable suggestions for improvement. Focus on:\n`;
    prompt += `1. Style guide compliance\n`;
    prompt += `2. Clarity and readability\n`;
    prompt += `3. Customer-focused language\n`;
    prompt += `4. Structure and formatting\n`;
    prompt += `5. Completeness\n\n`;
    prompt += `Provide your suggestions in a structured format with:\n`;
    prompt += `- Specific issues found\n`;
    prompt += `- Suggested improvements\n`;
    prompt += `- Priority level (High/Medium/Low)\n\n`;

    // Call AI API
    let suggestions = null;
    try {
      if (aiProvider === 'gemini' || (!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY)) {
        const { GoogleGenerativeAI } = require('@google/generative-ai');
        const genAI = new GoogleGenerativeAI(aiApiKey);
        const suggestModelNames = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-1.5-flash', 'gemini-1.5-pro'];
        let lastSuggestError = null;
        for (const modelName of suggestModelNames) {
          try {
            const model = genAI.getGenerativeModel({ model: modelName });
            const result = await model.generateContent(prompt);
            const response = await result.response;
            suggestions = response.text();
            break;
          } catch (modelError) {
            lastSuggestError = modelError;
            continue;
          }
        }
        if (!suggestions && lastSuggestError) throw lastSuggestError;
      } else if (aiProvider === 'anthropic') {
        const { Anthropic } = require('@anthropic-ai/sdk');
        const anthropic = new Anthropic({ apiKey: aiApiKey });
        const message = await anthropic.messages.create({
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 4096,
          messages: [{ role: 'user', content: prompt }]
        });
        suggestions = message.content[0].text;
      }
    } catch (aiError) {
      console.error('AI suggestions error:', aiError.message);
      return res.status(500).json({
        error: 'Failed to generate suggestions',
        details: aiError.message
      });
    }

    res.json({
      success: true,
      suggestions,
      pageId: pageId || null
    });
  } catch (error) {
    console.error('Error generating suggestions:', error);
    res.status(500).json({
      error: 'Failed to generate suggestions',
      details: error.message
    });
  }
});

// Style guide compliance checker
app.post('/api/ai/check-compliance', requirePermission('ai'), async (req, res) => {
  try {
    const { pageId, content } = req.body;
    
    if (!pageId && !content) {
      return res.status(400).json({ error: 'pageId or content is required' });
    }

    const credentials = getCredentialsFromRequest(req);
    const { confluenceApi } = createApiClients(credentials);

    // Fetch style guide (with caching and update detection)
    let styleGuide = null;
    try {
      const styleGuideData = await fetchStyleGuide(credentials);
      styleGuide = styleGuideData.content;
      if (styleGuideData.wasUpdated) {
        console.log('[Compliance Check] Style guide was updated, using new version');
      }
    } catch (e) {
      console.warn('Could not fetch style guide:', e.message);
      return res.status(500).json({ error: 'Could not fetch style guide' });
    }

    // Get page content if pageId provided
    let pageContent = content;
    let pageTitle = '';
    if (pageId && !content) {
      const pageResponse = await confluenceApi.get(`/rest/api/content/${pageId}`, {
        params: { expand: 'body.storage' }
      });
      pageContent = convertConfluenceToText(pageResponse.data.body?.storage?.value || '');
      pageTitle = pageResponse.data.title;
    }

    // Basic compliance checks (without AI)
    const issues = [];
    const warnings = [];
    
    // Check for required elements
    if (!pageContent || pageContent.trim().length < 50) {
      issues.push({
        type: 'error',
        category: 'completeness',
        message: 'Release note content is too short or empty',
        priority: 'high'
      });
    }

    // Check for markdown headers (should not be used)
    if (pageContent.match(/^#{1,6}\s+/m)) {
      warnings.push({
        type: 'warning',
        category: 'formatting',
        message: 'Markdown headers (##) detected. Use plain text headings instead.',
        priority: 'medium'
      });
    }

    // Check for negative language in titles
    if (pageTitle) {
      const negativeWords = ['bug', 'broken', 'fix', 'issue', 'problem', 'error', 'fail'];
      const hasNegative = negativeWords.some(word => pageTitle.toLowerCase().includes(word));
      if (hasNegative && !pageTitle.toLowerCase().includes('bug fix')) {
        warnings.push({
          type: 'warning',
          category: 'tone',
          message: 'Title may contain negative language. Consider reframing positively.',
          priority: 'medium'
        });
      }
    }

    // Check for customer-focused language
    const customerFocused = /(you|your|customers?|users?)/i.test(pageContent);
    if (!customerFocused && pageContent.length > 100) {
      warnings.push({
        type: 'warning',
        category: 'tone',
        message: 'Consider using more customer-focused language (you, your)',
        priority: 'low'
      });
    }

    // Check for uncertain language
    const uncertainWords = /\b(might|may|perhaps|possibly|maybe)\b/i;
    if (uncertainWords.test(pageContent)) {
      warnings.push({
        type: 'warning',
        category: 'clarity',
        message: 'Uncertain language detected. Use confident, clear statements.',
        priority: 'medium'
      });
    }

    // Calculate compliance score
    const totalChecks = issues.length + warnings.length;
    const errorCount = issues.length;
    const warningCount = warnings.length;
    const score = totalChecks > 0 
      ? Math.max(0, 100 - (errorCount * 20) - (warningCount * 5))
      : 100;

    res.json({
      success: true,
      compliance: {
        score,
        issues,
        warnings,
        totalIssues: issues.length,
        totalWarnings: warnings.length
      },
      pageId: pageId || null,
      pageTitle: pageTitle || null
    });
  } catch (error) {
    console.error('Error checking compliance:', error);
    res.status(500).json({
      error: 'Failed to check compliance',
      details: error.message
    });
  }
});

// Create LaunchNotes draft from Confluence page
app.post('/api/launchnotes/create-draft', requirePermission('launchnotes'), async (req, res) => {
  try {
    const { pageId, content, title, selectedSections, externalContentLinks: bodyExternalLinks, jiraTicket: bodyJiraTicket } = req.body;
    const credentials = getCredentialsFromRequest(req);
    const { confluenceApi } = createApiClients(credentials);
    
    // Get LaunchNotes credentials from request headers
    const useSandbox = req.headers['x-launchnotes-use-sandbox'] === 'true' || req.headers['X-Launchnotes-Use-Sandbox'] === 'true';
    
    let launchnotesApiUrl, launchnotesApiKey, launchnotesProjectId;
    
    if (useSandbox) {
      // Hardcoded sandbox credentials for testing
      launchnotesApiUrl = 'https://app.launchnotes.io';
      launchnotesApiKey = 'manage_5Vpg4TSKelwDJ8mLLof5UKW2';
      launchnotesProjectId = 'pro_c3ZUp1d2X9bpj';
    } else {
      launchnotesApiUrl = req.headers['x-launchnotes-api-url'] || req.headers['X-Launchnotes-Api-Url'] || process.env.LAUNCHNOTES_API_URL;
      launchnotesApiKey = req.headers['x-launchnotes-api-key'] || req.headers['X-Launchnotes-Api-Key'] || process.env.LAUNCHNOTES_API_KEY;
      launchnotesProjectId = req.headers['x-launchnotes-project-id'] || req.headers['X-Launchnotes-Project-Id'] || process.env.LAUNCHNOTES_PROJECT_ID;
    }
    
    if (!launchnotesApiUrl || !launchnotesApiKey) {
      return res.status(400).json({ 
        error: 'LaunchNotes API credentials not configured', 
        details: 'Please configure LaunchNotes API URL and API Key in settings' 
      });
    }
    
    if (!launchnotesProjectId) {
      return res.status(400).json({ 
        error: 'LaunchNotes Project ID not configured', 
        details: 'Please configure LaunchNotes Project ID in settings.' 
      });
    }
    
    // Get page content if not provided
    let pageTitle = title;
    let pageContent = content;
    let pageIdForImages = pageId;
    let baseUrlForImages = '';
    
    if (!pageContent && pageId) {
      const pageResponse = await confluenceApi.get(`/rest/api/content/${pageId}`, { 
        params: { expand: 'body.storage,version,history' } 
      });
      const page = pageResponse.data;
      pageTitle = pageTitle || page.title;
      pageContent = page.body?.storage?.value || '';
      pageIdForImages = page.id;
      
      // Get base URL from credentials for image URLs
      baseUrlForImages = credentials.baseUrl || '';
      if (baseUrlForImages && !baseUrlForImages.endsWith('/wiki')) {
        // Ensure we have the /wiki path for Confluence
        baseUrlForImages = baseUrlForImages.replace(/\/$/, '') + '/wiki';
      }
      baseUrlForImages = baseUrlForImages.replace(/\/$/, ''); // Remove trailing slash
    }
    
    // Process content (extract sections if needed)
    let processedContent = pageContent;
    if (selectedSections && selectedSections.length > 0) {
      processedContent = extractSections(pageContent, selectedSections);
    }
    
    // When content was provided in request body (e.g. AI Hub or batch AI), treat as already markdown to preserve styling
    const isContentFromClient = !!content;
    let markdownContent;
    if (isContentFromClient && processedContent) {
      markdownContent = processedContent;
    } else {
      // Convert Confluence HTML to Markdown (preserving formatting and images)
      markdownContent = convertConfluenceToMarkdown(processedContent, baseUrlForImages);
    }
    
    // Replace {PAGE_ID} placeholder in image URLs with actual page ID
    let finalMarkdown = pageIdForImages 
      ? markdownContent.replace(/{PAGE_ID}/g, pageIdForImages)
      : markdownContent;
    
    // Try to get proper attachment URLs for images if we have pageId and API access
    if (pageIdForImages && baseUrlForImages && confluenceApi) {
      try {
        // Get page attachments to build proper URLs
        const attachmentsResponse = await confluenceApi.get(`/rest/api/content/${pageIdForImages}/child/attachment`, {
          params: { expand: 'metadata' }
        });
        const attachments = attachmentsResponse.data?.results || [];
        
        // Create a map of filename to download URL
        const attachmentMap = {};
        attachments.forEach(att => {
          const filename = att.title;
          // Build download URL: {baseUrl}/download/attachments/{pageId}/{filename}
          const downloadUrl = `${baseUrlForImages}/download/attachments/${pageIdForImages}/${encodeURIComponent(filename)}`;
          attachmentMap[filename] = downloadUrl;
        });
        
        // Replace image URLs with proper download URLs
        finalMarkdown = finalMarkdown.replace(
          /!\[([^\]]*)\]\(([^)]*\/download\/attachments\/[^/]+\/([^)]+))\)/g,
          (match, altText, url, filename) => {
            // If we have the attachment in our map, use the proper URL
            if (attachmentMap[filename]) {
              return `![${altText}](${attachmentMap[filename]})`;
            }
            return match; // Keep original if not found
          }
        );
        
        console.log(`[LaunchNotes] Found ${attachments.length} attachment(s) for page ${pageIdForImages}`);
      } catch (attachmentError) {
        console.warn('[LaunchNotes] Could not fetch attachments (non-fatal):', attachmentError.message);
        // Continue without attachment URLs - images will use placeholder URLs
      }
    }
    
    // Log content for debugging
    console.log('[LaunchNotes] Page content length:', pageContent?.length || 0);
    console.log('[LaunchNotes] Processed content length:', processedContent?.length || 0);
    console.log('[LaunchNotes] Markdown length:', finalMarkdown?.length || 0);
    console.log('[LaunchNotes] Markdown preview (first 300 chars):', finalMarkdown?.substring(0, 300) || 'EMPTY');
    
    // Check for images in markdown (will be counted later in response)
    const hasImages = (finalMarkdown.match(/!\[.*?\]\(.*?\)/g) || []).length > 0;
    if (hasImages) {
      console.log(`[LaunchNotes] Found images in content`);
    }

    // Build external content links (JPD/Jira ticket) for LaunchNotes
    const jiraBaseUrl = credentials.baseUrl ? credentials.baseUrl.replace(/\/wiki\/?$/, '') : 'https://toasttab.atlassian.net';
    let externalLinks = [];
    if (bodyExternalLinks && Array.isArray(bodyExternalLinks) && bodyExternalLinks.length > 0) {
      externalLinks = bodyExternalLinks.filter(l => l && (l.title || l.url)).map(l => ({
        title: (l.title || l.url || 'Link').trim(),
        url: (l.url || '').trim()
      })).filter(l => l.url);
    } else if (bodyJiraTicket && typeof bodyJiraTicket === 'string' && bodyJiraTicket.trim()) {
      const ticket = bodyJiraTicket.trim();
      externalLinks = [{ title: ticket, url: `${jiraBaseUrl}/browse/${ticket}` }];
    } else if (pageContent || pageTitle) {
      const jiraTicket = extractJiraTicket(pageContent || processedContent) || extractJiraTicketFromTitle(pageTitle);
      if (jiraTicket) {
        externalLinks = [{ title: jiraTicket, url: `${jiraBaseUrl}/browse/${jiraTicket}` }];
        console.log('[LaunchNotes] Extracted Jira ticket for external link:', jiraTicket);
      }
    }
    if (externalLinks.length > 0) {
      console.log('[LaunchNotes] External content links to add:', externalLinks);
    }

    // Build GraphQL endpoint
    let graphqlEndpoint = launchnotesApiUrl;
    if (!graphqlEndpoint || graphqlEndpoint === 'https://app.launchnotes.io' || graphqlEndpoint === 'app.launchnotes.io') {
      graphqlEndpoint = 'https://app.launchnotes.io/graphql';
    } else {
      if (!graphqlEndpoint.endsWith('/graphql')) {
        if (!graphqlEndpoint.startsWith('http://') && !graphqlEndpoint.startsWith('https://')) {
          graphqlEndpoint = `https://${graphqlEndpoint}`;
        }
        graphqlEndpoint = `${graphqlEndpoint.replace(/\/$/, '')}/graphql`;
      }
    }
    
    // Trim and validate project ID (FIXED: declare before use)
    const trimmedProjectId = launchnotesProjectId?.trim();
    if (!trimmedProjectId) {
      return res.status(400).json({ 
        error: 'LaunchNotes Project ID is required', 
        details: 'Project ID cannot be empty' 
      });
    }
    
    // Create announcement mutation - use contentMarkdown when available to preserve markdown styling
    const createMutationWithContent = `mutation CreateDraftAnnouncement($projectId: ID!, $headline: String, $contentMarkdown: String) { 
      createAnnouncement(input: { 
        announcement: { 
          projectId: $projectId
          headline: $headline
          contentMarkdown: $contentMarkdown
        } 
      }) { 
        announcement { id headline } 
        errors { message path } 
      } 
    }`;
    const createMutationWithHeadline = `mutation CreateDraftAnnouncement($projectId: ID!, $headline: String) { 
      createAnnouncement(input: { 
        announcement: { 
          projectId: $projectId
          headline: $headline
        } 
      }) { 
        announcement { id headline } 
        errors { message path } 
      } 
    }`;
    const createMutationSimple = `mutation CreateDraftAnnouncement($projectId: ID!) { 
      createAnnouncement(input: { 
        announcement: { 
          projectId: $projectId
        } 
      }) { 
        announcement { id headline } 
        errors { message path } 
      } 
    }`;
    
    // Log what we're about to send
    console.log('[LaunchNotes] Creating announcement with:');
    console.log('  - Project ID:', trimmedProjectId);
    console.log('  - Headline:', pageTitle || '(none)');
    console.log('  - Content available:', finalMarkdown ? `${finalMarkdown.length} chars (markdown)` : 'none');
    console.log('  - GraphQL endpoint:', graphqlEndpoint);
    
    let createVariables = { 
      projectId: String(trimmedProjectId).trim()
    };
    if (pageTitle && pageTitle.trim().length > 0) {
      createVariables.headline = pageTitle.trim();
    }
    if (finalMarkdown && finalMarkdown.trim().length > 0) {
      createVariables.contentMarkdown = finalMarkdown.trim();
    }
    let createQuery = createMutationSimple;
    if (createVariables.contentMarkdown) {
      createQuery = createMutationWithContent;
    } else if (createVariables.headline) {
      createQuery = createMutationWithHeadline;
    }
    let requestPayload = { 
      query: createQuery,
      variables: createVariables
    };
    
    console.log('[LaunchNotes] Create request payload:', JSON.stringify({
      query: requestPayload.query.substring(0, 100) + '...',
      variables: requestPayload.variables
    }, null, 2));
    
    let createResponse;
    
    try {
      createResponse = await axios.post(graphqlEndpoint, requestPayload, { 
        headers: { 
          'Authorization': `Bearer ${launchnotesApiKey}`, 
          'Content-Type': 'application/json' 
        } 
      });
      
      console.log('[LaunchNotes] Create response status:', createResponse.status);
      console.log('[LaunchNotes] Create response data:', JSON.stringify(createResponse.data, null, 2));
      
      // If headline or contentMarkdown failed, fall back to simpler creation
      const errs = createResponse.data.errors || createResponse.data.data?.createAnnouncement?.errors || [];
      const hasFieldError = errs.some(e => 
        (e.message && (e.message.includes('headline') || e.message.includes('Headline') || e.message.includes('contentMarkdown') || e.message.includes('content')))
      );
      
      if (hasFieldError && (createVariables.headline || createVariables.contentMarkdown)) {
        console.log('[LaunchNotes] Create with headline/content failed, falling back to simple creation');
        requestPayload = { 
          query: createMutationSimple.trim(), 
          variables: { projectId: String(trimmedProjectId).trim() } 
        };
        createResponse = await axios.post(graphqlEndpoint, requestPayload, { 
          headers: { 
            'Authorization': `Bearer ${launchnotesApiKey}`, 
            'Content-Type': 'application/json' 
          } 
        });
        console.log('[LaunchNotes] Simple create response:', JSON.stringify(createResponse.data, null, 2));
      }
    } catch (error) {
      // Fall back to simple creation on error
      console.error('[LaunchNotes] Error creating announcement:', error.response?.data || error.message);
      console.log('[LaunchNotes] Falling back to simple creation');
      requestPayload = { 
        query: createMutationSimple.trim(), 
        variables: { projectId: String(trimmedProjectId).trim() } 
      };
      createResponse = await axios.post(graphqlEndpoint, requestPayload, { 
        headers: { 
          'Authorization': `Bearer ${launchnotesApiKey}`, 
          'Content-Type': 'application/json' 
        } 
      });
      console.log('[LaunchNotes] Fallback create response:', JSON.stringify(createResponse.data, null, 2));
    }
    
    if (createResponse.data.errors) {
      return res.status(400).json({ 
        error: 'Failed to create LaunchNotes draft', 
        details: createResponse.data.errors.map(e => e.message || JSON.stringify(e)).join(', ') 
      });
    }
    
    const createResult = createResponse.data.data?.createAnnouncement;
    if (createResult?.errors && createResult.errors.length > 0) {
      return res.status(400).json({ 
        error: 'Failed to create LaunchNotes draft', 
        details: createResult.errors.map(e => e.message || JSON.stringify(e)).join(', ') 
      });
    }
    
    const announcement = createResult?.announcement;
    if (!announcement || !announcement.id) {
      return res.status(500).json({ 
        error: 'Failed to create LaunchNotes draft', 
        details: 'No announcement ID returned from API.' 
      });
    }
    
    const announcementId = announcement.id;
    
    // Update headline if needed, then try to add content safely
    const createdHeadline = announcement.headline;
    const needsHeadlineUpdate = pageTitle && pageTitle.trim() && (!createdHeadline || createdHeadline !== pageTitle.trim());
    
    if (needsHeadlineUpdate) {
      console.log('[LaunchNotes] Updating headline');
      const updateMutation = `mutation UpdateAnnouncement($announcement: UpdateAnnouncementAttributes!) { 
        updateAnnouncement(input: { announcement: $announcement }) { 
          announcement { id headline } 
          errors { message path } 
        } 
      }`;
      
      const updateVariables = { 
        announcement: { 
          id: announcementId,
          headline: pageTitle.trim()
        } 
      };
      
      try {
        const updateResponse = await axios.post(graphqlEndpoint, { 
          query: updateMutation.trim(), 
          variables: updateVariables 
        }, { 
          headers: { 
            'Authorization': `Bearer ${launchnotesApiKey}`, 
            'Content-Type': 'application/json' 
          } 
        });
        
        if (updateResponse.data.errors || updateResponse.data.data?.updateAnnouncement?.errors?.length > 0) {
          const errors = updateResponse.data.errors || updateResponse.data.data?.updateAnnouncement?.errors || [];
          console.warn('[LaunchNotes] Headline update had errors (non-fatal):', errors);
        } else {
          console.log('[LaunchNotes] Successfully updated headline');
        }
      } catch (updateError) {
        console.warn('[LaunchNotes] Headline update failed (non-fatal):', updateError.response?.data || updateError.message);
      }
    } else {
      console.log('[LaunchNotes] Headline already set during creation, skipping update');
    }

    // Add external content links (e.g. Jira JPD ticket) so they appear on the LaunchNotes announcement
    const createExternalLinkMutation = `mutation CreateExternalContentLink($input: CreateExternalContentLinkInput!) {
      createExternalContentLink(input: $input) {
        errors { message path }
        stage { id }
      }
    }`;
    for (const link of externalLinks) {
      if (!link.url || !link.title) continue;
      try {
        const linkResponse = await axios.post(graphqlEndpoint, {
          query: createExternalLinkMutation,
          variables: {
            input: {
              externalContentLink: {
                ownerId: announcementId,
                title: link.title,
                url: link.url
              }
            }
          }
        }, {
          headers: {
            'Authorization': `Bearer ${launchnotesApiKey}`,
            'Content-Type': 'application/json'
          }
        });
        const linkErrors = linkResponse.data?.errors || linkResponse.data?.data?.createExternalContentLink?.errors || [];
        if (linkErrors.length > 0) {
          console.warn('[LaunchNotes] External link creation had errors (non-fatal):', linkErrors);
        } else {
          console.log('[LaunchNotes] Added external content link:', link.title, link.url);
        }
      } catch (linkErr) {
        console.warn('[LaunchNotes] Failed to add external content link (non-fatal):', linkErr.response?.data || linkErr.message);
      }
    }
    
    // Try to add content only if we didn't send it on create (e.g. fallback from contentMarkdown)
    if (finalMarkdown && finalMarkdown.trim().length > 0 && !createVariables.contentMarkdown) {
      console.log(`[LaunchNotes] Attempting to add content (${finalMarkdown.length} chars, Markdown format)`);
      
      const updateMutation = `mutation UpdateAnnouncement($announcement: UpdateAnnouncementAttributes!) { 
        updateAnnouncement(input: { announcement: $announcement }) { 
          announcement { id headline } 
          errors { message path } 
        } 
      }`;
      
      // Try the simplest possible format first: just a JSON string containing the markdown
      // This is the most basic format that should work if LaunchNotes accepts JSON
      const contentAsJsonString = JSON.stringify(finalMarkdown.trim());
      
      const updateVariables = { 
        announcement: { 
          id: announcementId,
          content: contentAsJsonString
        } 
      };
      
      console.log('[LaunchNotes] Content update attempt - format: JSON stringified Markdown');
      console.log('[LaunchNotes] Content preview:', finalMarkdown.substring(0, 200) + '...');
      
      try {
        const updateResponse = await axios.post(graphqlEndpoint, { 
          query: updateMutation.trim(), 
          variables: updateVariables 
        }, { 
          headers: { 
            'Authorization': `Bearer ${launchnotesApiKey}`, 
            'Content-Type': 'application/json' 
          } 
        });
        
        console.log('[LaunchNotes] Content update response:', JSON.stringify(updateResponse.data, null, 2));
        
        // Check for errors
        const hasErrors = updateResponse.data.errors?.length > 0 || 
                         updateResponse.data.data?.updateAnnouncement?.errors?.length > 0;
        
        if (hasErrors) {
          const errors = updateResponse.data.errors || updateResponse.data.data?.updateAnnouncement?.errors || [];
          console.warn('[LaunchNotes] Content update failed (non-fatal - announcement still created):', errors);
          console.warn('[LaunchNotes] Content can be added manually in LaunchNotes UI');
          // Don't fail - announcement was created successfully
        } else {
          console.log('[LaunchNotes] Successfully added content to announcement!');
        }
      } catch (updateError) {
        console.warn('[LaunchNotes] Content update error (non-fatal - announcement still created):', 
          updateError.response?.data || updateError.message);
        console.warn('[LaunchNotes] Content can be added manually in LaunchNotes UI');
        // Don't fail - announcement was created successfully
      }
    } else {
      console.log('[LaunchNotes] No content available to add');
    }
    
    // Determine if content was successfully added
    const contentAdded = finalMarkdown && finalMarkdown.trim().length > 0;
    const imageCount = contentAdded ? (finalMarkdown.match(/!\[.*?\]\(.*?\)/g) || []).length : 0;
    
    res.json({ 
      success: true, 
      announcementId: announcementId, 
      headline: pageTitle || announcement.headline || null,
      message: 'LaunchNotes draft created successfully' + (contentAdded ? ' with content' : ''),
      contentAdded: contentAdded,
      contentFormat: 'markdown',
      imageCount: imageCount
    });
  } catch (error) {
    console.error('[LaunchNotes] Error creating draft:', error.response?.data || error.message);
    res.status(500).json({ 
      error: 'Failed to create LaunchNotes draft', 
      details: error.response?.data?.message || error.message 
    });
  }
});

// Serve static files in production or when running in Electron
const isElectron = process.env.ELECTRON_RUN_AS_NODE !== undefined || process.versions.electron !== undefined;
if (process.env.NODE_ENV === 'production' || isElectron) {
  const buildPath = path.join(__dirname, '../client/build');
  app.use(express.static(buildPath));
  
  app.get('*', (req, res) => {
    res.sendFile(path.join(buildPath, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║       Confluence Release Manager Server Running            ║
╠════════════════════════════════════════════════════════════╣
║  Server:  http://localhost:${PORT}                            ║
║  API:     http://localhost:${PORT}/api                        ║
╠════════════════════════════════════════════════════════════╣
║  Statuses configured:                                      ║
║    Draft:        ${PAGE_STATUSES.draft.pageId.padEnd(20)}       ║
║    In Progress:  ${PAGE_STATUSES.inProgress.pageId.padEnd(20)}       ║
║    Needs Action: ${PAGE_STATUSES.needsAction.pageId.padEnd(20)}       ║
║    Published:    ${PAGE_STATUSES.published.pageId.padEnd(20)}       ║
║    Discarded:    ${PAGE_STATUSES.discard.pageId.padEnd(20)}       ║
╚════════════════════════════════════════════════════════════╝
  `);
});
