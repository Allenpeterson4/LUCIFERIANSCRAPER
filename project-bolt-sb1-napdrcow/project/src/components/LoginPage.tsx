import { useState } from "react";
import { Mail, Eye, EyeOff, Loader2, ArrowLeft, KeyRound } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import type { View } from "@/components/Header";

export function LoginPage({ onNavigate, adminLogin = false }: { onNavigate: (v: View) => void; adminLogin?: boolean }) {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [forgotPassword, setForgotPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice("");
    setLoading(true);
    const { error: err } = await signIn(email, password);
    setLoading(false);
    if (err) {
      setError(err);
    }
  };

  const handlePasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice("");
    setLoading(true);
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);
    if (resetError) setError(resetError.message);
    else setNotice("If an account exists for this email, a password reset link has been sent.");
  };

  return (
    <div className="min-h-screen bg-neutral-50 flex flex-col">
      <div className="px-4 sm:px-6 pt-6">
        <button
          onClick={() => onNavigate("home")}
          className="flex items-center gap-2 text-sm font-medium text-neutral-500 hover:text-neutral-800 transition-colors"
        >
          <ArrowLeft size={16} />
          Back to home
        </button>
      </div>

      <div className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md animate-fade-up">
          <div className="bg-white rounded-2xl shadow-xl border border-neutral-200 p-8">
            <div className="flex items-center gap-2 mb-6">
              <div className="w-10 h-10 rounded-xl bg-primary-600 flex items-center justify-center">
                <Mail className="text-white" size={20} />
              </div>
              <span className="font-bold text-lg">MailHarvest</span>
            </div>
            <h1 className="text-2xl font-bold mb-1">{forgotPassword ? "Reset your password" : adminLogin ? "Administrator sign in" : "Welcome back"}</h1>
            <p className="text-neutral-500 text-sm mb-6">
              {forgotPassword ? "Enter your account email and we will send a secure reset link." : adminLogin ? "Sign in with an administrator account to continue." : "Sign in to access your scraping dashboard and history."}
            </p>
            <form onSubmit={forgotPassword ? handlePasswordReset : handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-1.5">Email</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-lg border border-neutral-200 focus:border-primary-500 focus:ring-2 focus:ring-primary-100 outline-none transition-all"
                  placeholder="you@example.com"
                />
              </div>
              {!forgotPassword && <div>
                <label className="block text-sm font-medium text-neutral-700 mb-1.5">Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-4 py-2.5 pr-11 rounded-lg border border-neutral-200 focus:border-primary-500 focus:ring-2 focus:ring-primary-100 outline-none transition-all"
                    placeholder="Enter your password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-700 transition-colors"
                    aria-label="Toggle password visibility"
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>}
              {error && (
                <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 animate-slide-in">
                  {error}
                </div>
              )}
              {notice && <p role="status" className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">{notice}</p>}
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-primary-600 hover:bg-primary-700 disabled:opacity-60 text-white font-medium py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                {loading && <Loader2 size={18} className="animate-spin" />}
                {forgotPassword ? "Send reset link" : "Sign in"}
              </button>
            </form>
            {!adminLogin && <div className="mt-4 text-center">
              {forgotPassword ? <button type="button" onClick={() => { setForgotPassword(false); setError(null); setNotice(""); }} className="text-sm font-medium text-primary-600 hover:underline">Back to sign in</button>
                : <button type="button" onClick={() => { setForgotPassword(true); setError(null); setNotice(""); }} className="inline-flex items-center gap-1.5 text-sm font-medium text-primary-600 hover:underline"><KeyRound size={14} />Forgot password?</button>}
            </div>}
            {!adminLogin && !forgotPassword && (
              <p className="text-center text-sm text-neutral-500 mt-5">
                Don't have an account?{" "}
                <button
                  onClick={() => onNavigate("signup")}
                  className="text-primary-600 font-medium hover:underline"
                >
                  Create one
                </button>
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
