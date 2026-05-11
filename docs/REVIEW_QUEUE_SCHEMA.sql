-- Review Queue Table for Bulk JPD Submissions
-- Run this in your Supabase SQL Editor

CREATE TABLE IF NOT EXISTS jpd_review_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  jira_key TEXT NOT NULL,
  jira_url TEXT NOT NULL,
  page_id TEXT,
  page_url TEXT,
  page_title TEXT,
  reporter_email TEXT NOT NULL,
  reporter_name TEXT,
  status TEXT NOT NULL DEFAULT 'To Do',
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes TEXT
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_jpd_review_jira_key ON jpd_review_queue(jira_key);
CREATE INDEX IF NOT EXISTS idx_jpd_review_page_id ON jpd_review_queue(page_id);
CREATE INDEX IF NOT EXISTS idx_jpd_review_status ON jpd_review_queue(status);
CREATE INDEX IF NOT EXISTS idx_jpd_review_reporter ON jpd_review_queue(reporter_email);

-- Enable Row Level Security
ALTER TABLE jpd_review_queue ENABLE ROW LEVEL SECURITY;

-- Policy: Everyone can view all review items
CREATE POLICY "Anyone can view review queue"
  ON jpd_review_queue
  FOR SELECT
  TO authenticated
  USING (true);

-- Policy: Anyone can insert (submit) review items
CREATE POLICY "Anyone can submit to review queue"
  ON jpd_review_queue
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Policy: Only admins can update review items (status changes)
-- Note: You'll need to define admin users in a separate way, or use a user_roles table
-- For now, this allows all authenticated users to update. Adjust based on your admin setup.
CREATE POLICY "Authenticated users can update review queue"
  ON jpd_review_queue
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Policy: Only admins can delete review items
CREATE POLICY "Authenticated users can delete review queue"
  ON jpd_review_queue
  FOR DELETE
  TO authenticated
  USING (true);

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_jpd_review_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to call the function
CREATE TRIGGER jpd_review_updated_at_trigger
  BEFORE UPDATE ON jpd_review_queue
  FOR EACH ROW
  EXECUTE FUNCTION update_jpd_review_updated_at();
