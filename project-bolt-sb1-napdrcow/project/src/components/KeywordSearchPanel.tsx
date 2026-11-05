import { useEffect, useState } from "react";
import { ArrowDownToLine, ExternalLink, Loader2, Search } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export interface KeywordSearchResult {
  title: string;
  link: string;
  snippet: string;
}

type Destination = "domain-listing" | "email-domain";

const TARGET_ENTITIES = ["exhibitor", "exhibitors", "participant", "participants", "supplier", "suppliers", "vendor", "vendors", "seller", "sellers", "manufacturer", "manufacturers", "distributor", "distributors"];
const LIST_MARKERS = ["directory", "directories", "list", "lists", "catalog", "catalogue", "catalogues", "companies", "results", ...TARGET_ENTITIES];

function isListingUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const tokens = `${url.hostname} ${url.pathname}`.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    return TARGET_ENTITIES.some((marker) => tokens.includes(marker)) && LIST_MARKERS.some((marker) => tokens.includes(marker));
  } catch {
    return false;
  }
}

export function KeywordSearchPanel({ destination, onUseResult }: {
  destination: Destination;
  onUseResult: (result: KeywordSearchResult) => void;
}) {
  const { user } = useAuth();
  const [enabled, setEnabled] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<KeywordSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const loadSetting = async () => {
      const { data } = await supabase.from("system_settings").select("web_search_enabled").eq("id", 1).maybeSingle();
      if (active) setEnabled(data?.web_search_enabled === true);
    };
    void loadSetting();
    const refreshInterval = window.setInterval(() => void loadSetting(), 15000);
    window.addEventListener("focus", loadSetting);
    window.addEventListener("system-settings-updated", loadSetting);
    return () => {
      active = false;
      window.clearInterval(refreshInterval);
      window.removeEventListener("focus", loadSetting);
      window.removeEventListener("system-settings-updated", loadSetting);
    };
  }, []);

  const search = async (event: React.FormEvent) => {
    event.preventDefault();
    const normalized = query.trim();
    if (!normalized) return;

    setLoading(true);
    setSearched(true);
    setError("");
    setResults([]);
    const { data, error: invokeError } = await supabase.functions.invoke("discovery-search", {
      body: { provider: "web", query: normalized },
    });
    setLoading(false);
    if (invokeError || data?.error) {
      setError(data?.error ?? invokeError?.message ?? "Web search is unavailable.");
      return;
    }

    const found = (data?.results ?? []) as KeywordSearchResult[];
    setResults(found);
    if (user) {
      await supabase.from("discovery_searches").insert({
        user_id: user.id,
        provider: "web",
        query: normalized,
        result_count: found.length,
      });
    }
  };

  const handleUseResult = (result: KeywordSearchResult) => {
    if (destination === "domain-listing" && !isListingUrl(result.link)) return;
    onUseResult(result);
  };

  if (!enabled) return null;

  return (
    <section className="mb-6 border border-neutral-200 bg-white rounded-xl p-5">
      <h2 className="font-semibold">Search the web</h2>
      <form onSubmit={search} className="mt-3 flex flex-col sm:flex-row gap-2">
        <div className="relative min-w-0 flex-1">
          <Search size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            maxLength={200}
            placeholder={destination === "domain-listing" ? "Search exhibitor or distributor directories" : "Search companies, products, or topics"}
            className="w-full rounded-lg border border-neutral-200 py-2.5 pl-10 pr-3 text-sm outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
          />
        </div>
        <button disabled={loading || !query.trim()} className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">
          {loading ? <Loader2 className="animate-spin" size={16} /> : <Search size={16} />}
          Search
        </button>
      </form>
      {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
      {loading && <p role="status" className="mt-4 flex items-center gap-2 text-sm text-neutral-500"><Loader2 className="animate-spin" size={15} />Searching live web results...</p>}
      {!loading && searched && !error && results.length === 0 && <p className="mt-4 text-sm text-neutral-500">No results found.</p>}
      {!loading && results.length > 0 && <div className="mt-4 divide-y divide-neutral-100 border-t border-neutral-100">
        {results.map((result) => {
          const canUse = destination !== "domain-listing" || isListingUrl(result.link);
          return <article key={result.link} className="py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <a href={result.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 font-medium text-primary-700 hover:underline">
                  {result.title}<ExternalLink size={13} />
                </a>
                <p className="mt-1 truncate text-xs text-green-800">{result.link}</p>
                {result.snippet && <p className="mt-2 text-sm text-neutral-600">{result.snippet}</p>}
              </div>
              <button
                onClick={() => handleUseResult(result)}
                disabled={!canUse}
                title={canUse ? undefined : "Only URLs marked as exhibitor, participant, supplier, vendor, seller, or distributor directories can be imported."}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-neutral-200 px-3 py-2 text-xs font-medium text-neutral-700 hover:border-primary-300 hover:text-primary-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ArrowDownToLine size={14} />
                {destination === "domain-listing" ? "Use listing URL" : "Use domain"}
              </button>
            </div>
          </article>;
        })}
      </div>}
    </section>
  );
}
