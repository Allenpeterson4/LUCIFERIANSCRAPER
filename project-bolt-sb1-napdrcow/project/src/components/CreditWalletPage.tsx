import { useCallback, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Coins, Loader2, RefreshCw, Wallet } from "lucide-react";
import { supabase } from "@/lib/supabase";

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
  created_at: string;
  paid_at: string | null;
}

const bundleOptions = [
  { label: "1,000 credits", amount: 1000, credits: 1000 },
  { label: "5,000 credits", amount: 4000, credits: 5000 },
  { label: "10,000 credits", amount: 7000, credits: 10000 },
  { label: "25,000 credits", amount: 15000, credits: 25000 },
  { label: "50,000 credits", amount: 28000, credits: 50000 },
  { label: "100,000 credits", amount: 52000, credits: 100000 },
];

const monthlyPlan = { label: "Monthly unlimited", amount: 25000, credits: 1000000, days: 30 };

export function CreditWalletPage() {
  const [balance, setBalance] = useState<CreditBalance | null>(null);
  const [payments, setPayments] = useState<WalletPayment[]>([]);
  const [selectedBundle, setSelectedBundle] = useState<typeof bundleOptions[number]>(bundleOptions[0]);
  const [loading, setLoading] = useState(true);
  const [funding, setFunding] = useState(false);
  const [checkingPayment, setCheckingPayment] = useState(false);
  const [reference, setReference] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const currency = (import.meta.env.VITE_PAYSTACK_CURRENCY as string | undefined) ?? "NGN";

  const loadWallet = useCallback(async () => {
    setLoading(true);
    const [balanceResult, paymentsResult] = await Promise.all([
      supabase.rpc("get_my_credit_balance"),
      supabase.from("wallet_payments").select("reference,amount_minor,currency,credits,status,created_at,paid_at")
        .order("created_at", { ascending: false }).limit(50),
    ]);
    const balanceData = Array.isArray(balanceResult.data) ? balanceResult.data[0] : balanceResult.data;
    setBalance((balanceData as CreditBalance | null) ?? null);
    setPayments((paymentsResult.data as WalletPayment[]) ?? []);
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
    setFunding(true);
    setNotice("");
    setError("");
    const { data, error: invokeError } = await supabase.functions.invoke("credit-wallet", {
      body: {
        action: "initialize",
        amount: selectedBundle.amount,
        amountMinor: selectedBundle.amount * 100,
        bundleType: "bundle",
        credits: selectedBundle.credits,
      },
    });
    setFunding(false);
    if (invokeError || data?.error) {
      setError(data?.error ?? invokeError?.message ?? "Could not start wallet funding.");
      return;
    }
    window.location.assign(data.authorization_url as string);
  };

  const startMonthlyPlan = async () => {
    setFunding(true);
    setNotice("");
    setError("");
    const { data, error: invokeError } = await supabase.functions.invoke("credit-wallet", {
      body: {
        action: "initialize",
        amount: monthlyPlan.amount,
        amountMinor: monthlyPlan.amount * 100,
        bundleType: "monthly",
        credits: monthlyPlan.credits,
        subscriptionMonths: 1,
      },
    });
    setFunding(false);
    if (invokeError || data?.error) {
      setError(data?.error ?? invokeError?.message ?? "Could not start monthly plan.");
      return;
    }
    window.location.assign(data.authorization_url as string);
  };

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
          <div className="border border-neutral-200 bg-white rounded-lg p-5"><p className="text-sm text-neutral-500">Total available</p><p className="mt-2 text-3xl font-bold text-primary-700">{(balance?.total_remaining ?? 0).toLocaleString()}</p></div>
          <div className="border border-neutral-200 bg-white rounded-lg p-5"><p className="text-sm text-neutral-500">Daily credits remaining</p><p className="mt-2 text-3xl font-bold">{(balance?.daily_remaining ?? 0).toLocaleString()}<span className="ml-1 text-sm font-normal text-neutral-500">/ {(balance?.daily_allowance ?? 1000).toLocaleString()}</span></p><p className="mt-2 text-xs text-neutral-500">Resets {balance?.resets_at ? new Date(balance.resets_at).toLocaleString() : "daily at 00:00 UTC"}</p></div>
          <div className="border border-neutral-200 bg-white rounded-lg p-5"><p className="text-sm text-neutral-500">Purchased credits</p><p className="mt-2 text-3xl font-bold">{(balance?.purchased_credits ?? 0).toLocaleString()}</p></div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] items-start">
          <div className="border border-neutral-200 bg-white rounded-lg p-5">
            <h2 className="font-semibold flex items-center gap-2"><Wallet size={17} />Fund wallet</h2>
            <p className="mt-2 text-sm text-neutral-600">Secure checkout through Paystack. Credits are added after payment verification.</p>

            <div className="mt-5 space-y-3">
              <div className="grid gap-2 sm:grid-cols-2">
                {bundleOptions.map((bundle) => <button key={bundle.label} type="button" onClick={() => setSelectedBundle(bundle)} className={`rounded-lg border p-3 text-left ${selectedBundle.label === bundle.label ? "border-primary-300 bg-primary-50" : "border-neutral-200 bg-white"}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">{bundle.label}</span>
                    <span className="text-xs text-neutral-500">{currency} {bundle.amount.toLocaleString()}</span>
                  </div>
                </button>)}
              </div>
              <form onSubmit={startFunding} className="space-y-3">
                <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
                  <p className="text-xs uppercase tracking-wide text-neutral-500">Selected bundle</p>
                  <p className="mt-1 text-lg font-semibold">{selectedBundle.label}</p>
                  <p className="text-sm text-neutral-600">{currency} {selectedBundle.amount.toLocaleString()} · {selectedBundle.credits.toLocaleString()} credits</p>
                </div>
                <button disabled={funding} className="inline-flex items-center gap-2 px-4 py-2.5 bg-primary-600 text-white rounded-lg text-sm font-medium disabled:opacity-50">
                  {funding ? <Loader2 className="animate-spin" size={16} /> : <Coins size={16} />}
                  Buy bundle via Paystack
                </button>
              </form>
            </div>

            <div className="mt-5 border-t border-neutral-200 pt-4">
              <div className="rounded-lg border border-primary-200 bg-primary-50 p-3">
                <p className="text-xs uppercase tracking-wide text-primary-700">Monthly unlimited</p>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-lg font-semibold">{monthlyPlan.label}</p>
                    <p className="text-sm text-neutral-600">Up to {monthlyPlan.credits.toLocaleString()} credits included until the plan expires.</p>
                  </div>
                  <button type="button" onClick={() => void startMonthlyPlan()} className="inline-flex items-center gap-2 px-3 py-2 border border-primary-300 bg-white rounded-lg text-sm font-medium text-primary-700 disabled:opacity-50">
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
              <thead className="bg-neutral-50 text-neutral-500"><tr><th className="p-3">Date</th><th className="p-3">Amount</th><th className="p-3">Credits</th><th className="p-3">Status</th></tr></thead>
              <tbody className="divide-y divide-neutral-100">{payments.map((payment) => <tr key={payment.reference}>
                <td className="p-3 whitespace-nowrap text-xs">{new Date(payment.created_at).toLocaleString()}</td>
                <td className="p-3 whitespace-nowrap">{payment.currency} {(payment.amount_minor / 100).toLocaleString()}</td>
                <td className="p-3">{payment.credits.toLocaleString()}</td>
                <td className={`p-3 text-xs font-medium ${payment.status === "paid" ? "text-green-700" : payment.status === "pending" ? "text-amber-700" : "text-red-700"}`}>{payment.status}</td>
              </tr>)}</tbody>
            </table></div>}
          </section>
        </section>
      </>}
    </div>
  );
}