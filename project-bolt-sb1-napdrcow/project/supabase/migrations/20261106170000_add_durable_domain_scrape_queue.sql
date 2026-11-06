CREATE TABLE public.scrape_domain_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.scraping_runs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ordinal integer NOT NULL CHECK (ordinal > 0),
  input text NOT NULL,
  domain text NOT NULL,
  start_url text,
  intent text NOT NULL DEFAULT '',
  source_type text NOT NULL DEFAULT 'website' CHECK (source_type IN ('website', 'maps')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'completed', 'no_emails', 'not_relevant', 'failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz,
  result_id uuid REFERENCES public.scrape_results(id) ON DELETE SET NULL,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, ordinal)
);

ALTER TABLE public.scrape_domain_jobs ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.scrape_domain_jobs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scrape_domain_jobs TO service_role;
CREATE POLICY "owners_read_scrape_domain_jobs" ON public.scrape_domain_jobs
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

ALTER TABLE public.scrape_results
  ADD COLUMN job_id uuid REFERENCES public.scrape_domain_jobs(id) ON DELETE SET NULL;
ALTER TABLE public.scrape_results
  ADD CONSTRAINT scrape_results_job_id_key UNIQUE (job_id);
CREATE INDEX idx_scrape_domain_jobs_due
  ON public.scrape_domain_jobs (available_at, created_at)
  WHERE status IN ('queued', 'processing');
CREATE INDEX idx_scrape_domain_jobs_run
  ON public.scrape_domain_jobs (run_id, ordinal);

CREATE OR REPLACE FUNCTION public.enqueue_scrape_batch(
  p_user_id uuid,
  p_source_type text,
  p_source_query text,
  p_batch_label text,
  p_intent text,
  p_tasks jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_primary_domain text;
  v_total integer;
  v_valid_count integer;
  v_remaining integer;
  v_charge integer;
  v_credit record;
  v_credits_remaining bigint := 0;
  v_run public.scraping_runs%ROWTYPE;
BEGIN
  IF p_user_id IS NULL OR jsonb_typeof(p_tasks) <> 'array' OR jsonb_array_length(p_tasks) = 0 THEN
    RAISE EXCEPTION 'A user and at least one domain task are required';
  END IF;

  SELECT count(*)::integer,
         count(*) FILTER (WHERE coalesce(value->>'error', '') = '')::integer,
         coalesce((array_agg(coalesce(nullif(value->>'domain', ''), value->>'input') ORDER BY ordinality))[1], '')
  INTO v_total, v_valid_count, v_primary_domain
  FROM jsonb_array_elements(p_tasks) WITH ORDINALITY AS tasks(value, ordinality);

  IF v_valid_count > 0 THEN
    PERFORM public.refresh_user_credit_account(p_user_id);
    v_remaining := v_valid_count;
    WHILE v_remaining > 0 LOOP
      v_charge := least(v_remaining, 100000);
      SELECT * INTO v_credit
      FROM public.consume_user_credits(p_user_id, v_charge, 'email_domain_scrape', NULL);
      IF NOT coalesce(v_credit.allowed, false) THEN
        RAISE EXCEPTION 'Not enough credits. This batch needs % credits; % remain.', v_valid_count, v_credit.total_remaining
          USING ERRCODE = 'P0001', DETAIL = 'INSUFFICIENT_CREDITS';
      END IF;
      v_credits_remaining := coalesce(v_credit.total_remaining, 0);
      v_remaining := v_remaining - v_charge;
    END LOOP;
  END IF;

  INSERT INTO public.scraping_runs (
    user_id, domain, is_bulk, status, total_emails, source_type, source_query, batch_label
  ) VALUES (
    p_user_id,
    v_primary_domain,
    v_total > 1,
    'queued',
    0,
    CASE WHEN p_source_type = 'maps' THEN 'maps' ELSE 'website' END,
    nullif(left(coalesce(p_source_query, ''), 200), ''),
    coalesce(nullif(left(coalesce(p_batch_label, ''), 120), ''), 'Website: ' || v_primary_domain)
  ) RETURNING * INTO v_run;

  INSERT INTO public.scrape_domain_jobs (
    run_id, user_id, ordinal, input, domain, start_url, intent, source_type, status, error
  )
  SELECT
    v_run.id,
    p_user_id,
    tasks.ordinality::integer,
    coalesce(value->>'input', ''),
    coalesce(nullif(value->>'domain', ''), value->>'input', ''),
    nullif(value->>'start_url', ''),
    left(coalesce(p_intent, ''), 200),
    CASE WHEN p_source_type = 'maps' THEN 'maps' ELSE 'website' END,
    'queued',
    nullif(value->>'error', '')
  FROM jsonb_array_elements(p_tasks) WITH ORDINALITY AS tasks(value, ordinality);

  RETURN jsonb_build_object(
    'run_id', v_run.id,
    'total_domains', v_total,
    'valid_domains', v_valid_count,
    'credits_remaining', v_credits_remaining
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_due_scrape_domain_jobs(p_limit integer DEFAULT 1)
RETURNS SETOF public.scrape_domain_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT id
    FROM public.scrape_domain_jobs
    WHERE available_at <= clock_timestamp()
      AND (
        status = 'queued'
        OR (status = 'processing' AND locked_until <= clock_timestamp())
      )
    ORDER BY created_at, ordinal
    LIMIT greatest(1, least(p_limit, 5))
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.scrape_domain_jobs AS job
  SET status = 'processing',
      attempts = job.attempts + 1,
      locked_until = clock_timestamp() + interval '10 minutes',
      updated_at = clock_timestamp()
  FROM due
  WHERE job.id = due.id
  RETURNING job.*;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_scrape_batch(uuid, text, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_due_scrape_domain_jobs(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_scrape_batch(uuid, text, text, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_due_scrape_domain_jobs(integer) TO service_role;

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
DECLARE
  v_job_id bigint;
  v_vault_ready boolean := false;
BEGIN
  SELECT jobid INTO v_job_id FROM cron.job WHERE jobname = 'scrape-domain-dispatch';
  IF v_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(v_job_id);
  END IF;

  IF to_regclass('vault.decrypted_secrets') IS NOT NULL THEN
    EXECUTE $check$
      SELECT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'supabase_url')
         AND EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'scrape_dispatcher_secret')
    $check$ INTO v_vault_ready;
  END IF;

  IF v_vault_ready THEN
    PERFORM cron.schedule(
      'scrape-domain-dispatch',
      '* * * * *',
      $job$
        SELECT net.http_post(
          url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url') || '/functions/v1/scrape-emails',
          headers := jsonb_build_object(
            'X-Scrape-Dispatcher-Secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'scrape_dispatcher_secret'),
            'Content-Type', 'application/json'
          ),
          body := '{"action":"dispatch_due"}'::jsonb
        );
      $job$
    );
  ELSE
    RAISE NOTICE 'Scrape worker cron not scheduled. Configure Vault secrets supabase_url and scrape_dispatcher_secret, set the Edge Function secret SCRAPE_DISPATCHER_SECRET to the same value, then rerun this migration.';
  END IF;
END;
$$;
