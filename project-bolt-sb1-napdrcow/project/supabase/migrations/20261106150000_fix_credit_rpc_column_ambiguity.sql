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
  v_subscription record;
  v_subscription_remaining bigint;
  v_subscription_debit bigint := 0;
  v_from_daily integer;
  v_from_purchased bigint;
  v_to_consume integer;
  v_take integer;
BEGIN
  IF p_amount IS NULL OR p_amount < 1 OR p_amount > 100000 THEN
    RAISE EXCEPTION 'Credit amount must be between 1 and 100000';
  END IF;

  v_account := public.refresh_user_credit_account(p_user_id);
  SELECT COALESCE(sum(credits_remaining), 0)
  INTO v_subscription_remaining
  FROM public.credit_subscriptions
  WHERE user_id = p_user_id AND starts_at <= now() AND expires_at > now();

  IF v_account.daily_remaining::bigint + v_subscription_remaining + v_account.purchased_credits < p_amount THEN
    RETURN QUERY SELECT false, v_account.daily_remaining, v_account.purchased_credits,
      v_account.daily_remaining::bigint + v_subscription_remaining + v_account.purchased_credits;
    RETURN;
  END IF;

  v_from_daily := least(v_account.daily_remaining, p_amount);
  v_to_consume := p_amount - v_from_daily;

  FOR v_subscription IN
    SELECT id, credits_remaining
    FROM public.credit_subscriptions
    WHERE user_id = p_user_id AND starts_at <= now() AND expires_at > now() AND credits_remaining > 0
    ORDER BY expires_at, id
    FOR UPDATE
  LOOP
    EXIT WHEN v_to_consume = 0;
    v_take := least(v_subscription.credits_remaining, v_to_consume);
    UPDATE public.credit_subscriptions AS subscription
    SET credits_remaining = subscription.credits_remaining - v_take,
        updated_at = now()
    WHERE subscription.id = v_subscription.id;
    v_to_consume := v_to_consume - v_take;
    v_subscription_debit := v_subscription_debit + v_take;
  END LOOP;

  v_from_purchased := v_to_consume;
  UPDATE public.user_credit_accounts AS account
  SET daily_remaining = account.daily_remaining - v_from_daily,
      purchased_credits = account.purchased_credits - v_from_purchased,
      updated_at = now()
  WHERE account.user_id = p_user_id
  RETURNING account.* INTO v_account;

  SELECT COALESCE(sum(credits_remaining), 0)
  INTO v_subscription_remaining
  FROM public.credit_subscriptions
  WHERE user_id = p_user_id AND starts_at <= now() AND expires_at > now();

  INSERT INTO public.user_credit_transactions (
    user_id, transaction_type, amount, reason, reference_id, daily_balance_after, purchased_balance_after
  ) VALUES (p_user_id, 'consume', -p_amount, left(p_reason, 120), p_reference_id, v_account.daily_remaining, v_account.purchased_credits);

  RETURN QUERY SELECT true, v_account.daily_remaining, v_account.purchased_credits,
    v_account.daily_remaining::bigint + v_subscription_remaining + v_account.purchased_credits;
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
  UPDATE public.user_credit_accounts AS account
  SET purchased_credits = account.purchased_credits + p_amount,
      updated_at = now()
  WHERE account.user_id = p_user_id
  RETURNING account.* INTO v_account;

  INSERT INTO public.user_credit_transactions (
    user_id, transaction_type, amount, reason, reference_id, daily_balance_after, purchased_balance_after
  ) VALUES (p_user_id, 'top_up', p_amount, left(p_reason, 120), NULL, v_account.daily_remaining, v_account.purchased_credits);

  RETURN QUERY SELECT v_account.daily_remaining, v_account.purchased_credits,
    v_account.daily_remaining::bigint + v_account.purchased_credits;
END;
$$;

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
    UPDATE public.user_credit_accounts AS account
    SET purchased_credits = account.purchased_credits + v_payment.credits,
        updated_at = now()
    WHERE account.user_id = v_payment.user_id
    RETURNING account.* INTO v_account;
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
