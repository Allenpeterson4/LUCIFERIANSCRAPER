import { useEffect, useState } from "react";
import { ExternalLink, Loader2, Search } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";

interface SearchResult {
  title: string;
  link: string;
  snippet: string;
}

interface SearchHistory {
  id: string;
  query: string;
  result_count: number;
  created_at: string;
}

export function SearchEnginePage() {
  const { user } = useAuth();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [history, setHistory] = useState<SearchHistory[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState("");

  const loadHistory = async () => {
    const { data } = await supabase.from("discovery_searches").select("id,query,result_count,created_at")
      .eq("provider", "web").order("created_at", { ascending: false }).limit(8);
    setHistory((data as SearchHistory[]) ?? []);
  };

  useEffect(() => { void loadHistory(); }, []);

  const search = async (value = query) => {
    const normalized = value.trim();
    if (!normalized) return;
    setQuery(normalized);
    setLoading(true);
    setSearched(true);
    setError("");
    setResults([]);
    const { data, error: invokeError } = await supabase.functions.invoke("discovery-search", {
      body: { provider: "web", query: normalized },
    });
    setLoading(false);
    if (invokeError || data?.error) {
      setError(data?.error ?? invokeError?.message ?? "Search is unavailable.");
      return;
    }
    const found = (data?.results ?? []) as SearchResult[];
    setResults(found);
    if (user) {
      await supabase.from("discovery_searches").insert({ user_id: user.id, provider: "web", query: normalized, result_count: found.length });
      await loadHistory();
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10 animate-fade-in">
      <header className="mb-8">
        <p className="text-xs uppercase tracking-wider text-neutral-500 mb-2">Discovery</p>
        <h1 className="text-3xl font-bold mb-2">Web search</h1>
        <p className="text-neutral-600">Search live web results without leaving MailHarvest.</p>
      </header>
      <form onSubmit={(event) => { event.preventDefault(); void search(); }} className="flex gap-2 p-2 border border-neutral-200 bg-white rounded-lg">
        <Search size={19} className="ml-2 self-center text-neutral-400" />
        <input value={query} onChange={(event) => setQuery(event.target.value)} maxLength={200} placeholder="Search the web" className="min-w-0 flex-1 py-2 outline-none text-sm" />
        <button disabled={loading || !query.trim()} className="inline-flex items-center gap-2 px-4 py-2.5 bg-primary-600 text-white rounded-md text-sm font-medium disabled:opacity-50">{loading ? <Loader2 className="animate-spin" size={16} /> : <Search size={16} />}Search</button>
      </form>
      {error && <div role="alert" className="mt-5 p-4 border border-amber-300 bg-amber-50 rounded-lg text-sm text-amber-950"><p className="font-semibold mb-1">Search isn’t configured</p><p>{error}</p><p className="mt-2 text-xs">Configure GOOGLE_CSE_API_KEY and GOOGLE_CSE_ID as Supabase function secrets, then deploy the discovery-search function.</p></div>}
      {loading && <div className="py-16 text-center text-neutral-500"><Loader2 className="animate-spin mx-auto mb-2" size={22} />Searching the web</div>}
      {!loading && searched && !error && results.length === 0 && <p className="py-12 text-center text-neutral-500">No results found.</p>}
      {!loading && results.length > 0 && <section className="mt-6 border-t border-neutral-200">
        <p className="py-3 text-sm text-neutral-500">{results.length} results</p>
        {results.map((result) => <article key={result.link} className="py-4 border-b border-neutral-200">
          <a href={result.link} target="_blank" rel="noreferrer" className="group inline-flex items-center gap-2 text-lg font-medium text-primary-700 hover:underline">{result.title}<ExternalLink size={14} /></a>
          <p className="text-xs text-green-800 truncate mt-1">{result.link}</p>
          <p className="text-sm text-neutral-600 mt-2">{result.snippet}</p>
        </article>)}
      </section>}
      {history.length > 0 && <aside className="mt-10 border-t border-neutral-200 pt-5"><h2 className="text-sm font-semibold mb-3">Recent searches</h2><div className="flex flex-wrap gap-2">{history.map((item) => <button key={item.id} onClick={() => void search(item.query)} className="px-3 py-1.5 border border-neutral-200 rounded-full text-sm text-neutral-600 hover:text-neutral-900">{item.query}</button>)}</div></aside>}
    </div>
  );
}