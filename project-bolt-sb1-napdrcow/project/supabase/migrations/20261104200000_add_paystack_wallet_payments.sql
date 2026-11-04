CREATE TABLE IF NOT EXISTS public.wallet_payments (
  reference text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  gateway text NOT NULL CHECK (gateway IN ('paystack')),
  bundle_type text NOT NULL DEFAULT 'bundle' CHECK (bundle_type IN ('bundle', 'monthly')),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  credits integer NOT NULL CHECK (credits > 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed')),
  gateway_transaction_id text,
  subscription_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.credit_subscriptions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  bundle_type text NOT NULL DEFAULT 'monthly' CHECK (bundle_type IN ('monthly')),
  credits_limit bigint NOT NULL DEFAULT 1000000 CHECK (credits_limit > 0),
  starts_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, expires_at)
);

ALTER TABLE public.wallet_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_subscriptions ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.wallet_payments, public.credit_subscriptions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wallet_payments, public.credit_subscriptions TO service_role;

CREATE POLICY "owners_read_wallet_payments" ON public.wallet_payments
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY "owners_read_credit_subscriptions" ON public.credit_subscriptions
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_wallet_payments_user_created
  ON public.wallet_payments (user_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.confirm_wallet_payment(
  p_reference text,
  p_gateway_transaction_id text,
  p_amount_minor bigint,
  p_currency text
)
RETURNS TABLE(applied boolean, daily_remaining integer, purchased_credits bigint, total_remaining bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_payment public.wallet_payments%ROWTYPE;
  v_account public.user_credit_accounts%ROWTYPE;
  v_subscription_expires_at timestamptz;
BEGIN
  SELECT * INTO v_payment
  FROM public.wallet_payments
  WHERE reference = p_reference AND gateway = 'paystack'
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Wallet payment reference not found'; END IF;
  IF v_payment.amount_minor <> p_amount_minor OR v_payment.currency <> upper(p_currency) THEN
    RAISE EXCEPTION 'Verified payment amount or currency does not match';
  END IF;

  IF v_payment.status = 'paid' THEN
    v_account := public.refresh_user_credit_account(v_payment.user_id);
    RETURN QUERY SELECT false, v_account.daily_remaining, v_account.purchased_credits,
      v_account.daily_remaining::bigint + v_account.purchased_credits;
    RETURN;
  END IF;

  IF v_payment.status <> 'pending' THEN RAISE EXCEPTION 'Wallet payment is not pending'; END IF;

  v_account := public.refresh_user_credit_account(v_payment.user_id);
  IF v_payment.bundle_type = 'monthly' THEN
    v_subscription_expires_at := now() + interval '30 days';
    INSERT INTO public.credit_subscriptions (user_id, bundle_type, credits_limit, starts_at, expires_at)
    VALUES (v_payment.user_id, 'monthly', 1000000, now(), v_subscription_expires_at)
    ON CONFLICT (user_id, expires_at) DO NOTHING;
    UPDATE public.user_credit_accounts
    SET purchased_credits = purchased_credits + v_payment.credits,
        updated_at = now()
    WHERE user_id = v_payment.user_id
    RETURNING * INTO v_account;
  ELSE
    UPDATE public.user_credit_accounts
    SET purchased_credits = purchased_credits + v_payment.credits,
        updated_at = now()
    WHERE user_id = v_payment.user_id
    RETURNING * INTO v_account;
  END IF;

  UPDATE public.wallet_payments
  SET status = 'paid', gateway_transaction_id = p_gateway_transaction_id, paid_at = now(), subscription_expires_at = v_subscription_expires_at
  WHERE reference = p_reference;

  INSERT INTO public.user_credit_transactions (
    user_id, transaction_type, amount, reason, reference_id, daily_balance_after, purchased_balance_after
  ) VALUES (
    v_payment.user_id, 'top_up', v_payment.credits, COALESCE(v_payment.bundle_type, 'bundle') || '_payment', p_reference,
    v_account.daily_remaining, v_account.purchased_credits
  );

  RETURN QUERY SELECT true, v_account.daily_remaining, v_account.purchased_credits,
    v_account.daily_remaining::bigint + v_account.purchased_credits;
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_wallet_payment(text, text, bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_wallet_payment(text, text, bigint, text) TO service_role;