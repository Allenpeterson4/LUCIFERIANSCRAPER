ALTER TABLE public.email_contacts
  ADD COLUMN IF NOT EXISTS replied_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_email_contacts_user_replied
  ON public.email_contacts (user_id, replied_at);

CREATE TABLE IF NOT EXISTS public.email_reply_tracking (
  token text PRIMARY KEY CHECK (token ~ '^[0-9a-f]{32}$'),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  campaign_queue_id uuid NOT NULL REFERENCES public.campaign_queue(id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES public.email_messages(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES public.email_contacts(id) ON DELETE SET NULL,
  recipient_email text NOT NULL,
  reply_to_address text NOT NULL UNIQUE,
  sent_at timestamptz,
  replied_at timestamptz,
  reply_from text,
  reply_subject text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.email_reply_tracking ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.email_reply_tracking FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.email_reply_tracking TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.email_reply_tracking TO service_role;

CREATE POLICY "owners_read_email_reply_tracking" ON public.email_reply_tracking
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_email_reply_tracking_user_created
  ON public.email_reply_tracking (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_reply_tracking_campaign
  ON public.email_reply_tracking (campaign_queue_id, recipient_email);