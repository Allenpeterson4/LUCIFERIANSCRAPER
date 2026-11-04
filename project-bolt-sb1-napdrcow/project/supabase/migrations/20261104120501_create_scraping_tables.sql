/*
# Email scraping platform tables

1. New Tables
- `scraping_runs` — one row per scraping request (single domain or bulk batch).
  - id (uuid, pk)
  - user_id (uuid, owner, defaults to auth.uid())
  - domain (text, the primary domain; for bulk runs this is the first domain)
  - is_bulk (boolean, whether this was a multi-domain batch)
  - status (text: pending | running | completed | failed)
  - total_emails (int, count of emails found across all domains in this run)
  - created_at (timestamptz)
- `scrape_results` — one row per domain processed within a run.
  - id (uuid, pk)
  - run_id (uuid, fk to scraping_runs, cascade delete)
  - user_id (uuid, owner, defaults to auth.uid())
  - domain (text)
  - emails (text[], extracted email addresses)
  - status (text: completed | failed | no_emails)
  - pages_scanned (int, number of pages fetched)
  - error (text, nullable, error message if failed)
  - created_at (timestamptz)
2. Security
- Enable RLS on both tables.
- Grant CRUD to authenticated only (sign-in required app).
- Owner-scoped policies using auth.uid() = user_id.
- service_role grant on scrape_results for the edge function to insert results.
3. Notes
- Owner columns default to auth.uid() so client inserts omitting user_id succeed.
- cascade delete on scrape_results.run_id so deleting a run cleans up its results.
*/

CREATE TABLE IF NOT EXISTS scraping_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  domain text NOT NULL,
  is_bulk boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pending',
  total_emails integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE scraping_runs ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON scraping_runs TO authenticated;

DROP POLICY IF EXISTS "select_own_runs" ON scraping_runs;
CREATE POLICY "select_own_runs" ON scraping_runs FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_runs" ON scraping_runs;
CREATE POLICY "insert_own_runs" ON scraping_runs FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_runs" ON scraping_runs;
CREATE POLICY "update_own_runs" ON scraping_runs FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_runs" ON scraping_runs;
CREATE POLICY "delete_own_runs" ON scraping_runs FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS scrape_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES scraping_runs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  domain text NOT NULL,
  emails text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'pending',
  pages_scanned integer NOT NULL DEFAULT 0,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE scrape_results ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON scrape_results TO authenticated;
GRANT INSERT, UPDATE ON scrape_results TO service_role;

DROP POLICY IF EXISTS "select_own_results" ON scrape_results;
CREATE POLICY "select_own_results" ON scrape_results FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_results" ON scrape_results;
CREATE POLICY "insert_own_results" ON scrape_results FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_results" ON scrape_results;
CREATE POLICY "update_own_results" ON scrape_results FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_results" ON scrape_results;
CREATE POLICY "delete_own_results" ON scrape_results FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_scraping_runs_user_id ON scraping_runs(user_id);
CREATE INDEX IF NOT EXISTS idx_scrape_results_run_id ON scrape_results(run_id);
CREATE INDEX IF NOT EXISTS idx_scrape_results_user_id ON scrape_results(user_id);
