import { useEffect, useState } from "react";
import {
  Mail,
  Search,
  Layers,
  Loader2,
  AlertCircle,
  Copy,
  Check,
  Globe,
  FileText,
  ChevronDown,
  ChevronRight,
  Inbox,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { scrapeDomains, waitForScrapeRun, type ScrapeResponseData } from "@/lib/scrape";
import { HistoryView } from "@/components/HistoryView";
import { KeywordSearchPanel } from "@/components/KeywordSearchPanel";
import type { CompanyRecord, ScrapeCampaignBatch } from "@/lib/types";

interface DomainResult extends CompanyRecord {
  emails: string[];
  status: string;
  pages_scanned: number;
  error: string | null;
}

interface ScrapeToolProps {
  pendingDomains?: string[];
  pendingIntent?: string;
  onPendingConsumed?: () => void;
  onSendCampaign?: (batch: ScrapeCampaignBatch) => void;
}

function domainKey(value: string) {
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    return url.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return value.trim().toLowerCase();
  }
}

export function ScrapeTool({ pendingDomains, pendingIntent, onPendingConsumed, onSendCampaign }: ScrapeToolProps) {
  const { session } = useAuth();
  const [activeTab, setActiveTab] = useState<"single" | "bulk" | "history">("single");
  const [singleDomain, setSingleDomain] = useState("");
  const [bulkInput, setBulkInput] = useState("");
  const [automaticIntent, setAutomaticIntent] = useState("");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<{ current: number; completed: number; total: number; domain: string; phase: "queued" | "processing" | "completed" } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<DomainResult[] | null>(null);
  const [totalEmails, setTotalEmails] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => {
    if (pendingDomains && pendingDomains.length > 0) {
      setActiveTab("bulk");
      setBulkInput(pendingDomains.join("\n"));
      setAutomaticIntent(pendingIntent ?? "");
      onPendingConsumed?.();
    }
  }, [pendingDomains, pendingIntent, onPendingConsumed]);

  const parseDomains = (): string[] => {
    const submitted = activeTab === "single"
      ? [singleDomain]
      : bulkInput
        .replace(/(?=https?:\/\/)/gi, "\n")
        .split(/[\n,;\s]+/);
    const seen = new Set<string>();
    return submitted
      .map((d) => d.trim())
      .filter((domain) => {
        if (!domain) return false;
        const key = domainKey(domain);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  };

  const handleScrape = async () => {
    const domains = parseDomains();
    if (domains.length === 0 || (domains.length === 1 && !domains[0])) {
      setError("Please enter at least one domain.");
      return;
    }
    setError(null);
    setLoading(true);
    setProgress(null);
    setResults(null);
    setTotalEmails(0);

    const batchLabel = domains.length > 1 ? `Bulk Domains ${new Date().toISOString()}` : undefined;
    try {
      if (!session) throw new Error("Sign in to start a scrape batch.");
      const queued = await scrapeDomains(domains, session.access_token, {
        intent: automaticIntent || undefined,
        sourceQuery: batchLabel,
        batchLabel,
      });
      window.dispatchEvent(new Event("credits-updated"));
      setProgress({ current: 1, completed: 0, total: queued.total_domains, domain: domains[0], phase: "queued" });
      const data: ScrapeResponseData = await waitForScrapeRun(
        queued.run_id,
        queued.total_domains,
        queued.source_type,
        setProgress,
      );
      const collectedResults = data.results as DomainResult[];
      setResults(collectedResults);
      setTotalEmails(data.total_emails);
      setExpanded(new Set(collectedResults.map((result) => result.domain)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not queue or load the scrape batch.");
    } finally {
      setLoading(false);
      setProgress(null);
    }
  };

  const toggleDomain = (domain: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(domain)) next.delete(domain);
      else next.add(domain);
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

  const copyAll = async (emails: string[]) => {
    try {
      await navigator.clipboard.writeText(emails.join("\n"));
      setCopied(`all-${emails[0]}`);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // clipboard unavailable
    }
  };

  const totalDomains = results?.length ?? 0;
  const successfulDomains = results?.filter((result) => result.status === "completed" && result.emails.length > 0).length ?? 0;
  const noEmailDomains = results?.filter((result) => result.status === "no_emails").length ?? 0;
  const notRelevantDomains = results?.filter((result) => result.status === "not_relevant").length ?? 0;
  const failedDomains = results?.filter((result) => result.status === "failed").length ?? 0;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10 animate-fade-in">
      <div className="mb-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-3xl font-bold">Scrape emails</h1>
        </div>
        <p className="text-neutral-600">
          Enter a domain or a list of domains. We'll crawl each one and extract every
          reachable email address. Each domain uses 1 credit.
        </p>
      </div>

      {/* Mode toggle */}
      <nav role="tablist" aria-label="Email scraper sections" className="mb-6 flex flex-wrap gap-1 border-b border-neutral-200">
        {([
          ["single", "Single domain", <Search size={16} />],
          ["bulk", "Bulk domains", <Layers size={16} />],
          ["history", "Email scraper history", <Inbox size={16} />],
        ] as const).map(([tab, label, icon]) => <button
          key={tab}
          role="tab"
          aria-selected={activeTab === tab}
          onClick={() => setActiveTab(tab)}
          className={`inline-flex items-center gap-2 px-4 py-3 border-b-2 text-sm font-medium ${activeTab === tab ? "border-primary-600 text-primary-700" : "border-transparent text-neutral-500 hover:text-neutral-800"}`}
        >{icon}{label}</button>)}
      </nav>

      {activeTab !== "history" && <KeywordSearchPanel
        destination="email-domain"
        onUseResult={(result) => {
          try {
            setSingleDomain(new URL(result.link).hostname.replace(/^www\./, ""));
            setActiveTab("single");
            setError(null);
          } catch {
            setError("This search result does not have a valid website address.");
          }
        }}
      />}

      {/* Input */}
      {activeTab !== "history" && <div className="bg-white rounded-2xl border border-neutral-200 p-6 mb-6">
        {activeTab === "single" ? (
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-2">
              Domain to analyze
            </label>
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1 relative">
                <Globe
                  size={18}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400"
                />
                <input
                  type="text"
                  value={singleDomain}
                  onChange={(e) => { setSingleDomain(e.target.value); setAutomaticIntent(""); }}
                  onKeyDown={(e) => e.key === "Enter" && !loading && handleScrape()}
                  placeholder="example.com"
                  className="w-full pl-10 pr-4 py-3 rounded-lg border border-neutral-200 focus:border-primary-500 focus:ring-2 focus:ring-primary-100 outline-none transition-all font-mono text-sm"
                />
              </div>
              <button
                onClick={handleScrape}
                disabled={loading}
                className="flex items-center justify-center gap-2 bg-primary-600 hover:bg-primary-700 disabled:opacity-60 text-white font-medium px-6 py-3 rounded-lg transition-colors"
              >
                {loading ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  <Mail size={18} />
                )}
                {loading ? "Scraping..." : "Extract emails"}
              </button>
            </div>
          </div>
        ) : (
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-2">
              Domains to analyze — one per line, or comma/space separated
            </label>
            <textarea
              value={bulkInput}
              onChange={(e) => { setBulkInput(e.target.value); setAutomaticIntent(""); }}
              placeholder={"Paste domains here, for example:\nexample.com\nanother.org third-company.co"}
              rows={7}
              className="w-full px-4 py-3 rounded-lg border border-neutral-200 focus:border-primary-500 focus:ring-2 focus:ring-primary-100 outline-none transition-all font-mono text-sm resize-y"
            />
            <div className="flex items-center justify-between mt-3">
              <span className="text-sm text-neutral-400">
                {parseDomains().length === 0
                  ? "Paste domains to begin"
                  : `${parseDomains().length} unique domain${parseDomains().length !== 1 ? "s" : ""} detected`}
              </span>
              <button
                onClick={handleScrape}
                disabled={loading || parseDomains().length === 0}
                className="flex items-center justify-center gap-2 bg-primary-600 hover:bg-primary-700 disabled:opacity-60 text-white font-medium px-6 py-3 rounded-lg transition-colors"
              >
                {loading ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  <Layers size={18} />
                )}
                {loading ? "Processing..." : "Scrape all domains"}
              </button>
            </div>
          </div>
        )}
      </div>}

      {error && (
        <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-6 animate-slide-in">
          <AlertCircle size={20} className="text-red-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-red-800 text-sm">Scraping error</p>
            <p className="text-red-700 text-sm mt-0.5">{error}</p>
          </div>
        </div>
      )}

      {/* Loading state */}
      {loading && activeTab !== "history" && (
        <div className="bg-white rounded-2xl border border-neutral-200 p-10 text-center animate-fade-in">
          <Loader2 size={36} className="animate-spin text-primary-600 mx-auto mb-4" />
          <p className="font-medium text-neutral-700">{progress ? `${progress.phase === "completed" ? "Completed" : progress.phase === "queued" ? "Queued" : "Processing"} ${progress.current} of ${progress.total}${progress.domain ? `: ${progress.domain}` : ""}` : "Starting domain queue..."}</p>
          <div className="mx-auto mt-4 h-2 max-w-md overflow-hidden rounded-full bg-neutral-100"><div className="h-full bg-primary-600 transition-[width] duration-300" style={{ width: `${progress?.total ? Math.round(progress.completed / progress.total * 100) : 0}%` }} /></div>
          <p className="mt-2 text-sm text-neutral-400">{progress ? `${progress.completed} of ${progress.total} domains complete` : "Preparing the batch..."}</p>
        </div>
      )}

      {/* Results */}
      {results && !loading && activeTab !== "history" && (
        <div className="space-y-4 animate-fade-in">
          <div className="flex items-center justify-between bg-white rounded-2xl border border-neutral-200 px-6 py-4">
            <div className="flex items-center gap-6">
              <div>
                <div className="text-2xl font-bold text-primary-600">{totalEmails}</div>
                <div className="text-xs text-neutral-500 uppercase tracking-wide">emails found</div>
              </div>
              <div className="h-10 w-px bg-neutral-200" />
              <div>
                <div className="text-2xl font-bold text-neutral-800">{totalDomains}</div>
                <div className="text-xs text-neutral-500 uppercase tracking-wide">domains scanned</div>
              </div>
            </div>
            <button
              onClick={() => setActiveTab("history")}
              className="text-sm font-medium text-primary-600 hover:text-primary-700 flex items-center gap-1.5"
            >
              View history
            </button>
          </div>

          <section aria-label="Batch result summary" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[["Successful", successfulDomains, "text-green-700"], ["No emails", noEmailDomains, "text-neutral-700"], ["Not relevant", notRelevantDomains, "text-amber-700"], ["Failed or invalid", failedDomains, "text-red-700"]].map(([label, count, color]) => <div key={label} className="rounded-lg border border-neutral-200 bg-white p-4">
              <p className="text-xs text-neutral-500">{label}</p><p className={`mt-1 text-xl font-semibold ${color}`}>{Number(count).toLocaleString()}</p>
            </div>)}
          </section>

          {results.length === 0 ? (
            <div className="bg-white rounded-2xl border border-neutral-200 p-10 text-center">
              <Inbox size={36} className="text-neutral-300 mx-auto mb-3" />
              <p className="text-neutral-500">No results returned.</p>
            </div>
          ) : (
            results.map((r) => (
              <div
                key={r.domain}
                className="bg-white rounded-2xl border border-neutral-200 overflow-hidden"
              >
                <button
                  onClick={() => toggleDomain(r.domain)}
                  className="w-full flex items-center gap-3 px-5 py-4 hover:bg-neutral-50 transition-colors text-left"
                >
                  {expanded.has(r.domain) ? (
                    <ChevronDown size={18} className="text-neutral-400 shrink-0" />
                  ) : (
                    <ChevronRight size={18} className="text-neutral-400 shrink-0" />
                  )}
                  <Globe size={18} className="text-primary-600 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">
                    <span className="block truncate font-medium text-neutral-800">{r.business_name}</span>
                    <span className="block truncate font-mono text-xs text-neutral-500">{r.domain}</span>
                  </span>
                  <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${r.status === "completed" && r.emails.length > 0 ? "bg-accent-50 text-accent-700" : r.status === "failed" ? "bg-red-50 text-red-600" : r.status === "not_relevant" ? "bg-amber-50 text-amber-700" : "bg-neutral-100 text-neutral-500"}`}>
                    {r.status === "failed" ? "Failed" : r.status === "not_relevant" ? "Not relevant" : r.status === "no_emails" ? "No emails" : `${r.emails.length} email${r.emails.length !== 1 ? "s" : ""}`}
                  </span>
                  <span className="text-xs text-neutral-400 hidden sm:flex items-center gap-1">
                    <FileText size={13} />
                    {r.pages_scanned} pages
                  </span>
                </button>

                {expanded.has(r.domain) && (
                  <div className="px-5 pb-5 pt-1 border-t border-neutral-100 animate-slide-in">
                    <div className="py-3">
                      <p className="text-xs font-medium text-primary-700">{r.category}</p>
                      <p className="mt-1 text-sm text-neutral-600">{r.service_summary}</p>
                    </div>
                    {r.status === "not_relevant" && r.error ? (
                      <p className="py-3 text-sm text-amber-700">{r.error}</p>
                    ) : r.status === "failed" && r.error ? (
                      <div className="flex items-center gap-2 text-sm text-red-600 py-3">
                        <AlertCircle size={16} />
                        {r.error}
                      </div>
                    ) : r.emails.length === 0 ? (
                      <p className="text-sm text-neutral-500 py-3">
                        No emails were found on this domain. We scanned{" "}
                        {r.pages_scanned} page{r.pages_scanned !== 1 ? "s" : ""}.
                      </p>
                    ) : (
                      <>
                        <div className="flex items-center justify-between py-3">
                          <span className="text-sm text-neutral-500">
                            {r.emails.length} email{r.emails.length !== 1 ? "s" : ""} extracted
                          </span>
                          <button
                            onClick={() => copyAll(r.emails)}
                            className="flex items-center gap-1.5 text-sm font-medium text-primary-600 hover:text-primary-700 transition-colors"
                          >
                            {copied === `all-${r.emails[0]}` ? (
                              <>
                                <Check size={15} /> Copied all
                              </>
                            ) : (
                              <>
                                <Copy size={15} /> Copy all
                              </>
                            )}
                          </button>
                        </div>
                        <div className="grid sm:grid-cols-2 gap-2">
                          {r.emails.map((email) => (
                            <div
                              key={email}
                              className="group flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg bg-neutral-50 border border-neutral-100 hover:border-primary-200 transition-colors"
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
                                  <Check size={15} className="text-accent-600" />
                                ) : (
                                  <Copy size={15} />
                                )}
                              </button>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
      <div className="border-t border-neutral-200 pt-6"><HistoryView sourceType="website" title="Email scraper history" onSendCampaign={onSendCampaign} /></div>
    </div>
  );
}
