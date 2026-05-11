-- Migration to add Jira fields and make Confluence fields optional
-- Run this if you already created the table

-- Add new columns if they don't exist
ALTER TABLE jpd_review_queue
ADD COLUMN IF NOT EXISTS jira_key TEXT,
ADD COLUMN IF NOT EXISTS jira_url TEXT;

-- Make Confluence fields nullable (since not all Jira issues may have linked pages yet)
ALTER TABLE jpd_review_queue
ALTER COLUMN page_id DROP NOT NULL,
ALTER COLUMN page_url DROP NOT NULL;

-- Add index for jira_key
CREATE INDEX IF NOT EXISTS idx_jpd_review_jira_key ON jpd_review_queue(jira_key);

-- If you have existing data and want to populate jira_key from somewhere, do it here
-- UPDATE jpd_review_queue SET jira_key = 'UNKNOWN' WHERE jira_key IS NULL;

-- Then you can add NOT NULL constraint for jira fields if needed
-- ALTER TABLE jpd_review_queue ALTER COLUMN jira_key SET NOT NULL;
-- ALTER TABLE jpd_review_queue ALTER COLUMN jira_url SET NOT NULL;
