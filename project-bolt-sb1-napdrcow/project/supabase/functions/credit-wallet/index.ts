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

type PaymentGateway = "paystack" | "flutterwave" | "monnify" | "korapay";

const paymentGateways = new Set<PaymentGateway>(["paystack", "flutterwave", "monnify", "korapay"]);

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

function callbackUrl(appUrl: string, reference: string): string {
  const callback = new URL("/", appUrl);
  callback.searchParams.set("wallet_reference", reference);
  return callback.toString();
}

async function initializeGatewayPayment(
  gateway: PaymentGateway,
  reference: string,
  amountMinor: number,
  amountMajor: number,
  currency: string,
  email: string,
  name: string,
  appUrl: string,
  credits: number,
  bundleType: string,
): Promise<string> {
  const redirectUrl = callbackUrl(appUrl, reference);
  if (gateway === "paystack") {
    const secret = Deno.env.get("PAYSTACK_SECRET_KEY");
    if (!secret) throw new Error("Paystack is not configured.");
    const response = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        email, amount: amountMinor, currency, reference, callback_url: redirectUrl,
        metadata: { credits, bundle_type: bundleType },
      }),
    });
    const result = await response.json();
    if (!response.ok || !result.status || !result.data?.authorization_url) throw new Error("Paystack could not initialize this payment.");
    return result.data.authorization_url;
  }

  if (gateway === "flutterwave") {
    const secret = Deno.env.get("FLUTTERWAVE_SECRET_KEY");
    if (!secret) throw new Error("Flutterwave is not configured.");
    const response = await fetch("https://api.flutterwave.com/v3/payments", {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        tx_ref: reference, amount: amountMajor, currency, redirect_url: redirectUrl,
        customer: { email, name },
        meta: { credits, bundle_type: bundleType },
        customizations: { title: "MailHarvest credits", description: `${credits.toLocaleString()} wallet credits` },
      }),
    });
    const result = await response.json();
    if (!response.ok || result.status !== "success" || !result.data?.link) throw new Error("Flutterwave could not initialize this payment.");
    return result.data.link;
  }

  if (gateway === "monnify") {
    const apiKey = Deno.env.get("MONNIFY_API_KEY");
    const secret = Deno.env.get("MONNIFY_SECRET_KEY");
    const contractCode = Deno.env.get("MONNIFY_CONTRACT_CODE");
    if (!apiKey || !secret || !contractCode) throw new Error("Monnify is not configured.");
    const baseUrl = (Deno.env.get("MONNIFY_API_URL") ?? "https://api.monnify.com").replace(/\/$/, "");
    const authResponse = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST", headers: { Authorization: `Basic ${btoa(`${apiKey}:${secret}`)}` },
    });
    const authResult = await authResponse.json();
    const accessToken = authResult.responseBody?.accessToken;
    if (!authResponse.ok || !accessToken) throw new Error("Monnify authentication failed.");
    const response = await fetch(`${baseUrl}/api/v1/merchant/transactions/init-transaction`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: amountMajor,
        customerName: name || email,
        customerEmail: email,
        paymentReference: reference,
        paymentDescription: `${credits.toLocaleString()} MailHarvest wallet credits`,
        currencyCode: currency,
        contractCode,
        redirectUrl,
      }),
    });
    const result = await response.json();
    if (!response.ok || !result.requestSuccessful || !result.responseBody?.checkoutUrl) throw new Error("Monnify could not initialize this payment.");
    return result.responseBody.checkoutUrl;
  }

  const secret = Deno.env.get("KORAPAY_SECRET_KEY");
  if (!secret) throw new Error("KoraPay is not configured.");
  const response = await fetch("https://api.korapay.com/merchant/api/v1/charges/initialize", {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      reference,
      amount: amountMajor,
      currency,
      redirect_url: redirectUrl,
      customer: { name: name || email, email },
      metadata: { credits, bundle_type: bundleType },
    }),
  });
  const result = await response.json();
  if (!response.ok || !result.status || !result.data?.checkout_url) throw new Error("KoraPay could not initialize this payment.");
  return result.data.checkout_url;
}

async function verifyGatewayPayment(gateway: PaymentGateway, reference: string, expectedAmountMinor: number, expectedCurrency: string) {
  if (gateway === "paystack") {
    const secret = Deno.env.get("PAYSTACK_SECRET_KEY");
    if (!secret) throw new Error("Paystack is not configured.");
    const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${secret}` },
    });
    const result = await response.json();
    const payment = result.data;
    if (!response.ok || !result.status || payment?.status !== "success" || payment.reference !== reference) throw new Error("Payment is not confirmed yet. Please check again shortly.");
    return { id: String(payment.id), amount: Number(payment.amount), currency: String(payment.currency) };
  }

  if (gateway === "flutterwave") {
    const secret = Deno.env.get("FLUTTERWAVE_SECRET_KEY");
    if (!secret) throw new Error("Flutterwave is not configured.");
    const response = await fetch(`https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${secret}` },
    });
    const result = await response.json();
    const payment = result.data;
    if (!response.ok || result.status !== "success" || payment?.status !== "successful" || payment.tx_ref !== reference) throw new Error("Payment is not confirmed yet. Please check again shortly.");
    return { id: String(payment.id), amount: Math.round(Number(payment.amount) * 100), currency: String(payment.currency) };
  }

  if (gateway === "monnify") {
    const apiKey = Deno.env.get("MONNIFY_API_KEY");
    const secret = Deno.env.get("MONNIFY_SECRET_KEY");
    if (!apiKey || !secret) throw new Error("Monnify is not configured.");
    const baseUrl = (Deno.env.get("MONNIFY_API_URL") ?? "https://api.monnify.com").replace(/\/$/, "");
    const authResponse = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST", headers: { Authorization: `Basic ${btoa(`${apiKey}:${secret}`)}` },
    });
    const authResult = await authResponse.json();
    const accessToken = authResult.responseBody?.accessToken;
    if (!authResponse.ok || !accessToken) throw new Error("Monnify authentication failed.");
    const response = await fetch(`${baseUrl}/api/v1/merchant/transactions/query?paymentReference=${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const result = await response.json();
    const payment = result.responseBody;
    if (!response.ok || !result.requestSuccessful || payment?.paymentStatus !== "PAID" || payment.paymentReference !== reference) throw new Error("Payment is not confirmed yet. Please check again shortly.");
    return { id: String(payment.transactionReference), amount: Math.round(Number(payment.amountPaid) * 100), currency: String(payment.currencyCode) };
  }

  const secret = Deno.env.get("KORAPAY_SECRET_KEY");
  if (!secret) throw new Error("KoraPay is not configured.");
  const response = await fetch(`https://api.korapay.com/merchant/api/v1/charges/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  const result = await response.json();
  const payment = result.data;
  if (!response.ok || !result.status || payment?.status !== "success" || payment.reference !== reference) throw new Error("Payment is not confirmed yet. Please check again shortly.");
  return { id: String(payment.payment_reference ?? payment.reference), amount: Math.round(Number(payment.amount) * 100), currency: String(payment.currency) };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return jsonResponse({ error: "Wallet payments are not configured." }, 503);

  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    const rawBody = await req.text();
    const signature = req.headers.get("x-paystack-signature");
    if (signature) {
      const secret = Deno.env.get("PAYSTACK_SECRET_KEY");
      if (!secret) return jsonResponse({ error: "Paystack is not configured." }, 503);
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
    if (body.action === "manual_deposit") {
      const credits = Number(body.credits);
      const proofPath = typeof body.proofPath === "string" ? body.proofPath : "";
      if (!Number.isInteger(credits) || credits < 1000 || credits > 2000000) {
        return jsonResponse({ error: "Choose between 1,000 and 2,000,000 credits." }, 400);
      }
      if (!proofPath.startsWith(`${user.id}/`) || proofPath.includes("..")) {
        return jsonResponse({ error: "Upload a valid proof of payment first." }, 400);
      }
      const { data: fundingSettings } = await supabase.from("wallet_funding_settings")
        .select("bank_name,account_number,account_name").eq("id", 1).maybeSingle();
      if (!fundingSettings?.bank_name || !fundingSettings.account_number || !fundingSettings.account_name) {
        return jsonResponse({ error: "Manual bank funding is not configured yet." }, 503);
      }
      const { data: proof, error: proofError } = await supabase.storage.from("wallet-payment-proofs").createSignedUrl(proofPath, 60);
      if (proofError || !proof?.signedUrl) return jsonResponse({ error: "The uploaded proof could not be found." }, 400);

      const amountMajor = priceForCredits(credits);
      const reference = `mh_manual_${crypto.randomUUID()}`;
      const { error: insertError } = await supabase.from("wallet_payments").insert({
        reference,
        user_id: user.id,
        gateway: "manual",
        bundle_type: "bundle",
        amount_minor: Math.round(amountMajor * 100),
        currency: "NGN",
        credits,
        status: "pending",
        proof_path: proofPath,
      });
      if (insertError) return jsonResponse({ error: "Could not submit the bank transfer for review." }, 500);
      return jsonResponse({ success: true, reference, status: "pending", message: "Proof submitted for administrator review." });
    }

    if (body.action === "initialize") {
      const bundleType = body.bundleType === "monthly" ? "monthly" : "bundle";
      const gateway = typeof body.gateway === "string" && paymentGateways.has(body.gateway as PaymentGateway)
        ? body.gateway as PaymentGateway
        : "paystack";
      const currency = (gateway === "paystack" ? Deno.env.get("PAYSTACK_CURRENCY") : null) ?? "NGN";
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
        gateway,
        bundle_type: bundleType,
        amount_minor: amountMinor,
        currency,
        credits,
        status: "pending",
      });
      if (insertError) return jsonResponse({ error: "Could not create wallet payment." }, 500);

      let checkoutUrl: string;
      try {
        checkoutUrl = await initializeGatewayPayment(
          gateway,
          reference,
          amountMinor,
          amountMajor,
          currency,
          user.email ?? "",
          String(user.user_metadata?.full_name ?? user.user_metadata?.username ?? ""),
          appUrl,
          credits,
          bundleType,
        );
      } catch (gatewayError) {
        await supabase.from("wallet_payments").update({ status: "failed" }).eq("reference", reference).eq("user_id", user.id);
        return jsonResponse({ error: gatewayError instanceof Error ? gatewayError.message : "Could not initialize payment." }, 502);
      }
      return jsonResponse({ authorization_url: checkoutUrl, reference, credits, amount: amountMajor, currency, gateway });
    }

    if (body.action === "verify") {
      const reference = typeof body.reference === "string" ? body.reference : "";
      if (!reference) return jsonResponse({ error: "A payment reference is required." }, 400);
      const { data: payment, error: paymentError } = await supabase.from("wallet_payments")
        .select("reference,status,user_id,gateway,amount_minor,currency").eq("reference", reference).eq("user_id", user.id).maybeSingle();
      if (paymentError || !payment) return jsonResponse({ error: "Wallet payment not found." }, 404);
      if (payment.gateway === "manual") return jsonResponse({ error: "Manual bank deposits are credited after administrator review." }, 409);
      if (payment.status === "paid") {
        const { data: balance } = await supabase.rpc("get_my_credit_balance");
        return jsonResponse({ success: true, already_applied: true, balance: Array.isArray(balance) ? balance[0] : balance });
      }

      const gateway = payment.gateway as PaymentGateway;
      let verified: { id: string; amount: number; currency: string };
      try {
        verified = await verifyGatewayPayment(gateway, reference, Number(payment.amount_minor), payment.currency);
      } catch (verificationError) {
        return jsonResponse({ error: verificationError instanceof Error ? verificationError.message : "Payment is not confirmed yet." }, 409);
      }
      if (verified.amount !== Number(payment.amount_minor) || verified.currency.toUpperCase() !== payment.currency.toUpperCase()) {
        return jsonResponse({ error: "Verified payment amount or currency does not match." }, 409);
      }
      const { data: balance, error: applyError } = await supabase.rpc("confirm_wallet_payment", {
        p_reference: reference,
        p_gateway_transaction_id: verified.id,
        p_amount_minor: verified.amount,
        p_currency: verified.currency,
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