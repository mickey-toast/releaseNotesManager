# Confluence Release Notes Manager

A comprehensive tool to manage the complete lifecycle of Confluence release note pages - from draft to published, with AI-powered generation, Jira integration, and workflow management.

## Features

### Core Workflow Management
- **Status-based workflow** - Organize pages across Draft, In Progress, Needs Action, Published, and Discarded statuses
- **Drag-and-drop status changes** - Move pages between statuses using the hamburger icon handle
- **Bulk actions** - Select multiple pages and move them together
- **Statistics dashboard** - View total pages, average days in draft, and stale page counts
- **My Tasks view** - Filter pages by assignee to see your work
- **Search and filtering** - Search by title, filter by author, and filter by time period (Today, This week, This month, All time)
- **Page assignment** - Assign pages to yourself for tracking

### AI-Powered Features
- **AI Hub** - Generate release notes from Confluence pages using AI (Gemini, Anthropic, or OpenAI)
- **Batch AI generation** - Generate multiple release notes at once
- **AI-powered suggestions** - Analyze existing release notes and get improvement suggestions
- **Style guide compliance checker** - Automatically check release notes against your Confluence style guide
- **Auto-refresh style guide** - Periodically check for style guide updates and refresh the cache

### Jira Integration
- **Jira ticket linking** - View associated Jira tickets for each release note page
- **Jira comments** - View and add comments to Jira tickets directly from the tool
- **@ mentions** - Search and mention Jira users in comments
- **Fix Versions** - Display Jira fix versions as metadata badges (supports standard field, custom fields, and Jira Product Discovery; optional `JIRA_FIX_VERSION_FIELD_ID` in `.env` if the field uses a custom ID)
- **Quick replies** - Pre-configured comment templates with variable substitution (`{assignee}`, `{pageUrl}`, `{reporter}`, `{ticket}`)
- **Hardcoded templates** - Essential templates like "Out of scope" that can't be deleted
- **Jira field visibility** - Customize which Jira fields are displayed (assignee, reporter, labels, priority, status, etc.)
- **Bulk Jira updates** - Update Jira tickets in bulk

### LaunchNotes Integration
- **Create LaunchNotes drafts** - Generate release notes and create draft announcements in LaunchNotes
- **MCP integration** - Use LaunchNotes MCP server for direct API access (optional)

### Page Management
- **Page detail panel** - View full page content, comments, Jira details, and metadata
- **Confluence comments** - View and add comments to Confluence pages
- **Open in Confluence** - Quick link to view the page in Confluence
- **Copy URL** - One-click copy of page URLs
- **Stale page detection** - Automatically highlights pages with no activity for 30+ days
- **Age tracking** - See days since creation and last activity
- **Page sections** - View and select specific sections of pages for LaunchNotes

### Export for Claude / Cursor
- **Export for Claude (zip)** - In Settings → Export, download a zip containing the style guide, a manifest of all pages, and one markdown file per page (with frontmatter). Unzip and use with Claude Code or Cursor to rewrite content to the style guide without using Gemini. See **INSTRUCTIONS.md** inside the zip.

### User Experience
- **Confetti celebration** - Visual celebration when pages are moved to Published status
- **Theme support** - Dim, Dark, and Light themes
- **Keyboard shortcuts** - Power user shortcuts for common actions
- **Auto-refresh** - Configurable automatic page refresh (30s, 1min, 5min, 10min, or disabled)
- **Settings modal** - Centralized configuration for Confluence, Jira, LaunchNotes, AI, and Style Guide

### Multi-User Ready
- **Client-side credentials** - Confluence/Jira-related secrets live in the browser; with Supabase + server env configured they also sync to Postgres per user (RLS). See [docs/USER_PROFILE_SYNC.md](./docs/USER_PROFILE_SYNC.md).
- **Stateless server** - Server doesn't store user data, making it safe for multi-user hosting
- **Per-user configuration** - Each user configures their own credentials and settings
- **Optional Supabase app auth** - For public hosting, set `SUPABASE_JWT_SECRET` on the server and `REACT_APP_SUPABASE_*` on the client build so only allowed work emails (default `@toasttab.com`) can call `/api/*`. See root `.env.example` and `client/.env.example`. Sign-in options: magic link, password, and **Sign up** (email + password). To block non-Toast signups inside Supabase as well, run the SQL hook in [docs/SUPABASE_AUTH_HOOK.md](./docs/SUPABASE_AUTH_HOOK.md) (includes Supabase dashboard steps for password sign-up). With `SUPABASE_URL` + `SUPABASE_ANON_KEY` on the server, **Troubleshooting → Team audit log** lists actions by user email (see [docs/USER_PROFILE_SYNC.md](./docs/USER_PROFILE_SYNC.md)).

## Prerequisites

- Node.js 18+ installed
- Confluence Cloud account with API access
- Jira Cloud account (optional, for Jira integration features)
- API token from [Atlassian Account Settings](https://id.atlassian.com/manage-profile/security/api-tokens)
- AI API key (optional, for AI features):
  - Google Gemini: [Get API key](https://makersuite.google.com/app/apikey)
  - Anthropic Claude: [Get API key](https://console.anthropic.com/)
  - OpenAI: [Get API key](https://platform.openai.com/api-keys)

## Quick Start

### Easy Startup (Mac)

**Double-click `Start.app.command`** to launch the app!

This will:
- Install dependencies if needed
- Start the server and client
- Open the app in your browser

### Manual Startup

1. **Navigate to the project:**
   ```bash
   cd /Users/mickey.farmer/Documents/Tools/mickeysToolsandThings/confluence-release-manager
   ```

2. **Install dependencies:**
   ```bash
   npm run install:all
   ```

3. **Start the application:**
   ```bash
   npm run dev
   ```

4. **Open in browser:**
   Navigate to [http://localhost:3000](http://localhost:3000)

## Deploy to Render (shared hosting)

You deploy **one Render Web Service**: the Node server serves both the API and the built React app in production. Step-by-step commands, health checks, and optional `render.yaml` are in **[docs/RENDER.md](docs/RENDER.md)**. For **Vercel**, see **[docs/VERCEL.md](docs/VERCEL.md)** (why the full Express app isn’t a drop-in there, and when a Vercel frontend + API elsewhere makes sense).

## First Time Setup

**No configuration files needed!** All setup is done through the Settings modal in the browser.

1. **When you first open the app**, you'll see a Settings modal
2. **Enter your Atlassian credentials:**
   - **Email**: Your Atlassian account email
   - **API Token**: Get one from [Atlassian Account Settings](https://id.atlassian.com/manage-profile/security/api-tokens)
   - **Base URL**: Your Confluence base URL (e.g., `https://toasttab.atlassian.net/wiki`)
   - **Space Key**: Your Confluence space key (default: `RD`)
3. **Page IDs are pre-configured** - The app uses hardcoded default page IDs for each status. You only need to change these if you want to use different pages:
   - **Draft**: `5530845756` (default)
   - **In Progress**: `5530550421` (default)
   - **Needs Action**: `5529731171` (default)
   - **Published**: `5529862458` (default)
   - **Discarded**: `5529600531` (default)
4. **Configure Jira** (optional):
   - **Base URL**: Your Jira base URL (e.g., `https://toasttab.atlassian.net`)
   - Uses the same credentials as Confluence
5. **Configure LaunchNotes** (optional):
   - **API URL**: `https://app.launchnotes.io` (default)
   - **Project ID**: Your LaunchNotes project ID
   - **API Token**: Your LaunchNotes API token
6. **Configure AI** (optional, for AI features):
   - **Provider**: Choose Gemini, Anthropic, or OpenAI
   - **API Key**: Your API key for the selected provider
7. **Configure Style Guide** (optional):
   - **Page ID**: The Confluence page ID of your style guide
   - Click "Refresh Style Guide" to load it
8. **Click "Test Connection"** to verify your credentials
9. **Click "Save Settings"**

Your credentials are stored **locally in your browser** and never shared with the server or other users.

## Accessing Settings Later

Click the settings button in the top-right corner to update your configuration.

## Usage

### Viewing Pages

The main interface shows pages organized by status. Use the status tabs at the top to filter:
- **Draft** - Pages that need release notes created
- **In Progress** - Pages currently being worked on
- **Needs Action** - Pages requiring attention or review
- **Published** - Completed release notes
- **Discarded** - Pages that don't need release notes

### Understanding Status Indicators

- **Green badge**: Recently active (< 21 days)
- **Yellow badge**: Getting stale (21-29 days)
- **Red badge**: Stale (30+ days) - consider reviewing or discarding
- **Stale count**: Shows number of stale pages in each status

### Moving Pages Between Statuses

1. **Single page drag-and-drop**: Click the hamburger icon (☰) at the end of a row and drag it to a status tab
2. **Bulk move**: Select multiple pages using checkboxes, then use the bulk actions bar
3. **Quick move**: Use the overflow menu (⋮) on any page row
4. **Page detail panel**: Click on a page to open the detail panel, then use "Quick Actions" buttons

### AI Hub - Generating Release Notes

1. Click the **"AI Hub"** tab
2. **Step 1**: Select one or more pages to generate release notes for
   - Pages are organized by status with collapsible sections
   - Use search to find specific pages
   - Draft, In Progress, and Needs Action pages are shown (Published and Discarded are excluded)
3. **Step 2**: Review the selected content and set a headline (auto-filled from page title)
4. **Step 3**: Generate the release note using AI, then preview and edit
5. **Create in LaunchNotes**: Optionally create a draft announcement in LaunchNotes

### Batch AI Generation

1. Select multiple pages using checkboxes
2. Click **"Batch AI Generate"** in the bulk actions bar
3. Review the generated release notes for all selected pages

### AI Suggestions and Compliance

- **AI Suggestions**: Click "AI Suggestions" in the page detail panel to get improvement recommendations
- **Compliance Check**: Click "Check Compliance" to verify the page matches your style guide

### Adding Comments

1. Click the **comments button** (💬) on any page row or open the page detail panel
2. **Confluence comments**: Add comments directly to the Confluence page
3. **Jira comments**: View and add comments to associated Jira tickets
4. **Quick replies**: Use pre-configured templates for common responses
   - Templates support variables: `{assignee}`, `{pageUrl}`, `{reporter}`, `{ticket}`
   - Customize templates in Settings
   - Hardcoded templates (like "Out of scope") cannot be deleted
5. **@ mentions**: Search and mention users in Jira comments

### Page Assignment

- **Assign to Me**: Click "Assign to Me" in the page detail panel to track pages you're working on
- **My Tasks**: Use the "My Tasks" tab to see only pages assigned to you
- **Unassign**: Remove assignment when you're done

### Keyboard Shortcuts

- `⌘/Ctrl + R` - Refresh pages and stats
- `⌘/Ctrl + K` - Focus search input
- `⌘/Ctrl + A` - Select all pages (when not in input)
- `1-5` - Switch between status tabs
- `Escape` - Close modals, clear selection

## Building as a macOS Application

You can package this application as a native macOS `.app` that can be placed in your Applications folder.

### Prerequisites
- Node.js 18+ installed
- All dependencies installed (`npm run install:all`)

### Build Steps

1. **Build the React client:**
   ```bash
   npm run build
   ```

2. **Build the macOS app:**
   ```bash
   npm run build:mac
   ```

   This creates:
   - A `.dmg` file in the `dist/` folder (drag-and-drop installer)
   - A `.zip` file in the `dist/` folder (alternative format)
   - The `.app` bundle is inside the DMG

3. **Install the app:**
   - Open the `.dmg` file
   - Drag "Confluence Release Manager.app" to your Applications folder
   - The app will appear in your Applications list

### Testing Electron App Locally

To test the Electron app without building a full installer:

```bash
npm run build        # Build the React app first
npm run electron     # Launch Electron app
```

## Development

```bash
# Run both frontend and backend in development mode
npm run dev

# Run only the backend
npm run server

# Run only the frontend
npm run client

# Build for production
npm run build

# Run production server
npm start
```

## Multi-User Hosting

This application is designed to be safely hosted for multiple users. See [MULTI_USER_HOSTING.md](./MULTI_USER_HOSTING.md) for detailed considerations and recommendations.

Key points:
- **Credentials are per-user** - Stored in browser localStorage, never shared
- **Stateless server** - Server doesn't store user data or credentials
- **HTTPS recommended** - For production deployments
- **CORS configuration** - Configure allowed origins for your domain

## API Endpoints

### Configuration
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/config` | GET | Get app configuration including status page IDs |
| `/api/test-connection` | POST | Test Atlassian credentials |

### Pages
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/pages` | GET | List pages for a specific status |
| `/api/pages/stats` | GET | Dashboard totals only (same Confluence fetches as `/all`, small JSON) |
| `/api/pages/all` | GET | List all pages across all statuses (full payload; prefer `/stats` for header) |
| `/api/pages/my-tasks` | GET | List pages assigned to current user |
| `/api/pages/:pageId` | GET | Get single page details |
| `/api/pages/:pageId/content` | GET | Get page content for LaunchNotes import |
| `/api/pages/:pageId/sections` | GET | Get page sections |
| `/api/pages/:pageId/comments` | GET | Get Confluence page comments |
| `/api/pages/:pageId/comments` | POST | Add comment to Confluence page |
| `/api/pages/:pageId/move` | POST | Move page to different status |
| `/api/pages/bulk-move` | POST | Bulk move multiple pages |
| `/api/pages/bulk-update-jira` | POST | Bulk update Jira tickets |

### Jira
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/jira/issue/:issueKey` | GET | Get Jira ticket details |
| `/api/jira/issue/:issueKey/comments` | GET | Get Jira ticket comments |
| `/api/jira/issue/:issueKey/comment` | POST | Add comment to Jira ticket |
| `/api/jira/labels` | GET | Get available Jira labels |
| `/api/users/search` | GET | Search Jira/Confluence users (for @ mentions) |

### User
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/user/current` | GET | Get current user information |

### AI
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/ai/generate-release-note` | POST | Generate release note with AI |
| `/api/ai/batch-generate` | POST | Batch generate release notes |
| `/api/ai/suggest-improvements` | POST | Get AI suggestions for improving release notes |
| `/api/ai/check-compliance` | POST | Check style guide compliance |

### Style Guide
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/style-guide/status` | GET | Get style guide status (version, cache info) |
| `/api/style-guide/refresh` | POST | Refresh style guide cache |

### LaunchNotes
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/launchnotes/create-draft` | POST | Create draft announcement in LaunchNotes |

## Troubleshooting

### "Failed to fetch pages" error
- Verify your API token is correct in Settings
- Ensure your email matches your Atlassian account
- Check that you have read access to the Confluence space
- Verify your page IDs are correct (or use the defaults)

### "Missing credentials" error
- Open Settings and configure your Atlassian credentials
- Click "Test Connection" to verify they work
- Make sure you've saved your settings

### Pages not loading
- Check the browser console for errors
- Ensure the status page IDs are correct in Settings (or use defaults)
- Verify network connectivity to Confluence
- Try refreshing the page

### Jira @ mentions not working
- Verify Jira credentials are configured in Settings
- Check that you have permission to search users in Jira
- Try refreshing the page

### AI features not working
- Verify AI provider and API key are configured in Settings
- Check that you have sufficient API credits/quota
- Review browser console for API errors

### Style guide not updating
- Click "Refresh Style Guide" in Settings
- Verify the style guide page ID is correct
- Check that you have read access to the style guide page

### Port already in use
- Stop any other instances of the app
- Or use a different port by setting `PORT` environment variable

## License

MIT
