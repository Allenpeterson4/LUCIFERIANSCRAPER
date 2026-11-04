import { useEffect, useState } from "react";
import {
  History as HistoryIcon,
  Loader2,
  Trash2,
  Globe,
  Mail,
  Layers,
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  AlertCircle,
  Inbox,
  Calendar,
  Download,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import type { ScrapingRun, ScrapeResult } from "@/lib/types";
import type { View } from "@/components/Header";

export function HistoryView({ onNavigate }: { onNavigate: (v: View) => void }) {
  const { user } = useAuth();
  const [runs, setRuns] = useState<ScrapingRun[]>([]);
  const [resultsByRun, setResultsByRun] = useState<Record<string, ScrapeResult[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    loadRuns();
  }, []);

  const loadRuns = async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
      .from("scraping_runs")
      .select("*")
      .order("created_at", { ascending: false });

    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }
    setRuns((data as ScrapingRun[]) ?? []);
    setLoading(false);
  };

  const loadResults = async (runId: string) => {
    if (resultsByRun[runId]) return;
    const { data } = await supabase
      .from("scrape_results")
      .select("*")
      .eq("run_id", runId)
      .order("created_at", { ascending: true });
    if (data) {
      setResultsByRun((prev) => ({ ...prev, [runId]: data as ScrapeResult[] }));
    }
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

  const escapeCsv = (val: string): string => {
    const needsQuotes = val.includes(",") || val.includes('"') || val.includes("\n");
    if (needsQuotes) {
      return '"' + val.replace(/"/g, '""') + '"';
    }
    return val;
  };

  const exportCsv = async () => {
    const allRows: string[] = [
      "Run Date,Run Type,Domain,Status,Emails,Pages Scanned,Error",
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
          `${escapeCsv(dateStr)},${escapeCsv(runType)},${escapeCsv(run.domain)},${escapeCsv(run.status)},0,0,`
        );
        continue;
      }
      for (const res of resList) {
        const emailsJoined = res.emails.join("; ");
        allRows.push(
          `${escapeCsv(dateStr)},${escapeCsv(runType)},${escapeCsv(res.domain)},${escapeCsv(res.status)},${escapeCsv(emailsJoined)},${res.pages_scanned},${escapeCsv(res.error ?? "")}`
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
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold mb-2">Scraping history</h1>
          <p className="text-neutral-600">
            Every scraping run tied to your account, with full results.
          </p>
        </div>
        <button
          onClick={exportCsv}
          disabled={runs.length === 0}
          className="flex items-center gap-2 bg-white border border-neutral-200 hover:border-neutral-300 text-neutral-700 font-medium px-5 py-2.5 rounded-lg transition-colors text-sm disabled:opacity-50"
        >
          <Download size={16} />
          Export CSV
        </button>
        <button
          onClick={() => onNavigate("scrape")}
          className="flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white font-medium px-5 py-2.5 rounded-lg transition-colors text-sm"
        >
          <Mail size={16} />
          New scrape
        </button>
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
          <p className="text-neutral-500 text-sm mb-5">
            Run your first scrape to see results saved here automatically.
          </p>
          <button
            onClick={() => onNavigate("scrape")}
            className="inline-flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white font-medium px-5 py-2.5 rounded-lg transition-colors text-sm"
          >
            <Mail size={16} />
            Start scraping
          </button>
        </div>
      )}

      {!loading && runs.length > 0 && (
        <div className="space-y-3">
          {runs.map((run) => {
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
                          {run.is_bulk ? "Bulk run" : run.domain}
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
                      </div>
                    </div>
                  </button>
                  <div className="flex items-center gap-4 shrink-0">
                    <div className="text-right hidden sm:block">
                      <div className="text-sm font-semibold text-neutral-800">
                        {run.total_emails}
                      </div>
                      <div className="text-xs text-neutral-400">emails</div>
                    </div>
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
      )}
    </div>
  );
}
