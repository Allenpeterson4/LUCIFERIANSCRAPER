CREATE TABLE IF NOT EXISTS email_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL CHECK (email = lower(email)),
  domain text,
  source_run_id uuid REFERENCES scraping_runs(id) ON DELETE SET NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  last_sent_at timestamptz,
  suppressed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, email),
  UNIQUE (id, user_id)
);

ALTER TABLE email_contacts ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON email_contacts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON email_contacts TO service_role;

CREATE POLICY "select_own_contacts" ON email_contacts FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "insert_own_contacts" ON email_contacts FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "update_own_contacts" ON email_contacts FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "delete_own_contacts" ON email_contacts FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS email_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name),
  UNIQUE (id, user_id)
);

ALTER TABLE email_lists ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON email_lists TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON email_lists TO service_role;

CREATE POLICY "select_own_email_lists" ON email_lists FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "insert_own_email_lists" ON email_lists FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "update_own_email_lists" ON email_lists FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "delete_own_email_lists" ON email_lists FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS email_list_contacts (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  list_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (list_id, contact_id),
  FOREIGN KEY (list_id, user_id) REFERENCES email_lists(id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (contact_id, user_id) REFERENCES email_contacts(id, user_id) ON DELETE CASCADE
);

ALTER TABLE email_list_contacts ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, DELETE ON email_list_contacts TO authenticated;
GRANT SELECT, INSERT, DELETE ON email_list_contacts TO service_role;

CREATE POLICY "select_own_list_contacts" ON email_list_contacts FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "insert_own_list_contacts" ON email_list_contacts FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "delete_own_list_contacts" ON email_list_contacts FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS email_delivery_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL,
  message_id uuid NOT NULL REFERENCES email_messages(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'failed', 'skipped')),
  error text,
  sent_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, contact_id, message_id),
  FOREIGN KEY (contact_id, user_id) REFERENCES email_contacts(id, user_id) ON DELETE CASCADE
);

ALTER TABLE email_delivery_log ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON email_delivery_log TO authenticated;
GRANT SELECT, INSERT, UPDATE ON email_delivery_log TO service_role;

CREATE POLICY "select_own_delivery_log" ON email_delivery_log FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('admin', 'user')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role)
);

ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON user_roles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON user_roles TO service_role;

CREATE POLICY "users_read_own_roles" ON user_roles FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION is_mailharvest_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'admin'
  );
$$;

GRANT EXECUTE ON FUNCTION is_mailharvest_admin() TO authenticated;

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  target_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON admin_audit_log TO authenticated;
GRANT SELECT, INSERT ON admin_audit_log TO service_role;

CREATE POLICY "admins_read_audit_log" ON admin_audit_log FOR SELECT
  TO authenticated USING (is_mailharvest_admin());

CREATE TABLE IF NOT EXISTS discovery_searches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('web', 'places')),
  query text NOT NULL,
  result_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE discovery_searches ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, DELETE ON discovery_searches TO authenticated;
GRANT SELECT, INSERT, DELETE ON discovery_searches TO service_role;

CREATE POLICY "select_own_discovery_searches" ON discovery_searches FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "insert_own_discovery_searches" ON discovery_searches FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "delete_own_discovery_searches" ON discovery_searches FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_email_contacts_user_date
  ON email_contacts (user_id, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_contacts_user_domain
  ON email_contacts (user_id, domain);
CREATE INDEX IF NOT EXISTS idx_email_lists_user_name
  ON email_lists (user_id, name);
CREATE INDEX IF NOT EXISTS idx_email_list_contacts_contact
  ON email_list_contacts (contact_id, user_id);
CREATE INDEX IF NOT EXISTS idx_email_delivery_log_user_sent
  ON email_delivery_log (user_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_discovery_searches_user_created
  ON discovery_searches (user_id, created_at DESC);

REVOKE ALL ON smtp_configs FROM authenticated;
GRANT SELECT (id, user_id, host, port, username, encryption, from_email, from_name, hourly_limit, is_active, created_at, updated_at)
  ON smtp_configs TO authenticated;
GRANT INSERT (user_id, host, port, username, password, encryption, from_email, from_name, hourly_limit, is_active)
  ON smtp_configs TO authenticated;
GRANT UPDATE (host, port, username, password, encryption, from_email, from_name, hourly_limit, is_active, updated_at)
  ON smtp_configs TO authenticated;
GRANT DELETE ON smtp_configs TO authenticated;

INSERT INTO email_contacts (user_id, email, domain, first_seen_at, last_seen_at)
SELECT
  results.user_id,
  lower(trim(email_value)),
  min(results.domain),
  min(results.created_at),
  max(results.created_at)
FROM scrape_results AS results
CROSS JOIN LATERAL unnest(results.emails) AS email_value
WHERE trim(email_value) <> ''
GROUP BY results.user_id, lower(trim(email_value))
ON CONFLICT (user_id, email) DO UPDATE
SET first_seen_at = LEAST(email_contacts.first_seen_at, EXCLUDED.first_seen_at),
    last_seen_at = GREATEST(email_contacts.last_seen_at, EXCLUDED.last_seen_at),
    domain = COALESCE(email_contacts.domain, EXCLUDED.domain),
    updated_at = now();