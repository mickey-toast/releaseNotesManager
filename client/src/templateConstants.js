// Default quick comment templates
// These are hardcoded templates that should always be available
export const DEFAULT_TEMPLATES = [
  {
    id: 'rovo-review',
    name: 'See Rovo review',
    template: `Hello {assignee}! This seems like a valid candidate for updates.toasttab.com. If you agree, please see the feedback on the release notes page {pageUrl} and let me know if you have any questions.`,
    hardcoded: true
  },
  {
    id: 'insufficient-details',
    name: 'Insufficient details - discarding',
    template: `Hello {assignee}! There is not enough information in this ticket to craft a release note. Let us know once additional details are added so we can reprocess this ticket for a release note. For now, we are discarding the release note page for this change. (Release note confluence page: {pageUrl})`,
    hardcoded: true
  },
  {
    id: 'out-of-scope',
    name: 'Out of scope',
    template: `Hi {assignee} this change appears to affect a product area or feature that is not included in our current release notes coverage. For now I am discarding the release notes page for this change. Let me know if you have any questions.`,
    hardcoded: true
  },
  {
    id: 'ready-for-review',
    name: 'Ready for review',
    template: `Hello {assignee}! The release note for this ticket is ready for your review. Please check the Confluence page {pageUrl} and let me know if any changes are needed.`,
    hardcoded: true
  },
  {
    id: 'published',
    name: 'Published to updates.toasttab.com',
    template: `Hello {assignee}! The release note for this ticket has been published to updates.toasttab.com. You can view it at {pageUrl}.`,
    hardcoded: true
  },
  {
    id: 'needs-revision',
    name: 'Needs revision',
    template: `Hello {assignee}! The release note for this ticket needs some revisions. Please review the feedback on {pageUrl} and update as needed.`,
    hardcoded: true
  },
  {
    id: 'moved-to-in-progress',
    name: 'Moved to In Progress',
    template: `Hello {assignee}! The release note for this ticket has been moved to In Progress. You can track its status at {pageUrl}.`,
    hardcoded: true
  }
];

// Get all templates (defaults + custom from localStorage)
// Custom templates with same ID as hardcoded ones will override the defaults
export const getTemplates = () => {
  const saved = localStorage.getItem('quickCommentTemplates');
  let customTemplates = [];
  
  if (saved) {
    try {
      customTemplates = JSON.parse(saved);
    } catch {
      // Invalid JSON, use defaults only
    }
  }
  
  // Start with hardcoded templates
  const templates = [...DEFAULT_TEMPLATES];
  
  // Override with custom templates (including edited hardcoded ones)
  customTemplates.forEach(customTemplate => {
    const existingIndex = templates.findIndex(t => t.id === customTemplate.id);
    if (existingIndex >= 0) {
      // Override existing template (user edited a hardcoded template)
      templates[existingIndex] = { ...customTemplate, hardcoded: true };
    } else {
      // Add new custom template
      templates.push(customTemplate);
    }
  });
  
  return templates;
};
