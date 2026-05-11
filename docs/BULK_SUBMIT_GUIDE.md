# Bulk JPD Submission & Review Queue - Complete Guide

## Overview

This feature allows Product Managers to bulk-submit JPD (Confluence page) links for review. Instead of submitting each link individually via Slack, they can paste multiple URLs into a web form. The submissions go into a Review Queue where you (and other admins) can manage them.

## Architecture

### Flow
1. **PM submits** → JPD links at `/bulk-submit-jpds`
2. **System checks** → Warns if any pages were already submitted (shows who submitted + when)
3. **PM confirms** → Can choose to re-submit or cancel
4. **Data stored** → Each link becomes a row in Supabase `jpd_review_queue` table
5. **Admin reviews** → You manage items in the Review Queue view
6. **Status changes** → When marked as "Published":
   - Confluence page moves to Published status
   - Item is removed from review queue

### Components Created

**Frontend:**
- `BulkSubmitView.js` - Submission form (works both standalone and in-app)
- `ReviewQueueView.js` - Management interface with status updates and bulk delete

**Backend:**
- `/api/review-queue/check-duplicate` - Check if pages already submitted
- `/api/review-queue/submit` - Add pages to review queue
- `/api/review-queue` - Get all review items (with optional status filter)
- `/api/review-queue/:id` - Update status/notes (admin only)
- `/api/review-queue/bulk-delete` - Delete multiple items (admin only)

**Database:**
- Supabase table: `jpd_review_queue`

## Setup Instructions

### 1. Install Dependencies

```bash
cd /Users/mickey.farmer/Documents/releaseNotesManager/client
npm install react-router-dom
```

### 2. Create Supabase Database Table

Open your Supabase SQL Editor and run:

```sql
-- Copy contents from /Users/mickey.farmer/Documents/releaseNotesManager/docs/REVIEW_QUEUE_SCHEMA.sql
```

Or run directly:
```bash
cat /Users/mickey.farmer/Documents/releaseNotesManager/docs/REVIEW_QUEUE_SCHEMA.sql
```

### 3. Verify Environment Variables

Make sure your server `.env` has:

```bash
# Required for Supabase integration
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SUPABASE_JWT_SECRET=your-jwt-secret  # If using HS256 tokens

# Required for Toast email domain restriction
ALLOWED_EMAIL_DOMAIN=@toasttab.com
```

### 4. Start the Application

```bash
cd /Users/mickey.farmer/Documents/releaseNotesManager
npm run dev
```

The app will start at http://localhost:3000

## Usage

### For Product Managers (Submitters)

**Option 1: Direct URL (Recommended for sharing)**
1. Go to: **http://localhost:3000/#/bulk-submit-jpds**
2. Sign in with Toast email (magic link)
3. Paste Confluence page URLs (one per line or comma-separated)
4. Click "Submit"
5. If duplicates detected, confirm or cancel

**Option 2: Within the app**
1. Sign in to release notes manager
2. Click "Bulk Submit" in sidebar
3. Follow same steps as above

**Supported URL formats:**
- `https://toasttab.atlassian.net/wiki/spaces/RD/pages/123456789/Page+Title`
- `https://toasttab.atlassian.net/wiki/pages/123456789`
- Any URL containing `/pages/{pageId}` or `?pageId={pageId}`

### For Admins (You)

**Access Review Queue:**
1. Sign in to release notes manager
2. Click "Review Queue" in sidebar

**Features:**
- **View all submissions** - See who submitted what and when
- **Filter by status** - To Do, Under Review, or all
- **Change status** - Use dropdown to update each item
- **Multi-select** - Check multiple items and bulk delete
- **Publish** - When marked as "Published":
  - Automatically moves Confluence page to Published status
  - Removes item from review queue

**Status meanings:**
- **To Do** (default) - Newly submitted, not yet reviewed
- **Under Review** - You're currently working on it
- **Published** - Moves to Published status in Confluence + removes from queue

### For Non-Admins (View-Only)

Non-admin users can:
- View all submissions in Review Queue
- See who submitted what
- Cannot change status
- Cannot delete items

## Permissions

### Admin Check
- Configured in Supabase `app_admins` table
- Server-side validation on update/delete endpoints
- Frontend shows/hides controls based on admin status

### To Make Someone Admin
Run in Supabase SQL Editor:
```sql
INSERT INTO app_admins (user_id)
VALUES ('user-uuid-here');
```

To get user UUID:
```sql
SELECT id, email FROM auth.users WHERE email = 'their@email.com';
```

## Troubleshooting

### "Supabase not configured" error
- Check that `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set in server `.env`
- Restart the server after adding env vars

### "Only admins can change status"
- Verify you're listed in `app_admins` table
- Sign out and sign back in to refresh permissions

### Duplicate detection not working
- Check that `check-duplicate` endpoint is accessible
- Verify Supabase table has proper indexes (see schema)

### Pages not moving to Published
- Verify Confluence credentials are saved in settings
- Check that `PAGE_STATUSES['published']` is configured in server
- Look at server logs for Confluence API errors

## Database Schema

```sql
jpd_review_queue (
  id: UUID (primary key)
  page_id: TEXT (Confluence page ID)
  page_url: TEXT (full Confluence URL)
  page_title: TEXT (fetched from Confluence)
  reporter_email: TEXT (who submitted it)
  reporter_name: TEXT
  status: TEXT ('To Do' | 'Under Review' | 'Published')
  submitted_at: TIMESTAMPTZ (default NOW())
  updated_at: TIMESTAMPTZ (auto-updated on change)
  notes: TEXT (optional admin notes)
)
```

## API Endpoints

| Endpoint | Method | Access | Description |
|----------|--------|--------|-------------|
| `/api/review-queue/check-duplicate` | POST | All | Check if page IDs exist |
| `/api/review-queue/submit` | POST | All | Submit pages to queue |
| `/api/review-queue` | GET | All | List all items (optional ?status filter) |
| `/api/review-queue/:id` | PUT | Admin | Update status/notes |
| `/api/review-queue/bulk-delete` | POST | Admin | Delete multiple items |

## Sharing the Submission Form

**Shareable URL:**
```
http://localhost:3000/#/bulk-submit-jpds
```

For production (after deployment):
```
https://your-domain.com/#/bulk-submit-jpds
```

**Instructions for PMs:**
1. Click the link
2. Sign in with your Toast email
3. Paste your Confluence page URLs
4. Submit
5. Done! The team will review them.

## Next Steps

1. **Test locally** - Submit some test JPD links and verify they appear in Review Queue
2. **Deploy** - Follow deployment guide (see docs/RENDER.md or docs/VERCEL.md)
3. **Share URL** - Send the `/bulk-submit-jpds` link to your Product Managers
4. **Monitor** - Check Review Queue regularly for new submissions

## Files Modified

- `client/src/BulkSubmitView.js` - Created
- `client/src/ReviewQueueView.js` - Created
- `client/src/App.js` - Added routing and navigation
- `client/src/App.css` - Added styles
- `server/index.js` - Added review queue API endpoints
- `docs/REVIEW_QUEUE_SCHEMA.sql` - Created database schema

## Questions?

- Check server logs for API errors: `npm run server`
- Check browser console for frontend errors
- Verify Supabase RLS policies allow your operations
- Ensure you're signed in with a Toast email
