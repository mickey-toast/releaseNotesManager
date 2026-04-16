const express = require('express');
const axios = require('axios');
const router = express.Router();

// In-memory cache for feature flags data
let featureFlagsCache = {
  data: null,
  timestamp: null,
  ttl: 5 * 60 * 1000 // 5 minutes default TTL
};

// Constants
const LD_BASE = 'https://app.launchdarkly.com/api/v2';
const LD_PROJECT = 'toastmobile';
const LD_ENV = 'production';
const LN_GRAPHQL = 'https://app.launchnotes.io/graphql';
const LN_PROJECT_ID = 'pro_EtBG4hh8w3LBq';

// Helper functions
function extractJpdKey(url) {
  if (!url) return null;
  const browseMatch = url.match(/\/browse\/([A-Z][A-Z0-9]+-\d+)/i);
  if (browseMatch) return browseMatch[1].toUpperCase();
  const queryMatch = url.match(/[?&]selectedIssue=([A-Z][A-Z0-9]+-\d+)/i);
  if (queryMatch) return queryMatch[1].toUpperCase();
  return null;
}

function extractJpdKeyFromFlagLinks(items) {
  if (!Array.isArray(items)) return null;
  for (const item of items) {
    const key = extractJpdKey(item._deepLink) || extractJpdKey(item.url);
    if (key) return key;
  }
  return null;
}

function extractAllJiraKeysFromFlagLinks(items) {
  if (!Array.isArray(items)) return [];
  const keys = [];
  const seen = {};
  for (const item of items) {
    const key = extractJpdKey(item._deepLink) || extractJpdKey(item.url);
    if (key && !seen[key]) {
      keys.push(key);
      seen[key] = true;
    }
  }
  return keys;
}

function extractJpdKeyFromExternalLinks(links) {
  if (!Array.isArray(links)) {
    console.log('[DEBUG] externalContentLinks is not an array:', typeof links, links);
    return null;
  }
  if (links.length === 0) {
    return null;
  }
  for (const link of links) {
    const key = extractJpdKey(link.url);
    if (key) return key;
  }
  return null;
}

function extractTier(tags) {
  if (!Array.isArray(tags)) return null;
  for (const tag of tags) {
    if (/^tier\d+$/i.test(tag)) return tag.toLowerCase();
  }
  return null;
}

function extractReleaseVersion(tags) {
  if (!Array.isArray(tags)) return null;
  for (const tag of tags) {
    if (/^\d+\.\d+(\.\d+)?$/.test(tag)) return tag;
  }
  return null;
}

function requiresJpd(tags) {
  const tier = extractTier(tags);
  return tier === 'tier1' || tier === 'tier2' || tier === 'tier3';
}

function isJpdIssue(issue) {
  if (!issue || !issue.issueType) return false;
  // Accept JPD-specific types AND common Jira types that represent product work
  const jpdTypes = ['Idea', 'Small Change'];
  const productTypes = ['Story', 'Epic', 'Bug', 'Task', 'Sub-task'];
  return jpdTypes.includes(issue.issueType) || productTypes.includes(issue.issueType);
}

function formatRollout(flag) {
  const prod = flag.environments && flag.environments.production;
  if (!prod) return { status: 'OFF', percentage: 0 };

  const variations = flag.variations || [];
  const getLabel = (idx) => {
    const v = variations[idx];
    if (!v) return '?';
    if (v.name) return v.name;
    return String(v.value);
  };

  if (!prod.on) {
    const offLabel = prod.offVariation !== undefined ? getLabel(prod.offVariation) : 'OFF';
    return { status: 'OFF', percentage: 0, label: offLabel };
  }

  // Calculate percentage from rollout
  const rules = prod.rules || [];
  const ft = prod.fallthrough;

  // For boolean flags, try to calculate percentage of "true" variation
  let onPercentage = 0;

  if (ft && ft.rollout && ft.rollout.variations) {
    // Find the "true" variation and get its percentage
    for (const rv of ft.rollout.variations) {
      const varLabel = getLabel(rv.variation);
      if (varLabel === 'true' || varLabel === 'True' || rv.variation === 1) {
        onPercentage = Math.round((rv.weight / 1000));
        break;
      }
    }
  } else if (ft && ft.variation !== undefined) {
    const varLabel = getLabel(ft.variation);
    if (varLabel === 'true' || varLabel === 'True' || ft.variation === 1) {
      onPercentage = 100;
    }
  }

  // If there are targeting rules, it's more complex
  if (rules.length > 0) {
    return { status: 'ON', percentage: onPercentage, label: `${rules.length} rules` };
  }

  return { status: 'ON', percentage: onPercentage };
}

// Fetch all flags from LaunchDarkly
async function fetchAllFlags(ldApiKey) {
  const all = [];
  let offset = 0;
  const limit = 100;
  let hasMore = true;

  while (hasMore) {
    const url = `${LD_BASE}/flags/${LD_PROJECT}?env=${LD_ENV}&summary=false&limit=${limit}&offset=${offset}`;

    const response = await axios.get(url, {
      headers: { Authorization: ldApiKey }
    });

    if (!response.data.items || response.data.items.length === 0) {
      hasMore = false;
    } else {
      all.push(...response.data.items);
      offset += response.data.items.length;
      hasMore = response.data.items.length === limit;
      await new Promise(resolve => setTimeout(resolve, 50)); // Rate limit
    }
  }

  return all;
}

// Fetch flag-links for a flag
async function fetchFlagLinks(flagKey, ldApiKey) {
  const url = `${LD_BASE}/flag-links/projects/${LD_PROJECT}/flags/${flagKey}`;

  try {
    const response = await axios.get(url, {
      headers: {
        Authorization: ldApiKey,
        'LD-API-Version': 'beta'
      }
    });
    return Array.isArray(response.data.items) ? response.data.items : [];
  } catch (error) {
    console.error(`fetchFlagLinks error for ${flagKey}:`, error.message);
    return [];
  }
}

// Fetch Jira issue details
async function fetchJiraIssue(issueKey, jiraEmail, jiraToken, jiraBaseUrl) {
  const auth = Buffer.from(`${jiraEmail}:${jiraToken}`).toString('base64');
  const url = `${jiraBaseUrl}/rest/api/3/issue/${issueKey}?fields=summary,status,issuetype`;

  try {
    const response = await axios.get(url, {
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: 'application/json'
      }
    });

    return {
      key: response.data.key,
      summary: response.data.fields?.summary || '',
      status: response.data.fields?.status?.name || '',
      issueType: response.data.fields?.issuetype?.name || ''
    };
  } catch (error) {
    console.error(`fetchJiraIssue error for ${issueKey}:`, error.message);
    return { key: issueKey, summary: '', status: '', issueType: '' };
  }
}

// Fetch all announcements from LaunchNotes
async function fetchAllAnnouncements(lnApiToken) {
  const all = [];
  let cursor = null;
  let hasNext = true;
  const pageSize = 100;

  while (hasNext) {
    const query = `
      query FetchAnnouncements($projectId: ID!, $first: Int!, $after: String) {
        project(id: $projectId) {
          announcements(first: $first, after: $after) {
            edges { node {
              id title state publishedAt publicPermalink
              externalContentLinks { id url title }
            }}
            pageInfo { hasNextPage endCursor }
          }
        }
      }
    `;

    const variables = {
      projectId: LN_PROJECT_ID,
      first: pageSize,
      after: cursor
    };

    const response = await axios.post(LN_GRAPHQL,
      { query, variables },
      { headers: { Authorization: `Bearer ${lnApiToken}` } }
    );

    if (response.data.errors) {
      throw new Error(`LaunchNotes GraphQL error: ${JSON.stringify(response.data.errors)}`);
    }

    const conn = response.data.data.project.announcements;
    all.push(...conn.edges.map(e => e.node));

    hasNext = conn.pageInfo.hasNextPage;
    cursor = conn.pageInfo.endCursor;
    await new Promise(resolve => setTimeout(resolve, 50)); // Rate limit
  }

  return all;
}

// Main pipeline function
async function fetchFeatureFlagsData(ldApiKey, lnApiToken, jiraEmail, jiraToken, jiraBaseUrl) {
  console.log('Fetching feature flags from LaunchDarkly...');
  const flags = await fetchAllFlags(ldApiKey);

  console.log('Fetching announcements from LaunchNotes...');
  const announcements = await fetchAllAnnouncements(lnApiToken);

  // Enrich announcements with JPD keys
  console.log(`[FeatureFlags] Processing ${announcements.length} announcements`);
  announcements.forEach(ann => {
    ann.jpdKey = extractJpdKeyFromExternalLinks(ann.externalContentLinks);
  });

  // Debug: Log sample announcement to see structure
  if (announcements.length > 0) {
    const sample = announcements[0];
    console.log('[FeatureFlags] Sample announcement:', {
      title: sample.title,
      hasExternalLinks: !!sample.externalContentLinks,
      externalContentLinksType: typeof sample.externalContentLinks,
      externalContentLinksIsArray: Array.isArray(sample.externalContentLinks),
      linkCount: sample.externalContentLinks?.length || 0,
      rawLinks: sample.externalContentLinks,
      links: Array.isArray(sample.externalContentLinks) ? sample.externalContentLinks.map(l => l.url) : 'not an array',
      extractedJpd: sample.jpdKey
    });

    // Find an announcement with actual links for debugging
    const withLinks = announcements.find(a => Array.isArray(a.externalContentLinks) && a.externalContentLinks.length > 0);
    if (withLinks) {
      console.log('[FeatureFlags] Example announcement WITH links:', {
        title: withLinks.title,
        linkCount: withLinks.externalContentLinks.length,
        firstLink: withLinks.externalContentLinks[0],
        extractedJpd: extractJpdKeyFromExternalLinks(withLinks.externalContentLinks)
      });
    }
  }

  // Build announcement map: jpdKey → announcement
  const annMap = {};
  announcements.forEach(ann => {
    if (ann.jpdKey && !annMap[ann.jpdKey]) {
      annMap[ann.jpdKey] = ann;
    }
  });

  // Filter tier flags (exclude tier4, tier5)
  const tierFlags = flags.filter(f => {
    const tier = extractTier(f.tags);
    return tier !== 'tier4' && tier !== 'tier5';
  });

  console.log(`Fetching Jira links for ${tierFlags.length} tier flags...`);

  // Fetch flag-links for tier flags
  let flagsWithLinks = 0;
  for (const flag of tierFlags) {
    if (requiresJpd(flag.tags)) {
      const items = await fetchFlagLinks(flag.key, ldApiKey);
      flag.allJiraKeys = extractAllJiraKeysFromFlagLinks(items);
      if (flag.allJiraKeys.length > 0) {
        flagsWithLinks++;
      }
      await new Promise(resolve => setTimeout(resolve, 50)); // Rate limit
    } else {
      flag.allJiraKeys = [];
    }
  }
  console.log(`[FeatureFlags] ${flagsWithLinks} flags have flag-links with Jira keys`);

  // Collect unique Jira keys
  const jiraKeys = {};
  tierFlags.forEach(flag => {
    if (Array.isArray(flag.allJiraKeys)) {
      flag.allJiraKeys.forEach(key => {
        if (key) jiraKeys[key] = true;
      });
    }
  });

  console.log(`Fetching JIRA details for ${Object.keys(jiraKeys).length} Jira tickets...`);

  // Fetch JIRA details
  const jiraMap = {};
  for (const key of Object.keys(jiraKeys)) {
    jiraMap[key] = await fetchJiraIssue(key, jiraEmail, jiraToken, jiraBaseUrl);
    await new Promise(resolve => setTimeout(resolve, 100)); // Rate limit
  }

  // Use all Jira keys - trust that the flag-links exist even if we can't fetch Jira details
  let totalJiraKeys = 0;
  let matchedJiraKeys = 0;
  let fetchedDetails = 0;
  const issueTypeCounts = {};

  tierFlags.forEach(flag => {
    if (!Array.isArray(flag.allJiraKeys) || flag.allJiraKeys.length === 0) {
      flag.jpdKey = null;
      return;
    }

    totalJiraKeys += flag.allJiraKeys.length;

    // Use the first Jira key that exists in the map (even if details are missing)
    // This trusts LaunchDarkly flag-links even when Jira fetch fails
    const validKeys = flag.allJiraKeys.filter(key => {
      const issue = jiraMap[key];
      if (issue) {
        if (issue.issueType) {
          issueTypeCounts[issue.issueType] = (issueTypeCounts[issue.issueType] || 0) + 1;
          fetchedDetails++;
        }
        // Accept any key that exists in the map (even 404s)
        return true;
      }
      return false;
    });

    if (validKeys.length > 0) {
      matchedJiraKeys++;
    }

    flag.jpdKey = validKeys.length > 0 ? validKeys[0] : null;
  });

  console.log(`[FeatureFlags] Jira processing: ${totalJiraKeys} total keys, ${matchedJiraKeys} flags with Jira links, ${fetchedDetails} with details fetched`);
  console.log('[FeatureFlags] Issue type distribution:', issueTypeCounts);

  // Debug: Log announcement map
  console.log(`[FeatureFlags] Built announcement map with ${Object.keys(annMap).length} entries`);
  console.log('[FeatureFlags] Sample announcement JPD keys:', Object.keys(annMap).slice(0, 5));

  // Build result rows
  const rows = tierFlags.map(flag => {
    const tier = extractTier(flag.tags);
    const jpd = flag.jpdKey || null;
    const jira = jpd && jiraMap[jpd] ? jiraMap[jpd] : null;
    const ln = jpd && annMap[jpd] ? annMap[jpd] : null;
    const rollout = formatRollout(flag);

    const releaseVersion = extractReleaseVersion(flag.tags);

    return {
      flagKey: flag.key || '',
      tier: tier || '',
      releaseVersion: releaseVersion || '',
      status: rollout.status,
      percentage: rollout.percentage,
      rolloutLabel: rollout.label || '',
      jpdKey: jpd || '',
      jpdSummary: jira ? jira.summary : '',
      jpdStatus: jira ? jira.status : '',
      hasReleaseNote: !!ln,
      releaseNoteTitle: ln ? ln.title : '',
      releaseNoteUrl: ln ? ln.publicPermalink : '',
      flagUrl: `https://app.launchdarkly.com/${LD_PROJECT}/${LD_ENV}/features/${flag.key}`,
      jpdUrl: jpd ? `https://toasttab.atlassian.net/browse/${jpd}` : ''
    };
  });

  // Debug: Count matches
  const withNotes = rows.filter(r => r.hasReleaseNote).length;
  const withJpd = rows.filter(r => r.jpdKey).length;
  console.log(`[FeatureFlags] Result: ${rows.length} flags, ${withJpd} with JPD, ${withNotes} with release notes`);

  return rows;
}

// GET /api/feature-flags
router.get('/feature-flags', async (req, res) => {
  try {
    const ldApiKey = req.headers['x-launchdarkly-key'];
    const lnApiToken = req.headers['x-launchnotes-key'];
    const jiraEmail = req.headers['x-atlassian-email'];
    const jiraToken = req.headers['x-atlassian-token'];
    const jiraBaseUrl = req.headers['x-atlassian-base-url'] || 'https://toasttab.atlassian.net';

    if (!ldApiKey) {
      return res.status(400).json({ error: 'LaunchDarkly API key is required' });
    }
    if (!lnApiToken) {
      return res.status(400).json({ error: 'LaunchNotes API token is required' });
    }
    if (!jiraEmail || !jiraToken) {
      return res.status(400).json({ error: 'Jira credentials are required' });
    }

    // Check cache
    const now = Date.now();
    const cacheKey = `${ldApiKey}-${lnApiToken}-${jiraEmail}`;

    if (featureFlagsCache.data &&
        featureFlagsCache.cacheKey === cacheKey &&
        featureFlagsCache.timestamp &&
        (now - featureFlagsCache.timestamp < featureFlagsCache.ttl)) {
      console.log('Returning cached feature flags data');
      return res.json({
        data: featureFlagsCache.data,
        cached: true,
        timestamp: featureFlagsCache.timestamp
      });
    }

    // Fetch fresh data
    const data = await fetchFeatureFlagsData(ldApiKey, lnApiToken, jiraEmail, jiraToken, jiraBaseUrl);

    // Update cache
    featureFlagsCache = {
      data,
      timestamp: now,
      cacheKey,
      ttl: 5 * 60 * 1000 // 5 minutes
    };

    res.json({
      data,
      cached: false,
      timestamp: now
    });
  } catch (error) {
    console.error('Error fetching feature flags:', error);
    res.status(500).json({
      error: 'Failed to fetch feature flags',
      message: error.message
    });
  }
});

// POST /api/feature-flags/refresh
router.post('/feature-flags/refresh', async (req, res) => {
  try {
    const ldApiKey = req.headers['x-launchdarkly-key'];
    const lnApiToken = req.headers['x-launchnotes-key'];
    const jiraEmail = req.headers['x-atlassian-email'];
    const jiraToken = req.headers['x-atlassian-token'];
    const jiraBaseUrl = req.headers['x-atlassian-base-url'] || 'https://toasttab.atlassian.net';

    if (!ldApiKey) {
      return res.status(400).json({ error: 'LaunchDarkly API key is required' });
    }
    if (!lnApiToken) {
      return res.status(400).json({ error: 'LaunchNotes API token is required' });
    }
    if (!jiraEmail || !jiraToken) {
      return res.status(400).json({ error: 'Jira credentials are required' });
    }

    // Force refresh by fetching new data
    const data = await fetchFeatureFlagsData(ldApiKey, lnApiToken, jiraEmail, jiraToken, jiraBaseUrl);

    const now = Date.now();
    const cacheKey = `${ldApiKey}-${lnApiToken}-${jiraEmail}`;

    // Update cache
    featureFlagsCache = {
      data,
      timestamp: now,
      cacheKey,
      ttl: 5 * 60 * 1000 // 5 minutes
    };

    res.json({
      data,
      cached: false,
      timestamp: now,
      refreshed: true
    });
  } catch (error) {
    console.error('Error refreshing feature flags:', error);
    res.status(500).json({
      error: 'Failed to refresh feature flags',
      message: error.message
    });
  }
});

module.exports = router;
