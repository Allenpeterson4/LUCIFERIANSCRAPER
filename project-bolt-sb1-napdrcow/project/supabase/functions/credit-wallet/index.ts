import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, X-Paystack-Signature",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const paygPricingTiers = [
  { credits: 1000, amount: 1000 },
  { credits: 5000, amount: 4000 },
  { credits: 10000, amount: 7000 },
  { credits: 25000, amount: 15000 },
  { credits: 50000, amount: 28000 },
  { credits: 100000, amount: 52000 },
  { credits: 250000, amount: 125000 },
];

function priceForCredits(credits: number): number {
  for (let index = 1; index < paygPricingTiers.length; index += 1) {
    const lower = paygPricingTiers[index - 1];
    const upper = paygPricingTiers[index];
    if (credits <= upper.credits) {
      const progress = (credits - lower.credits) / (upper.credits - lower.credits);
      return Math.ceil(lower.amount + progress * (upper.amount - lower.amount));
    }
  }
  const lower = paygPricingTiers[paygPricingTiers.length - 2];
  const upper = paygPricingTiers[paygPricingTiers.length - 1];
  const rate = (upper.amount - lower.amount) / (upper.credits - lower.credits);
  return Math.ceil(upper.amount + (credits - upper.credits) * rate);
}

function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function verifySignature(payload: string, signature: string, secret: string): Promise<boolean> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
  const expected = bytesToHex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
  if (expected.length !== signature.length) return false;
  let mismatch = 0;
  for (let index = 0; index < expected.length; index++) mismatch |= expected.charCodeAt(index) ^ signature.charCodeAt(index);
  return mismatch === 0;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);

  const secret = Deno.env.get("PAYSTACK_SECRET_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!secret || !supabaseUrl || !serviceKey) return jsonResponse({ error: "Wallet payments are not configured." }, 503);

  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    const rawBody = await req.text();
    const signature = req.headers.get("x-paystack-signature");
    if (signature) {
      if (!await verifySignature(rawBody, signature, secret)) return jsonResponse({ error: "Invalid webhook signature." }, 401);
      const event = JSON.parse(rawBody);
      if (event.event !== "charge.success" || typeof event.data?.reference !== "string") {
        return jsonResponse({ received: true });
      }

      const verification = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(event.data.reference)}`, {
        headers: { Authorization: `Bearer ${secret}` },
      });
      const verified = await verification.json();
      if (!verification.ok || !verified.status || verified.data?.status !== "success") {
        return jsonResponse({ error: "Could not verify Paystack payment." }, 502);
      }
      const { error } = await supabase.rpc("confirm_wallet_payment", {
        p_reference: verified.data.reference,
        p_gateway_transaction_id: String(verified.data.id),
        p_amount_minor: verified.data.amount,
        p_currency: verified.data.currency,
      });
      if (error) return jsonResponse({ error: "Could not apply wallet payment." }, 500);
      return jsonResponse({ received: true });
    }

    const authorization = req.headers.get("Authorization");
    if (!authorization) return jsonResponse({ error: "Sign in to fund your wallet." }, 401);
    const token = authorization.replace(/^Bearer\s+/i, "");
    const { data: userData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !userData.user) return jsonResponse({ error: "Your session has expired." }, 401);
    const user = userData.user;

    const body = JSON.parse(rawBody);
    if (body.action === "initialize") {
      const bundleType = body.bundleType === "monthly" ? "monthly" : "bundle";
      const currency = (Deno.env.get("PAYSTACK_CURRENCY") ?? "NGN").toUpperCase();
      const appUrl = Deno.env.get("APP_URL");
      const requestedCredits = Number(body.credits);
      let amountMajor: number;
      let credits: number;
      if (bundleType === "monthly") {
        if (Number(body.amount) !== 25000 || requestedCredits !== 1000000) {
          return jsonResponse({ error: "The monthly plan is a fixed 25,000 currency units for 1,000,000 credits." }, 400);
        }
        amountMajor = 25000;
        credits = 1000000;
      } else {
        if (!Number.isInteger(requestedCredits) || requestedCredits < 1000 || requestedCredits > 2000000) {
          return jsonResponse({ error: "Choose between 1,000 and 2,000,000 Pay As You Go credits." }, 400);
        }
        amountMajor = priceForCredits(requestedCredits);
        if (body.amount !== undefined && Number(body.amount) !== amountMajor) {
          return jsonResponse({ error: "The Pay As You Go price does not match the credit amount." }, 400);
        }
        credits = requestedCredits;
      }
      if (!Number.isFinite(amountMajor) || amountMajor < 50 || amountMajor > 10000000) {
        return jsonResponse({ error: "Enter a whole-number wallet amount between 50 and 10,000,000." }, 400);
      }
      if (!appUrl) {
        return jsonResponse({ error: "Set APP_URL before enabling wallet funding." }, 503);
      }

      const reference = `mh_${crypto.randomUUID()}`;
      const amountMinor = Math.round(amountMajor * 100);
      if (!Number.isSafeInteger(credits) || credits < 1 || credits > 2000000000) {
        return jsonResponse({ error: "The selected amount exceeds the configured wallet credit limit." }, 400);
      }
      const { error: insertError } = await supabase.from("wallet_payments").insert({
        reference,
        user_id: user.id,
        gateway: "paystack",
        bundle_type: bundleType,
        amount_minor: amountMinor,
        currency,
        credits,
        status: "pending",
      });
      if (insertError) return jsonResponse({ error: "Could not create wallet payment." }, 500);

      const callbackUrl = new URL("/", appUrl);
      callbackUrl.searchParams.set("wallet_reference", reference);
      const initResponse = await fetch("https://api.paystack.co/transaction/initialize", {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          email: user.email,
          amount: amountMinor,
          currency,
          reference,
          callback_url: callbackUrl.toString(),
          metadata: { user_id: user.id, credits, bundle_type: bundleType },
        }),
      });
      const initialized = await initResponse.json();
      if (!initResponse.ok || !initialized.status || !initialized.data?.authorization_url) {
        await supabase.from("wallet_payments").update({ status: "failed" }).eq("reference", reference).eq("user_id", user.id);
        return jsonResponse({ error: "Paystack could not initialize this payment." }, 502);
      }
      return jsonResponse({ authorization_url: initialized.data.authorization_url, reference, credits, amount: amountMajor, currency });
    }

    if (body.action === "verify") {
      const reference = typeof body.reference === "string" ? body.reference : "";
      if (!reference) return jsonResponse({ error: "A payment reference is required." }, 400);
      const { data: payment, error: paymentError } = await supabase.from("wallet_payments")
        .select("reference,status,user_id").eq("reference", reference).eq("user_id", user.id).maybeSingle();
      if (paymentError || !payment) return jsonResponse({ error: "Wallet payment not found." }, 404);
      if (payment.status === "paid") {
        const { data: balance } = await supabase.rpc("get_my_credit_balance");
        return jsonResponse({ success: true, already_applied: true, balance: Array.isArray(balance) ? balance[0] : balance });
      }

      const verification = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
        headers: { Authorization: `Bearer ${secret}` },
      });
      const verified = await verification.json();
      if (!verification.ok || !verified.status || verified.data?.status !== "success") {
        return jsonResponse({ error: "Payment is not confirmed yet. Please check again shortly." }, 409);
      }
      const { data: balance, error: applyError } = await supabase.rpc("confirm_wallet_payment", {
        p_reference: verified.data.reference,
        p_gateway_transaction_id: String(verified.data.id),
        p_amount_minor: verified.data.amount,
        p_currency: verified.data.currency,
      });
      if (applyError) return jsonResponse({ error: "Could not apply wallet payment." }, 500);
      return jsonResponse({ success: true, balance: Array.isArray(balance) ? balance[0] : balance });
    }

    return jsonResponse({ error: "Unknown wallet action." }, 400);
  } catch (error) {
    console.error("Wallet payment failed:", error);
    return jsonResponse({ error: "Wallet payment could not be completed." }, 500);
  }
});