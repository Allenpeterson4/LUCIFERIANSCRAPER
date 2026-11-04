import { useEffect, useState, useCallback } from "react";
import {
  Settings,
  Send,
  Plus,
  Trash2,
  Edit2,
  Check,
  X,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Clock,
  Server,
  FileText,
  Zap,
  ListChecks,
  RefreshCw,
  Inbox,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { testSmtpConnection, sendEmailsNow, processQueueBatch } from "@/lib/smtp";
import type { SmtpConfig, EmailMessage, CampaignQueueItem } from "@/lib/smtp-types";

type Tab = "config" | "messages" | "queue";

export function SmtpPage() {
  const { session } = useAuth();
  const [tab, setTab] = useState<Tab>("config");

  // SMTP config state
  const [config, setConfig] = useState<SmtpConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [host, setHost] = useState("");
  const [port, setPort] = useState(587);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [encryption, setEncryption] = useState("tls");
  const [fromEmail, setFromEmail] = useState("");
  const [fromName, setFromName] = useState("");
  const [savingConfig, setSavingConfig] = useState(false);
  const [testingConfig, setTestingConfig] = useState(false);
  const [configMessage, setConfigMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Messages state
  const [messages, setMessages] = useState<EmailMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(true);
  const [editingMsg, setEditingMsg] = useState<EmailMessage | null>(null);
  const [msgSubject, setMsgSubject] = useState("");
  const [msgBody, setMsgBody] = useState("");
  const [savingMsg, setSavingMsg] = useState(false);
  const [msgError, setMsgError] = useState<string | null>(null);

  // Queue state
  const [queue, setQueue] = useState<CampaignQueueItem[]>([]);
  const [queueLoading, setQueueLoading] = useState(true);
  const [processingQueue, setProcessingQueue] = useState(false);
  const [queueMessage, setQueueMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Send modal state
  const [sendModalOpen, setSendModalOpen] = useState(false);
  const [sendMsgId, setSendMsgId] = useState<string | null>(null);
  const [sendRecipients, setSendRecipients] = useState("");
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const loadConfig = useCallback(async () => {
    setConfigLoading(true);
    const { data } = await supabase
      .from("smtp_configs")
      .select("*")
      .eq("is_active", true)
      .maybeSingle();
    if (data) {
      const c = data as SmtpConfig;
      setConfig(c);
      setHost(c.host);
      setPort(c.port);
      setUsername(c.username);
      setPassword(c.password);
      setEncryption(c.encryption);
      setFromEmail(c.from_email);
      setFromName(c.from_name || "");
    }
    setConfigLoading(false);
  }, []);

  const loadMessages = useCallback(async () => {
    setMessagesLoading(true);
    const { data } = await supabase
      .from("email_messages")
      .select("*")
      .order("updated_at", { ascending: false });
    setMessages((data as EmailMessage[]) ?? []);
    setMessagesLoading(false);
  }, []);

  const loadQueue = useCallback(async () => {
    setQueueLoading(true);
    const { data } = await supabase
      .from("campaign_queue")
      .select("*")
      .order("created_at", { ascending: false });
    setQueue((data as CampaignQueueItem[]) ?? []);
    setQueueLoading(false);
  }, []);

  useEffect(() => {
    loadConfig();
    loadMessages();
    loadQueue();
  }, [loadConfig, loadMessages, loadQueue]);

  const handleSaveConfig = async () => {
    setSavingConfig(true);
    setConfigMessage(null);
    if (!host || !username || !fromEmail) {
      setConfigMessage({ type: "error", text: "Host, username, and from email are required." });
      setSavingConfig(false);
      return;
    }
    const payload = {
      host, port: Number(port), username, password,
      encryption, from_email: fromEmail, from_name: fromName,
      is_active: true,
    };
    let err;
    if (config) {
      ({ error: err } = await supabase.from("smtp_configs").update(payload).eq("id", config.id));
    } else {
      ({ error: err } = await supabase.from("smtp_configs").insert(payload));
    }
    setSavingConfig(false);
    if (err) {
      setConfigMessage({ type: "error", text: err.message });
    } else {
      setConfigMessage({ type: "success", text: "SMTP settings saved successfully." });
      loadConfig();
    }
  };

  const handleTestConfig = async () => {
    if (!session) return;
    setTestingConfig(true);
    setConfigMessage(null);
    const result = await testSmtpConnection(session.access_token, config?.id);
    setTestingConfig(false);
    setConfigMessage({ type: result.success ? "success" : "error", text: result.message });
  };

  const handleSaveMessage = async () => {
    setMsgError(null);
    if (!msgSubject.trim() || !msgBody.trim()) {
      setMsgError("Subject and body are required.");
      return;
    }
    setSavingMsg(true);
    let err;
    if (editingMsg) {
      ({ error: err } = await supabase
        .from("email_messages")
        .update({ subject: msgSubject, body: msgBody, updated_at: new Date().toISOString() })
        .eq("id", editingMsg.id));
    } else {
      ({ error: err } = await supabase
        .from("email_messages")
        .insert({ subject: msgSubject, body: msgBody }));
    }
    setSavingMsg(false);
    if (err) {
      setMsgError(err.message);
      return;
    }
    setEditingMsg(null);
    setMsgSubject("");
    setMsgBody("");
    loadMessages();
  };

  const handleEditMessage = (msg: EmailMessage) => {
    setEditingMsg(msg);
    setMsgSubject(msg.subject);
    setMsgBody(msg.body);
    setMsgError(null);
  };

  const handleDeleteMessage = async (id: string) => {
    await supabase.from("email_messages").delete().eq("id", id);
    loadMessages();
  };

  const handleCancelEdit = () => {
    setEditingMsg(null);
    setMsgSubject("");
    setMsgBody("");
    setMsgError(null);
  };

  const openSendModal = (msgId: string) => {
    setSendMsgId(msgId);
    setSendRecipients("");
    setSendResult(null);
    setSendModalOpen(true);
  };

  const handleQueueSubmit = async (addToQueue: boolean) => {
    if (!session || !sendMsgId || !config) return;
    const recipients = sendRecipients.split(/[\n,\s]+/).map((r) => r.trim()).filter(Boolean);
    if (recipients.length === 0) {
      setSendResult({ type: "error", text: "Please enter at least one recipient email." });
      return;
    }
    if (addToQueue) {
      setSending(true);
      setSendResult(null);
      const result = await sendEmailsNow(session.access_token, sendMsgId, recipients, config.id);
      setSending(false);
      setSendResult({ type: result.success ? "success" : "error", text: result.message });
      if (result.success) loadQueue();
    } else {
      setSending(true);
      setSendResult(null);
      const result = await sendEmailsNow(session.access_token, sendMsgId, recipients, config.id);
      setSending(false);
      setSendResult({ type: result.success ? "success" : "error", text: result.message });
      if (result.success) loadQueue();
    }
  };

  const handleProcessQueue = async () => {
    if (!session) return;
    setProcessingQueue(true);
    setQueueMessage(null);
    const result = await processQueueBatch(session.access_token);
    setProcessingQueue(false);
    setQueueMessage({ type: result.success ? "success" : "error", text: result.message });
    loadQueue();
  };

  const handleDeleteQueueItem = async (id: string) => {
    await supabase.from("campaign_queue").delete().eq("id", id);
    loadQueue();
  };

  const formatDate = (iso: string) => new Date(iso).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });

  const tabButton = (label: string, target: Tab, icon: React.ReactNode) => (
    <button
      onClick={() => setTab(target)}
      className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
        tab === target
          ? "bg-primary-600 text-white shadow-sm"
          : "text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100"
      }`}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10 animate-fade-in">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">SMTP & Messages</h1>
        <p className="text-neutral-600">
          Configure your SMTP server, draft email messages, and send or schedule campaigns.
        </p>
      </div>

      {/* Tab bar */}
      <div className="flex flex-wrap gap-2 mb-6 p-1.5 bg-white rounded-xl border border-neutral-200">
        {tabButton("SMTP Configuration", "config", <Server size={16} />)}
        {tabButton("Message Manager", "messages", <FileText size={16} />)}
        {tabButton("Queue & Scheduler", "queue", <ListChecks size={16} />)}
      </div>

      {/* --- SMTP CONFIG TAB --- */}
      {tab === "config" && (
        <div className="bg-white rounded-2xl border border-neutral-200 p-6 animate-fade-in">
          {configLoading ? (
            <div className="flex items-center gap-2 text-neutral-400 py-8">
              <Loader2 size={20} className="animate-spin" /> Loading settings...
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 mb-5">
                <Settings size={20} className="text-primary-600" />
                <h2 className="text-lg font-semibold">SMTP Server Settings</h2>
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-1.5">Host</label>
                  <input type="text" value={host} onChange={(e) => setHost(e.target.value)}
                    placeholder="smtp.gmail.com"
                    className="w-full px-4 py-2.5 rounded-lg border border-neutral-200 focus:border-primary-500 focus:ring-2 focus:ring-primary-100 outline-none transition-all text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-1.5">Port</label>
                  <input type="number" value={port} onChange={(e) => setPort(Number(e.target.value))}
                    className="w-full px-4 py-2.5 rounded-lg border border-neutral-200 focus:border-primary-500 focus:ring-2 focus:ring-primary-100 outline-none transition-all text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-1.5">Username</label>
                  <input type="text" value={username} onChange={(e) => setUsername(e.target.value)}
                    placeholder="your@email.com"
                    className="w-full px-4 py-2.5 rounded-lg border border-neutral-200 focus:border-primary-500 focus:ring-2 focus:ring-primary-100 outline-none transition-all text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-1.5">Password</label>
                  <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full px-4 py-2.5 rounded-lg border border-neutral-200 focus:border-primary-500 focus:ring-2 focus:ring-primary-100 outline-none transition-all text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-1.5">Encryption</label>
                  <select value={encryption} onChange={(e) => setEncryption(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-lg border border-neutral-200 focus:border-primary-500 focus:ring-2 focus:ring-primary-100 outline-none transition-all text-sm bg-white">
                    <option value="tls">STARTTLS (recommended)</option>
                    <option value="ssl">SSL/TLS</option>
                    <option value="none">None</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-1.5">From Email</label>
                  <input type="email" value={fromEmail} onChange={(e) => setFromEmail(e.target.value)}
                    placeholder="noreply@yourcompany.com"
                    className="w-full px-4 py-2.5 rounded-lg border border-neutral-200 focus:border-primary-500 focus:ring-2 focus:ring-primary-100 outline-none transition-all text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-1.5">From Name (optional)</label>
                  <input type="text" value={fromName} onChange={(e) => setFromName(e.target.value)}
                    placeholder="Your Company"
                    className="w-full px-4 py-2.5 rounded-lg border border-neutral-200 focus:border-primary-500 focus:ring-2 focus:ring-primary-100 outline-none transition-all text-sm" />
                </div>
              </div>

              {configMessage && (
                <div className={`flex items-start gap-2 mt-4 rounded-lg px-3 py-2 text-sm animate-slide-in ${
                  configMessage.type === "success" ? "bg-accent-50 text-accent-700" : "bg-red-50 text-red-700"
                }`}>
                  {configMessage.type === "success" ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : <AlertCircle size={16} className="mt-0.5 shrink-0" />}
                  {configMessage.text}
                </div>
              )}

              <div className="flex items-center gap-3 mt-5">
                <button onClick={handleSaveConfig} disabled={savingConfig}
                  className="flex items-center gap-2 bg-primary-600 hover:bg-primary-700 disabled:opacity-60 text-white font-medium px-5 py-2.5 rounded-lg transition-colors text-sm">
                  {savingConfig ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                  Save settings
                </button>
                <button onClick={handleTestConfig} disabled={testingConfig || !config}
                  className="flex items-center gap-2 bg-white border border-neutral-200 hover:border-neutral-300 text-neutral-700 font-medium px-5 py-2.5 rounded-lg transition-colors text-sm disabled:opacity-50">
                  {testingConfig ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />}
                  Test connection
                </button>
                {!config && (
                  <span className="text-xs text-neutral-400">Save settings before testing</span>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* --- MESSAGE MANAGER TAB --- */}
      {tab === "messages" && (
        <div className="space-y-6 animate-fade-in">
          {/* Editor */}
          <div className="bg-white rounded-2xl border border-neutral-200 p-6">
            <div className="flex items-center gap-2 mb-4">
              {editingMsg ? <Edit2 size={20} className="text-primary-600" /> : <Plus size={20} className="text-primary-600" />}
              <h2 className="text-lg font-semibold">{editingMsg ? "Edit message" : "New message"}</h2>
              {editingMsg && (
                <button onClick={handleCancelEdit} className="ml-auto flex items-center gap-1 text-sm text-neutral-400 hover:text-neutral-700 transition-colors">
                  <X size={15} /> Cancel
                </button>
              )}
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-1.5">Subject</label>
                <input type="text" value={msgSubject} onChange={(e) => setMsgSubject(e.target.value)}
                  placeholder="Email subject line"
                  className="w-full px-4 py-2.5 rounded-lg border border-neutral-200 focus:border-primary-500 focus:ring-2 focus:ring-primary-100 outline-none transition-all text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-1.5">Body</label>
                <textarea value={msgBody} onChange={(e) => setMsgBody(e.target.value)}
                  placeholder="Write your email message here..."
                  rows={8}
                  className="w-full px-4 py-2.5 rounded-lg border border-neutral-200 focus:border-primary-500 focus:ring-2 focus:ring-primary-100 outline-none transition-all text-sm resize-y" />
              </div>
              {msgError && (
                <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 animate-slide-in">
                  <AlertCircle size={16} /> {msgError}
                </div>
              )}
              <button onClick={handleSaveMessage} disabled={savingMsg}
                className="flex items-center gap-2 bg-primary-600 hover:bg-primary-700 disabled:opacity-60 text-white font-medium px-5 py-2.5 rounded-lg transition-colors text-sm">
                {savingMsg ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                {editingMsg ? "Update message" : "Save message"}
              </button>
            </div>
          </div>

          {/* Saved messages */}
          <div>
            <h3 className="text-sm font-semibold text-neutral-500 uppercase tracking-wide mb-3">Saved Messages</h3>
            {messagesLoading ? (
              <div className="flex items-center gap-2 text-neutral-400 py-6">
                <Loader2 size={18} className="animate-spin" /> Loading messages...
              </div>
            ) : messages.length === 0 ? (
              <div className="bg-white rounded-2xl border border-neutral-200 p-8 text-center">
                <Inbox size={32} className="text-neutral-300 mx-auto mb-2" />
                <p className="text-neutral-500 text-sm">No saved messages yet. Draft one above.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {messages.map((msg) => (
                  <div key={msg.id} className="bg-white rounded-xl border border-neutral-200 p-5">
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="min-w-0 flex-1">
                        <h4 className="font-semibold text-neutral-800 truncate">{msg.subject}</h4>
                        <p className="text-sm text-neutral-500 line-clamp-2 mt-1">{msg.body}</p>
                        <p className="text-xs text-neutral-400 mt-2">Updated {formatDate(msg.updated_at)}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mt-3">
                      <button onClick={() => handleEditMessage(msg)}
                        className="flex items-center gap-1.5 text-sm font-medium text-neutral-600 hover:text-primary-600 px-3 py-1.5 rounded-lg hover:bg-neutral-100 transition-colors">
                        <Edit2 size={14} /> Edit
                      </button>
                      <button onClick={() => openSendModal(msg.id)}
                        className="flex items-center gap-1.5 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 px-3 py-1.5 rounded-lg transition-colors">
                        <Send size={14} /> Send
                      </button>
                      <button onClick={() => handleDeleteMessage(msg.id)}
                        className="flex items-center gap-1.5 text-sm font-medium text-neutral-400 hover:text-red-600 px-3 py-1.5 rounded-lg hover:bg-red-50 transition-colors ml-auto">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* --- QUEUE TAB --- */}
      {tab === "queue" && (
        <div className="space-y-6 animate-fade-in">
          <div className="bg-white rounded-2xl border border-neutral-200 p-6">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
              <div className="flex items-center gap-2">
                <ListChecks size={20} className="text-primary-600" />
                <h2 className="text-lg font-semibold">Campaign Queue</h2>
              </div>
              <button onClick={handleProcessQueue} disabled={processingQueue}
                className="flex items-center gap-2 bg-primary-600 hover:bg-primary-700 disabled:opacity-60 text-white font-medium px-4 py-2 rounded-lg transition-colors text-sm">
                {processingQueue ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                Process next batch
              </button>
            </div>
            <div className="bg-neutral-50 rounded-lg p-4 text-sm text-neutral-600 mb-4">
              <p className="flex items-center gap-2">
                <Clock size={15} className="text-primary-600" />
                Campaigns dispatch automatically. The rate adapts to successful delivery and provider throttling, then resumes when the provider allows.
              </p>
            </div>
            {queueMessage && (
              <div className={`flex items-start gap-2 mb-4 rounded-lg px-3 py-2 text-sm animate-slide-in ${
                queueMessage.type === "success" ? "bg-accent-50 text-accent-700" : "bg-red-50 text-red-700"
              }`}>
                {queueMessage.type === "success" ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : <AlertCircle size={16} className="mt-0.5 shrink-0" />}
                {queueMessage.text}
              </div>
            )}
            {queueLoading ? (
              <div className="flex items-center gap-2 text-neutral-400 py-6">
                <Loader2 size={18} className="animate-spin" /> Loading queue...
              </div>
            ) : queue.length === 0 ? (
              <div className="text-center py-8">
                <Inbox size={32} className="text-neutral-300 mx-auto mb-2" />
                <p className="text-neutral-500 text-sm">No campaigns queued. Send a message and choose "Add to queue" to create one.</p>
                <button onClick={() => { setTab("messages"); }}
                  className="mt-3 flex items-center gap-2 text-sm font-medium text-primary-600 hover:text-primary-700 mx-auto">
                  <FileText size={15} /> Go to messages
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {queue.map((item) => {
                  const total = item.recipients.length;
                  const processed = item.total_sent + item.total_failed;
                  const pct = total > 0 ? Math.round((processed / total) * 100) : 0;
                  return (
                    <div key={item.id} className="border border-neutral-200 rounded-xl p-4">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                            item.status === "completed" ? "bg-accent-50 text-accent-700"
                            : item.status === "failed" ? "bg-red-50 text-red-600"
                            : item.status === "sending" ? "bg-primary-50 text-primary-700"
                            : "bg-neutral-100 text-neutral-500"
                          }`}>{item.status}</span>
                          <span className="text-sm text-neutral-500">{total} recipients</span>
                        </div>
                        <button onClick={() => handleDeleteQueueItem(item.id)}
                          className="text-neutral-400 hover:text-red-600 transition-colors p-1.5 rounded-lg hover:bg-red-50">
                          <Trash2 size={15} />
                        </button>
                      </div>
                      <div className="grid grid-cols-3 gap-3 mb-3 text-center">
                        <div className="bg-neutral-50 rounded-lg py-2">
                          <div className="text-lg font-bold text-neutral-800">{item.total_sent}</div>
                          <div className="text-xs text-neutral-400">sent</div>
                        </div>
                        <div className="bg-neutral-50 rounded-lg py-2">
                          <div className="text-lg font-bold text-neutral-800">{item.total_failed}</div>
                          <div className="text-xs text-neutral-400">failed</div>
                        </div>
                        <div className="bg-neutral-50 rounded-lg py-2">
                          <div className="text-lg font-bold text-neutral-800">{total - processed}</div>
                          <div className="text-xs text-neutral-400">remaining</div>
                        </div>
                      </div>
                      <div className="w-full bg-neutral-100 rounded-full h-2 mb-2">
                        <div className="bg-primary-600 h-2 rounded-full transition-all" style={{ width: `${pct}%` }} />
                      </div>
                      <div className="flex items-center justify-between text-xs text-neutral-400">
                        <span>Adaptive delivery</span>
                        <span>Created {formatDate(item.created_at)}</span>
                      </div>
                      {item.next_batch_at && (
                        <p className="text-xs text-primary-600 mt-1 flex items-center gap-1">
                          <Clock size={12} /> Next batch: {formatDate(item.next_batch_at)}
                        </p>
                      )}
                      {item.error && (
                        <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                          <AlertCircle size={12} /> {item.error}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* --- SEND MODAL --- */}
      {sendModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in">
          <div className="absolute inset-0 bg-neutral-950/60 backdrop-blur-sm" onClick={() => setSendModalOpen(false)} />
          <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl animate-fade-up">
            <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-100">
              <h3 className="font-semibold flex items-center gap-2"><Send size={18} className="text-primary-600" /> Send message</h3>
              <button onClick={() => setSendModalOpen(false)} className="text-neutral-400 hover:text-neutral-700 transition-colors">
                <X size={20} />
              </button>
            </div>
            <div className="p-6">
              <label className="block text-sm font-medium text-neutral-700 mb-1.5">Recipients</label>
              <p className="text-xs text-neutral-400 mb-2">One per line, or comma/space separated</p>
              <textarea value={sendRecipients} onChange={(e) => setSendRecipients(e.target.value)}
                placeholder={"recipient1@email.com\nrecipient2@email.com"}
                rows={6}
                className="w-full px-4 py-2.5 rounded-lg border border-neutral-200 focus:border-primary-500 focus:ring-2 focus:ring-primary-100 outline-none transition-all text-sm font-mono resize-y" />
              {sendResult && (
                <div className={`flex items-start gap-2 mt-3 rounded-lg px-3 py-2 text-sm animate-slide-in ${
                  sendResult.type === "success" ? "bg-accent-50 text-accent-700" : "bg-red-50 text-red-700"
                }`}>
                  {sendResult.type === "success" ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : <AlertCircle size={16} className="mt-0.5 shrink-0" />}
                  {sendResult.text}
                </div>
              )}
              <div className="flex items-center gap-3 mt-5">
                <button onClick={() => handleQueueSubmit(false)} disabled={sending}
                  className="flex-1 flex items-center justify-center gap-2 bg-primary-600 hover:bg-primary-700 disabled:opacity-60 text-white font-medium py-2.5 rounded-lg transition-colors text-sm">
                  {sending ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />}
                  Queue send
                </button>
                <button onClick={() => handleQueueSubmit(true)}
                  className="flex-1 flex items-center justify-center gap-2 bg-white border border-neutral-200 hover:border-neutral-300 text-neutral-700 font-medium py-2.5 rounded-lg transition-colors text-sm">
                  <Clock size={16} />
                  Add to queue
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
