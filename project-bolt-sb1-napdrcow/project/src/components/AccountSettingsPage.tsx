import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, KeyRound, Loader2, Save, UserRound } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export function AccountSettingsPage() {
  const { user } = useAuth();
  const [email, setEmail] = useState(user?.email ?? "");
  const [username, setUsername] = useState(String(user?.user_metadata?.username ?? ""));
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [profileNotice, setProfileNotice] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [passwordNotice, setPasswordNotice] = useState("");

  useEffect(() => {
    setEmail(user?.email ?? "");
    setUsername(String(user?.user_metadata?.username ?? ""));
  }, [user]);

  const updateProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user) return;
    const normalizedEmail = email.trim();
    const normalizedUsername = username.trim();
    if (!/^[A-Za-z0-9._-]{3,32}$/.test(normalizedUsername)) {
      setProfileError("Username must be 3-32 letters, numbers, periods, underscores, or hyphens.");
      return;
    }
    if (!normalizedEmail) {
      setProfileError("Enter a valid email address.");
      return;
    }

    setProfileSaving(true);
    setProfileError("");
    setProfileNotice("");
    const { error: updateError } = await supabase.auth.updateUser({
      ...(normalizedEmail !== user.email ? { email: normalizedEmail } : {}),
      data: { ...user.user_metadata, username: normalizedUsername },
    });
    setProfileSaving(false);
    if (updateError) {
      setProfileError(updateError.message);
      return;
    }
    setProfileNotice(normalizedEmail !== user.email
      ? "Username saved. Confirm the email change using the link sent to your new address."
      : "Account settings saved.");
  };

  const updatePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user?.email) return;
    setPasswordError("");
    setPasswordNotice("");
    if (newPassword.length < 8) {
      setPasswordError("Use a password with at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("The new passwords do not match.");
      return;
    }

    setPasswordSaving(true);
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: currentPassword,
    });
    if (authError) {
      setPasswordSaving(false);
      setPasswordError("Current password is incorrect.");
      return;
    }

    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
    setPasswordSaving(false);
    if (updateError) {
      setPasswordError(updateError.message);
      return;
    }
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setPasswordNotice("Password updated successfully.");
  };

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-10 animate-fade-in">
      <header className="mb-8">
        <p className="text-xs uppercase tracking-wider text-neutral-500 mb-2">Account</p>
        <h1 className="text-3xl font-bold mb-2">Settings</h1>
        <p className="text-neutral-600">Manage your profile and sign-in credentials.</p>
      </header>

      <section className="mb-6 border border-neutral-200 bg-white rounded-lg">
        <header className="flex items-center gap-3 border-b border-neutral-200 p-5">
          <UserRound size={18} className="text-primary-700" />
          <div><h2 className="font-semibold">Profile</h2><p className="text-xs text-neutral-500">Update the name and email associated with your account.</p></div>
        </header>
        <form onSubmit={updateProfile} className="space-y-4 p-5">
          {profileError && <p role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"><AlertCircle size={16} className="mt-0.5 shrink-0" />{profileError}</p>}
          {profileNotice && <p role="status" className="flex items-start gap-2 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800"><CheckCircle2 size={16} className="mt-0.5 shrink-0" />{profileNotice}</p>}
          <label className="block text-sm font-medium">Email<input type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1.5 w-full rounded-lg border border-neutral-200 px-3 py-2.5 text-sm" /></label>
          <label className="block text-sm font-medium">Username<input type="text" required minLength={3} maxLength={32} pattern="[A-Za-z0-9._-]+" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} className="mt-1.5 w-full rounded-lg border border-neutral-200 px-3 py-2.5 text-sm" /><span className="mt-1 block text-xs font-normal text-neutral-500">3-32 letters, numbers, periods, underscores, or hyphens.</span></label>
          <button type="submit" disabled={profileSaving} className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">{profileSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}Save profile</button>
        </form>
      </section>

      <section className="border border-neutral-200 bg-white rounded-lg">
        <header className="flex items-center gap-3 border-b border-neutral-200 p-5">
          <KeyRound size={18} className="text-primary-700" />
          <div><h2 className="font-semibold">Change password</h2><p className="text-xs text-neutral-500">Verify your current password before choosing a new one.</p></div>
        </header>
        <form onSubmit={updatePassword} className="space-y-4 p-5">
          {passwordError && <p role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"><AlertCircle size={16} className="mt-0.5 shrink-0" />{passwordError}</p>}
          {passwordNotice && <p role="status" className="flex items-start gap-2 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800"><CheckCircle2 size={16} className="mt-0.5 shrink-0" />{passwordNotice}</p>}
          <label className="block text-sm font-medium">Current password<input type="password" required autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} className="mt-1.5 w-full rounded-lg border border-neutral-200 px-3 py-2.5 text-sm" /></label>
          <label className="block text-sm font-medium">New password<input type="password" required minLength={8} autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} className="mt-1.5 w-full rounded-lg border border-neutral-200 px-3 py-2.5 text-sm" /></label>
          <label className="block text-sm font-medium">Confirm new password<input type="password" required minLength={8} autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className="mt-1.5 w-full rounded-lg border border-neutral-200 px-3 py-2.5 text-sm" /></label>
          <button type="submit" disabled={passwordSaving} className="inline-flex items-center gap-2 rounded-lg border border-neutral-200 px-4 py-2.5 text-sm font-medium text-neutral-700 disabled:opacity-50">{passwordSaving ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={16} />}Update password</button>
        </form>
      </section>
    </div>
  );
}