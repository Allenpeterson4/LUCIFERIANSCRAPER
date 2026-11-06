import { useCallback, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Coins, Loader2, RefreshCw, Wallet, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";

interface CreditBalance {
  daily_allowance: number;
  daily_remaining: number;
  purchased_credits: number;
  total_remaining: number;
  resets_at: string;
}

interface WalletPayment {
  reference: string;
  amount_minor: number;
  currency: string;
  credits: number;
  status: "pending" | "paid" | "failed";
  gateway: "paystack" | "flutterwave" | "monnify" | "korapay" | "manual";
  created_at: string;
  paid_at: string | null;
}

interface CreditSubscription {
  credits_remaining: number;
  starts_at: string;
  expires_at: string;
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

const minPaygCredits = 1000;
const maxPaygCredits = 2000000;
const gateways = [
  { id: "paystack", label: "Paystack" },
  { id: "flutterwave", label: "Flutterwave" },
  { id: "monnify", label: "Monnify" },
  { id: "korapay", label: "KoraPay" },
] as const;

type Gateway = typeof gateways[number]["id"];
type Purchase = { credits: number; amount: number; bundleType: "bundle" | "monthly" };

interface FundingBankDetails {
  bank_name: string;
  account_number: string;
  account_name: string;
}

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

const monthlyPlan = { label: "Monthly unlimited", amount: 25000, credits: 1000000, days: 30 };

export function CreditWalletPage() {
  const { user } = useAuth();
  const [balance, setBalance] = useState<CreditBalance | null>(null);
  const [payments, setPayments] = useState<WalletPayment[]>([]);
  const [subscriptions, setSubscriptions] = useState<CreditSubscription[]>([]);
  const [paygCredits, setPaygCredits] = useState(String(minPaygCredits));
  const [bankDetails, setBankDetails] = useState<FundingBankDetails | null>(null);
  const [checkoutPurchase, setCheckoutPurchase] = useState<Purchase | null>(null);
  const [selectedGateway, setSelectedGateway] = useState<Gateway>("paystack");
  const [manualTransfer, setManualTransfer] = useState(false);
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [funding, setFunding] = useState(false);
  const [checkingPayment, setCheckingPayment] = useState(false);
  const [reference, setReference] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const currency = (import.meta.env.VITE_PAYSTACK_CURRENCY as string | undefined) ?? "NGN";
  const parsedCredits = paygCredits === "" ? Number.NaN : Number(paygCredits);
  const validPaygCredits = Number.isInteger(parsedCredits) && parsedCredits >= minPaygCredits && parsedCredits <= maxPaygCredits;
  const paygAmount = validPaygCredits ? priceForCredits(parsedCredits) : 0;

  const loadWallet = useCallback(async () => {
    setLoading(true);
    const [balanceResult, paymentsResult, subscriptionsResult, fundingSettingsResult] = await Promise.all([
      supabase.rpc("get_my_credit_balance"),
      supabase.from("wallet_payments").select("reference,amount_minor,currency,credits,status,gateway,created_at,paid_at")
        .order("created_at", { ascending: false }).limit(50),
      supabase.from("credit_subscriptions").select("credits_remaining,starts_at,expires_at")
        .gt("expires_at", new Date().toISOString()).order("starts_at", { ascending: true }),
      supabase.from("wallet_funding_settings").select("bank_name,account_number,account_name").eq("id", 1).maybeSingle(),
    ]);
    const balanceData = Array.isArray(balanceResult.data) ? balanceResult.data[0] : balanceResult.data;
    setBalance((balanceData as CreditBalance | null) ?? null);
    setPayments((paymentsResult.data as WalletPayment[]) ?? []);
    setSubscriptions((subscriptionsResult.data as CreditSubscription[]) ?? []);
    setBankDetails((fundingSettingsResult.data as FundingBankDetails | null) ?? null);
    setLoading(false);
  }, []);

  const verifyPayment = useCallback(async (paymentReference: string) => {
    if (!paymentReference) return;
    setCheckingPayment(true);
    setError("");
    const { data, error: invokeError } = await supabase.functions.invoke("credit-wallet", {
      body: { action: "verify", reference: paymentReference },
    });
    setCheckingPayment(false);
    if (invokeError || data?.error) {
      setError(data?.error ?? invokeError?.message ?? "Could not verify the payment yet.");
      return;
    }
    setNotice("Payment confirmed. Your credits are available now.");
    window.dispatchEvent(new Event("credits-updated"));
    await loadWallet();
  }, [loadWallet]);

  useEffect(() => {
    void loadWallet();
    const params = new URLSearchParams(window.location.search);
    const returnedReference = params.get("wallet_reference");
    if (returnedReference) {
      setReference(returnedReference);
      void verifyPayment(returnedReference);
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, [loadWallet, verifyPayment]);

  const startFunding = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!validPaygCredits) {
      setError("Enter a whole number between 1,000 and 2,000,000 credits.");
      return;
    }
    setCheckoutPurchase({ credits: parsedCredits, amount: paygAmount, bundleType: "bundle" });
    setSelectedGateway("paystack");
    setManualTransfer(false);
    setProofFile(null);
    setError("");
    setNotice("");
  };

  const startMonthlyPlan = () => {
    setCheckoutPurchase({ credits: monthlyPlan.credits, amount: monthlyPlan.amount, bundleType: "monthly" });
    setSelectedGateway("paystack");
    setManualTransfer(false);
    setProofFile(null);
    setError("");
    setNotice("");
  };

  const submitCheckout = async () => {
    if (!checkoutPurchase) return;
    setFunding(true);
    setNotice("");
    setError("");
    if (manualTransfer) {
      if (checkoutPurchase.bundleType !== "bundle") {
        setFunding(false);
        setError("Manual bank funding is available for Pay As You Go credits only.");
        return;
      }
      if (!user || !proofFile || !bankDetails) {
        setFunding(false);
        setError("Choose a proof file and make sure bank details are configured.");
        return;
      }
      if (!(["image/jpeg", "image/png", "application/pdf"].includes(proofFile.type)) || proofFile.size > 10 * 1024 * 1024) {
        setFunding(false);
        setError("Upload a JPG, PNG, or PDF proof no larger than 10 MB.");
        return;
      }
      const proofPath = `${user.id}/${crypto.randomUUID()}-${proofFile.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const { error: uploadError } = await supabase.storage.from("wallet-payment-proofs").upload(proofPath, proofFile, {
        contentType: proofFile.type,
        upsert: false,
      });
      if (uploadError) {
        setFunding(false);
        setError(uploadError.message);
        return;
      }
      const { data, error: invokeError } = await supabase.functions.invoke("credit-wallet", {
        body: { action: "manual_deposit", credits: checkoutPurchase.credits, proofPath },
      });
      if (invokeError || data?.error) {
        await supabase.storage.from("wallet-payment-proofs").remove([proofPath]);
        setFunding(false);
        setError(data?.error ?? invokeError?.message ?? "Could not submit bank transfer for review.");
        return;
      }
      setFunding(false);
      setCheckoutPurchase(null);
      setProofFile(null);
      setNotice("Bank transfer submitted. Credits will be added after an administrator approves the proof.");
      await loadWallet();
      return;
    }

    const { data, error: invokeError } = await supabase.functions.invoke("credit-wallet", {
      body: {
        action: "initialize",
        gateway: selectedGateway,
        amount: checkoutPurchase.amount,
        amountMinor: checkoutPurchase.amount * 100,
        bundleType: checkoutPurchase.bundleType,
        credits: checkoutPurchase.credits,
        subscriptionMonths: checkoutPurchase.bundleType === "monthly" ? 1 : undefined,
      },
    });
    setFunding(false);
    if (invokeError || data?.error) {
      setError(data?.error ?? invokeError?.message ?? "Could not start wallet funding.");
      return;
    }
    if (typeof data.authorization_url !== "string") {
      setError("The payment provider did not return a checkout link.");
      return;
    }
    window.location.assign(data.authorization_url);
  };

  const activeSubscription = subscriptions.find((subscription) => new Date(subscription.starts_at) <= new Date());
  const nextSubscription = subscriptions.find((subscription) => new Date(subscription.starts_at) > new Date());

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10 animate-fade-in">
      <header className="mb-8">
        <p className="text-xs uppercase tracking-wide text-neutral-500 mb-2">Account</p>
        <h1 className="text-3xl font-bold">Credit balance</h1>
        <p className="mt-2 text-neutral-600">Daily credits are used first. Purchased credits remain available after the daily reset.</p>
      </header>

      {error && <div role="alert" className="mb-5 flex gap-2 p-3 border border-red-300 bg-red-50 text-red-700 rounded-lg text-sm"><AlertCircle size={16} className="shrink-0 mt-0.5" />{error}</div>}
      {notice && <div role="status" className="mb-5 flex gap-2 p-3 border border-green-300 bg-green-50 text-green-800 rounded-lg text-sm"><CheckCircle2 size={16} className="shrink-0 mt-0.5" />{notice}</div>}

      {loading ? <div className="py-16 text-center text-neutral-500"><Loader2 className="animate-spin mx-auto mb-2" size={22} />Loading wallet</div> : <>
        <section className="grid gap-4 sm:grid-cols-3 mb-8">
          <div className="border border-neutral-200 bg-white rounded-lg p-5"><p className="text-sm text-neutral-500">Total Available Credits</p><p className="mt-2 text-3xl font-bold text-primary-700">{(balance?.total_remaining ?? 0).toLocaleString()}</p></div>
          <div className="border border-neutral-200 bg-white rounded-lg p-5"><p className="text-sm text-neutral-500">Daily Credits</p><p className="mt-2 text-3xl font-bold">{(balance?.daily_remaining ?? 0).toLocaleString()}<span className="ml-1 text-sm font-normal text-neutral-500">/ {(balance?.daily_allowance ?? 1000).toLocaleString()}</span></p><p className="mt-2 text-xs text-neutral-500">Resets {balance?.resets_at ? new Date(balance.resets_at).toLocaleString() : "daily at 00:00 UTC"}</p></div>
          <div className="border border-neutral-200 bg-white rounded-lg p-5"><p className="text-sm text-neutral-500">Purchased + Monthly Credits</p><p className="mt-2 text-3xl font-bold">{((balance?.purchased_credits ?? 0) + (activeSubscription?.credits_remaining ?? 0)).toLocaleString()}</p><p className="mt-2 text-xs text-neutral-500">{(balance?.purchased_credits ?? 0).toLocaleString()} purchased · {(activeSubscription?.credits_remaining ?? 0).toLocaleString()} monthly{activeSubscription ? ` · expires ${new Date(activeSubscription.expires_at).toLocaleDateString()}` : nextSubscription ? ` · plan starts ${new Date(nextSubscription.starts_at).toLocaleDateString()}` : ""}</p></div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] items-start">
          <div className="border border-neutral-200 bg-white rounded-lg p-5">
            <h2 className="font-semibold flex items-center gap-2"><Wallet size={17} />Pay As You Go</h2>
            <p className="mt-2 text-sm text-neutral-600">Choose a credit amount. Pricing updates automatically before checkout.</p>

            <div className="mt-5 space-y-3">
              <form onSubmit={startFunding} className="space-y-3">
                <label className="block text-sm font-medium">Credits to purchase
                  <input type="number" min={minPaygCredits} max={maxPaygCredits} step={1} value={paygCredits} onChange={(event) => setPaygCredits(event.target.value)} className="mt-1.5 w-full px-3 py-2.5 border border-neutral-200 rounded-lg text-sm" />
                </label>
                <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
                  <p className="text-xs uppercase tracking-wide text-neutral-500">Automatic price</p>
                  <p className="mt-1 text-lg font-semibold">{currency} {paygAmount.toLocaleString()}</p>
                  <p className="text-sm text-neutral-600">{validPaygCredits ? parsedCredits.toLocaleString() : "Enter 1,000–2,000,000 credits"} · tiered rates improve with larger amounts</p>
                </div>
                <button disabled={funding || !validPaygCredits} className="inline-flex items-center gap-2 px-4 py-2.5 bg-primary-600 text-white rounded-lg text-sm font-medium disabled:opacity-50">
                  {funding ? <Loader2 className="animate-spin" size={16} /> : <Coins size={16} />}
                  Proceed to Checkout
                </button>
              </form>
            </div>

            <div className="mt-5 border-t border-neutral-200 pt-4">
              <div className="rounded-lg border border-primary-200 bg-primary-50 p-3">
                <p className="text-xs uppercase tracking-wide text-primary-700">Monthly unlimited</p>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-lg font-semibold">{monthlyPlan.label}</p>
                    <p className="text-sm text-neutral-600">{monthlyPlan.credits.toLocaleString()} credits available during each 30-day plan period.</p>
                  </div>
                  <button type="button" onClick={startMonthlyPlan} disabled={funding} className="inline-flex items-center gap-2 px-3 py-2 border border-primary-300 bg-white rounded-lg text-sm font-medium text-primary-700 disabled:opacity-50">
                    {funding ? <Loader2 className="animate-spin" size={15} /> : <Coins size={15} />}
                    {currency} {monthlyPlan.amount.toLocaleString()}
                  </button>
                </div>
              </div>
            </div>

            {reference && <div className="mt-5 border-t border-neutral-200 pt-4"><p className="text-sm font-medium">Payment confirmation</p><p className="mt-1 text-xs text-neutral-500 break-all">{reference}</p><button onClick={() => void verifyPayment(reference)} disabled={checkingPayment} className="mt-3 inline-flex items-center gap-2 px-3 py-2 border border-neutral-200 rounded-lg text-sm disabled:opacity-50">{checkingPayment ? <Loader2 className="animate-spin" size={15} /> : <RefreshCw size={15} />}Check payment status</button></div>}
          </div>

          <section className="border border-neutral-200 bg-white rounded-lg overflow-hidden">
            <header className="p-5 border-b border-neutral-200"><h2 className="font-semibold">Wallet activity</h2></header>
            {payments.length === 0 ? <p className="p-6 text-sm text-neutral-500">No wallet payments yet.</p> : <div className="overflow-x-auto"><table className="w-full text-sm text-left">
              <thead className="bg-neutral-50 text-neutral-500"><tr><th className="p-3">Date</th><th className="p-3">Method</th><th className="p-3">Amount</th><th className="p-3">Credits</th><th className="p-3">Status</th></tr></thead>
              <tbody className="divide-y divide-neutral-100">{payments.map((payment) => <tr key={payment.reference}>
                <td className="p-3 whitespace-nowrap text-xs">{new Date(payment.created_at).toLocaleString()}</td>
                <td className="p-3 capitalize">{payment.gateway === "manual" ? "Bank transfer" : payment.gateway}</td>
                <td className="p-3 whitespace-nowrap">{payment.currency} {(payment.amount_minor / 100).toLocaleString()}</td>
                <td className="p-3">{payment.credits.toLocaleString()}</td>
                <td className={`p-3 text-xs font-medium ${payment.status === "paid" ? "text-green-700" : payment.status === "pending" ? "text-amber-700" : "text-red-700"}`}>{payment.status}</td>
              </tr>)}</tbody>
            </table></div>}
          </section>
        </section>
      </>}
      {checkoutPurchase && <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <button aria-label="Close checkout" className="absolute inset-0 bg-black/70" onClick={() => setCheckoutPurchase(null)} />
        <section role="dialog" aria-modal="true" aria-labelledby="wallet-checkout-title" className="relative max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-lg border border-neutral-200 bg-white shadow-2xl">
          <header className="flex items-center justify-between border-b border-neutral-200 p-5">
            <div><p className="text-xs uppercase tracking-wide text-neutral-500">Wallet funding</p><h2 id="wallet-checkout-title" className="mt-1 font-semibold">Choose payment method</h2></div>
            <button type="button" onClick={() => setCheckoutPurchase(null)} aria-label="Close" className="p-2"><X size={18} /></button>
          </header>
          <div className="space-y-5 p-5">
            <div className="flex items-center justify-between gap-3 rounded-lg border border-neutral-200 bg-neutral-50 p-4">
              <div><p className="text-sm font-medium">{checkoutPurchase.credits.toLocaleString()} credits</p><p className="mt-1 text-xs capitalize text-neutral-500">{checkoutPurchase.bundleType === "monthly" ? "30-day monthly plan" : "Pay As You Go"}</p></div>
              <p className="text-lg font-semibold">{currency} {checkoutPurchase.amount.toLocaleString()}</p>
            </div>

            <fieldset>
              <legend className="mb-2 text-sm font-medium">Online checkout</legend>
              <div className="grid grid-cols-2 gap-2">
                {gateways.map((gateway) => <button key={gateway.id} type="button" aria-pressed={!manualTransfer && selectedGateway === gateway.id}
                  onClick={() => { setSelectedGateway(gateway.id); setManualTransfer(false); setError(""); }}
                  className={`rounded-lg border px-3 py-3 text-left text-sm font-medium ${!manualTransfer && selectedGateway === gateway.id ? "border-primary-500 bg-primary-50 text-primary-800" : "border-neutral-200 hover:border-neutral-300"}`}>
                  {gateway.label}
                </button>)}
              </div>
            </fieldset>

            <fieldset>
              <legend className="mb-2 text-sm font-medium">Manual funding</legend>
              <button type="button" aria-pressed={manualTransfer} disabled={!bankDetails || checkoutPurchase.bundleType === "monthly"}
                onClick={() => { setManualTransfer(true); setError(""); }}
                className={`w-full rounded-lg border px-3 py-3 text-left text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${manualTransfer ? "border-primary-500 bg-primary-50 text-primary-800" : "border-neutral-200 hover:border-neutral-300"}`}>
                Bank transfer
                <span className="mt-1 block text-xs font-normal text-neutral-500">Credits are added after admin review.</span>
              </button>
              {!bankDetails && <p className="mt-2 text-xs text-neutral-500">Manual transfer is unavailable until an administrator configures bank details.</p>}
            </fieldset>

            {manualTransfer && bankDetails && <div className="space-y-3 rounded-lg border border-neutral-200 p-4">
              <h3 className="text-sm font-semibold">Transfer to</h3>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <dt className="text-neutral-500">Bank</dt><dd className="font-medium">{bankDetails.bank_name}</dd>
                <dt className="text-neutral-500">Account number</dt><dd className="font-mono font-medium">{bankDetails.account_number}</dd>
                <dt className="text-neutral-500">Account name</dt><dd className="font-medium">{bankDetails.account_name}</dd>
                <dt className="text-neutral-500">Amount</dt><dd className="font-medium">{currency} {checkoutPurchase.amount.toLocaleString()}</dd>
              </dl>
              <label className="block text-sm font-medium">Proof of payment
                <input type="file" accept="image/jpeg,image/png,application/pdf" onChange={(event) => setProofFile(event.target.files?.[0] ?? null)} className="mt-1.5 block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-neutral-100 file:px-3 file:py-2 file:text-sm file:font-medium" />
              </label>
              <p className="text-xs text-neutral-500">JPG, PNG, or PDF up to 10 MB. Keep your receipt for reference.</p>
            </div>}

            {error && <p role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
            <button type="button" onClick={() => void submitCheckout()} disabled={funding || (manualTransfer && (!proofFile || !bankDetails))}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
              {funding ? <Loader2 size={16} className="animate-spin" /> : <Coins size={16} />}
              {funding ? "Processing..." : manualTransfer ? "Submit transfer for review" : "Continue to secure checkout"}
            </button>
          </div>
        </section>
      </div>}
    </div>
  );
}