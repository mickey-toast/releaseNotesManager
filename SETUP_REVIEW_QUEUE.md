# Review Queue Setup Instructions

## Step 1: Install Dependencies

```bash
cd /Users/mickey.farmer/Documents/releaseNotesManager/client
npm install react-router-dom
```

## Step 2: Set Up Supabase Database

Run the SQL script in your Supabase SQL Editor:

```bash
cat /Users/mickey.farmer/Documents/releaseNotesManager/docs/REVIEW_QUEUE_SCHEMA.sql
```

Copy and paste the contents into Supabase SQL Editor and run it.

## Step 3: Configure Environment Variables

Make sure your server `.env` file has:
- `SUPABASE_URL` - Your Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` - Your Supabase service role key (for server-side operations)
- `SUPABASE_JWT_SECRET` - For auth verification (if using HS256)

## Step 4: Test the Feature

1. Start the development server:
   ```bash
   cd /Users/mickey.farmer/Documents/releaseNotesManager
   npm run dev
   ```

2. Log in with your Toast email

3. Navigate to:
   - **Bulk Submit**: http://localhost:3000/bulk-submit-jpds (standalone submission form)
   - **Review Queue**: Click "Review Queue" in the sidebar

## Features

### Bulk Submit
- Accessible at `/bulk-submit-jpds`
- Paste multiple Confluence page URLs
- Duplicate detection with confirmation
- Submission tracking by reporter email

### Review Queue
- View all submitted JPDs
- Filter by status (To Do, Under Review, Published)
- Admins can:
  - Change status via dropdown
  - Multi-select and bulk delete
  - Mark as Published (moves Confluence page + removes from queue)
- Non-admins can:
  - View all submissions (read-only)

## How It Works

1. PM submits JPD links at `/bulk-submit-jpds`
2. System checks for duplicates and warns if found
3. Entries are stored in Supabase `jpd_review_queue` table
4. You review submissions in the Review Queue
5. When marked as "Published":
   - Confluence page is moved to Published status
   - Entry is removed from the review queue
