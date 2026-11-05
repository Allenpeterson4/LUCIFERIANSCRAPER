import { useEffect, useState } from "react";
import { AlertCircle, Activity, Check, CheckCircle2, Clock, Edit2, Loader2, Plus, RefreshCw, Server, Trash2, Zap } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { testSmtpConnection } from "@/lib/smtp";

interface SmtpSettings {
  id: string;
  host: string;
  port: number;
  username: string;
  encryption: string;
  from_email: string;
  from_name: string | null;
  is_active: boolean;
}

interface SmtpRateState {
  messages_per_minute: number;
  attempts_this_minute: number;
  minute_started_at: string;
  paused_until: string | null;
  last_provider_response: string | null;
}

interface SmtpAttempt {
  id: number;
  recipient: string;
  outcome: "sent" | "failed" | "throttled";
  provider_response: string | null;
  created_at: string;
}

export function SmtpSettingsPage() {
  const { session, user } = useAuth();
  const [configs, setConfigs] = useState<SmtpSettings[]>([]);
  const [config, setConfig] = useState<SmtpSettings | null>(null);
  const [configureOpen, setConfigureOpen] = useState(false);
  const [host, setHost] = useState("");
  const [port, setPort] = useState(587);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [encryption, setEncryption] = useState("tls");
  const [fromEmail, setFromEmail] = useState("");
  const [fromName, setFromName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [rateState, setRateState] = useState<SmtpRateState | null>(null);
  const [recentAttempts, setRecentAttempts] = useState<SmtpAttempt[]>([]);
  const [statusLoading, setStatusLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ success: boolean; message: string } | null>(null);

  const loadAdaptiveStatus = async (smtpConfigId: string) => {
    setStatusLoading(true);
    const [stateResult, attemptsResult] = await Promise.all([
      supabase.from("smtp_provider_rate_state")
        .select("messages_per_minute,attempts_this_minute,minute_started_at,paused_until,last_provider_response")
        .eq("smtp_config_id", smtpConfigId).maybeSingle(),
      supabase.from("smtp_dispatch_attempts")
        .select("id,recipient,outcome,provider_response,created_at")
        .eq("smtp_config_id", smtpConfigId).order("created_at", { ascending: false }).limit(8),
    ]);
    setRateState(stateResult.data as SmtpRateState | null);
    setRecentAttempts((attemptsResult.data as SmtpAttempt[]) ?? []);
    setStatusLoading(false);
  };

  const applyConfig = (saved: SmtpSettings | null) => {
    if (!saved) {
      setHost("");
      setPort(587);
      setUsername("");
      setPassword("");
      setEncryption("tls");
      setFromEmail("");
      setFromName("");
      setConfig(null);
      return;
    }
    setConfig(saved);
    setHost(saved.host);
    setPort(saved.port);
    setUsername(saved.username);
    setEncryption(saved.encryption);
    setFromEmail(saved.from_email);
    setFromName(saved.from_name ?? "");
    setPassword("");
    void loadAdaptiveStatus(saved.id);
  };

  useEffect(() => {
    let active = true;
    const load = async () => {
      const { data, error } = await supabase.from("smtp_configs")
        .select("id,host,port,username,encryption,from_email,from_name,is_active")
        .order("created_at", { ascending: true });
      if (!active) return;
      const savedConfigs = (data as SmtpSettings[]) ?? [];
      setConfigs(savedConfigs);
      const saved = savedConfigs.find((item) => item.is_active) ?? savedConfigs[0] ?? null;
      if (saved) applyConfig(saved);
      if (error) setFeedback({ success: false, message: error.message });
      setLoading(false);
    };
    void load();
    return () => { active = false; };
  }, []);

  const save = async () => {
    setFeedback(null);
    if (!host.trim() || !username.trim() || !fromEmail.trim() || (!config && !password)) {
      setFeedback({ success: false, message: "Host, username, sender email, and an initial password are required." });
      return;
    }
    setSaving(true);
    const payload: Record<string, unknown> = {
      host: host.trim(), port: Number(port), username: username.trim(), encryption,
      from_email: fromEmail.trim(), from_name: fromName.trim() || null,
    };
    if (password) payload.password = password;
    const isEdit = Boolean(config);
    const { data, error } = isEdit
      ? await supabase.from("smtp_configs").update(payload).eq("id", config!.id).select("id").single()
      : await supabase.from("smtp_configs").insert({ ...payload, is_active: false, password, user_id: user?.id }).select("id").single();
    setSaving(false);
    if (error) {
      setFeedback({ success: false, message: error.message });
      return;
    }

    const savedId = data?.id ?? config?.id;
    if (savedId) {
      const { data: refreshed } = await supabase.from("smtp_configs")
        .select("id,host,port,username,encryption,from_email,from_name,is_active")
        .eq("id", savedId).maybeSingle();
      if (refreshed) {
        const activeConfig = { ...refreshed, is_active: true } as SmtpSettings;
        await supabase.from("smtp_configs").update({ is_active: false }).eq("user_id", user?.id ?? "").neq("id", savedId);
        await supabase.from("smtp_configs").update({ is_active: true }).eq("id", savedId);
        setConfigs((current) => [
          ...current.filter((item) => item.id !== savedId).map((item) => ({ ...item, is_active: false })),
          activeConfig,
        ]);
        setConfig(activeConfig);
      }
      setPassword("");
      setConfigureOpen(false);
      setFeedback({ success: true, message: isEdit ? "SMTP account updated." : "SMTP account saved." });
      return;
    }
    setPassword("");
    setFeedback({ success: true, message: "SMTP settings saved." });
  };

  const selectConfig = async (id: string) => {
    if (!user) return;
    const { error } = await supabase.from("smtp_configs").update({ is_active: false }).eq("user_id", user.id);
    if (error) {
      setFeedback({ success: false, message: error.message });
      return;
    }
    const { error: updateError } = await supabase.from("smtp_configs").update({ is_active: true }).eq("id", id).eq("user_id", user.id);
    if (updateError) {
      setFeedback({ success: false, message: updateError.message });
      return;
    }
    const next = configs.find((item) => item.id === id) ?? null;
    setConfigs((current) => current.map((item) => ({ ...item, is_active: item.id === id }))); 
    if (next) applyConfig(next);
    setFeedback({ success: true, message: "Active SMTP account updated." });
  };

  const configureNewAccount = () => {
    applyConfig(null);
    setConfigureOpen(true);
    setFeedback(null);
  };

  const editConfig = (saved: SmtpSettings) => {
    applyConfig(saved);
    setConfigureOpen(true);
    setFeedback(null);
  };

  const removeConfig = async (id: string) => {
    if (configs.length <= 1) {
      setFeedback({ success: false, message: "Keep at least one SMTP account saved." });
      return;
    }
    const { error } = await supabase.from("smtp_configs").delete().eq("id", id);
    if (error) {
      setFeedback({ success: false, message: error.message });
      return;
    }
    const remaining = configs.filter((item) => item.id !== id);
    setConfigs(remaining);
    const next = remaining.find((item) => item.is_active) ?? remaining[0] ?? null;
    setFeedback({ success: true, message: "SMTP account deleted." });
    applyConfig(next);
  };

  const test = async () => {
    if (!session) return;
    setTesting(true);
    setFeedback(null);
    const result = await testSmtpConnection(session.access_token, config?.id);
    setTesting(false);
    setFeedback({ success: result.success, message: result.message });
    if (config) void loadAdaptiveStatus(config.id);
  };

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-10 animate-fade-in">
      <header className="mb-8">
        <p className="text-xs uppercase tracking-wider text-neutral-500 mb-2">Delivery settings</p>
        <h1 className="text-3xl font-bold mb-2">SMTP configuration</h1>
        <p className="text-neutral-600">Configure and test the mail server used by your message campaigns.</p>
      </header>

      {feedback && <div role={feedback.success ? "status" : "alert"} className={`mb-5 flex items-start gap-2 p-3 border rounded-lg text-sm ${feedback.success ? "border-green-300 bg-green-50 text-green-800" : "border-red-300 bg-red-50 text-red-700"}`}>
        {feedback.success ? <CheckCircle2 size={16} className="shrink-0 mt-0.5" /> : <AlertCircle size={16} className="shrink-0 mt-0.5" />}{feedback.message}
      </div>}
      <section className="border border-neutral-200 bg-white rounded-lg overflow-hidden">
        <header className="flex flex-wrap items-center justify-between gap-3 p-5 border-b border-neutral-200">
          <div className="flex items-center gap-3"><div className="p-2 rounded-lg bg-neutral-100"><Server size={19} /></div><div><h2 className="font-semibold">Saved SMTP accounts</h2><p className="text-xs text-neutral-500">Choose the account used by new campaigns.</p></div></div>
          <button onClick={configureNewAccount} className="inline-flex items-center gap-2 px-3 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium"><Plus size={16} />Add SMTP account</button>
        </header>
        {loading ? <div className="flex items-center gap-2 p-8 text-neutral-500"><Loader2 className="animate-spin" size={18} />Loading accounts</div> : configs.length === 0 ? <div className="p-8 text-center"><p className="text-sm text-neutral-600">No SMTP accounts saved yet.</p><button onClick={configureNewAccount} className="mt-3 inline-flex items-center gap-2 px-3 py-2 border border-neutral-200 rounded-lg text-sm font-medium"><Plus size={15} />Configure your first account</button></div> : <div className="divide-y divide-neutral-100">
          {configs.map((item) => <article key={item.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
            <button type="button" onClick={() => { void selectConfig(item.id); }} aria-pressed={item.is_active} className="min-w-0 flex-1 text-left">
              <span className="block truncate text-sm font-medium text-neutral-800">{item.from_name || item.from_email}</span>
              <span className="mt-1 block truncate text-xs text-neutral-500">{item.host} · {item.from_email}</span>
            </button>
            <div className="flex shrink-0 items-center gap-2">
              <span className={`rounded-full px-2 py-1 text-[10px] font-medium ${item.is_active ? "bg-green-100 text-green-700" : "bg-neutral-100 text-neutral-500"}`}>{item.is_active ? "Active" : "Saved"}</span>
              <button onClick={() => editConfig(item)} className="p-2 rounded text-neutral-500 hover:text-primary-700" aria-label={`Edit ${item.from_email}`} title="Edit SMTP account"><Edit2 size={15} /></button>
              <button onClick={() => void removeConfig(item.id)} className="p-2 rounded text-neutral-500 hover:text-red-700" aria-label={`Delete ${item.from_email}`} title="Delete SMTP account"><Trash2 size={15} /></button>
            </div>
          </article>)}
        </div>}
      </section>
      <section className="mt-6 border border-neutral-200 bg-white rounded-lg overflow-hidden">
        <header className="flex flex-wrap items-center justify-between gap-3 p-5">
          <div><h2 className="font-semibold">Configure an account</h2><p className="mt-1 text-xs text-neutral-500">Add a server or edit a saved account’s connection details.</p></div>
          <button onClick={configureOpen ? () => setConfigureOpen(false) : configureNewAccount} className="px-3 py-2 border border-neutral-200 rounded-lg text-sm font-medium">{configureOpen ? "Close configuration" : "Configure account"}</button>
        </header>
        {configureOpen && <div className="border-t border-neutral-200 p-5">
          <h3 className="mb-4 text-sm font-semibold">{config ? `Edit ${config.from_email}` : "New SMTP account"}</h3>
          <div className="grid sm:grid-cols-2 gap-4">
            <label className="text-sm font-medium">Host<input value={host} onChange={(event) => setHost(event.target.value)} placeholder="smtp.example.com" autoComplete="off" className="mt-1.5 w-full px-3 py-2.5 border border-neutral-200 rounded-lg text-sm" /></label>
            <label className="text-sm font-medium">Port<input type="number" min={1} max={65535} value={port} onChange={(event) => setPort(Number(event.target.value))} className="mt-1.5 w-full px-3 py-2.5 border border-neutral-200 rounded-lg text-sm" /></label>
            <label className="text-sm font-medium">Username<input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" className="mt-1.5 w-full px-3 py-2.5 border border-neutral-200 rounded-lg text-sm" /></label>
            <label className="text-sm font-medium">Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={config ? "Leave empty to keep saved password" : "SMTP password"} autoComplete="new-password" className="mt-1.5 w-full px-3 py-2.5 border border-neutral-200 rounded-lg text-sm" /></label>
            <label className="text-sm font-medium">Encryption<select value={encryption} onChange={(event) => setEncryption(event.target.value)} className="mt-1.5 w-full px-3 py-2.5 border border-neutral-200 rounded-lg bg-white text-sm"><option value="tls">STARTTLS</option><option value="ssl">SSL/TLS</option><option value="none">None</option></select></label>
            <label className="text-sm font-medium">From email<input type="email" value={fromEmail} onChange={(event) => setFromEmail(event.target.value)} autoComplete="email" className="mt-1.5 w-full px-3 py-2.5 border border-neutral-200 rounded-lg text-sm" /></label>
            <label className="text-sm font-medium">From name<input value={fromName} onChange={(event) => setFromName(event.target.value)} className="mt-1.5 w-full px-3 py-2.5 border border-neutral-200 rounded-lg text-sm" /></label>
          </div>
          <div className="flex flex-wrap gap-3 mt-6">
            <button onClick={save} disabled={saving} className="inline-flex items-center gap-2 px-4 py-2.5 bg-primary-600 text-white rounded-lg text-sm font-medium disabled:opacity-50">{saving ? <Loader2 className="animate-spin" size={16} /> : <Check size={16} />}Save settings</button>
            <button onClick={test} disabled={testing || !config} className="inline-flex items-center gap-2 px-4 py-2.5 border border-neutral-200 rounded-lg text-sm font-medium disabled:opacity-50">{testing ? <Loader2 className="animate-spin" size={16} /> : <Zap size={16} />}Send test email</button>
          </div>
        </div>}
      </section>
      {config && <section className="mt-6 border border-neutral-200 bg-white rounded-lg">
        <header className="p-5 border-b border-neutral-200 flex items-center justify-between gap-3">
          <h2 className="font-semibold flex items-center gap-2"><Activity size={17} />Adaptive delivery status</h2>
          <button onClick={() => void loadAdaptiveStatus(config.id)} disabled={statusLoading} title="Refresh delivery status" aria-label="Refresh delivery status" className="p-2 border border-neutral-200 rounded-lg disabled:opacity-50">
            {statusLoading ? <Loader2 className="animate-spin" size={16} /> : <RefreshCw size={16} />}
          </button>
        </header>
        <div className="grid sm:grid-cols-2 gap-3 p-5">
          <div className="border border-neutral-200 rounded-lg p-4">
            <p className="text-xs text-neutral-500">Adaptive send rate</p>
            <p className="mt-1 text-lg font-semibold">{rateState ? `${rateState.messages_per_minute} messages/minute` : "Initial rate: 1 message/minute"}</p>
            <p className="mt-1 text-xs text-neutral-500">{rateState ? `${rateState.attempts_this_minute} attempts in current window` : "Rate increases after successful sends and backs off on provider throttling."}</p>
          </div>
          <div className="border border-neutral-200 rounded-lg p-4">
            <p className="text-xs text-neutral-500">Provider response</p>
            {rateState?.paused_until && new Date(rateState.paused_until) > new Date()
              ? <p className="mt-1 flex items-center gap-1.5 text-sm font-medium text-amber-700"><Clock size={15} />Paused until {new Date(rateState.paused_until).toLocaleString()}</p>
              : <p className="mt-1 text-sm font-medium text-green-700">Ready for adaptive dispatch</p>}
            {rateState?.last_provider_response && <p className="mt-1 text-xs text-neutral-500 break-words">{rateState.last_provider_response}</p>}
          </div>
        </div>
        <div className="border-t border-neutral-200">
          <h3 className="px-5 py-3 text-sm font-medium">Recent delivery attempts</h3>
          {recentAttempts.length ? <div className="divide-y divide-neutral-100">{recentAttempts.map((attempt) => <article key={attempt.id} className="px-5 py-3 flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="min-w-0 truncate font-mono text-xs">{attempt.recipient}</span>
            <span className={`text-xs font-medium ${attempt.outcome === "sent" ? "text-green-700" : attempt.outcome === "throttled" ? "text-amber-700" : "text-red-700"}`}>{attempt.outcome}</span>
            <time className="text-xs text-neutral-500">{new Date(attempt.created_at).toLocaleString()}</time>
          </article>)}</div> : <p className="px-5 pb-5 text-sm text-neutral-500">No delivery attempts recorded yet.</p>}
        </div>
      </section>}
    </div>
  );
}