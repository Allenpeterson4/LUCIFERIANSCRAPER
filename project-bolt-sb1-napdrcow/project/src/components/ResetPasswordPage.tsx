import { useState } from "react";
import { AlertCircle, CheckCircle2, KeyRound, Loader2, Mail } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import type { View } from "@/components/Header";

export function ResetPasswordPage({ onNavigate }: { onNavigate: (view: View) => void }) {
  const { user } = useAuth();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [updated, setUpdated] = useState(false);

  const updatePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("Use a password with at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("The passwords do not match.");
      return;
    }

    setSaving(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setPassword("");
    setConfirmPassword("");
    setUpdated(true);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-50 px-4 py-12">
      <section className="w-full max-w-md rounded-2xl border border-neutral-200 bg-white p-8 shadow-xl">
        <div className="mb-6 flex items-center gap-2"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-600"><Mail className="text-white" size={20} /></div><span className="text-lg font-bold">MailHarvest</span></div>
        {updated ? <>
          <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-lg bg-green-50 text-green-700"><CheckCircle2 size={22} /></div>
          <h1 className="text-2xl font-bold">Password updated</h1>
          <p role="status" className="mt-2 text-sm text-neutral-600">Your password has been changed. Continue to your account.</p>
          <button onClick={() => onNavigate("scrape")} className="mt-6 w-full rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-primary-700">Continue</button>
        </> : !user ? <>
          <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-lg bg-amber-50 text-amber-700"><AlertCircle size={22} /></div>
          <h1 className="text-2xl font-bold">Reset link unavailable</h1>
          <p role="alert" className="mt-2 text-sm text-neutral-600">This link may have expired or already been used. Request a new reset link to continue.</p>
          <button onClick={() => onNavigate("login")} className="mt-6 w-full rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-primary-700">Return to sign in</button>
        </> : <>
          <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-lg bg-primary-50 text-primary-700"><KeyRound size={22} /></div>
          <h1 className="text-2xl font-bold">Set a new password</h1>
          <p className="mt-2 text-sm text-neutral-600">Choose a new password for {user.email}.</p>
          <form onSubmit={updatePassword} className="mt-6 space-y-4">
            <label className="block text-sm font-medium">New password<input type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1.5 w-full rounded-lg border border-neutral-200 px-3 py-2.5 text-sm" /></label>
            <label className="block text-sm font-medium">Confirm new password<input type="password" required minLength={8} autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className="mt-1.5 w-full rounded-lg border border-neutral-200 px-3 py-2.5 text-sm" /></label>
            {error && <p role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"><AlertCircle size={16} className="mt-0.5 shrink-0" />{error}</p>}
            <button type="submit" disabled={saving} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">{saving ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={16} />}Update password</button>
          </form>
        </>}
      </section>
    </div>
  );
}