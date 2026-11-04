import { useEffect, useRef, useState } from "react";
import { AlertCircle, BarChart3, Check, CheckCircle2, Clock, Edit2, FileText, Inbox, Loader2, Plus, RefreshCw, Send, Trash2, X, Zap } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { processQueueBatch, sendEmailsNow } from "@/lib/smtp";
import type { CampaignQueueItem, EmailMessage } from "@/lib/smtp-types";
import type { ScrapeCampaignBatch } from "@/lib/types";

interface SavedList { id: string; name: string }
interface SmtpSummary { id: string }
interface DeliveryAttempt {
  id: number;
  message_id: string | null;
  recipient: string;
  outcome: "sent" | "failed" | "throttled";
  provider_response: string | null;
  created_at: string;
}
interface BounceEntry {
  id: number;
  recipient: string;
  failure_reason: string;
  failure_count: number;
  status: "new" | "reviewed";
  first_failed_at: string;
  last_failed_at: string;
}
type Audience = "all" | "all_lists" | "today" | "range" | "list" | "batch";
type MessageSection = "create" | "deliveries" | "saved";

export function MessageManager({ initialBatch = null, onBatchConsumed }: {
  initialBatch?: ScrapeCampaignBatch | null;
  onBatchConsumed?: () => void;
}) {
  const { session } = useAuth();
  const [messages, setMessages] = useState<EmailMessage[]>([]);
  const [lists, setLists] = useState<SavedList[]>([]);
  const [config, setConfig] = useState<SmtpSummary | null>(null);
  const [smtpAccounts, setSmtpAccounts] = useState<Array<{ id: string; host: string; from_email: string; from_name: string | null; is_active: boolean }>>([]);
  const [queue, setQueue] = useState<CampaignQueueItem[]>([]);
  const [section, setSection] = useState<MessageSection>("create");
  const [deliveryAttempts, setDeliveryAttempts] = useState<DeliveryAttempt[]>([]);
  const [deliveryMetrics, setDeliveryMetrics] = useState({ sent: 0, failed: 0, throttled: 0, bounces: 0 });
  const [bounceEntries, setBounceEntries] = useState<BounceEntry[]>([]);
  const [messageId, setMessageId] = useState("");
  const [editing, setEditing] = useState<EmailMessage | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [format, setFormat] = useState<"text" | "html">("text");
  const [audience, setAudience] = useState<Audience>("all");
  const [listId, setListId] = useState("");
  const [batchRecipients, setBatchRecipients] = useState<string[]>([]);
  const [batchRunId, setBatchRunId] = useState("");
  const [batchLabel, setBatchLabel] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [quantity, setQuantity] = useState(100);
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [processingQueue, setProcessingQueue] = useState(false);
  const [feedback, setFeedback] = useState<{ success: boolean; message: string } | null>(null);
  const handledBatchId = useRef<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    const [messageResult, listResult, configResult, queueResult, attemptsResult, sentCount, failedCount, throttledCount, bounceResult, bounceCount] = await Promise.all([
      supabase.from("email_messages").select("*").order("updated_at", { ascending: false }),
      supabase.from("email_lists").select("id,name").order("name"),
      supabase.from("smtp_configs").select("id,host,from_email,from_name,is_active").order("created_at", { ascending: false }),
      supabase.from("campaign_queue").select("*").order("created_at", { ascending: false }).limit(25),
      supabase.from("smtp_dispatch_attempts").select("id,message_id,recipient,outcome,provider_response,created_at").order("created_at", { ascending: false }).limit(100),
      supabase.from("smtp_dispatch_attempts").select("id", { count: "exact", head: true }).eq("outcome", "sent"),
      supabase.from("smtp_dispatch_attempts").select("id", { count: "exact", head: true }).eq("outcome", "failed"),
      supabase.from("smtp_dispatch_attempts").select("id", { count: "exact", head: true }).eq("outcome", "throttled"),
      supabase.from("smtp_bounce_entries").select("id,recipient,failure_reason,failure_count,status,first_failed_at,last_failed_at").order("last_failed_at", { ascending: false }).limit(100),
      supabase.from("smtp_bounce_entries").select("id", { count: "exact", head: true }),
    ]);
    const smtpRows = (configResult.data as Array<{ id: string; host: string; from_email: string; from_name: string | null; is_active: boolean }> | null) ?? [];
    setMessages((messageResult.data as EmailMessage[]) ?? []);
    setLists((listResult.data as SavedList[]) ?? []);
    setSmtpAccounts(smtpRows);
    const saved = smtpRows.find((row) => row.is_active) ?? smtpRows[0] ?? null;
    setConfig(saved ? { id: saved.id } : null);
    setQueue((queueResult.data as CampaignQueueItem[]) ?? []);
    setDeliveryAttempts((attemptsResult.data as DeliveryAttempt[]) ?? []);
    setDeliveryMetrics({ sent: sentCount.count ?? 0, failed: failedCount.count ?? 0, throttled: throttledCount.count ?? 0, bounces: bounceCount.count ?? 0 });
    setBounceEntries((bounceResult.data as BounceEntry[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { void loadData(); }, []);

  useEffect(() => {
    if (!initialBatch || loading || handledBatchId.current === initialBatch.runId) return;
    handledBatchId.current = initialBatch.runId;
    setBatchRecipients(initialBatch.emails);
    setBatchRunId(initialBatch.runId);
    setBatchLabel(initialBatch.batchLabel);
    setAudience("batch");
    setPreviewCount(initialBatch.emails.length);
    setQuantity(initialBatch.emails.length);
    setMessageId(messages[0]?.id ?? "");
    setFeedback(null);
    setModalOpen(true);
    onBatchConsumed?.();
  }, [initialBatch, loading, messages, onBatchConsumed]);

  const saveTemplate = async () => {
    setFeedback(null);
    if (!subject.trim() || !body.trim()) {
      setFeedback({ success: false, message: "Add a subject and message body first." });
      return;
    }
    setBusy(true);
    const payload = { subject: subject.trim(), body: body.trim(), format, updated_at: new Date().toISOString() };
    const result = editing
      ? await supabase.from("email_messages").update(payload).eq("id", editing.id)
      : await supabase.from("email_messages").insert(payload);
    setBusy(false);
    if (result.error) {
      setFeedback({ success: false, message: result.error.message });
      return;
    }
    setEditing(null);
    setSubject("");
    setBody("");
    setFormat("text");
    await loadData();
  };

  const editTemplate = (message: EmailMessage) => {
    setEditing(message);
    setSubject(message.subject);
    setBody(message.body);
    setFormat(message.format ?? "text");
    setSection("create");
  };

  const cancelEdit = () => { setEditing(null); setSubject(""); setBody(""); setFormat("text"); };

  const deleteTemplate = async (id: string) => {
    const { error } = await supabase.from("email_messages").delete().eq("id", id);
    if (error) setFeedback({ success: false, message: error.message });
    else await loadData();
  };

  const markBounceReviewed = async (entry: BounceEntry) => {
    const { error } = await supabase.from("smtp_bounce_entries")
      .update({ status: entry.status === "new" ? "reviewed" : "new" }).eq("id", entry.id);
    if (error) setFeedback({ success: false, message: error.message });
    else await loadData();
  };

  const deleteBounce = async (id: number) => {
    const { error } = await supabase.from("smtp_bounce_entries").delete().eq("id", id);
    if (error) setFeedback({ success: false, message: error.message });
    else await loadData();
  };

  const getRecipients = async () => {
    const pageSize = 1000;
    const rows: Array<{ email: string }> = [];
    if (audience === "batch") {
      for (let offset = 0; offset < batchRecipients.length; offset += 200) {
        const { data, error } = await supabase.from("email_contacts").select("email")
          .in("email", batchRecipients.slice(offset, offset + 200))
          .is("last_sent_at", null)
          .is("suppressed_at", null);
        if (error) throw error;
        rows.push(...(data ?? []));
      }
    } else if (audience === "list" || audience === "all_lists") {
      if (audience === "list" && !listId) throw new Error("Choose a saved list.");
      const contactIds: string[] = [];
      for (let offset = 0; ; offset += pageSize) {
        let query = supabase.from("email_list_contacts").select("contact_id");
        if (audience === "list") query = query.eq("list_id", listId);
        const { data, error } = await query.order("contact_id").range(offset, offset + pageSize - 1);
        if (error) throw error;
        const batch = data ?? [];
        contactIds.push(...batch.map((row) => row.contact_id));
        if (batch.length < pageSize) break;
      }
      for (let offset = 0; offset < contactIds.length; offset += 200) {
        let query = supabase.from("email_contacts").select("id,email").in("id", contactIds.slice(offset, offset + 200)).is("last_sent_at", null).is("suppressed_at", null);
        if (fromDate) query = query.gte("last_seen_at", new Date(`${fromDate}T00:00:00`).toISOString());
        if (toDate) query = query.lte("last_seen_at", new Date(`${toDate}T23:59:59.999`).toISOString());
        const { data, error } = await query;
        if (error) throw error;
        rows.push(...(data ?? []));
      }
    } else {
      for (let offset = 0; ; offset += pageSize) {
        let query = supabase.from("email_contacts").select("email").is("last_sent_at", null).is("suppressed_at", null);
        if (audience === "today") {
          const start = new Date();
          start.setHours(0, 0, 0, 0);
          query = query.gte("last_seen_at", start.toISOString()).lte("last_seen_at", new Date().toISOString());
        }
        if (audience === "range" && fromDate) query = query.gte("last_seen_at", new Date(`${fromDate}T00:00:00`).toISOString());
        if (audience === "range" && toDate) query = query.lte("last_seen_at", new Date(`${toDate}T23:59:59.999`).toISOString());
        const { data, error } = await query.order("email").range(offset, offset + pageSize - 1);
        if (error) throw error;
        rows.push(...(data ?? []));
        if ((data ?? []).length < pageSize) break;
      }
    }
    const queuedEmails = new Set<string>();
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await supabase.from("campaign_queue")
        .select("recipients")
        .in("status", ["queued", "sending"])
        .order("created_at")
        .range(offset, offset + pageSize - 1);
      if (error) throw error;
      const batch = data ?? [];
      batch.forEach((item: { recipients: string[] }) => item.recipients.forEach((email: string) => queuedEmails.add(email.toLowerCase())));
      if (batch.length < pageSize) break;
    }
    return [...new Set(rows.map((row) => row.email))].filter((email) => !queuedEmails.has(email.toLowerCase()));
  };

  const previewRecipients = async () => {
    setBusy(true);
    setFeedback(null);
    try {
      const recipients = await getRecipients();
      setPreviewCount(recipients.length);
      setQuantity((current) => Math.min(current, recipients.length || 1));
    } catch (error) {
      setFeedback({ success: false, message: error instanceof Error ? error.message : "Could not load contacts." });
    }
    setBusy(false);
  };

  const openDispatch = (id: string) => {
    setMessageId(id);
    setAudience("all");
    setListId("");
    setFromDate("");
    setToDate("");
    setPreviewCount(null);
    setQuantity(100);
    setFeedback(null);
    setModalOpen(true);
  };

  const dispatch = async () => {
    if (!session || !config || !messageId) {
      setFeedback({ success: false, message: "Configure and test SMTP settings before sending." });
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      const recipients = (await getRecipients()).slice(0, Math.max(0, quantity));
      if (recipients.length === 0) throw new Error("No eligible contacts match this audience.");
      const activeConfigId = config?.id ?? smtpAccounts[0]?.id ?? null;
      if (!activeConfigId) throw new Error("Choose or save an SMTP account before dispatch.");
      const result = await sendEmailsNow(session.access_token, messageId, recipients, activeConfigId, {
        sourceBatchId: audience === "batch" ? batchRunId : null,
        batchLabel: audience === "batch" ? batchLabel : null,
      });
      if (!result.success) throw new Error(result.message);
      setFeedback({ success: true, message: result.message });
      await loadData();
    } catch (error) {
      setFeedback({ success: false, message: error instanceof Error ? error.message : "Dispatch failed." });
    }
    setBusy(false);
  };

  const processNextBatch = async () => {
    if (!session) return;
    setProcessingQueue(true);
    const result = await processQueueBatch(session.access_token);
    setProcessingQueue(false);
    setFeedback({ success: result.success, message: result.message });
    await loadData();
  };

  const selectedMessage = messages.find((message) => message.id === messageId);

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10 animate-fade-in">
      <header className="mb-8">
        <p className="text-xs uppercase tracking-wider text-neutral-500 mb-2">Communications</p>
        <h1 className="text-3xl font-bold mb-2">Message manager</h1>
        <p className="text-neutral-600">Create templates, review delivery performance, and manage saved content.</p>
      </header>

      {feedback && !modalOpen && <p role={feedback.success ? "status" : "alert"} className={`mb-5 p-3 border rounded-lg text-sm ${feedback.success ? "border-green-300 bg-green-50 text-green-800" : "border-red-300 bg-red-50 text-red-700"}`}>{feedback.message}</p>}
      <nav aria-label="Message sections" className="flex flex-wrap gap-1 border-b border-neutral-200 mb-6">
        {([
          ["create", "Create template", <Plus size={16} />],
          ["deliveries", "Delivery log", <BarChart3 size={16} />],
          ["saved", "Saved content", <Inbox size={16} />],
        ] as const).map(([target, label, icon]) => <button
          key={target}
          onClick={() => setSection(target)}
          className={`inline-flex items-center gap-2 px-4 py-3 border-b-2 text-sm font-medium ${section === target ? "border-primary-600 text-primary-700" : "border-transparent text-neutral-500 hover:text-neutral-800"}`}
        >{icon}{label}</button>)}
      </nav>
      <div className="grid lg:grid-cols-[minmax(0,1fr)_320px] gap-6 items-start">
        <section className="space-y-5">
          {section === "create" && (
          <div className="border border-neutral-200 bg-white rounded-lg p-5">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4"><h2 className="font-semibold flex items-center gap-2"><FileText size={17} />{editing ? "Edit template" : "New template"}</h2><div className="inline-flex rounded-lg bg-neutral-100 p-1" role="group" aria-label="Message format">
              <button onClick={() => setFormat("text")} aria-pressed={format === "text"} className={`px-3 py-1.5 rounded-md text-xs font-medium ${format === "text" ? "bg-white text-primary-700 shadow-sm" : "text-neutral-500"}`}>Plain text</button>
              <button onClick={() => setFormat("html")} aria-pressed={format === "html"} className={`px-3 py-1.5 rounded-md text-xs font-medium ${format === "html" ? "bg-white text-primary-700 shadow-sm" : "text-neutral-500"}`}>HTML</button>
            </div>{editing && <button onClick={cancelEdit} title="Cancel editing" aria-label="Cancel editing"><X size={17} /></button>}</div>
            <div className="space-y-3">
              <label className="block text-sm font-medium">Subject<input value={subject} onChange={(event) => setSubject(event.target.value)} className="mt-1.5 w-full px-3 py-2.5 border border-neutral-200 rounded-lg text-sm" /></label>
              <label className="block text-sm font-medium">Message body<textarea rows={7} value={body} onChange={(event) => setBody(event.target.value)} className="mt-1.5 w-full px-3 py-2.5 border border-neutral-200 rounded-lg text-sm resize-y" /></label>
              <button onClick={saveTemplate} disabled={busy} className="inline-flex items-center gap-2 px-4 py-2.5 bg-primary-600 text-white rounded-lg text-sm font-medium disabled:opacity-50">{busy ? <Loader2 className="animate-spin" size={16} /> : editing ? <Check size={16} /> : <Plus size={16} />}{editing ? "Save changes" : "Save template"}</button>
            </div>
          </div>
          )}

          {section === "saved" && (
          <div className="border border-neutral-200 bg-white rounded-lg">
            <div className="flex items-center justify-between p-5 border-b border-neutral-200"><h2 className="font-semibold">Saved templates</h2><button onClick={() => void loadData()} title="Refresh templates" aria-label="Refresh templates" className="p-2 rounded hover:bg-neutral-100"><RefreshCw size={16} /></button></div>
            {loading ? <div className="p-8 text-center text-neutral-500"><Loader2 className="animate-spin mx-auto mb-2" size={20} />Loading templates</div> : messages.length === 0 ? <p className="p-8 text-sm text-neutral-500">Save a template to start a campaign.</p> : <div className="divide-y divide-neutral-100">
              {messages.map((message) => <article key={message.id} className="p-5">
                <div className="flex items-start justify-between gap-4"><div className="min-w-0"><div className="flex items-center gap-2"><h3 className="font-medium truncate">{message.subject}</h3><span className="shrink-0 rounded bg-neutral-100 px-2 py-0.5 text-[10px] uppercase text-neutral-500">{message.format ?? "text"}</span></div><p className="mt-1 text-sm text-neutral-500 line-clamp-3 whitespace-pre-wrap">{message.body}</p><p className="mt-2 text-xs text-neutral-400">Updated {new Date(message.updated_at).toLocaleString()}</p></div><div className="flex gap-1"><button onClick={() => editTemplate(message)} aria-label="Edit template" title="Edit template" className="p-2 text-neutral-500 hover:text-primary-600"><Edit2 size={16} /></button><button onClick={() => void deleteTemplate(message.id)} aria-label="Delete template" title="Delete template" className="p-2 text-neutral-500 hover:text-red-600"><Trash2 size={16} /></button></div></div>
                <button onClick={() => openDispatch(message.id)} className="mt-4 inline-flex items-center gap-2 px-3.5 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium"><Send size={15} />Send message</button>
              </article>)}
            </div>}
          </div>
          )}

          {section === "deliveries" && <div className="space-y-5">
            <section className="grid grid-cols-2 xl:grid-cols-4 gap-3">
              {[["Sent", deliveryMetrics.sent, "text-green-700"], ["Failed", deliveryMetrics.failed, "text-red-700"], ["Provider throttles", deliveryMetrics.throttled, "text-amber-700"], ["Bounce entries", deliveryMetrics.bounces, "text-neutral-800"]].map(([label, count, color]) => <div key={label} className="border border-neutral-200 bg-white rounded-lg p-4">
                <p className="text-xs text-neutral-500">{label}</p><p className={`mt-2 text-2xl font-semibold ${color}`}>{Number(count).toLocaleString()}</p>
              </div>)}
            </section>
            <section className="border border-neutral-200 bg-white rounded-lg overflow-hidden">
              <header className="flex items-center justify-between gap-3 p-5 border-b border-neutral-200"><h2 className="font-semibold">Recent delivery attempts</h2><button onClick={() => void loadData()} title="Refresh delivery log" aria-label="Refresh delivery log" className="p-2 border border-neutral-200 rounded-lg"><RefreshCw size={16} /></button></header>
              {loading ? <p className="p-6 text-sm text-neutral-500">Loading delivery log...</p> : deliveryAttempts.length === 0 ? <p className="p-6 text-sm text-neutral-500">No delivery attempts recorded yet.</p> : <div className="overflow-x-auto"><table className="w-full text-sm text-left">
                <thead className="bg-neutral-50 text-neutral-500"><tr><th className="p-3">Message</th><th className="p-3">Recipient</th><th className="p-3">Result</th><th className="p-3">Provider response</th><th className="p-3">Time</th></tr></thead>
                <tbody className="divide-y divide-neutral-100">{deliveryAttempts.map((attempt) => <tr key={attempt.id}>
                  <td className="p-3 max-w-48 truncate">{messages.find((message) => message.id === attempt.message_id)?.subject ?? "SMTP test"}</td>
                  <td className="p-3 font-mono text-xs">{attempt.recipient}</td>
                  <td className={`p-3 text-xs font-medium ${attempt.outcome === "sent" ? "text-green-700" : attempt.outcome === "throttled" ? "text-amber-700" : "text-red-700"}`}>{attempt.outcome}</td>
                  <td className="p-3 max-w-xs truncate text-xs text-neutral-500" title={attempt.provider_response ?? undefined}>{attempt.provider_response ?? "-"}</td>
                  <td className="p-3 whitespace-nowrap text-xs text-neutral-500">{new Date(attempt.created_at).toLocaleString()}</td>
                </tr>)}</tbody>
              </table></div>}
              <p className="px-5 py-3 border-t border-neutral-200 text-xs text-neutral-500">Showing the latest {deliveryAttempts.length} of {deliveryMetrics.sent + deliveryMetrics.failed + deliveryMetrics.throttled} recorded attempts.</p>
            </section>
            <section className="border border-neutral-200 bg-white rounded-lg overflow-hidden">
              <header className="p-5 border-b border-neutral-200"><h2 className="font-semibold">Bounce review list</h2><p className="mt-1 text-xs text-neutral-500">Failed recipients are isolated here; recording them does not pause campaign dispatch.</p></header>
              {bounceEntries.length === 0 ? <p className="p-6 text-sm text-neutral-500">No failed deliveries need review.</p> : <div className="divide-y divide-neutral-100">{bounceEntries.map((entry) => <article key={entry.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="font-mono text-sm break-all">{entry.recipient}</p><p className="mt-1 text-xs text-neutral-500">{entry.failure_reason}</p><p className="mt-1 text-xs text-neutral-400">{entry.failure_count} failure{entry.failure_count === 1 ? "" : "s"} · Last {new Date(entry.last_failed_at).toLocaleString()}</p></div>
                  <div className="flex shrink-0 items-center gap-1"><span className={`mr-1 text-xs font-medium ${entry.status === "new" ? "text-amber-700" : "text-green-700"}`}>{entry.status}</span><button onClick={() => void markBounceReviewed(entry)} title={entry.status === "new" ? "Mark reviewed" : "Mark unreviewed"} aria-label={entry.status === "new" ? "Mark bounce reviewed" : "Mark bounce unreviewed"} className="p-2 text-neutral-500 hover:text-primary-700">{entry.status === "new" ? <CheckCircle2 size={16} /> : <Clock size={16} />}</button><button onClick={() => void deleteBounce(entry.id)} title="Delete bounce entry" aria-label="Delete bounce entry" className="p-2 text-neutral-500 hover:text-red-700"><Trash2 size={16} /></button></div>
                </div>
              </article>)}</div>}
              {deliveryMetrics.bounces > bounceEntries.length && <p className="px-5 py-3 border-t border-neutral-200 text-xs text-neutral-500">Showing the latest {bounceEntries.length} of {deliveryMetrics.bounces} entries.</p>}
            </section>
          </div>}
        </section>

        <aside className="border border-neutral-200 bg-white rounded-lg p-5">
          <div className="flex items-center justify-between gap-3 mb-4"><h2 className="font-semibold flex items-center gap-2"><Clock size={17} />Dispatch queue</h2><button onClick={processNextBatch} disabled={processingQueue} title="Process next batch" aria-label="Process next batch" className="p-2 border border-neutral-200 rounded-lg disabled:opacity-50">{processingQueue ? <Loader2 className="animate-spin" size={16} /> : <Zap size={16} />}</button></div>
          {!config && <p className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900">Configure SMTP before dispatching a campaign.</p>}
          <div className="space-y-3">
            {queue.map((item) => <div key={item.id} className="p-3 border border-neutral-200 rounded-lg">
              <div className="flex justify-between gap-2"><span className="text-sm font-medium">{item.status}</span><span className="text-xs text-neutral-500">{item.total_sent}/{item.recipients.length}</span></div>
              <div className="h-1.5 bg-neutral-100 rounded-full mt-2 overflow-hidden"><div className="h-full bg-primary-600" style={{ width: `${item.recipients.length ? Math.min(100, (item.total_sent + item.total_failed) / item.recipients.length * 100) : 0}%` }} /></div>
              {item.error && <p className="mt-2 text-xs text-red-600">{item.error}</p>}
            </div>)}
            {queue.length === 0 && <p className="text-sm text-neutral-500">No queued campaigns.</p>}
          </div>
          <p className="mt-4 text-xs text-neutral-400">Queued campaigns dispatch automatically. Provider throttling pauses and resumes delivery as limits allow.</p>
        </aside>
      </div>

      {modalOpen && <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <button aria-label="Close send dialog" className="absolute inset-0 bg-black/70" onClick={() => setModalOpen(false)} />
        <section role="dialog" aria-modal="true" aria-labelledby="dispatch-title" className="relative w-full max-w-xl max-h-[90vh] overflow-y-auto bg-white border border-neutral-200 rounded-lg shadow-2xl">
          <header className="flex items-center justify-between p-5 border-b border-neutral-200"><div><p className="text-xs uppercase tracking-wide text-neutral-500">Audience review</p><h2 id="dispatch-title" className="font-semibold mt-1">{selectedMessage?.subject ?? "Send message"}</h2></div><button onClick={() => setModalOpen(false)} aria-label="Close" className="p-2"><X size={18} /></button></header>
          <div className="p-5 space-y-4">
            <label className="block text-sm font-medium">SMTP account<select value={config?.id ?? ""} onChange={(event) => setConfig({ id: event.target.value })} className="mt-1.5 w-full px-3 py-2.5 bg-white border border-neutral-200 rounded-lg"><option value="">Choose a saved SMTP account</option>{smtpAccounts.map((account) => <option key={account.id} value={account.id}>{account.from_email || account.host} {account.is_active ? "● active" : ""}</option>)}</select></label>
            <label className="block text-sm font-medium">Message template<select value={messageId} onChange={(event) => setMessageId(event.target.value)} className="mt-1.5 w-full px-3 py-2.5 bg-white border border-neutral-200 rounded-lg"><option value="">Choose a template</option>{messages.map((message) => <option key={message.id} value={message.id}>{message.subject}</option>)}</select></label>
            <label className="block text-sm font-medium">Recipient source<select value={audience} onChange={(event) => { setAudience(event.target.value as Audience); setPreviewCount(null); }} className="mt-1.5 w-full px-3 py-2.5 bg-white border border-neutral-200 rounded-lg">
              <option value="all">All unsent contacts</option><option value="all_lists">All email lists</option><option value="today">Scraped today</option><option value="range">Date range</option><option value="list">Specific email list</option>
              {batchRecipients.length > 0 && <option value="batch">Selected batch: {batchLabel}</option>}
            </select></label>
            {audience === "batch" && <p className="p-3 bg-neutral-50 border border-neutral-200 rounded-lg text-sm">Batch: {batchLabel} · {batchRecipients.length.toLocaleString()} extracted contacts</p>}
            {(audience === "list" || audience === "all_lists") && <label className="block text-sm font-medium">Email list<select value={listId} onChange={(event) => { setListId(event.target.value); setPreviewCount(null); }} disabled={audience === "all_lists"} className="mt-1.5 w-full px-3 py-2.5 bg-white border border-neutral-200 rounded-lg disabled:opacity-50"><option value="">{audience === "all_lists" ? "All saved lists" : "Choose a list"}</option>{lists.map((list) => <option key={list.id} value={list.id}>{list.name}</option>)}</select></label>}
            {(audience === "range" || audience === "list" || audience === "all_lists") && <div className="grid sm:grid-cols-2 gap-3"><label className="text-sm font-medium">From date<input type="date" value={fromDate} onChange={(event) => { setFromDate(event.target.value); setPreviewCount(null); }} className="mt-1.5 w-full px-3 py-2.5 border border-neutral-200 rounded-lg" /></label><label className="text-sm font-medium">To date<input type="date" value={toDate} onChange={(event) => { setToDate(event.target.value); setPreviewCount(null); }} className="mt-1.5 w-full px-3 py-2.5 border border-neutral-200 rounded-lg" /></label></div>}
            <button onClick={previewRecipients} disabled={busy || (audience === "list" && !listId)} className="px-3 py-2 border border-neutral-200 rounded-lg text-sm disabled:opacity-50">{busy ? "Loading audience..." : "Review eligible contacts"}</button>
            {previewCount !== null && <div className="p-3 bg-neutral-50 border border-neutral-200 rounded-lg"><p className="text-sm font-medium">{previewCount.toLocaleString()} eligible contacts</p><p className="text-xs text-neutral-500 mt-1">Previously sent and suppressed contacts are excluded.</p></div>}
            <label className="block text-sm font-medium">Maximum recipients<input type="number" min={1} max={previewCount ?? 20000} value={quantity} onChange={(event) => setQuantity(Math.min(previewCount ?? 20000, Math.max(1, Number(event.target.value))))} className="mt-1.5 w-full px-3 py-2.5 border border-neutral-200 rounded-lg" /></label>
            {feedback && <div role={feedback.success ? "status" : "alert"} className={`flex gap-2 p-3 rounded-lg text-sm ${feedback.success ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700"}`}><AlertCircle size={16} className="shrink-0 mt-0.5" />{feedback.message}</div>}
            <p className="text-xs text-neutral-500">Scheduling uses 1 credit, then each SMTP send attempt uses 1 credit. Queued campaigns pause automatically until the daily reset if credits run out.</p>
            <footer className="flex flex-wrap gap-2 pt-2"><button onClick={() => void dispatch()} disabled={busy || !config || previewCount === null} className="inline-flex items-center gap-2 px-4 py-2.5 bg-primary-600 text-white rounded-lg text-sm font-medium disabled:opacity-50"><Clock size={15} />Queue for adaptive dispatch</button></footer>
          </div>
        </section>
      </div>}
    </div>
  );
}