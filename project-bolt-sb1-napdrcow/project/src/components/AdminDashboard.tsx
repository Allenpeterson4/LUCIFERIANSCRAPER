import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, Coins, Loader2, RefreshCw, Save, Users } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";

interface AdminUser {
  id: string;
  email: string | undefined;
  created_at: string;
  last_sign_in_at?: string;
  roles: string[];
  credit_balance: { daily_remaining: number; purchased_credits: number; subscription_remaining: number; subscription_expires_at: string | null; daily_reset_date: string } | null;
}

interface Overview {
  counts: Record<string, number>;
  system_settings: GlobalSettings;
  search_services: SearchServices;
  users: AdminUser[];
  recent_runs: Array<{ id: string; user_id: string; domain: string; status: string; total_emails: number; created_at: string }>;
  audit_log: Array<{ id: string; actor_id: string | null; target_user_id: string | null; action: string; created_at: string }>;
}

interface SearchServices {
  google_maps_api_key: boolean;
  google_cse_api_key: boolean;
  google_cse_id: boolean;
  google_maps_api_key_source: "database" | "environment" | "none";
  google_cse_api_key_source: "database" | "environment" | "none";
  google_cse_id_source: "database" | "environment" | "none";
}

type SearchKeyName = "google_maps_api_key" | "google_cse_api_key" | "google_cse_id";

interface GlobalSettings {
  allow_signups: boolean;
  maintenance_mode: boolean;
  max_domains_per_run: number;
  daily_free_credits: number;
  web_search_enabled: boolean;
}

interface AdminContact {
  id: string;
  user_id: string;
  email: string;
  domain: string | null;
  last_seen_at: string;
  last_sent_at: string | null;
  suppressed_at: string | null;
}

const countLabels: Record<string, string> = {
  scraping_runs: "Scrape jobs",
  scrape_results: "Domain results",
  domain_parsing_runs: "Domain searches",
  domain_parse_results: "Parsed domains",
  email_contacts: "Contacts",
  email_lists: "Saved lists",
  email_list_contacts: "List memberships",
  email_delivery_log: "Delivery records",
  email_messages: "Message templates",
  campaign_queue: "Campaigns",
  discovery_searches: "Discovery searches",
  user_roles: "Assigned roles",
  admin_audit_log: "Admin actions",
  credit_subscriptions: "Credit subscriptions",
};

export function AdminDashboard({ onUnauthorized }: { onUnauthorized: () => void }) {
  const { user } = useAuth();
  const [authorized, setAuthorized] = useState(false);
  const [checkingRole, setCheckingRole] = useState(true);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<GlobalSettings | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [searchKeyDraft, setSearchKeyDraft] = useState<Record<SearchKeyName, string>>({ google_maps_api_key: "", google_cse_api_key: "", google_cse_id: "" });
  const [clearSearchKey, setClearSearchKey] = useState<Record<SearchKeyName, boolean>>({ google_maps_api_key: false, google_cse_api_key: false, google_cse_id: false });
  const [savingSearchKeys, setSavingSearchKeys] = useState(false);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [contacts, setContacts] = useState<AdminContact[]>([]);
  const [contactQuery, setContactQuery] = useState("");
  const [contactPage, setContactPage] = useState(0);
  const [contactTotal, setContactTotal] = useState(0);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [creditGrantAmount, setCreditGrantAmount] = useState(1000);

  const loadOverview = async () => {
    setLoading(true);
    setError("");
    const { data, error: invokeError } = await supabase.functions.invoke("admin-console", { body: { action: "overview" } });
    setLoading(false);
    if (invokeError || data?.error) {
      setError(data?.error ?? invokeError?.message ?? "Could not load admin overview.");
      return;
    }
    setOverview(data as Overview);
  };

  useEffect(() => {
    let active = true;
    const checkRole = async () => {
      if (!user) { onUnauthorized(); return; }
      const { data } = await supabase.from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
      if (!active) return;
      setAuthorized(Boolean(data));
      setCheckingRole(false);
      if (data) void loadOverview();
      else onUnauthorized();
    };
    void checkRole();
    return () => { active = false; };
  }, [user, onUnauthorized]);

  const filteredUsers = useMemo(() => overview?.users.filter((item) => item.email?.toLowerCase().includes(query.trim().toLowerCase())) ?? [], [overview, query]);

  useEffect(() => {
    if (overview) setSettingsDraft(overview.system_settings);
  }, [overview]);

  const loadContacts = useCallback(async () => {
    setContactsLoading(true);
    const { data, error: invokeError } = await supabase.functions.invoke("admin-console", {
      body: { action: "contacts", query: contactQuery, page: contactPage },
    });
    setContactsLoading(false);
    if (invokeError || data?.error) {
      setError(data?.error ?? invokeError?.message ?? "Could not load contacts.");
      return;
    }
    setContacts((data.contacts as AdminContact[]) ?? []);
    setContactTotal(data.total ?? 0);
  }, [contactQuery, contactPage]);

  useEffect(() => {
    if (authorized) void loadContacts();
  }, [authorized, loadContacts]);

  const setRole = async (target: AdminUser, role: "admin" | "user") => {
    const { data, error: invokeError } = await supabase.functions.invoke("admin-console", {
      body: { action: "set_role", user_id: target.id, role },
    });
    if (invokeError || data?.error) {
      setError(data?.error ?? invokeError?.message ?? "Could not update role.");
      return;
    }
    await loadOverview();
  };

  const setSuppressed = async (contact: AdminContact, suppressed: boolean) => {
    const { data, error: invokeError } = await supabase.functions.invoke("admin-console", {
      body: { action: "suppress_contact", contact_id: contact.id, suppressed },
    });
    if (invokeError || data?.error) {
      setError(data?.error ?? invokeError?.message ?? "Could not update contact status.");
      return;
    }
    await loadContacts();
    await loadOverview();
  };

  const saveGlobalSettings = async () => {
    if (!settingsDraft) return;
    setSavingSettings(true);
    const { data, error: invokeError } = await supabase.functions.invoke("admin-console", {
      body: { action: "update_settings", settings: settingsDraft },
    });
    setSavingSettings(false);
    if (invokeError || data?.error) {
      setError(data?.error ?? invokeError?.message ?? "Could not save system settings.");
      return;
    }
    setSettingsDraft(data.settings as GlobalSettings);
    window.dispatchEvent(new Event("system-settings-updated"));
    await loadOverview();
  };

  const saveSearchKeys = async () => {
    setSavingSearchKeys(true);
    setError("");
    setNotice("");
    const { data, error: invokeError } = await supabase.functions.invoke("admin-console", {
      body: { action: "update_search_keys", keys: searchKeyDraft, clear: clearSearchKey },
    });
    setSavingSearchKeys(false);
    if (invokeError || data?.error) {
      setError(data?.error ?? invokeError?.message ?? "Could not save search provider credentials.");
      return;
    }
    setOverview((current) => current ? { ...current, search_services: data.search_services as SearchServices } : current);
    setSearchKeyDraft({ google_maps_api_key: "", google_cse_api_key: "", google_cse_id: "" });
    setClearSearchKey({ google_maps_api_key: false, google_cse_api_key: false, google_cse_id: false });
    setNotice("Search provider settings saved. Updated credentials are applied to new searches automatically.");
  };

  const grantCredits = async (target: AdminUser) => {
    setNotice("");
    const { data, error: invokeError } = await supabase.functions.invoke("admin-console", {
      body: { action: "grant_credits", user_id: target.id, amount: creditGrantAmount },
    });
    if (invokeError || data?.error) {
      setError(data?.error ?? invokeError?.message ?? "Could not grant credits.");
      return;
    }
    setError("");
    setNotice(`Added ${creditGrantAmount.toLocaleString()} purchased credits to ${target.email ?? "the account"}.`);
    await loadOverview();
  };

  if (checkingRole) return <div className="p-16 text-center text-neutral-500"><Loader2 className="animate-spin mx-auto mb-2" size={22} />Checking administrator access</div>;

  if (!authorized) return null;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 animate-fade-in">
      <header className="flex items-end justify-between gap-4 mb-8"><div><p className="text-xs uppercase tracking-wider text-neutral-500 mb-2">System controls</p><h1 className="text-3xl font-bold mb-2">Admin dashboard</h1><p className="text-neutral-600">Users, activity, and platform data.</p></div><button onClick={() => void loadOverview()} disabled={loading} title="Refresh dashboard" aria-label="Refresh dashboard" className="p-2.5 border border-neutral-200 rounded-lg disabled:opacity-50">{loading ? <Loader2 className="animate-spin" size={18} /> : <RefreshCw size={18} />}</button></header>
      {error && <div role="alert" className="mb-5 flex gap-2 p-3 border border-red-300 bg-red-50 text-red-700 rounded-lg text-sm"><AlertCircle size={16} className="shrink-0 mt-0.5" />{error}</div>}
      {notice && <div role="status" className="mb-5 p-3 border border-green-300 bg-green-50 text-green-800 rounded-lg text-sm">{notice}</div>}
      {overview && <>
        <section className="mb-6 border border-neutral-200 bg-white rounded-lg">
          <header className="p-5 border-b border-neutral-200"><h2 className="font-semibold">Global settings</h2></header>
          {settingsDraft && <div className="p-5 grid gap-5 md:grid-cols-3 xl:grid-cols-5 items-end">
            <label className="flex items-start gap-3 text-sm">
              <input type="checkbox" checked={settingsDraft.allow_signups} onChange={(event) => setSettingsDraft({ ...settingsDraft, allow_signups: event.target.checked })} className="mt-1 accent-primary-600" />
              <span><span className="block font-medium">Allow account registration</span><span className="mt-1 block text-xs text-neutral-500">New accounts are blocked at the database when disabled.</span></span>
            </label>
            <label className="flex items-start gap-3 text-sm">
              <input type="checkbox" checked={settingsDraft.maintenance_mode} onChange={(event) => setSettingsDraft({ ...settingsDraft, maintenance_mode: event.target.checked })} className="mt-1 accent-primary-600" />
              <span><span className="block font-medium">Maintenance mode</span><span className="mt-1 block text-xs text-neutral-500">Blocks app access and service operations; admin access remains available.</span></span>
            </label>
            <label className="text-sm font-medium">Maximum domains per scrape request
              <input type="number" min={1} max={5} value={settingsDraft.max_domains_per_run} onChange={(event) => setSettingsDraft({ ...settingsDraft, max_domains_per_run: Number(event.target.value) })} className="mt-1 block w-full max-w-36 px-3 py-2 border border-neutral-200 rounded-lg" />
            </label>
            <label className="text-sm font-medium">Free credits per UTC day
              <input type="number" min={0} max={100000} value={settingsDraft.daily_free_credits} onChange={(event) => setSettingsDraft({ ...settingsDraft, daily_free_credits: Number(event.target.value) })} className="mt-1 block w-full max-w-36 px-3 py-2 border border-neutral-200 rounded-lg" />
            </label>
            <label className="flex items-start gap-3 text-sm">
              <input type="checkbox" checked={settingsDraft.web_search_enabled} onChange={(event) => setSettingsDraft({ ...settingsDraft, web_search_enabled: event.target.checked })} className="mt-1 accent-primary-600" />
              <span><span className="block font-medium">Enable web search</span><span className="mt-1 block text-xs text-neutral-500">Hide keyword search from scraping pages when disabled.</span></span>
            </label>
            <div className="md:col-span-3 xl:col-span-5">
              <button onClick={() => void saveGlobalSettings()} disabled={savingSettings} className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm font-medium disabled:opacity-50">
                {savingSettings ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
                Save settings
              </button>
            </div>
          </div>}
        </section>
        <section className="mb-6 border border-neutral-200 bg-white rounded-lg">
          <header className="p-5 border-b border-neutral-200"><h2 className="font-semibold">Search provider API keys</h2><p className="mt-1 text-sm text-neutral-500">Credentials are saved server-side and never returned to this page.</p></header>
          <div className="grid gap-5 p-5 md:grid-cols-2">
            {([
              ["google_maps_api_key", "google_maps_api_key_source", "Google Maps Places API key"],
              ["google_cse_api_key", "google_cse_api_key_source", "Google Custom Search API key"],
              ["google_cse_id", "google_cse_id_source", "Google Custom Search engine ID"],
            ] as const).map(([keyName, sourceKey, label]) => {
              const configured = overview.search_services?.[keyName] ?? false;
              const source = overview.search_services?.[sourceKey] ?? "none";
              return <label key={keyName} className="block text-sm font-medium">
                <span className="flex items-center justify-between gap-2"><span>{label}</span><span className={`text-xs font-medium ${configured ? "text-green-700" : "text-neutral-400"}`}>{source === "environment" ? "Configured via Edge secret" : configured ? "Configured" : "Not configured"}</span></span>
                <input
                  type="password"
                  autoComplete="off"
                  value={searchKeyDraft[keyName]}
                  onChange={(event) => {
                    setSearchKeyDraft((current) => ({ ...current, [keyName]: event.target.value }));
                    setClearSearchKey((current) => ({ ...current, [keyName]: false }));
                  }}
                  placeholder={configured ? "Saved securely; enter a new value to replace" : "Enter API credential"}
                  className="mt-1.5 w-full rounded-lg border border-neutral-200 px-3 py-2.5 text-sm font-normal"
                />
                {source === "database" && <button type="button" onClick={() => {
                  setSearchKeyDraft((current) => ({ ...current, [keyName]: "" }));
                  setClearSearchKey((current) => ({ ...current, [keyName]: !current[keyName] }));
                }} className={`mt-1 text-xs font-medium ${clearSearchKey[keyName] ? "text-red-700" : "text-neutral-500 hover:text-red-700"}`}>
                  {clearSearchKey[keyName] ? "Key will be removed on save" : "Remove saved key"}
                </button>}
              </label>;
            })}
            <div className="md:col-span-2">
              <button onClick={() => void saveSearchKeys()} disabled={savingSearchKeys} className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
                {savingSearchKeys ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
                Save search credentials
              </button>
            </div>
          </div>
        </section>
        <section className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-8">{Object.entries(overview.counts).map(([key, count]) => <div key={key} className="border border-neutral-200 bg-white rounded-lg p-4"><p className="text-xs text-neutral-500">{countLabels[key] ?? key}</p><p className="text-2xl font-semibold mt-2">{count.toLocaleString()}</p></div>)}</section>
        <div className="grid xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.7fr)] gap-6 items-start">
          <section className="border border-neutral-200 bg-white rounded-lg">
            <header className="p-5 border-b border-neutral-200 flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold flex items-center gap-2"><Users size={17} />Accounts</h2><div className="flex flex-wrap items-center gap-2"><label className="text-xs text-neutral-500">Grant<input type="number" min={1} max={100000000} value={creditGrantAmount} onChange={(event) => setCreditGrantAmount(Number(event.target.value))} className="ml-2 w-28 px-2 py-1.5 border border-neutral-200 rounded text-sm text-neutral-800" /></label><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter by email" className="max-w-56 min-w-0 px-3 py-2 border border-neutral-200 rounded-lg text-sm" /></div></header>
            <div className="overflow-x-auto"><table className="w-full text-sm text-left"><thead className="bg-neutral-50 text-neutral-500"><tr><th className="p-3">Email</th><th className="p-3">Joined</th><th className="p-3">Last active</th><th className="p-3">Available credits</th><th className="p-3">Access</th></tr></thead><tbody className="divide-y divide-neutral-100">{filteredUsers.map((item) => <tr key={item.id}><td className="p-3">{item.email ?? "No email"}</td><td className="p-3 whitespace-nowrap">{new Date(item.created_at).toLocaleDateString()}</td><td className="p-3 whitespace-nowrap">{item.last_sign_in_at ? new Date(item.last_sign_in_at).toLocaleDateString() : "Never"}</td><td className="p-3"><span className="block whitespace-nowrap">{item.credit_balance ? (Number(item.credit_balance.daily_remaining) + Number(item.credit_balance.subscription_remaining) + Number(item.credit_balance.purchased_credits)).toLocaleString() : "Not initialized"}</span>{item.credit_balance && <span className="text-xs text-neutral-500">{Number(item.credit_balance.daily_remaining).toLocaleString()} daily + {Number(item.credit_balance.subscription_remaining).toLocaleString()} plan + {Number(item.credit_balance.purchased_credits).toLocaleString()} wallet</span>}<button onClick={() => void grantCredits(item)} disabled={!Number.isInteger(creditGrantAmount) || creditGrantAmount < 1} className="mt-1 inline-flex items-center gap-1 px-2 py-1 border border-neutral-200 rounded text-xs hover:border-primary-300 hover:text-primary-700 disabled:opacity-50"><Coins size={12} />Grant</button></td><td className="p-3"><button onClick={() => void setRole(item, item.roles.includes("admin") ? "user" : "admin")} disabled={item.id === user?.id} className="px-2.5 py-1 border border-neutral-200 rounded text-xs disabled:opacity-50">{item.roles.includes("admin") ? "Remove admin" : "Make admin"}</button></td></tr>)}{filteredUsers.length === 0 && <tr><td colSpan={5} className="p-8 text-center text-neutral-500">No matching accounts.</td></tr>}</tbody></table></div>
            <p className="p-4 border-t border-neutral-200 text-xs text-neutral-500">Showing up to 100 accounts.</p>
          </section>
          <div className="space-y-6">
            <section className="border border-neutral-200 bg-white rounded-lg"><h2 className="p-5 font-semibold border-b border-neutral-200">Recent scrape jobs</h2><div className="divide-y divide-neutral-100">{overview.recent_runs.map((run) => <article key={run.id} className="p-4"><div className="flex justify-between gap-3"><span className="font-mono text-sm truncate">{run.domain}</span><span className="text-xs text-neutral-500">{run.status}</span></div><p className="mt-1 text-xs text-neutral-500">{run.total_emails} contacts · {new Date(run.created_at).toLocaleString()}</p></article>)}{overview.recent_runs.length === 0 && <p className="p-5 text-sm text-neutral-500">No jobs recorded.</p>}</div></section>
            <section className="border border-neutral-200 bg-white rounded-lg"><h2 className="p-5 font-semibold border-b border-neutral-200">Admin activity</h2><div className="divide-y divide-neutral-100">{overview.audit_log.map((entry) => <article key={entry.id} className="p-4"><p className="text-sm">{entry.action.replace(/_/g, " ")}</p><p className="mt-1 text-xs text-neutral-500">{new Date(entry.created_at).toLocaleString()}</p></article>)}{overview.audit_log.length === 0 && <p className="p-5 text-sm text-neutral-500">No admin actions recorded.</p>}</div></section>
          </div>
        </div>
        <section className="mt-6 border border-neutral-200 bg-white rounded-lg">
          <header className="p-5 border-b border-neutral-200 flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">Contact oversight</h2><input value={contactQuery} onChange={(event) => { setContactQuery(event.target.value); setContactPage(0); }} placeholder="Search email addresses" className="w-full max-w-sm px-3 py-2 border border-neutral-200 rounded-lg text-sm" /></header>
          <div className="overflow-x-auto"><table className="w-full text-sm text-left"><thead className="bg-neutral-50 text-neutral-500"><tr><th className="p-3">Email</th><th className="p-3">Domain</th><th className="p-3">Owner</th><th className="p-3">Last scraped</th><th className="p-3">Status</th><th className="p-3">Action</th></tr></thead><tbody className="divide-y divide-neutral-100">{contactsLoading ? <tr><td colSpan={6} className="p-8 text-center text-neutral-500"><Loader2 className="animate-spin mx-auto mb-2" size={18} />Loading contacts</td></tr> : contacts.map((contact) => <tr key={contact.id}><td className="p-3 font-mono">{contact.email}</td><td className="p-3">{contact.domain ?? "-"}</td><td className="p-3 font-mono text-xs">{contact.user_id}</td><td className="p-3 whitespace-nowrap">{new Date(contact.last_seen_at).toLocaleDateString()}</td><td className="p-3">{contact.suppressed_at ? "Suppressed" : contact.last_sent_at ? "Previously sent" : "Available"}</td><td className="p-3"><button onClick={() => void setSuppressed(contact, !contact.suppressed_at)} className="px-2.5 py-1 border border-neutral-200 rounded text-xs">{contact.suppressed_at ? "Restore" : "Suppress"}</button></td></tr>)}{!contactsLoading && contacts.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-neutral-500">No matching contacts.</td></tr>}</tbody></table></div>
          <footer className="p-4 border-t border-neutral-200 flex items-center justify-between text-xs text-neutral-500"><span>{contactTotal.toLocaleString()} contacts</span><div className="flex gap-2"><button disabled={contactPage === 0 || contactsLoading} onClick={() => setContactPage((page) => page - 1)} className="px-3 py-1.5 border border-neutral-200 rounded disabled:opacity-40">Previous</button><button disabled={(contactPage + 1) * 50 >= contactTotal || contactsLoading} onClick={() => setContactPage((page) => page + 1)} className="px-3 py-1.5 border border-neutral-200 rounded disabled:opacity-40">Next</button></div></footer>
        </section>
      </>}
    </div>
  );
}