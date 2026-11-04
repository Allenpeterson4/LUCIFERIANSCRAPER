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
import { scrapeDomains, type ScrapeResponseData } from "@/lib/scrape";
import type { View } from "@/components/Header";

interface DomainResult {
  domain: string;
  emails: string[];
  status: string;
  pages_scanned: number;
  error: string | null;
}

interface ScrapeToolProps {
  onNavigate: (v: View) => void;
  pendingDomains?: string[];
  onPendingConsumed?: () => void;
}

export function ScrapeTool({ onNavigate, pendingDomains, onPendingConsumed }: ScrapeToolProps) {
  const { session } = useAuth();
  const [mode, setMode] = useState<"single" | "bulk">("single");
  const [singleDomain, setSingleDomain] = useState("");
  const [bulkInput, setBulkInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<DomainResult[] | null>(null);
  const [totalEmails, setTotalEmails] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (pendingDomains && pendingDomains.length > 0) {
      setMode("bulk");
      setBulkInput(pendingDomains.join("\n"));
      onPendingConsumed?.();
    }
  }, [pendingDomains, onPendingConsumed]);

  const parseDomains = (): string[] => {
    if (mode === "single") {
      return [singleDomain];
    }
    return bulkInput
      .split(/[\n,\s]+/)
      .map((d) => d.trim())
      .filter(Boolean);
  };

  const handleScrape = async () => {
    const domains = parseDomains();
    if (domains.length === 0 || (domains.length === 1 && !domains[0])) {
      setError("Please enter at least one domain.");
      return;
    }
    setError(null);
    setLoading(true);
    setResults(null);
    setTotalEmails(0);

    try {
      const data: ScrapeResponseData = await scrapeDomains(
        domains,
        session!.access_token
      );
      setResults(data.results);
      setTotalEmails(data.total_emails);
      setExpanded(new Set(data.results.map((r) => r.domain)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scraping failed.");
    } finally {
      setLoading(false);
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

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10 animate-fade-in">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Scrape emails</h1>
        <p className="text-neutral-600">
          Enter a domain or a list of domains. We'll crawl each one and extract every
          reachable email address.
        </p>
      </div>

      {/* Mode toggle */}
      <div className="inline-flex p-1 bg-neutral-100 rounded-lg mb-6">
        <button
          onClick={() => setMode("single")}
          className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
            mode === "single"
              ? "bg-white text-primary-700 shadow-sm"
              : "text-neutral-500 hover:text-neutral-700"
          }`}
        >
          <Search size={16} />
          Single domain
        </button>
        <button
          onClick={() => setMode("bulk")}
          className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
            mode === "bulk"
              ? "bg-white text-primary-700 shadow-sm"
              : "text-neutral-500 hover:text-neutral-700"
          }`}
        >
          <Layers size={16} />
          Bulk domains
        </button>
      </div>

      {/* Input */}
      <div className="bg-white rounded-2xl border border-neutral-200 p-6 mb-6">
        {mode === "single" ? (
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
                  onChange={(e) => setSingleDomain(e.target.value)}
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
              onChange={(e) => setBulkInput(e.target.value)}
              placeholder={"example.com\nanother.org\nthird-company.co"}
              rows={7}
              className="w-full px-4 py-3 rounded-lg border border-neutral-200 focus:border-primary-500 focus:ring-2 focus:ring-primary-100 outline-none transition-all font-mono text-sm resize-y"
            />
            <div className="flex items-center justify-between mt-3">
              <span className="text-sm text-neutral-400">
                {parseDomains().length} domain{parseDomains().length !== 1 ? "s" : ""} detected
              </span>
              <button
                onClick={handleScrape}
                disabled={loading}
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
      </div>

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
      {loading && (
        <div className="bg-white rounded-2xl border border-neutral-200 p-10 text-center animate-fade-in">
          <Loader2 size={36} className="animate-spin text-primary-600 mx-auto mb-4" />
          <p className="font-medium text-neutral-700">Crawling domains and extracting emails...</p>
          <p className="text-sm text-neutral-400 mt-1">This usually takes a few seconds per domain.</p>
        </div>
      )}

      {/* Results */}
      {results && !loading && (
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
              onClick={() => onNavigate("history")}
              className="text-sm font-medium text-primary-600 hover:text-primary-700 flex items-center gap-1.5"
            >
              View history
            </button>
          </div>

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
                  <span className="font-mono font-medium text-neutral-800 flex-1 truncate">
                    {r.domain}
                  </span>
                  <span
                    className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                      r.status === "completed"
                        ? "bg-accent-50 text-accent-700"
                        : r.status === "no_emails"
                        ? "bg-neutral-100 text-neutral-500"
                        : "bg-red-50 text-red-600"
                    }`}
                  >
                    {r.emails.length} email{r.emails.length !== 1 ? "s" : ""}
                  </span>
                  <span className="text-xs text-neutral-400 hidden sm:flex items-center gap-1">
                    <FileText size={13} />
                    {r.pages_scanned} pages
                  </span>
                </button>

                {expanded.has(r.domain) && (
                  <div className="px-5 pb-5 pt-1 border-t border-neutral-100 animate-slide-in">
                    {r.status === "failed" && r.error ? (
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
    </div>
  );
}
