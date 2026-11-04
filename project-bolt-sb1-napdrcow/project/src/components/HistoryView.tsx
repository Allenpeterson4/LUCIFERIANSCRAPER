import { useCallback, useEffect, useState } from "react";
import {
  Loader2,
  Trash2,
  Globe,
  Layers,
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  AlertCircle,
  Inbox,
  Calendar,
  Download,
  Printer,
  Send,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { ScrapeCampaignBatch, ScrapingRun, ScrapeResult } from "@/lib/types";

interface HistoryViewProps {
  sourceType: "website" | "maps";
  onSendCampaign?: (batch: ScrapeCampaignBatch) => void;
}

export function HistoryView({ sourceType, onSendCampaign }: HistoryViewProps) {
  const [runs, setRuns] = useState<ScrapingRun[]>([]);
  const [resultsByRun, setResultsByRun] = useState<Record<string, ScrapeResult[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [dateFilter, setDateFilter] = useState("");

  const loadRuns = useCallback(async () => {
    setLoading(true);
    setError(null);
    let query = supabase
      .from("scraping_runs")
      .select("*")
      .eq("source_type", sourceType)
      .order("created_at", { ascending: false });
    if (dateFilter) {
      const start = new Date(`${dateFilter}T00:00:00`);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      query = query.gte("created_at", start.toISOString()).lt("created_at", end.toISOString());
    }
    const { data, error: err } = await query;

    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }
    setRuns((data as ScrapingRun[]) ?? []);
    setLoading(false);
  }, [sourceType, dateFilter]);

  useEffect(() => { void loadRuns(); }, [loadRuns]);

  const loadResults = async (runId: string) => {
    if (resultsByRun[runId]) return resultsByRun[runId];
    const { data, error: resultsError } = await supabase
      .from("scrape_results")
      .select("*")
      .eq("run_id", runId)
      .order("created_at", { ascending: true });
    if (resultsError) setError(resultsError.message);
    const results = (data as ScrapeResult[]) ?? [];
    setResultsByRun((prev) => ({ ...prev, [runId]: results }));
    return results;
  };

  const toggleRun = (runId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(runId)) {
        next.delete(runId);
      } else {
        next.add(runId);
        loadResults(runId);
      }
      return next;
    });
  };

  const copyEmail = async (email: string) => {
    try {
      await navigator.clipboard.writeText(email);
      setCopied(email);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // clipboard unavailable
    }
  };

  const deleteRun = async (runId: string) => {
    setDeleting(runId);
    const { error: err } = await supabase
      .from("scraping_runs")
      .delete()
      .eq("id", runId);
    setDeleting(null);
    if (err) {
      setError(err.message);
      return;
    }
    setRuns((prev) => prev.filter((r) => r.id !== runId));
    setResultsByRun((prev) => {
      const next = { ...prev };
      delete next[runId];
      return next;
    });
    setExpanded((prev) => {
      const next = new Set(prev);
      next.delete(runId);
      return next;
    });
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const groupedRuns = () => {
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const groups = new Map<string, ScrapingRun[]>();
    for (const run of runs) {
      const date = new Date(run.created_at);
      const key = date.toDateString() === today.toDateString()
        ? "Today’s scrapes"
        : date.toDateString() === yesterday.toDateString()
          ? "Yesterday’s scrapes"
          : date.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
      groups.set(key, [...(groups.get(key) ?? []), run]);
    }
    return [...groups.entries()];
  };

  const escapeCsv = (val: string): string => {
    const needsQuotes = val.includes(",") || val.includes('"') || val.includes("\n");
    if (needsQuotes) {
      return '"' + val.replace(/"/g, '""') + '"';
    }
    return val;
  };

  const exportRunCsv = async (run: ScrapingRun) => {
    const results = await loadResults(run.id);
    const rows = ["Extracted At,Batch,Target,Domain,Email,Status,Pages Scanned"];
    for (const result of results) {
      if (result.emails.length === 0) {
        rows.push([formatDate(run.created_at), run.batch_label || run.domain, run.source_query || run.domain, result.domain, "", result.status, String(result.pages_scanned)].map(escapeCsv).join(","));
      } else {
        for (const email of result.emails) rows.push([formatDate(run.created_at), run.batch_label || run.domain, run.source_query || run.domain, result.domain, email, result.status, String(result.pages_scanned)].map(escapeCsv).join(","));
      }
    }
    const url = URL.createObjectURL(new Blob([rows.join("\r\n")], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `mailharvest-${sourceType}-batch-${run.id}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const exportRunPdf = async (run: ScrapingRun) => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      setError("Allow pop-ups to print this batch as a PDF.");
      return;
    }
    const results = await loadResults(run.id);
    const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
    const emails = results.flatMap((result) => result.emails);
    printWindow.document.write(`<!doctype html><title>Scrape batch</title><style>body{font:12px Arial,sans-serif;padding:24px;color:#111}h1{font-size:20px}p{margin:5px 0}table{width:100%;border-collapse:collapse;margin-top:18px}td,th{text-align:left;padding:7px;border-bottom:1px solid #ddd;overflow-wrap:anywhere}</style><h1>${escapeHtml(run.batch_label || run.domain)}</h1><p>${escapeHtml(formatDate(run.created_at))}</p><p>${escapeHtml(run.source_query || run.domain)} · ${emails.length} emails</p><table><thead><tr><th>Domain</th><th>Email</th></tr></thead><tbody>${results.flatMap((result) => result.emails.map((email) => `<tr><td>${escapeHtml(result.domain)}</td><td>${escapeHtml(email)}</td></tr>`)).join("")}</tbody></table>`);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  };

  const sendRunCampaign = async (run: ScrapingRun) => {
    const results = await loadResults(run.id);
    const emails = [...new Set(results.flatMap((result) => result.emails.map((email) => email.toLowerCase())))];
    if (emails.length === 0) {
      setError("This batch has no email addresses to send to.");
      return;
    }
    onSendCampaign?.({ runId: run.id, batchLabel: run.batch_label || run.domain, emails });
  };

  const exportCsv = async () => {
    const allRows: string[] = [
      "Source,Batch Label,Search Query,Run Date,Domain,Status,Emails,Pages Scanned,Error",
    ];

    for (const run of runs) {
      let resList = resultsByRun[run.id];
      if (!resList) {
        const { data } = await supabase
          .from("scrape_results")
          .select("*")
          .eq("run_id", run.id)
          .order("created_at", { ascending: true });
        resList = (data as ScrapeResult[]) ?? [];
        if (resList.length > 0) {
          setResultsByRun((prev) => ({ ...prev, [run.id]: resList! }));
        }
      }
      const runType = run.is_bulk ? "Bulk" : "Single";
      const dateStr = formatDate(run.created_at);
      if (!resList || resList.length === 0) {
        allRows.push(
          `${escapeCsv(run.source_type)},${escapeCsv(run.batch_label || run.domain)},${escapeCsv(run.source_query ?? "")},${escapeCsv(dateStr)},${escapeCsv(run.domain)},${escapeCsv(run.status)},0,0,`
        );
        continue;
      }
      for (const res of resList) {
        const emailsJoined = res.emails.join("; ");
        allRows.push(
          `${escapeCsv(run.source_type)},${escapeCsv(run.batch_label || runType)},${escapeCsv(run.source_query ?? "")},${escapeCsv(dateStr)},${escapeCsv(res.domain)},${escapeCsv(res.status)},${escapeCsv(emailsJoined)},${res.pages_scanned},${escapeCsv(res.error ?? "")}`
        );
      }
    }

    const csv = allRows.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `mailharvest-history-${Date.now()}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10 animate-fade-in">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold mb-2">{sourceType === "maps" ? "Maps scraper history" : "Website scraper history"}</h1>
          <p className="text-neutral-600">
            Dated batches, extracted contacts, and campaign actions.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs font-medium text-neutral-500">Specific date<input type="date" value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} className="block mt-1 px-3 py-2 border border-neutral-200 rounded-lg bg-white text-sm text-neutral-800" /></label>
          {dateFilter && <button onClick={() => setDateFilter("")} className="px-3 py-2 border border-neutral-200 rounded-lg text-sm">Clear date</button>}
          <button onClick={exportCsv} disabled={runs.length === 0} className="inline-flex items-center gap-2 bg-white border border-neutral-200 hover:border-neutral-300 text-neutral-700 font-medium px-4 py-2.5 rounded-lg transition-colors text-sm disabled:opacity-50"><Download size={16} />Export CSV</button>
        </div>
      </div>

      {loading && (
        <div className="bg-white rounded-2xl border border-neutral-200 p-10 text-center">
          <Loader2 size={32} className="animate-spin text-primary-600 mx-auto mb-3" />
          <p className="text-neutral-500">Loading your history...</p>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-6">
          <AlertCircle size={20} className="text-red-600 shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {!loading && !error && runs.length === 0 && (
        <div className="bg-white rounded-2xl border border-neutral-200 p-12 text-center">
          <Inbox size={40} className="text-neutral-300 mx-auto mb-4" />
          <h3 className="font-semibold text-neutral-700 mb-1">No scraping history yet</h3>
          <p className="text-neutral-500 text-sm">Completed {sourceType === "maps" ? "Maps" : "website"} scrapes will appear here automatically.</p>
        </div>
      )}

      {!loading && runs.length > 0 && (
        <div className="space-y-7">
          {groupedRuns().map(([groupName, groupRuns]) => (
            <section key={groupName}>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">{groupName}</h2>
              <div className="space-y-3">
          {groupRuns.map((run) => {
            const results = resultsByRun[run.id];
            const isOpen = expanded.has(run.id);
            return (
              <div
                key={run.id}
                className="bg-white rounded-2xl border border-neutral-200 overflow-hidden"
              >
                <div className="flex items-center gap-3 px-5 py-4">
                  <button
                    onClick={() => toggleRun(run.id)}
                    className="flex items-center gap-3 flex-1 text-left min-w-0"
                  >
                    {isOpen ? (
                      <ChevronDown size={18} className="text-neutral-400 shrink-0" />
                    ) : (
                      <ChevronRight size={18} className="text-neutral-400 shrink-0" />
                    )}
                    <div
                      className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                        run.is_bulk ? "bg-primary-50 text-primary-600" : "bg-neutral-100 text-neutral-500"
                      }`}
                    >
                      {run.is_bulk ? <Layers size={18} /> : <Globe size={18} />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-neutral-800 truncate">
                          {run.batch_label || (run.is_bulk ? "Bulk run" : run.domain)}
                        </span>
                        <span
                          className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                            run.status === "completed"
                              ? "bg-accent-50 text-accent-700"
                              : run.status === "failed"
                              ? "bg-red-50 text-red-600"
                              : "bg-neutral-100 text-neutral-500"
                          }`}
                        >
                          {run.status}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 text-xs text-neutral-400 mt-0.5">
                        <Calendar size={12} />
                        {formatDate(run.created_at)}
                        <span className="ml-2 truncate">{run.source_query || run.domain}</span>
                      </div>
                    </div>
                  </button>
                  <div className="flex flex-wrap items-center justify-end gap-1 shrink-0">
                    <div className="text-right hidden sm:block">
                      <div className="text-sm font-semibold text-neutral-800">
                        {run.total_emails}
                      </div>
                      <div className="text-xs text-neutral-400">emails</div>
                    </div>
                    <button onClick={() => void exportRunCsv(run)} title="Export batch CSV" aria-label="Export batch CSV" className="inline-flex items-center gap-1 px-2 py-1.5 border border-neutral-200 rounded text-xs"><Download size={14} />CSV</button>
                    <button onClick={() => void exportRunPdf(run)} title="Export batch PDF" aria-label="Export batch PDF" className="inline-flex items-center gap-1 px-2 py-1.5 border border-neutral-200 rounded text-xs"><Printer size={14} />PDF</button>
                    {onSendCampaign && <button onClick={() => void sendRunCampaign(run)} className="inline-flex items-center gap-1 px-2 py-1.5 bg-primary-600 text-white rounded text-xs"><Send size={14} />Send Campaign</button>}
                    <button
                      onClick={() => deleteRun(run.id)}
                      disabled={deleting === run.id}
                      className="text-neutral-400 hover:text-red-600 transition-colors p-2 rounded-lg hover:bg-red-50 disabled:opacity-50"
                      aria-label="Delete run"
                    >
                      {deleting === run.id ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : (
                        <Trash2 size={16} />
                      )}
                    </button>
                  </div>
                </div>

                {isOpen && (
                  <div className="border-t border-neutral-100 px-5 py-4 animate-slide-in">
                    {!results ? (
                      <div className="flex items-center gap-2 text-sm text-neutral-400 py-3">
                        <Loader2 size={16} className="animate-spin" />
                        Loading results...
                      </div>
                    ) : results.length === 0 ? (
                      <p className="text-sm text-neutral-500 py-3">No domain results found.</p>
                    ) : (
                      <div className="space-y-4">
                        {results.map((res) => (
                          <div key={res.id} className="border border-neutral-100 rounded-lg p-4">
                            <div className="flex items-center gap-2 mb-3">
                              <Globe size={15} className="text-primary-600 shrink-0" />
                              <span className="font-mono text-sm font-medium text-neutral-800">
                                {res.domain}
                              </span>
                              <span
                                className={`text-xs px-2 py-0.5 rounded-full ${
                                  res.status === "completed"
                                    ? "bg-accent-50 text-accent-700"
                                    : res.status === "no_emails"
                                    ? "bg-neutral-100 text-neutral-500"
                                    : "bg-red-50 text-red-600"
                                }`}
                              >
                                {res.emails.length} email{res.emails.length !== 1 ? "s" : ""}
                              </span>
                            </div>
                            {res.status === "failed" && res.error ? (
                              <p className="text-sm text-red-600 flex items-center gap-1.5">
                                <AlertCircle size={14} /> {res.error}
                              </p>
                            ) : res.emails.length === 0 ? (
                              <p className="text-sm text-neutral-500">
                                No emails found. Scanned {res.pages_scanned} page
                                {res.pages_scanned !== 1 ? "s" : ""}.
                              </p>
                            ) : (
                              <div className="grid sm:grid-cols-2 gap-2">
                                {res.emails.map((email) => (
                                  <div
                                    key={email}
                                    className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-neutral-50 border border-neutral-100 hover:border-primary-200 transition-colors"
                                  >
                                    <span className="font-mono text-sm text-neutral-800 truncate">
                                      {email}
                                    </span>
                                    <button
                                      onClick={() => copyEmail(email)}
                                      className="text-neutral-400 hover:text-primary-600 transition-colors shrink-0"
                                      aria-label="Copy email"
                                    >
                                      {copied === email ? (
                                        <Check size={14} className="text-accent-600" />
                                      ) : (
                                        <Copy size={14} />
                                      )}
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
