import { useEffect, useState } from "react";
import {
  Globe,
  Link2,
  Loader2,
  AlertCircle,
  Inbox,
  Calendar,
  Trash2,
  ChevronDown,
  ChevronRight,
  Mail,
  Tag,
  CheckSquare,
  Square,
  ArrowRight,
  Store,
  Building2,
  Layers,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { extractDomainDirectory, previewDomainDirectory, type DirectoryPreview } from "@/lib/parse";
import type { DomainParsingRun, DomainParseResult, ParseDomainsResponse } from "@/lib/types";
import type { ScrapeCampaignBatch } from "@/lib/types";
import type { View } from "@/components/Header";
import { HistoryView } from "@/components/HistoryView";
import { KeywordSearchPanel } from "@/components/KeywordSearchPanel";

interface ParsedDomain {
  domain: string;
  name: string | null;
  business_name: string;
  service_summary: string;
  category: string;
  source_page_url: string | null;
}

interface DomainScrapingProps {
  onNavigate: (v: View) => void;
  onSendToScraper: (domains: string[], intent?: string) => void;
  onSendCampaign?: (batch: ScrapeCampaignBatch) => void;
}

export function DomainScraping({ onSendToScraper, onSendCampaign }: DomainScrapingProps) {
  const { session } = useAuth();
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingAction, setLoadingAction] = useState<"preview" | "extract">("preview");
  const [error, setError] = useState<string | null>(null);
  const [directoryPreview, setDirectoryPreview] = useState<DirectoryPreview | null>(null);
  const [parseResult, setParseResult] = useState<ParseDomainsResponse | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [runs, setRuns] = useState<DomainParsingRun[]>([]);
  const [resultsByRun, setResultsByRun] = useState<Record<string, DomainParseResult[]>>({});
  const [historyLoading, setHistoryLoading] = useState(true);
  const [expandedRun, setExpandedRun] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [websiteHistoryOpen, setWebsiteHistoryOpen] = useState(false);

  useEffect(() => {
    loadHistory();
  }, []);

  const loadHistory = async () => {
    setHistoryLoading(true);
    const { data } = await supabase
      .from("domain_parsing_runs")
      .select("*")
      .order("created_at", { ascending: false });
    setRuns((data as DomainParsingRun[]) ?? []);
    setHistoryLoading(false);
  };

  const loadRunResults = async (runId: string) => {
    if (resultsByRun[runId]) return;
    const { data } = await supabase
      .from("domain_parse_results")
      .select("*")
      .eq("run_id", runId)
      .order("created_at", { ascending: true });
    if (data) {
      setResultsByRun((prev) => ({ ...prev, [runId]: data as DomainParseResult[] }));
    }
  };

  const toggleRun = (runId: string) => {
    setExpandedRun((prev) => {
      if (prev === runId) return null;
      loadRunResults(runId);
      return runId;
    });
  };

  const deleteRun = async (runId: string) => {
    setDeleting(runId);
    const { error: err } = await supabase.from("domain_parsing_runs").delete().eq("id", runId);
    setDeleting(null);
    if (err) return;
    setRuns((prev) => prev.filter((r) => r.id !== runId));
    setResultsByRun((prev) => {
      const next = { ...prev };
      delete next[runId];
      return next;
    });
    if (expandedRun === runId) setExpandedRun(null);
  };

  const handleFindDirectory = async () => {
    if (!url.trim()) {
      setError("Please enter a website domain.");
      return;
    }
    setError(null);
    setLoading(true);
    setLoadingAction("preview");
    setDirectoryPreview(null);
    setParseResult(null);
    setSelected(new Set());

    try {
      const data = await previewDomainDirectory(url, session!.access_token);
      setDirectoryPreview(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not locate a directory on this site.");
    } finally {
      setLoading(false);
    }
  };

  const handleExtractDirectory = async () => {
    if (!directoryPreview) return;
    setError(null);
    setLoading(true);
    setLoadingAction("extract");

    try {
      const data = await extractDomainDirectory(url, directoryPreview.directory_url, session!.access_token);
      setParseResult(data);
      setSelected(new Set(data.domains.map((d) => d.domain)));
      setDirectoryPreview(null);
      window.dispatchEvent(new Event("credits-updated"));
      loadHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to extract directory listings.");
    } finally {
      setLoading(false);
    }
  };

  const toggleSelect = (domain: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(domain)) next.delete(domain);
      else next.add(domain);
      return next;
    });
  };

  const toggleAll = () => {
    if (!parseResult) return;
    if (selected.size === parseResult.domains.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(parseResult.domains.map((d) => d.domain)));
    }
  };

  const sendSelected = () => {
    const domains = Array.from(selected);
    if (domains.length === 0) return;
    onSendToScraper(domains, parseResult?.intent);
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

  const sourceTypeMeta = (type: string) => {
    switch (type) {
      case "exhibition":
        return { label: "Exhibition", icon: <Building2 size={14} />, color: "bg-primary-50 text-primary-700" };
      case "b2b":
        return { label: "B2B Marketplace", icon: <Store size={14} />, color: "bg-accent-50 text-accent-700" };
      default:
        return { label: "Generic", icon: <Globe size={14} />, color: "bg-neutral-100 text-neutral-600" };
    }
  };

  const categories = parseResult
    ? Array.from(new Set(parseResult.domains.map((d) => d.category))).sort()
    : [];

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10 animate-fade-in">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Domain Scraping</h1>
        <p className="text-neutral-600">
          Enter a trade show or B2B website domain. The scraper will locate validated exhibitor, participant, vendor, seller, or distributor directories before extracting anything.
        </p>
      </div>

      <KeywordSearchPanel
        destination="domain-listing"
        onUseResult={(result) => {
          setUrl(result.link);
          setError(null);
          setParseResult(null);
          setSelected(new Set());
        }}
      />

      {/* URL Input */}
      <div className="bg-white rounded-2xl border border-neutral-200 p-6 mb-6">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <label className="text-sm font-medium text-neutral-700">Website domain or directory URL</label>
          <button onClick={() => setWebsiteHistoryOpen((open) => !open)} className="inline-flex items-center gap-2 px-3 py-1.5 border border-neutral-200 bg-white rounded-lg text-xs font-medium">
            <Inbox size={14} />{websiteHistoryOpen ? "Hide Domain scraper history" : "Domain scraper history"}
          </button>
        </div>
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1 relative">
            <Link2 size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input
              type="text"
              value={url}
              onChange={(e) => { setUrl(e.target.value); setDirectoryPreview(null); setParseResult(null); }}
              onKeyDown={(e) => e.key === "Enter" && !loading && handleFindDirectory()}
              placeholder="example-trade-show.com"
              className="w-full pl-10 pr-4 py-3 rounded-lg border border-neutral-200 focus:border-primary-500 focus:ring-2 focus:ring-primary-100 outline-none transition-all font-mono text-sm"
            />
          </div>
          <button
            onClick={handleFindDirectory}
            disabled={loading}
            className="flex items-center justify-center gap-2 bg-primary-600 hover:bg-primary-700 disabled:opacity-60 text-white font-medium px-6 py-3 rounded-lg transition-colors"
          >
            {loading ? <Loader2 size={18} className="animate-spin" /> : <Globe size={18} />}
            {loading && loadingAction === "preview" ? "Finding directory..." : "Find directory"}
          </button>
        </div>
      </div>

      {websiteHistoryOpen && <div id="website-scrape-history" className="mb-6"><HistoryView sourceType="website" title="Domain scraper history" onSendCampaign={onSendCampaign} /></div>}

      {error && (
        <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-6 animate-slide-in">
          <AlertCircle size={20} className="text-red-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-red-800 text-sm">Parsing error</p>
            <p className="text-red-700 text-sm mt-0.5">{error}</p>
          </div>
        </div>
      )}

      {directoryPreview && !loading && (
        <section className="mb-6 border border-primary-200 bg-primary-50/60 rounded-xl p-5 animate-fade-in">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-neutral-800">Directory found</p>
              <p className="mt-1 text-2xl font-bold text-primary-700">{directoryPreview.total_listings.toLocaleString()} listings</p>
              <p className="mt-2 break-all text-sm text-neutral-600">{directoryPreview.directory_url}</p>
              {directoryPreview.intent && <p className="mt-2 text-sm text-neutral-600">Detected topic: <span className="font-medium">{directoryPreview.intent}</span></p>}
              <p className="mt-1 text-xs text-neutral-500">Extraction uses {directoryPreview.total_listings.toLocaleString()} credits, 1 per listing. Nothing is saved until you confirm.</p>
            </div>
            <div className="flex shrink-0 gap-2">
              <button onClick={() => setDirectoryPreview(null)} className="px-3 py-2 border border-neutral-200 bg-white rounded-lg text-sm font-medium">Cancel</button>
              <button onClick={() => void handleExtractDirectory()} className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium">
                <Globe size={15} />Extract listings
              </button>
            </div>
          </div>
        </section>
      )}

      {loading && (
        <div className="bg-white rounded-2xl border border-neutral-200 p-10 text-center animate-fade-in">
          <Loader2 size={36} className="animate-spin text-primary-600 mx-auto mb-4" />
          <p className="font-medium text-neutral-700">{loadingAction === "preview" ? "Searching this site for a directory..." : "Extracting confirmed listings..."}</p>
          <p className="text-sm text-neutral-400 mt-1">Only validated exhibitor, participant, vendor, seller, and distributor listings are processed.</p>
        </div>
      )}

      {/* Parse Results */}
      {parseResult && !loading && (
        <div className="space-y-4 animate-fade-in">
          <div className="flex items-center justify-between bg-white rounded-2xl border border-neutral-200 px-6 py-4 flex-wrap gap-3">
            <div className="flex items-center gap-6">
              <div>
                <div className="text-2xl font-bold text-primary-600">{parseResult.total_domains}</div>
                <div className="text-xs text-neutral-500 uppercase tracking-wide">domains found</div>
              </div>
              <div className="h-10 w-px bg-neutral-200" />
              <div className={`flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-full ${sourceTypeMeta(parseResult.source_type).color}`}>
                {sourceTypeMeta(parseResult.source_type).icon}
                {sourceTypeMeta(parseResult.source_type).label}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={toggleAll}
                className="flex items-center gap-1.5 text-sm font-medium text-neutral-600 hover:text-neutral-900 transition-colors"
              >
                {selected.size === parseResult.domains.length ? (
                  <CheckSquare size={16} className="text-primary-600" />
                ) : (
                  <Square size={16} />
                )}
                {selected.size}/{parseResult.domains.length} selected
              </button>
              <button
                onClick={sendSelected}
                disabled={selected.size === 0}
                className="flex items-center gap-2 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white font-medium px-4 py-2 rounded-lg transition-colors text-sm"
              >
                <Mail size={15} />
                Send to email scraper
                <ArrowRight size={15} />
              </button>
            </div>
          </div>

          {categories.map((category) => {
            const categoryDomains = parseResult.domains.filter((d) => d.category === category);
            return (
              <div key={category} className="bg-white rounded-2xl border border-neutral-200 overflow-hidden">
                <div className="flex items-center gap-2 px-5 py-3 bg-neutral-50 border-b border-neutral-100">
                  <Tag size={15} className="text-primary-600" />
                  <span className="font-semibold text-sm text-neutral-700">{category}</span>
                  <span className="text-xs text-neutral-400">({categoryDomains.length})</span>
                </div>
                <div className="divide-y divide-neutral-50">
                  {categoryDomains.map((d: ParsedDomain) => (
                    <div key={d.domain} className="flex items-center gap-3 px-5 py-3 hover:bg-neutral-50/50 transition-colors">
                      <button
                        onClick={() => toggleSelect(d.domain)}
                        className="shrink-0 text-neutral-400 hover:text-primary-600 transition-colors"
                        aria-label="Toggle selection"
                      >
                        {selected.has(d.domain) ? (
                          <CheckSquare size={18} className="text-primary-600" />
                        ) : (
                          <Square size={18} />
                        )}
                      </button>
                      <Globe size={16} className="text-neutral-400 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-neutral-800">{d.business_name || d.name || "Unnamed business"}</span>
                        <span className="block truncate font-mono text-xs text-neutral-500">{d.domain}</span>
                        <span className="mt-1 block text-xs text-neutral-500 line-clamp-2">{d.service_summary}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Domain History */}
      <div className="mt-12">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <Layers size={20} className="text-neutral-700" />
            <h2 className="text-xl font-bold">Domain History</h2>
          </div>
        </div>

        {historyLoading && (
          <div className="bg-white rounded-2xl border border-neutral-200 p-8 text-center">
            <Loader2 size={28} className="animate-spin text-primary-600 mx-auto mb-2" />
            <p className="text-neutral-500 text-sm">Loading history...</p>
          </div>
        )}

        {!historyLoading && runs.length === 0 && (
          <div className="bg-white rounded-2xl border border-neutral-200 p-10 text-center">
            <Inbox size={36} className="text-neutral-300 mx-auto mb-3" />
            <p className="text-neutral-500 text-sm">No domain parsing history yet. Parse a URL above to get started.</p>
          </div>
        )}

        {!historyLoading && runs.length > 0 && (
          <div className="space-y-3">
            {runs.map((run) => {
              const results = resultsByRun[run.id];
              const isOpen = expandedRun === run.id;
              const meta = sourceTypeMeta(run.source_type);
              return (
                <div key={run.id} className="bg-white rounded-2xl border border-neutral-200 overflow-hidden">
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
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${meta.color}`}>
                        {meta.icon}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-neutral-800 truncate text-sm">
                            {run.source_url}
                          </span>
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${meta.color}`}>
                            {meta.label}
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
                        <div className="text-sm font-semibold text-neutral-800">{run.total_domains}</div>
                        <div className="text-xs text-neutral-400">domains</div>
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
                          Loading domains...
                        </div>
                      ) : results.length === 0 ? (
                        <p className="text-sm text-neutral-500 py-3">No domains found in this run.</p>
                      ) : (
                        <div className="grid sm:grid-cols-2 gap-2">
                          {results.map((res) => (
                            <div
                              key={res.id}
                              className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-neutral-50 border border-neutral-100"
                            >
                              <Globe size={15} className="text-primary-600 shrink-0" />
                              <div className="min-w-0 flex-1">
                                <span className="font-mono text-sm text-neutral-800 block truncate">
                                  {res.domain}
                                </span>
                                {res.business_name && <span className="block truncate text-xs font-medium text-neutral-700">{res.business_name}</span>}
                                {res.category && (
                                  <span className="text-xs text-neutral-400">{res.category}</span>
                                )}
                                {res.service_summary && <span className="mt-1 block text-xs text-neutral-500 line-clamp-2">{res.service_summary}</span>}
                              </div>
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
    </div>
  );
}
