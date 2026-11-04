/*
# SMTP configuration, message manager, and campaign queue tables

1. New Tables
- `smtp_configs` — stores a user's SMTP server settings.
  - id (uuid, pk)
  - user_id (uuid, owner, defaults to auth.uid())
  - host (text, SMTP server hostname)
  - port (integer, SMTP port)
  - username (text, SMTP login username)
  - password (text, SMTP login password — stored encrypted at app level)
  - encryption (text: none | ssl | tls)
  - from_email (text, sender email address)
  - from_name (text, sender display name)
  - hourly_limit (integer, max emails per hour for this provider, default 100)
  - is_active (boolean, whether this is the active config)
  - created_at (timestamptz)
  - updated_at (timestamptz)
- `email_messages` — saved email message templates drafted by the user.
  - id (uuid, pk)
  - user_id (uuid, owner, defaults to auth.uid())
  - subject (text, email subject line)
  - body (text, email body content)
  - recipient_type (text: manual | scraped — where recipients come from)
  - created_at (timestamptz)
  - updated_at (timestamptz)
- `campaign_queue` — queued email campaigns with scheduling and batch tracking.
  - id (uuid, pk)
  - user_id (uuid, owner, defaults to auth.uid())
  - message_id (uuid, fk to email_messages)
  - smtp_config_id (uuid, fk to smtp_configs)
  - recipients (text[], email addresses to send to)
  - status (text: queued | sending | paused | completed | failed)
  - total_sent (integer, default 0)
  - total_failed (integer, default 0)
  - batch_size (integer, emails per hourly batch)
  - next_batch_at (timestamptz, when the next batch should send)
  - last_batch_at (timestamptz, when the last batch was sent)
  - error (text, nullable)
  - created_at (timestamptz)
  - updated_at (timestamptz)
2. Security
- Enable RLS on all three tables.
- Grant CRUD to authenticated only (sign-in required app).
- Owner-scoped policies using auth.uid() = user_id.
- service_role grant on all tables for the edge function.
3. Notes
- Owner columns default to auth.uid() so client inserts omitting user_id succeed.
- campaign_queue cascades on delete of message or smtp_config.
- hourly_limit lets the scheduler respect provider sending limits.
*/
