ALTER TABLE public.wallet_payments
  DROP CONSTRAINT IF EXISTS wallet_payments_gateway_check,
  ADD CONSTRAINT wallet_payments_gateway_check
    CHECK (gateway IN ('paystack', 'flutterwave', 'monnify', 'korapay', 'manual')),
  ADD COLUMN IF NOT EXISTS proof_path text,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_note text;

CREATE INDEX IF NOT EXISTS idx_wallet_payments_manual_review
  ON public.wallet_payments (created_at DESC)
  WHERE gateway = 'manual' AND status = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_payments_manual_proof
  ON public.wallet_payments (proof_path)
  WHERE gateway = 'manual' AND proof_path IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.wallet_funding_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  bank_name text NOT NULL DEFAULT '',
  account_number text NOT NULL DEFAULT '',
  account_name text NOT NULL DEFAULT '',
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.wallet_funding_settings ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.wallet_funding_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wallet_funding_settings TO service_role;
CREATE POLICY "authenticated_read_wallet_funding_settings" ON public.wallet_funding_settings
  FOR SELECT TO authenticated USING (true);
INSERT INTO public.wallet_funding_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'wallet-payment-proofs',
  'wallet-payment-proofs',
  false,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'application/pdf']::text[]
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = 10485760,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'application/pdf']::text[];

CREATE POLICY "users_upload_own_wallet_payment_proofs" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'wallet-payment-proofs'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
CREATE POLICY "users_read_own_wallet_payment_proofs" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'wallet-payment-proofs'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
CREATE POLICY "users_delete_own_wallet_payment_proofs" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'wallet-payment-proofs'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

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
  v_subscription_remaining bigint;
  v_subscription_starts_at timestamptz;
  v_subscription_expires_at timestamptz;
BEGIN
  SELECT * INTO v_payment
  FROM public.wallet_payments
  WHERE reference = p_reference
    AND gateway IN ('paystack', 'flutterwave', 'monnify', 'korapay')
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Automated wallet payment reference not found'; END IF;
  IF v_payment.amount_minor <> p_amount_minor OR v_payment.currency <> upper(p_currency) THEN
    RAISE EXCEPTION 'Verified payment amount or currency does not match';
  END IF;

  IF v_payment.status = 'paid' THEN
    v_account := public.refresh_user_credit_account(v_payment.user_id);
    SELECT COALESCE(sum(credits_remaining), 0)
    INTO v_subscription_remaining
    FROM public.credit_subscriptions
    WHERE user_id = v_payment.user_id AND starts_at <= now() AND expires_at > now();
    RETURN QUERY SELECT false, v_account.daily_remaining, v_account.purchased_credits,
      v_account.daily_remaining::bigint + v_account.purchased_credits + v_subscription_remaining;
    RETURN;
  END IF;

  IF v_payment.status <> 'pending' THEN RAISE EXCEPTION 'Wallet payment is not pending'; END IF;
  v_account := public.refresh_user_credit_account(v_payment.user_id);
  SELECT * INTO v_account
  FROM public.user_credit_accounts
  WHERE user_id = v_payment.user_id
  FOR UPDATE;

  IF v_payment.bundle_type = 'monthly' THEN
    IF v_payment.credits <> 1000000 THEN RAISE EXCEPTION 'Invalid monthly subscription credit limit'; END IF;
    SELECT greatest(now(), COALESCE(max(expires_at), now()))
    INTO v_subscription_starts_at
    FROM public.credit_subscriptions
    WHERE user_id = v_payment.user_id;
    v_subscription_expires_at := v_subscription_starts_at + interval '30 days';

    INSERT INTO public.credit_subscriptions (
      user_id, bundle_type, credits_limit, credits_remaining, starts_at, expires_at
    ) VALUES (
      v_payment.user_id, 'monthly', 1000000, 1000000, v_subscription_starts_at, v_subscription_expires_at
    );
  ELSE
    UPDATE public.user_credit_accounts
    SET purchased_credits = purchased_credits + v_payment.credits,
        updated_at = now()
    WHERE user_id = v_payment.user_id
    RETURNING * INTO v_account;
  END IF;

  UPDATE public.wallet_payments
  SET status = 'paid',
      gateway_transaction_id = p_gateway_transaction_id,
      subscription_expires_at = v_subscription_expires_at,
      paid_at = now()
  WHERE reference = p_reference;

  INSERT INTO public.user_credit_transactions (
    user_id, transaction_type, amount, reason, reference_id, daily_balance_after, purchased_balance_after
  ) VALUES (
    v_payment.user_id,
    CASE WHEN v_payment.bundle_type = 'monthly' THEN 'subscription_grant' ELSE 'top_up' END,
    v_payment.credits,
    COALESCE(v_payment.bundle_type, 'bundle') || '_payment',
    p_reference,
    v_account.daily_remaining,
    v_account.purchased_credits
  );

  SELECT COALESCE(sum(credits_remaining), 0)
  INTO v_subscription_remaining
  FROM public.credit_subscriptions
  WHERE user_id = v_payment.user_id AND starts_at <= now() AND expires_at > now();

  RETURN QUERY SELECT true, v_account.daily_remaining, v_account.purchased_credits,
    v_account.daily_remaining::bigint + v_account.purchased_credits + v_subscription_remaining;
END;
$$;

CREATE OR REPLACE FUNCTION public.review_manual_wallet_payment(
  p_reference text,
  p_admin_user_id uuid,
  p_decision text,
  p_review_note text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_payment public.wallet_payments%ROWTYPE;
  v_account public.user_credit_accounts%ROWTYPE;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = p_admin_user_id AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Administrator access is required';
  END IF;
  IF p_decision NOT IN ('approve', 'reject') THEN
    RAISE EXCEPTION 'Decision must be approve or reject';
  END IF;

  SELECT * INTO v_payment
  FROM public.wallet_payments
  WHERE reference = p_reference AND gateway = 'manual'
  FOR UPDATE;
  IF NOT FOUND OR v_payment.status <> 'pending' THEN
    RAISE EXCEPTION 'Pending manual payment not found';
  END IF;

  IF p_decision = 'approve' THEN
    v_account := public.refresh_user_credit_account(v_payment.user_id);
    UPDATE public.user_credit_accounts
    SET purchased_credits = purchased_credits + v_payment.credits,
        updated_at = now()
    WHERE user_id = v_payment.user_id
    RETURNING * INTO v_account;

    UPDATE public.wallet_payments
    SET status = 'paid',
        gateway_transaction_id = 'manual:' || p_reference,
        reviewed_by = p_admin_user_id,
        reviewed_at = now(),
        review_note = left(p_review_note, 500),
        paid_at = now()
    WHERE reference = p_reference;

    INSERT INTO public.user_credit_transactions (
      user_id, transaction_type, amount, reason, reference_id, daily_balance_after, purchased_balance_after
    ) VALUES (
      v_payment.user_id, 'top_up', v_payment.credits, 'manual_bank_deposit', p_reference,
      v_account.daily_remaining, v_account.purchased_credits
    );
  ELSE
    UPDATE public.wallet_payments
    SET status = 'failed',
        reviewed_by = p_admin_user_id,
        reviewed_at = now(),
        review_note = left(p_review_note, 500)
    WHERE reference = p_reference;
  END IF;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.review_manual_wallet_payment(text, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.review_manual_wallet_payment(text, uuid, text, text) TO service_role;
