#!/usr/bin/env node

/**
 * Script to update the Confluence documentation page for the Release Notes Manager tool
 * 
 * Usage: node create-documentation-page.js
 * 
 * This script updates page ID 5685870607 with the latest features and changes.
 * Make sure your .env file has the correct credentials.
 */

require('dotenv').config();
const axios = require('axios');

const PARENT_PAGE_ID = '5682364469';
const DOCUMENTATION_PAGE_ID = '5685870607'; // Page to update with new features

// Confluence API configuration
const confluenceApi = axios.create({
  baseURL: process.env.CONFLUENCE_BASE_URL || 'https://toasttab.atlassian.net/wiki',
  auth: {
    username: process.env.CONFLUENCE_EMAIL,
    password: process.env.CONFLUENCE_API_TOKEN
  },
  headers: {
    'Accept': 'application/json',
    'Content-Type': 'application/json'
  }
});

// Confluence storage format content
const pageContent = `
<ac:structured-macro ac:name="info" ac:schema-version="1">
  <ac:rich-text-body>
    <p><strong>Release Notes Manager</strong> is a visual tool to manage Confluence release note pages - track age, view comments, and quickly move pages between different statuses (Draft, In Progress, Needs Action, Published, Discarded).</p>
  </ac:rich-text-body>
</ac:structured-macro>

<h2>✨ Features</h2>

<ac:layout>
  <ac:layout-section ac:type="two_equal">
    <ac:layout-cell>
      <h3>📋 Page Management</h3>
      <ul>
        <li>View all release notes in a clean table interface</li>
        <li>Track page age and last activity</li>
        <li>Automatic stale page detection</li>
        <li>Search and filter by title or author</li>
      </ul>
    </ac:layout-cell>
    <ac:layout-cell>
      <h3>💬 Collaboration</h3>
      <ul>
        <li>View and add comments directly from the tool</li>
        <li>@ mention support in comments</li>
        <li>View Confluence page content inline</li>
        <li>See Jira ticket details for each page</li>
      </ul>
    </ac:layout-cell>
  </ac:layout-section>
  <ac:layout-section ac:type="two_equal">
    <ac:layout-cell>
      <h3>🚀 Quick Actions</h3>
      <ul>
        <li>Move pages between statuses with one click</li>
        <li>Bulk edit multiple pages (location, labels, comments)</li>
        <li>Add labels to Jira tickets</li>
        <li>Leave Jira comments when moving pages</li>
        <li>Undo move operations</li>
      </ul>
    </ac:layout-cell>
    <ac:layout-cell>
      <h3>🔒 Security & Customization</h3>
      <ul>
        <li>Credentials stored locally in your browser</li>
        <li>Each user enters their own API token</li>
        <li>Personalized Jira field preferences</li>
        <li>No shared credentials or .env files needed</li>
      </ul>
    </ac:layout-cell>
  </ac:layout-section>
</ac:layout>

<h2>📦 Installation</h2>

<h3>Prerequisites</h3>
<ul>
  <li>Node.js 18+ installed</li>
  <li>Confluence Cloud account with API access</li>
  <li>API token from <a href="https://id.atlassian.com/manage-profile/security/api-tokens">Atlassian Account Settings</a></li>
</ul>

<h3>Quick Start (Mac)</h3>

<ac:structured-macro ac:name="panel" ac:schema-version="1" ac:macro-id="quickstart">
  <ac:parameter ac:name="title">🚀 Easiest Way to Start</ac:parameter>
  <ac:rich-text-body>
    <p><strong>Double-click <code>Start.app.command</code></strong> in the project folder!</p>
    <p>This will automatically:</p>
    <ol>
      <li>Install dependencies if needed</li>
      <li>Start the server and client</li>
      <li>Open the app in your browser</li>
    </ol>
  </ac:rich-text-body>
</ac:structured-macro>

<h3>Manual Installation</h3>

<ac:structured-macro ac:name="code" ac:schema-version="1">
  <ac:parameter ac:name="language">bash</ac:parameter>
  <ac:parameter ac:name="title">Installation Steps</ac:parameter>
  <ac:plain-text-body><![CDATA[
# 1. Navigate to the project directory
cd /path/to/confluence-release-manager

# 2. Install all dependencies
npm run install:all

# 3. Start the application
npm run dev
]]></ac:plain-text-body>
</ac:structured-macro>

<p>The app will be available at <strong><a href="http://localhost:3000">http://localhost:3000</a></strong></p>

<h2>⚙️ First Time Setup</h2>

<ac:structured-macro ac:name="info" ac:schema-version="1">
  <ac:rich-text-body>
    <p>When you first open the app, you'll see a Settings modal. This is where you configure your personal credentials.</p>
  </ac:rich-text-body>
</ac:structured-macro>

<h3>Step 1: Get Your API Token</h3>
<ol>
  <li>Go to <a href="https://id.atlassian.com/manage-profile/security/api-tokens">Atlassian Account Settings</a></li>
  <li>Click <strong>"Create API token"</strong></li>
  <li>Give it a name like "Release Notes Manager"</li>
  <li>Copy the token (you won't be able to see it again!)</li>
</ol>

<h3>Step 2: Enter Your Settings</h3>

<ac:structured-macro ac:name="panel" ac:schema-version="1">
  <ac:parameter ac:name="title">Required Information</ac:parameter>
  <ac:rich-text-body>
    <p><strong>Email Address:</strong> Your Atlassian account email</p>
    <p><strong>API Token:</strong> The token you just created</p>
    <p><strong>Base URL:</strong> Your Confluence base URL (e.g., <code>https://toasttab.atlassian.net/wiki</code>)</p>
    <p><strong>Space Key:</strong> The space where your release notes live (e.g., <code>RD</code>)</p>
  </ac:rich-text-body>
</ac:structured-macro>

<p><strong>Note:</strong> Page IDs are read-only and configured by the developer. You don't need to change them.</p>

<h3>Step 3: Customize Your Jira Field Preferences (Optional)</h3>

<ac:structured-macro ac:name="tip" ac:schema-version="1">
  <ac:rich-text-body>
    <p>You can customize which Jira ticket fields are displayed when moving pages. This lets you see only the information that matters to you!</p>
  </ac:rich-text-body>
</ac:structured-macro>

<ol>
  <li>In the Settings modal, scroll to <strong>"Jira Field Preferences"</strong></li>
  <li>Check or uncheck fields to show/hide them:
    <ul>
      <li>Assignee, Reporter, Labels, Priority, Status</li>
      <li>Roadmap Status, Due Date, Fix Versions</li>
      <li>Components, Issue Type, Epic Key</li>
    </ul>
  </li>
  <li>Custom fields (like Feature Flags) will automatically appear if they exist on tickets</li>
  <li>Your preferences are saved automatically</li>
</ol>

<h3>Step 4: Test Your Connection</h3>
<ol>
  <li>Click <strong>"Test Connection"</strong> in the settings modal</li>
  <li>If successful, you'll see a green checkmark</li>
  <li>Click <strong>"Save Settings"</strong></li>
</ol>

<ac:structured-macro ac:name="tip" ac:schema-version="1">
  <ac:rich-text-body>
    <p>Your credentials are stored <strong>locally in your browser</strong> and never shared. Each user needs to enter their own credentials.</p>
  </ac:rich-text-body>
</ac:structured-macro>

<h2>📖 How to Use</h2>

<h3>Viewing Pages</h3>

<ac:structured-macro ac:name="panel" ac:schema-version="1">
  <ac:parameter ac:name="title">Status Tabs</ac:parameter>
  <ac:rich-text-body>
    <p>The top navigation shows different status categories:</p>
    <ul>
      <li><strong>📝 Draft</strong> - New release notes</li>
      <li><strong>🔄 In Progress</strong> - Being worked on</li>
      <li><strong>⚡ Needs Action</strong> - Requires attention</li>
      <li><strong>✅ Published</strong> - Completed and published</li>
      <li><strong>🗑️ Discarded</strong> - No longer needed</li>
    </ul>
    <p>Each tab shows the count of pages and stale pages (⚠️).</p>
  </ac:rich-text-body>
</ac:structured-macro>

<h3>Understanding Status Indicators</h3>

<ac:structured-macro ac:name="panel" ac:schema-version="1">
  <ac:parameter ac:name="title">Status Badges</ac:parameter>
  <ac:rich-text-body>
    <table>
      <tr>
        <th>Color</th>
        <th>Meaning</th>
      </tr>
      <tr>
        <td><span style="background-color: #10b981; color: white; padding: 2px 8px; border-radius: 4px;">Green</span></td>
        <td>Recently active (within threshold)</td>
      </tr>
      <tr>
        <td><span style="background-color: #f59e0b; color: white; padding: 2px 8px; border-radius: 4px;">Yellow</span></td>
        <td>Getting stale (approaching threshold)</td>
      </tr>
      <tr>
        <td><span style="background-color: #ef4444; color: white; padding: 2px 8px; border-radius: 4px;">Red</span></td>
        <td>Stale (exceeded threshold) - consider action</td>
      </tr>
    </table>
  </ac:rich-text-body>
</ac:structured-macro>

<h3>Moving Pages</h3>

<ac:structured-macro ac:name="panel" ac:schema-version="1">
  <ac:parameter ac:name="title">Single Page Move</ac:parameter>
  <ac:rich-text-body>
    <ol>
      <li>Click the <strong>⋮</strong> (three dots) button in the Actions column</li>
      <li>Select <strong>"Move to [Status]"</strong></li>
      <li>Review the confirmation modal:
        <ul>
          <li>See page content (expandable)</li>
          <li>View Jira ticket details</li>
          <li>Optionally leave a comment on the Jira ticket</li>
          <li>Click assignee/reporter to auto-@ mention them</li>
        </ul>
      </li>
      <li>Click <strong>"Move to [Status]"</strong> to confirm</li>
      <li>Use the <strong>"Undo"</strong> link in the success message if needed</li>
    </ol>
  </ac:rich-text-body>
</ac:structured-macro>

<ac:structured-macro ac:name="panel" ac:schema-version="1">
  <ac:parameter ac:name="title">Bulk Edit (Enhanced!)</ac:parameter>
  <ac:rich-text-body>
    <p>The bulk edit feature lets you make multiple changes at once using a unified interface with tabs:</p>
    <ol>
      <li>Select multiple pages using the checkboxes</li>
      <li>Click <strong>"✏️ Edit"</strong> in the bulk actions bar</li>
      <li>Use the tabbed interface:
        <ul>
          <li><strong>📍 Location Tab:</strong> Change page location (or keep current)</li>
          <li><strong>🏷️ Labels Tab:</strong> Add labels to all Jira tickets</li>
          <li><strong>💬 Comments Tab:</strong> Add comments to all Jira tickets</li>
        </ul>
      </li>
      <li>Review the summary of changes</li>
      <li>Click <strong>"Apply Changes"</strong> to execute all actions</li>
      <li>Use <strong>"Undo"</strong> to revert if needed</li>
    </ol>
    <p><strong>Tip:</strong> You can combine actions - for example, move pages AND add labels AND leave comments all at once!</p>
  </ac:rich-text-body>
</ac:structured-macro>

<h3>Viewing Page Details</h3>

<ac:structured-macro ac:name="panel" ac:schema-version="1">
  <ac:rich-text-body>
    <p><strong>Click on any page title</strong> to open the detail panel, which shows:</p>
    <ul>
      <li>Confluence page information (author, dates, comments)</li>
      <li>Full page body content (expandable)</li>
      <li>Jira ticket details (if available)</li>
      <li>Quick actions to move the page</li>
    </ul>
  </ac:rich-text-body>
</ac:structured-macro>

<h3>Adding Comments</h3>

<ac:structured-macro ac:name="panel" ac:schema-version="1">
  <ac:rich-text-body>
    <ol>
      <li>Click the <strong>💬</strong> button on any page</li>
      <li>View existing comments</li>
      <li>Type your comment in the text box</li>
      <li>Use <code>@name</code> to mention someone (autocomplete will appear)</li>
      <li>Press <code>⌘+Enter</code> or click <strong>"Add Comment"</strong></li>
    </ol>
  </ac:rich-text-body>
</ac:structured-macro>

<h3>Adding Labels to Jira Tickets</h3>

<ac:structured-macro ac:name="panel" ac:schema-version="1">
  <ac:rich-text-body>
    <p>You can add labels to Jira tickets when moving pages (single or bulk):</p>
    <ol>
      <li>When moving a page, scroll to the <strong>"Labels"</strong> section</li>
      <li>Type to search for existing labels (autocomplete will appear)</li>
      <li>Click a label from the dropdown to add it</li>
      <li>Or type a new label name and press <code>Enter</code> to create it</li>
      <li>Selected labels appear as badges - click the <strong>×</strong> to remove</li>
      <li>Labels are merged with existing ones (no duplicates)</li>
    </ol>
    <p><strong>Example:</strong> When discarding a release note, you might add labels like <code>discarded</code>, <code>wont-fix</code>, or <code>deprecated</code>.</p>
  </ac:rich-text-body>
</ac:structured-macro>

<h3>Leaving Jira Comments</h3>

<ac:structured-macro ac:name="tip" ac:schema-version="1">
  <ac:rich-text-body>
    <p>When moving a page, you can leave a comment on the associated Jira ticket. This is especially useful for notifying stakeholders about status changes.</p>
  </ac:rich-text-body>
</ac:structured-macro>

<ol>
  <li>When moving a page, the confirmation modal shows Jira ticket details</li>
  <li>In the <strong>"Leave a comment"</strong> section:
    <ul>
      <li>Type your comment</li>
      <li>Click on <strong>Assignee</strong> or <strong>Reporter</strong> to automatically @ mention them</li>
      <li>Or type <code>@name</code> to mention anyone</li>
    </ul>
  </li>
  <li>The comment will be posted to the Jira ticket when you confirm the move</li>
  <li>In bulk edit, the comment is posted to <strong>all</strong> selected pages' Jira tickets</li>
</ol>

<h2>🔧 Troubleshooting</h2>

<ac:structured-macro ac:name="expand" ac:schema-version="1">
  <ac:parameter ac:name="title">❌ "Missing Atlassian credentials" error</ac:parameter>
  <ac:rich-text-body>
    <p><strong>Solution:</strong> Click the ⚙️ button in the top-right corner and enter your credentials in the Settings modal.</p>
  </ac:rich-text-body>
</ac:structured-macro>

<ac:structured-macro ac:name="expand" ac:schema-version="1">
  <ac:parameter ac:name="title">❌ "Connection failed" when testing</ac:parameter>
  <ac:rich-text-body>
    <p><strong>Check:</strong></p>
    <ul>
      <li>Your email address matches your Atlassian account exactly</li>
      <li>Your API token is correct (create a new one if unsure)</li>
      <li>Your Base URL is correct (should end with <code>/wiki</code>)</li>
      <li>You have access to the Confluence space</li>
    </ul>
  </ac:rich-text-body>
</ac:structured-macro>

<ac:structured-macro ac:name="expand" ac:schema-version="1">
  <ac:parameter ac:name="title">❌ "Failed to fetch pages" error</ac:parameter>
  <ac:rich-text-body>
    <p><strong>Possible causes:</strong></p>
    <ul>
      <li>Incorrect API token - verify in Settings</li>
      <li>No access to the Confluence space</li>
      <li>Page IDs are incorrect (contact developer)</li>
      <li>Network connectivity issues</li>
    </ul>
    <p><strong>Solution:</strong> Click the ⚙️ button, verify your settings, and click "Test Connection".</p>
  </ac:rich-text-body>
</ac:structured-macro>

<ac:structured-macro ac:name="expand" ac:schema-version="1">
  <ac:parameter ac:name="title">❌ Port already in use (3000 or 3001)</ac:parameter>
  <ac:rich-text-body>
    <p><strong>Solution:</strong></p>
    <ol>
      <li>Stop any other instances of the app</li>
      <li>Or kill the process using the port:
        <ac:structured-macro ac:name="code" ac:schema-version="1">
          <ac:parameter ac:name="language">bash</ac:parameter>
          <ac:plain-text-body><![CDATA[
# Find and kill process on port 3000
lsof -ti:3000 | xargs kill -9

# Find and kill process on port 3001
lsof -ti:3001 | xargs kill -9
]]></ac:plain-text-body>
        </ac:structured-macro>
      </li>
    </ol>
  </ac:rich-text-body>
</ac:structured-macro>

<ac:structured-macro ac:name="expand" ac:schema-version="1">
  <ac:parameter ac:name="title">❌ Labels not appearing in Jira</ac:parameter>
  <ac:rich-text-body>
    <p><strong>Check:</strong></p>
    <ul>
      <li>The page has an associated Jira ticket (check the page body for a ticket reference)</li>
      <li>You have permission to edit the Jira ticket</li>
      <li>The label name doesn't contain invalid characters</li>
      <li>Check the browser console for any error messages</li>
    </ul>
    <p><strong>Note:</strong> Labels are merged with existing ones, so you won't see duplicates if the label already exists.</p>
  </ac:rich-text-body>
</ac:structured-macro>

<ac:structured-macro ac:name="expand" ac:schema-version="1">
  <ac:parameter ac:name="title">❌ Pages not loading or showing empty</ac:parameter>
  <ac:rich-text-body>
    <p><strong>Check:</strong></p>
    <ul>
      <li>You're on the correct status tab</li>
      <li>There are actually pages in that status</li>
      <li>Your search/filter isn't hiding all results</li>
      <li>Browser console for errors (F12 → Console)</li>
    </ul>
    <p>Try clicking the <strong>↻ Refresh</strong> button in the header.</p>
  </ac:rich-text-body>
</ac:structured-macro>

<h2>⌨️ Keyboard Shortcuts</h2>

<ac:structured-macro ac:name="panel" ac:schema-version="1">
  <ac:rich-text-body>
    <table>
      <tr>
        <th>Key</th>
        <th>Action</th>
      </tr>
      <tr>
        <td><code>⌘+Enter</code></td>
        <td>Submit comment (when typing)</td>
      </tr>
      <tr>
        <td><code>Escape</code></td>
        <td>Close modals, clear selections</td>
      </tr>
      <tr>
        <td><code>@</code></td>
        <td>Start a mention (autocomplete appears)</td>
      </tr>
    </table>
  </ac:rich-text-body>
</ac:structured-macro>

<h2>🎨 Themes</h2>

<ac:structured-macro ac:name="panel" ac:schema-version="1">
  <ac:rich-text-body>
    <p>Click the theme picker (🌙/🌑/☀️) in the top-right to switch between:</p>
    <ul>
      <li><strong>🌙 Dim</strong> - Easy on the eyes (default)</li>
      <li><strong>🌑 Dark</strong> - Full dark mode</li>
      <li><strong>☀️ Light</strong> - Bright and clean</li>
    </ul>
    <p>Your preference is saved automatically.</p>
  </ac:rich-text-body>
</ac:structured-macro>

<h2>💡 Tips & Best Practices</h2>

<ac:structured-macro ac:name="panel" ac:schema-version="1">
  <ac:rich-text-body>
    <ul>
      <li><strong>Use bulk edit</strong> when you need to make multiple changes at once (location, labels, comments)</li>
      <li><strong>Add labels</strong> when discarding or categorizing pages for better organization</li>
      <li><strong>Leave Jira comments</strong> when moving pages to notify stakeholders</li>
      <li><strong>Customize field preferences</strong> to see only the Jira information you care about</li>
      <li><strong>Check stale pages regularly</strong> - they're highlighted in red/yellow</li>
      <li><strong>Use search</strong> to quickly find specific pages</li>
      <li><strong>Click page titles</strong> to see full details without leaving the tool</li>
      <li><strong>Undo is your friend</strong> - if you move something by mistake, click Undo in the success message</li>
      <li><strong>Combine actions</strong> - in bulk edit, you can move pages, add labels, AND leave comments all at once</li>
    </ul>
  </ac:rich-text-body>
</ac:structured-macro>

<h2>🔄 Updating Settings</h2>

<ac:structured-macro ac:name="panel" ac:schema-version="1">
  <ac:rich-text-body>
    <p>To update your credentials or settings:</p>
    <ol>
      <li>Click the <strong>⚙️</strong> button in the top-right corner</li>
      <li>Update any fields you need to change</li>
      <li>Adjust your <strong>Jira Field Preferences</strong> to customize which fields are displayed</li>
      <li>Click <strong>"Test Connection"</strong> to verify</li>
      <li>Click <strong>"Save Settings"</strong></li>
    </ol>
    <p><strong>Note:</strong> Your settings and field preferences are stored in your browser's localStorage. If you clear your browser data, you'll need to re-enter them.</p>
  </ac:rich-text-body>
</ac:structured-macro>

<h2>🎯 Personalizing Your Experience</h2>

<ac:structured-macro ac:name="panel" ac:schema-version="1">
  <ac:parameter ac:name="title">Jira Field Preferences</ac:parameter>
  <ac:rich-text-body>
    <p>Customize which Jira ticket fields you see when moving pages:</p>
    <ul>
      <li><strong>Default visible:</strong> Assignee, Reporter, Labels, Roadmap Status</li>
      <li><strong>Optional fields:</strong> Priority, Status, Due Date, Fix Versions, Components, Issue Type, Epic Key</li>
      <li><strong>Custom fields:</strong> Automatically displayed if they exist on tickets (e.g., Feature Flags)</li>
    </ul>
    <p><strong>Example:</strong> If you only care about Assignee, Labels, and Feature Flags, uncheck everything else in Settings → Jira Field Preferences.</p>
  </ac:rich-text-body>
</ac:structured-macro>

<h2>📞 Need Help?</h2>

<ac:structured-macro ac:name="info" ac:schema-version="1">
  <ac:rich-text-body>
    <p>If you encounter issues not covered in the troubleshooting section:</p>
    <ul>
      <li>Check the browser console (F12 → Console) for error messages</li>
      <li>Check the server terminal for backend errors</li>
      <li>Verify your API token hasn't expired</li>
      <li>Contact the developer with specific error messages</li>
    </ul>
  </ac:rich-text-body>
</ac:structured-macro>

<ac:structured-macro ac:name="panel" ac:schema-version="1">
  <ac:parameter ac:name="title">🔗 Quick Links</ac:parameter>
  <ac:rich-text-body>
    <ul>
      <li><a href="https://id.atlassian.com/manage-profile/security/api-tokens">Create API Token</a></li>
      <li><a href="https://support.atlassian.com/confluence-cloud/">Confluence Help</a></li>
      <li><a href="https://developer.atlassian.com/cloud/confluence/rest/">Confluence API Docs</a></li>
    </ul>
  </ac:rich-text-body>
</ac:structured-macro>

<hr />

<ac:structured-macro ac:name="note" ac:schema-version="1">
  <ac:rich-text-body>
    <p><strong>Last Updated:</strong> ${new Date().toLocaleDateString()}</p>
    <p><strong>Version:</strong> 2.0.0</p>
    <p><strong>New in v2.0:</strong> Bulk Edit with tabs, Label support, Personalized field preferences</p>
  </ac:rich-text-body>
</ac:structured-macro>
`;

async function updateDocumentationPage() {
  try {
    console.log('Updating documentation page...');
    
    // First, get the existing page to understand its structure
    console.log(`Fetching existing page (ID: ${DOCUMENTATION_PAGE_ID})...`);
    const existingPageResponse = await confluenceApi.get(`/rest/api/content/${DOCUMENTATION_PAGE_ID}`, {
      params: {
        expand: 'body.storage,version,space'
      }
    });
    
    const existingPage = existingPageResponse.data;
    const currentVersion = existingPage.version.number;
    const spaceKey = existingPage.space.key;
    
    console.log(`Current version: ${currentVersion}`);
    console.log(`Page is in space: ${spaceKey}`);
    console.log(`Page title: ${existingPage.title}`);
    
    // Update the page with new content
    console.log('\nUpdating page content...');
    const response = await confluenceApi.put(`/rest/api/content/${DOCUMENTATION_PAGE_ID}`, {
      id: DOCUMENTATION_PAGE_ID,
      type: 'page',
      title: existingPage.title, // Keep the same title
      version: {
        number: currentVersion + 1 // Increment version
      },
      body: {
        storage: {
          value: pageContent.trim(),
          representation: 'storage'
        }
      }
    });

    const pageUrl = `${process.env.CONFLUENCE_BASE_URL}${response.data._links.webui}`;
    
    console.log('\n✅ Documentation page updated successfully!');
    console.log(`📄 Page ID: ${DOCUMENTATION_PAGE_ID}`);
    console.log(`📝 New version: ${currentVersion + 1}`);
    console.log(`🔗 URL: ${pageUrl}`);
    console.log('\nThe page has been updated with the latest features and changes.');
    
  } catch (error) {
    console.error('\n❌ Error updating documentation page:');
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Error:', JSON.stringify(error.response.data, null, 2));
      
      if (error.response.status === 404) {
        console.error('\n⚠️  Page not found. The page ID might be incorrect, or the page may have been deleted.');
        console.error('   You may need to create a new page instead.');
      } else if (error.response.status === 409) {
        console.error('\n⚠️  Version conflict. The page may have been updated by someone else.');
        console.error('   Please refresh and try again.');
      }
    } else {
      console.error('Error:', error.message);
    }
    process.exit(1);
  }
}

// Run the script
updateDocumentationPage();
