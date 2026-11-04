/*
# SMTP configuration, message manager, and campaign queue tables

1. New Tables
- `smtp_configs` — stores a user's SMTP server settings.
  - id, user_id, host, port, username, password, encryption, from_email, from_name, hourly_limit, is_active, created_at, updated_at
- `email_messages` — saved email message templates.
  - id, user_id, subject, body, recipient_type, created_at, updated_at
- `campaign_queue` — queued campaigns with scheduling and batch tracking.
  - id, user_id, message_id, smtp_config_id, recipients, status, total_sent, total_failed, batch_size, next_batch_at, last_batch_at, error, created_at, updated_at
2. Security
- RLS enabled on all tables, authenticated-only CRUD, owner-scoped.
- service_role grants for edge function access.
3. Notes
- user_id defaults to auth.uid() on all tables.
- campaign_queue cascades on delete of message or smtp_config.
*/

CREATE TABLE IF NOT EXISTS smtp_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  host text NOT NULL,
  port integer NOT NULL DEFAULT 587,
  username text NOT NULL,
  password text NOT NULL,
  encryption text NOT NULL DEFAULT 'tls',
  from_email text NOT NULL,
  from_name text,
  hourly_limit integer NOT NULL DEFAULT 100,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE smtp_configs ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON smtp_configs TO authenticated;
GRANT SELECT, INSERT, UPDATE ON smtp_configs TO service_role;

DROP POLICY IF EXISTS "select_own_smtp" ON smtp_configs;
CREATE POLICY "select_own_smtp" ON smtp_configs FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "insert_own_smtp" ON smtp_configs;
CREATE POLICY "insert_own_smtp" ON smtp_configs FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "update_own_smtp" ON smtp_configs;
CREATE POLICY "update_own_smtp" ON smtp_configs FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "delete_own_smtp" ON smtp_configs;
CREATE POLICY "delete_own_smtp" ON smtp_configs FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS email_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  subject text NOT NULL,
  body text NOT NULL,
  recipient_type text NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE email_messages ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON email_messages TO authenticated;
GRANT SELECT, INSERT, UPDATE ON email_messages TO service_role;

DROP POLICY IF EXISTS "select_own_messages" ON email_messages;
CREATE POLICY "select_own_messages" ON email_messages FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "insert_own_messages" ON email_messages;
CREATE POLICY "insert_own_messages" ON email_messages FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "update_own_messages" ON email_messages;
CREATE POLICY "update_own_messages" ON email_messages FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "delete_own_messages" ON email_messages;
CREATE POLICY "delete_own_messages" ON email_messages FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS campaign_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES email_messages(id) ON DELETE CASCADE,
  smtp_config_id uuid NOT NULL REFERENCES smtp_configs(id) ON DELETE CASCADE,
  recipients text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'queued',
  total_sent integer NOT NULL DEFAULT 0,
  total_failed integer NOT NULL DEFAULT 0,
  batch_size integer NOT NULL DEFAULT 50,
  next_batch_at timestamptz,
  last_batch_at timestamptz,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE campaign_queue ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON campaign_queue TO authenticated;
GRANT SELECT, INSERT, UPDATE ON campaign_queue TO service_role;

DROP POLICY IF EXISTS "select_own_queue" ON campaign_queue;
CREATE POLICY "select_own_queue" ON campaign_queue FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "insert_own_queue" ON campaign_queue;
CREATE POLICY "insert_own_queue" ON campaign_queue FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "update_own_queue" ON campaign_queue;
CREATE POLICY "update_own_queue" ON campaign_queue FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "delete_own_queue" ON campaign_queue;
CREATE POLICY "delete_own_queue" ON campaign_queue FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_smtp_configs_user_id ON smtp_configs(user_id);
CREATE INDEX IF NOT EXISTS idx_email_messages_user_id ON email_messages(user_id);
CREATE INDEX IF NOT EXISTS idx_campaign_queue_user_id ON campaign_queue(user_id);
CREATE INDEX IF NOT EXISTS idx_campaign_queue_status ON campaign_queue(status);
