CREATE TABLE IF NOT EXISTS public.smtp_bounce_entries (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  smtp_config_id uuid NOT NULL REFERENCES public.smtp_configs(id) ON DELETE CASCADE,
  campaign_queue_id uuid NOT NULL REFERENCES public.campaign_queue(id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES public.email_messages(id) ON DELETE CASCADE,
  recipient text NOT NULL,
  failure_reason text NOT NULL,
  failure_count integer NOT NULL DEFAULT 1 CHECK (failure_count > 0),
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'reviewed')),
  first_failed_at timestamptz NOT NULL DEFAULT now(),
  last_failed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_queue_id, recipient)
);

ALTER TABLE public.smtp_bounce_entries ENABLE ROW LEVEL SECURITY;
GRANT SELECT, UPDATE, DELETE ON public.smtp_bounce_entries TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.smtp_bounce_entries TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.smtp_bounce_entries_id_seq TO service_role;

CREATE POLICY "owners_read_smtp_bounces" ON public.smtp_bounce_entries
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "owners_review_smtp_bounces" ON public.smtp_bounce_entries
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "owners_delete_smtp_bounces" ON public.smtp_bounce_entries
  FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_smtp_bounces_user_status_created
  ON public.smtp_bounce_entries (user_id, status, last_failed_at DESC);

ALTER TABLE public.smtp_dispatch_attempts
  ADD COLUMN IF NOT EXISTS message_id uuid REFERENCES public.email_messages(id) ON DELETE SET NULL;

UPDATE public.smtp_dispatch_attempts AS attempts
SET message_id = campaigns.message_id
FROM public.campaign_queue AS campaigns
WHERE attempts.campaign_queue_id = campaigns.id
  AND attempts.message_id IS NULL;

DROP FUNCTION IF EXISTS public.record_smtp_dispatch_attempt(uuid, uuid, uuid, text, text, text, integer);

CREATE FUNCTION public.record_smtp_dispatch_attempt(
  p_smtp_config_id uuid,
  p_user_id uuid,
  p_campaign_queue_id uuid,
  p_recipient text,
  p_outcome text,
  p_provider_response text DEFAULT NULL,
  p_retry_after_seconds integer DEFAULT NULL,
  p_message_id uuid DEFAULT NULL
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_state public.smtp_provider_rate_state%ROWTYPE;
  v_retry_seconds integer;
  v_paused_until timestamptz;
BEGIN
  IF p_outcome NOT IN ('sent', 'failed', 'throttled') THEN
    RAISE EXCEPTION 'Invalid SMTP dispatch outcome';
  END IF;

  INSERT INTO public.smtp_provider_rate_state (smtp_config_id, provider_host)
  SELECT id, lower(host) FROM public.smtp_configs WHERE id = p_smtp_config_id
  ON CONFLICT (smtp_config_id) DO NOTHING;

  INSERT INTO public.smtp_dispatch_attempts (
    smtp_config_id, user_id, campaign_queue_id, message_id, recipient, outcome, provider_response
  ) VALUES (
    p_smtp_config_id, p_user_id, p_campaign_queue_id, p_message_id, p_recipient, p_outcome,
    left(p_provider_response, 1000)
  );

  SELECT * INTO v_state
  FROM public.smtp_provider_rate_state
  WHERE smtp_config_id = p_smtp_config_id
  FOR UPDATE;

  IF p_outcome = 'throttled' THEN
    v_retry_seconds := greatest(60, least(86400, coalesce(
      p_retry_after_seconds,
      60 * power(2, least(v_state.throttle_count, 6))::integer
    )));
    v_paused_until := clock_timestamp() + make_interval(secs => v_retry_seconds);
    UPDATE public.smtp_provider_rate_state
    SET messages_per_minute = greatest(1, floor(messages_per_minute / 2.0)::integer),
        consecutive_successes = 0,
        throttle_count = throttle_count + 1,
        paused_until = v_paused_until,
        last_provider_response = left(p_provider_response, 1000),
        updated_at = clock_timestamp()
    WHERE smtp_config_id = p_smtp_config_id;
  ELSIF p_outcome = 'sent' THEN
    UPDATE public.smtp_provider_rate_state
    SET messages_per_minute = CASE
          WHEN consecutive_successes >= 9 THEN messages_per_minute + 1
          ELSE messages_per_minute
        END,
        consecutive_successes = CASE
          WHEN consecutive_successes >= 9 THEN 0
          ELSE consecutive_successes + 1
        END,
        throttle_count = 0,
        paused_until = NULL,
        last_provider_response = NULL,
        updated_at = clock_timestamp()
    WHERE smtp_config_id = p_smtp_config_id;
  ELSE
    UPDATE public.smtp_provider_rate_state
    SET consecutive_successes = 0,
        last_provider_response = left(p_provider_response, 1000),
        updated_at = clock_timestamp()
    WHERE smtp_config_id = p_smtp_config_id;
  END IF;

  RETURN v_paused_until;
END;
$$;

REVOKE ALL ON FUNCTION public.record_smtp_dispatch_attempt(uuid, uuid, uuid, text, text, text, integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_smtp_dispatch_attempt(uuid, uuid, uuid, text, text, text, integer, uuid) TO service_role;

COMMENT ON TABLE public.smtp_bounce_entries IS
  'Best-effort review list for recipient delivery failures; failure handling never blocks campaign queue progress.';

CREATE OR REPLACE FUNCTION public.record_smtp_bounce_entry(
  p_user_id uuid,
  p_smtp_config_id uuid,
  p_campaign_queue_id uuid,
  p_message_id uuid,
  p_recipient text,
  p_failure_reason text
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  INSERT INTO public.smtp_bounce_entries (
    user_id, smtp_config_id, campaign_queue_id, message_id, recipient, failure_reason
  ) VALUES (
    p_user_id, p_smtp_config_id, p_campaign_queue_id, p_message_id,
    lower(trim(p_recipient)), left(p_failure_reason, 1000)
  )
  ON CONFLICT (campaign_queue_id, recipient) DO UPDATE
  SET failure_reason = EXCLUDED.failure_reason,
      failure_count = public.smtp_bounce_entries.failure_count + 1,
      status = 'new',
      last_failed_at = now();
$$;

REVOKE ALL ON FUNCTION public.record_smtp_bounce_entry(uuid, uuid, uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_smtp_bounce_entry(uuid, uuid, uuid, uuid, text, text) TO service_role;