ALTER TABLE public.system_settings
  ADD COLUMN IF NOT EXISTS daily_free_credits integer NOT NULL DEFAULT 1000
    CHECK (daily_free_credits BETWEEN 0 AND 100000);

ALTER TABLE public.system_settings
  ADD COLUMN IF NOT EXISTS web_search_enabled boolean NOT NULL DEFAULT true;

ALTER TABLE public.email_messages
  ADD COLUMN IF NOT EXISTS format text NOT NULL DEFAULT 'text'
    CHECK (format IN ('text', 'html'));

WITH ranked_active_configs AS (
  SELECT id, row_number() OVER (PARTITION BY user_id ORDER BY updated_at DESC, created_at DESC, id) AS rank
  FROM public.smtp_configs
  WHERE is_active
)
UPDATE public.smtp_configs AS configs
SET is_active = false
FROM ranked_active_configs AS ranked
WHERE configs.id = ranked.id AND ranked.rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_smtp_configs_one_active_per_user
  ON public.smtp_configs (user_id) WHERE is_active;

  REVOKE INSERT ON public.campaign_queue FROM authenticated;

CREATE TABLE IF NOT EXISTS public.user_credit_accounts (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  daily_reset_date date NOT NULL DEFAULT (timezone('utc', now())::date),
  daily_allowance integer NOT NULL DEFAULT 1000 CHECK (daily_allowance BETWEEN 0 AND 100000),
  daily_remaining integer NOT NULL DEFAULT 1000 CHECK (daily_remaining BETWEEN 0 AND 100000),
  purchased_credits bigint NOT NULL DEFAULT 0 CHECK (purchased_credits >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.user_credit_transactions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  transaction_type text NOT NULL CHECK (transaction_type IN ('daily_grant', 'consume', 'top_up')),
  amount integer NOT NULL,
  reason text NOT NULL,
  reference_id text,
  daily_balance_after integer NOT NULL,
  purchased_balance_after bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_credit_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_credit_transactions ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.user_credit_accounts, public.user_credit_transactions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_credit_accounts, public.user_credit_transactions TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.user_credit_transactions_id_seq TO service_role;

CREATE POLICY "owners_read_credit_accounts" ON public.user_credit_accounts
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "owners_read_credit_transactions" ON public.user_credit_transactions
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_credit_transactions_user_created
  ON public.user_credit_transactions (user_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.refresh_user_credit_account(p_user_id uuid)
RETURNS public.user_credit_accounts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_allowance integer;
  v_account public.user_credit_accounts%ROWTYPE;
  v_today date := timezone('utc', now())::date;
  v_inserted integer;
BEGIN
  SELECT daily_free_credits INTO v_allowance FROM public.system_settings WHERE id = 1;
  IF v_allowance IS NULL THEN
    RAISE EXCEPTION 'Daily credit allowance is unavailable';
  END IF;

  INSERT INTO public.user_credit_accounts (
    user_id, daily_reset_date, daily_allowance, daily_remaining
  ) VALUES (p_user_id, v_today, v_allowance, v_allowance)
  ON CONFLICT (user_id) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  SELECT * INTO v_account
  FROM public.user_credit_accounts
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF v_inserted = 1 OR v_account.daily_reset_date < v_today OR v_account.daily_allowance <> v_allowance THEN
    UPDATE public.user_credit_accounts
    SET daily_reset_date = v_today,
        daily_allowance = v_allowance,
        daily_remaining = v_allowance,
        updated_at = now()
    WHERE user_id = p_user_id
    RETURNING * INTO v_account;

    INSERT INTO public.user_credit_transactions (
      user_id, transaction_type, amount, reason, daily_balance_after, purchased_balance_after
    ) VALUES (p_user_id, 'daily_grant', v_allowance, 'daily_allowance', v_account.daily_remaining, v_account.purchased_credits);
  END IF;

  RETURN v_account;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_credit_balance()
RETURNS TABLE(daily_allowance integer, daily_remaining integer, purchased_credits bigint, total_remaining bigint, resets_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_account public.user_credit_accounts%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  v_account := public.refresh_user_credit_account(auth.uid());
  RETURN QUERY SELECT
    v_account.daily_allowance,
    v_account.daily_remaining,
    v_account.purchased_credits,
    v_account.daily_remaining::bigint + v_account.purchased_credits,
    ((timezone('utc', now())::date + 1)::timestamp AT TIME ZONE 'utc');
END;
$$;

CREATE OR REPLACE FUNCTION public.consume_user_credits(
  p_user_id uuid,
  p_amount integer,
  p_reason text,
  p_reference_id text DEFAULT NULL
)
RETURNS TABLE(allowed boolean, daily_remaining integer, purchased_credits bigint, total_remaining bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_account public.user_credit_accounts%ROWTYPE;
  v_from_daily integer;
  v_from_purchased bigint;
BEGIN
  IF p_amount IS NULL OR p_amount < 1 OR p_amount > 100000 THEN
    RAISE EXCEPTION 'Credit amount must be between 1 and 100000';
  END IF;
  v_account := public.refresh_user_credit_account(p_user_id);
  IF v_account.daily_remaining::bigint + v_account.purchased_credits < p_amount THEN
    RETURN QUERY SELECT false, v_account.daily_remaining, v_account.purchased_credits,
      v_account.daily_remaining::bigint + v_account.purchased_credits;
    RETURN;
  END IF;

  v_from_daily := least(v_account.daily_remaining, p_amount);
  v_from_purchased := p_amount - v_from_daily;

  UPDATE public.user_credit_accounts
  SET daily_remaining = daily_remaining - v_from_daily,
      purchased_credits = purchased_credits - v_from_purchased,
      updated_at = now()
  WHERE user_id = p_user_id
  RETURNING * INTO v_account;

  INSERT INTO public.user_credit_transactions (
    user_id, transaction_type, amount, reason, reference_id, daily_balance_after, purchased_balance_after
  ) VALUES (p_user_id, 'consume', -p_amount, left(p_reason, 120), p_reference_id, v_account.daily_remaining, v_account.purchased_credits);

  RETURN QUERY SELECT true, v_account.daily_remaining, v_account.purchased_credits,
    v_account.daily_remaining::bigint + v_account.purchased_credits;
END;
$$;

CREATE OR REPLACE FUNCTION public.grant_user_credits(
  p_user_id uuid,
  p_amount integer,
  p_reason text DEFAULT 'credit_top_up'
)
RETURNS TABLE(daily_remaining integer, purchased_credits bigint, total_remaining bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_account public.user_credit_accounts%ROWTYPE;
BEGIN
  IF p_amount IS NULL OR p_amount < 1 OR p_amount > 100000000 THEN
    RAISE EXCEPTION 'Credit grant must be between 1 and 100000000';
  END IF;
  v_account := public.refresh_user_credit_account(p_user_id);
  UPDATE public.user_credit_accounts
  SET purchased_credits = purchased_credits + p_amount,
      updated_at = now()
  WHERE user_id = p_user_id
  RETURNING * INTO v_account;

  INSERT INTO public.user_credit_transactions (
    user_id, transaction_type, amount, reason, daily_balance_after, purchased_balance_after
  ) VALUES (p_user_id, 'top_up', p_amount, left(p_reason, 120), v_account.daily_remaining, v_account.purchased_credits);

  RETURN QUERY SELECT v_account.daily_remaining, v_account.purchased_credits,
    v_account.daily_remaining::bigint + v_account.purchased_credits;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_user_credit_account(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.consume_user_credits(uuid, integer, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.grant_user_credits(uuid, integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_my_credit_balance() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_credit_balance() TO authenticated;
GRANT EXECUTE ON FUNCTION public.consume_user_credits(uuid, integer, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.grant_user_credits(uuid, integer, text) TO service_role;