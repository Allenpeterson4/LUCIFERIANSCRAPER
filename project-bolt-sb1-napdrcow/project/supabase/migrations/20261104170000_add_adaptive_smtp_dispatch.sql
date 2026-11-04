CREATE TABLE IF NOT EXISTS public.smtp_provider_rate_state (
  smtp_config_id uuid PRIMARY KEY REFERENCES public.smtp_configs(id) ON DELETE CASCADE,
  provider_host text NOT NULL,
  messages_per_minute integer NOT NULL DEFAULT 1 CHECK (messages_per_minute >= 1),
  next_send_at timestamptz NOT NULL DEFAULT now(),
  minute_started_at timestamptz NOT NULL DEFAULT now(),
  attempts_this_minute integer NOT NULL DEFAULT 0,
  consecutive_successes integer NOT NULL DEFAULT 0,
  throttle_count integer NOT NULL DEFAULT 0,
  paused_until timestamptz,
  last_provider_response text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.smtp_configs DROP COLUMN IF EXISTS hourly_limit;

CREATE TABLE IF NOT EXISTS public.smtp_dispatch_attempts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  smtp_config_id uuid NOT NULL REFERENCES public.smtp_configs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  campaign_queue_id uuid REFERENCES public.campaign_queue(id) ON DELETE SET NULL,
  recipient text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('sent', 'failed', 'throttled')),
  provider_response text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.smtp_provider_rate_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.smtp_dispatch_attempts ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.smtp_provider_rate_state TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.smtp_dispatch_attempts TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.smtp_dispatch_attempts_id_seq TO service_role;
GRANT SELECT ON public.smtp_provider_rate_state, public.smtp_dispatch_attempts TO authenticated;

CREATE POLICY "owners_read_smtp_rate_state" ON public.smtp_provider_rate_state
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.smtp_configs
    WHERE smtp_configs.id = smtp_provider_rate_state.smtp_config_id
      AND smtp_configs.user_id = auth.uid()
  ));

CREATE POLICY "owners_read_smtp_dispatch_attempts" ON public.smtp_dispatch_attempts
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_smtp_dispatch_attempts_config_created
  ON public.smtp_dispatch_attempts (smtp_config_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_campaign_queue_due
  ON public.campaign_queue (next_batch_at, created_at)
  WHERE status IN ('queued', 'sending');

ALTER TABLE public.campaign_queue
  ADD COLUMN IF NOT EXISTS dispatch_lock_until timestamptz;

CREATE OR REPLACE FUNCTION public.reserve_smtp_send_slot(p_smtp_config_id uuid)
RETURNS TABLE(allowed boolean, retry_at timestamptz, current_rate integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_state public.smtp_provider_rate_state%ROWTYPE;
  v_now timestamptz := clock_timestamp();
BEGIN
  INSERT INTO public.smtp_provider_rate_state (smtp_config_id, provider_host)
  SELECT id, lower(host) FROM public.smtp_configs WHERE id = p_smtp_config_id
  ON CONFLICT (smtp_config_id) DO UPDATE
  SET provider_host = EXCLUDED.provider_host,
      messages_per_minute = CASE
        WHEN smtp_provider_rate_state.provider_host <> EXCLUDED.provider_host THEN 1
        ELSE smtp_provider_rate_state.messages_per_minute
      END,
      next_send_at = CASE
        WHEN smtp_provider_rate_state.provider_host <> EXCLUDED.provider_host THEN clock_timestamp()
        ELSE smtp_provider_rate_state.next_send_at
      END,
      attempts_this_minute = CASE
        WHEN smtp_provider_rate_state.provider_host <> EXCLUDED.provider_host THEN 0
        ELSE smtp_provider_rate_state.attempts_this_minute
      END,
      consecutive_successes = CASE
        WHEN smtp_provider_rate_state.provider_host <> EXCLUDED.provider_host THEN 0
        ELSE smtp_provider_rate_state.consecutive_successes
      END,
      throttle_count = CASE
        WHEN smtp_provider_rate_state.provider_host <> EXCLUDED.provider_host THEN 0
        ELSE smtp_provider_rate_state.throttle_count
      END,
      paused_until = CASE
        WHEN smtp_provider_rate_state.provider_host <> EXCLUDED.provider_host THEN NULL
        ELSE smtp_provider_rate_state.paused_until
      END;

  SELECT * INTO v_state
  FROM public.smtp_provider_rate_state
  WHERE smtp_config_id = p_smtp_config_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SMTP configuration not found';
  END IF;

  IF v_state.paused_until IS NOT NULL AND v_state.paused_until > v_now THEN
    RETURN QUERY SELECT false, v_state.paused_until, v_state.messages_per_minute;
    RETURN;
  END IF;

  IF v_state.next_send_at > v_now THEN
    RETURN QUERY SELECT false, v_state.next_send_at, v_state.messages_per_minute;
    RETURN;
  END IF;

  IF v_state.minute_started_at <= v_now - interval '1 minute' THEN
    UPDATE public.smtp_provider_rate_state
    SET minute_started_at = v_now, attempts_this_minute = 0, paused_until = NULL, updated_at = v_now
    WHERE smtp_config_id = p_smtp_config_id
    RETURNING * INTO v_state;
  END IF;

  IF v_state.attempts_this_minute >= v_state.messages_per_minute THEN
    RETURN QUERY SELECT false, v_state.minute_started_at + interval '1 minute', v_state.messages_per_minute;
    RETURN;
  END IF;

  UPDATE public.smtp_provider_rate_state
  SET attempts_this_minute = attempts_this_minute + 1,
      next_send_at = v_now + make_interval(secs => 60.0 / v_state.messages_per_minute),
      updated_at = v_now
  WHERE smtp_config_id = p_smtp_config_id;

  RETURN QUERY SELECT true, NULL::timestamptz, v_state.messages_per_minute;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_smtp_dispatch_attempt(
  p_smtp_config_id uuid,
  p_user_id uuid,
  p_campaign_queue_id uuid,
  p_recipient text,
  p_outcome text,
  p_provider_response text DEFAULT NULL,
  p_retry_after_seconds integer DEFAULT NULL
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
    smtp_config_id, user_id, campaign_queue_id, recipient, outcome, provider_response
  ) VALUES (
    p_smtp_config_id, p_user_id, p_campaign_queue_id, p_recipient, p_outcome,
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

REVOKE ALL ON FUNCTION public.reserve_smtp_send_slot(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_smtp_dispatch_attempt(uuid, uuid, uuid, text, text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_smtp_send_slot(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_smtp_dispatch_attempt(uuid, uuid, uuid, text, text, text, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_due_smtp_campaigns(p_user_id uuid DEFAULT NULL, p_limit integer DEFAULT 1)
RETURNS SETOF public.campaign_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT id
    FROM public.campaign_queue
    WHERE status IN ('queued', 'sending')
      AND (next_batch_at IS NULL OR next_batch_at <= clock_timestamp())
      AND (dispatch_lock_until IS NULL OR dispatch_lock_until <= clock_timestamp())
      AND (p_user_id IS NULL OR user_id = p_user_id)
    ORDER BY created_at
    LIMIT greatest(1, least(p_limit, 50))
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.campaign_queue AS queue
  SET dispatch_lock_until = clock_timestamp() + interval '5 minutes',
      updated_at = clock_timestamp()
  FROM due
  WHERE queue.id = due.id
  RETURNING queue.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_due_smtp_campaigns(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_smtp_campaigns(uuid, integer) TO service_role;

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
DECLARE
  v_job_id bigint;
  v_vault_ready boolean := false;
BEGIN
  SELECT jobid INTO v_job_id FROM cron.job WHERE jobname = 'smtp-campaign-dispatch';
  IF v_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(v_job_id);
  END IF;

    IF to_regclass('vault.decrypted_secrets') IS NOT NULL THEN
      EXECUTE $check$
        SELECT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'supabase_url')
           AND EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'service_role_key')
           AND EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'smtp_dispatcher_secret')
      $check$ INTO v_vault_ready;
    END IF;

    IF v_vault_ready THEN
    PERFORM cron.schedule(
      'smtp-campaign-dispatch',
      '* * * * *',
      $job$
        SELECT net.http_post(
          url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url') || '/functions/v1/smtp-send',
          headers := jsonb_build_object(
            'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key'),
            'X-Dispatcher-Secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'smtp_dispatcher_secret'),
            'Content-Type', 'application/json'
          ),
          body := '{"action":"dispatch_due"}'::jsonb
        );
      $job$
    );
  ELSE
    RAISE NOTICE 'SMTP background dispatch not scheduled. Add Vault secrets supabase_url, service_role_key, and smtp_dispatcher_secret, set the Edge Function secret SMTP_DISPATCHER_SECRET to the same value, then rerun this migration.';
  END IF;
END;
$$;