CREATE TABLE IF NOT EXISTS domain_parsing_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  source_url text NOT NULL,
  source_type text NOT NULL DEFAULT 'generic',
  status text NOT NULL DEFAULT 'completed',
  total_domains integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, user_id)
);

ALTER TABLE domain_parsing_runs ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON domain_parsing_runs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON domain_parsing_runs TO service_role;

CREATE POLICY "select_own_domain_runs" ON domain_parsing_runs FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "insert_own_domain_runs" ON domain_parsing_runs FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "update_own_domain_runs" ON domain_parsing_runs FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "delete_own_domain_runs" ON domain_parsing_runs FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS domain_parse_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  domain text NOT NULL,
  name text,
  category text,
  source_page_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (run_id, user_id) REFERENCES domain_parsing_runs(id, user_id) ON DELETE CASCADE
);

ALTER TABLE domain_parse_results ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON domain_parse_results TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON domain_parse_results TO service_role;

CREATE POLICY "select_own_domain_results" ON domain_parse_results FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "insert_own_domain_results" ON domain_parse_results FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "update_own_domain_results" ON domain_parse_results FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "delete_own_domain_results" ON domain_parse_results FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_domain_parsing_runs_user_created
  ON domain_parsing_runs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_domain_parse_results_run
  ON domain_parse_results (run_id, created_at);
CREATE INDEX IF NOT EXISTS idx_domain_parse_results_user_domain
  ON domain_parse_results (user_id, domain);