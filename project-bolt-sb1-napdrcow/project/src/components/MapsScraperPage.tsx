import { useEffect, useState } from "react";
import { ExternalLink, Globe, Loader2, MapPin, Search } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { scrapeDomains } from "@/lib/scrape";
import { HistoryView } from "@/components/HistoryView";
import type { CompanyRecord, ScrapeCampaignBatch } from "@/lib/types";

interface PlaceResult extends CompanyRecord {
  id: string;
  name: string;
  address: string;
  website: string | null;
  location?: { latitude: number; longitude: number };
}

export function MapsScraperPage({ onSendCampaign }: { onSendCampaign?: (batch: ScrapeCampaignBatch) => void }) {
  const { user, session } = useAuth();
  const [query, setQuery] = useState("");
  const [resultsQuery, setResultsQuery] = useState("");
  const [places, setPlaces] = useState<PlaceResult[]>([]);
  const [selectedPlace, setSelectedPlace] = useState<PlaceResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [scraping, setScraping] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [scrapeMessage, setScrapeMessage] = useState("");
  const [history, setHistory] = useState<Array<{ id: string; query: string }>>([]);
  const [scrapeHistoryOpen, setScrapeHistoryOpen] = useState(false);
  const embedKey = import.meta.env.VITE_GOOGLE_MAPS_EMBED_KEY as string | undefined;

  const loadHistory = async () => {
    const { data } = await supabase.from("discovery_searches").select("id,query")
      .eq("provider", "places").order("created_at", { ascending: false }).limit(6);
    setHistory(data ?? []);
  };

  useEffect(() => { void loadHistory(); }, []);

  useEffect(() => {
    if (scrapeHistoryOpen) {
      document.getElementById("maps-scrape-history")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [scrapeHistoryOpen]);

  const search = async (value = query) => {
    const normalized = value.trim();
    if (!normalized) return;
    setResultsQuery(normalized);
    setLoading(true);
    setError("");
    setScrapeMessage("");
    setPlaces([]);
    const { data, error: invokeError } = await supabase.functions.invoke("discovery-search", {
      body: { provider: "places", query: normalized },
    });
    setLoading(false);
    if (invokeError || data?.error) {
      setError(data?.error ?? invokeError?.message ?? "Maps search is unavailable.");
      return;
    }
    const found = (data?.results ?? []) as PlaceResult[];
    setPlaces(found);
    setSelectedPlace(found[0] ?? null);
    if (user) {
      await supabase.from("discovery_searches").insert({ user_id: user.id, provider: "places", query: normalized, result_count: found.length });
      await loadHistory();
    }
  };

  const scrapePlace = async (place: PlaceResult) => {
    if (!session || !place.website) return;
    setScraping(place.id);
    setScrapeMessage("");
    try {
      const domain = new URL(place.website).hostname;
      const result = await scrapeDomains([domain], session.access_token, {
        sourceType: "maps",
        sourceQuery: resultsQuery,
        batchLabel: `${resultsQuery}: ${place.name}`,
      });
      const emails = result.results.flatMap((item) => item.emails);
      setScrapeMessage(`${place.name}: ${emails.length} email${emails.length === 1 ? "" : "s"} found. Results were added to Email lists.`);
    } catch (scrapeError) {
      setScrapeMessage(scrapeError instanceof Error ? scrapeError.message : "Could not scrape this website.");
    }
    setScraping(null);
  };

  const mapQuery = selectedPlace?.location
    ? `${selectedPlace.location.latitude},${selectedPlace.location.longitude}`
    : resultsQuery || query || "World";
  const isWorldView = mapQuery === "World";
  const mapSrc = embedKey
    ? isWorldView
      ? `https://www.google.com/maps/embed/v1/view?key=${encodeURIComponent(embedKey)}&center=20,0&zoom=2&maptype=roadmap`
      : `https://www.google.com/maps/embed/v1/search?key=${encodeURIComponent(embedKey)}&q=${encodeURIComponent(mapQuery)}`
    : isWorldView
      ? "https://maps.google.com/maps?q=World&z=2&output=embed"
      : `https://maps.google.com/maps?q=${encodeURIComponent(mapQuery)}&z=12&output=embed`;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 animate-fade-in">
      <header className="mb-7"><p className="text-xs uppercase tracking-wider text-neutral-500 mb-2">Discovery</p><div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-3xl font-bold">Maps scraper</h1><button onClick={() => setScrapeHistoryOpen((open) => !open)} className="px-3 py-2 border border-neutral-200 rounded-lg text-sm font-medium">{scrapeHistoryOpen ? "Hide Maps history" : "Maps scrape history"}</button></div><p className="text-neutral-600 mt-2">Find local businesses, review their websites, and scrape a selected result.</p></header>
      {error && <div role="alert" className="mb-5 p-4 border border-amber-300 bg-amber-50 rounded-lg text-sm text-amber-950"><p className="font-semibold mb-1">Maps search isn’t configured</p><p>{error}</p><p className="mt-2 text-xs">Configure GOOGLE_MAPS_API_KEY as a Supabase function secret and deploy the discovery-search function.</p></div>}
      {scrapeMessage && <p role="status" className="mb-5 p-3 border border-neutral-200 rounded-lg text-sm">{scrapeMessage}</p>}

      <section className="grid gap-5 lg:grid-cols-[minmax(320px,0.78fr)_minmax(0,1.22fr)] lg:items-stretch">
        <div className="min-w-0 space-y-3">
          <form onSubmit={(event) => { event.preventDefault(); void search(); }} className="flex gap-2 rounded-lg border border-neutral-200 bg-white p-2">
            <MapPin size={19} className="ml-2 self-center text-neutral-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} maxLength={200} placeholder="Business type and location, e.g. bookstores in Lagos" className="min-w-0 flex-1 py-2 text-sm outline-none" />
            <button disabled={loading || !query.trim()} className="inline-flex shrink-0 items-center gap-2 rounded-md bg-primary-600 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">{loading ? <Loader2 className="animate-spin" size={16} /> : <Search size={16} />}Search</button>
          </form>
          {history.length > 0 && <aside className="flex flex-wrap items-center gap-2"><h2 className="mr-1 text-xs font-semibold text-neutral-500">Recent searches</h2>{history.map((item) => <button key={item.id} onClick={() => { setQuery(item.query); void search(item.query); }} className="max-w-full truncate rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-xs text-neutral-600">{item.query}</button>)}</aside>}
          {loading && <div className="py-16 text-center text-neutral-500"><Loader2 className="animate-spin mx-auto mb-2" size={22} />Searching places</div>}
          {!loading && <div className="space-y-3 lg:max-h-[calc(100vh-13rem)] lg:overflow-y-auto lg:pr-2">{places.map((place) => <article key={place.id} className={`border rounded-lg bg-white p-4 transition-colors ${selectedPlace?.id === place.id ? "border-primary-500" : "border-neutral-200"}`}>
            <button onClick={() => setSelectedPlace(place)} className="w-full text-left">
              <span className="block text-[10px] font-semibold uppercase text-neutral-500">Business Name</span>
              <span className="block font-medium">{place.business_name}</span>
              <span className="mt-2 block text-[10px] font-semibold uppercase text-neutral-500">Domain</span>
              <span className="block truncate font-mono text-xs text-neutral-700">{place.domain || "Not listed"}</span>
              <span className="mt-2 block text-[10px] font-semibold uppercase text-neutral-500">Core services</span>
              <span className="block text-sm text-neutral-600">{place.service_summary}</span>
              <span className="mt-2 block text-xs text-neutral-500">{place.address}</span>
            </button>
            <p className="mt-2 inline-flex rounded-full bg-neutral-100 px-2.5 py-1 text-[10px] font-medium text-neutral-600">{place.category}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {place.website ? <>
                <a href={place.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-neutral-200 rounded text-xs font-medium">Website <ExternalLink size={13} /></a>
                <button onClick={() => void scrapePlace(place)} disabled={scraping === place.id} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary-600 text-white rounded text-xs font-medium disabled:opacity-50">{scraping === place.id ? <Loader2 size={13} className="animate-spin" /> : <Globe size={13} />}Scrape website</button>
              </> : <span className="text-xs text-neutral-400">No website listed</span>}
              {place.location && <a href={`https://www.google.com/maps/search/?api=1&query=${place.location.latitude},${place.location.longitude}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 px-2 py-1 text-xs text-neutral-500">Map <ExternalLink size={12} /></a>}
            </div>
          </article>)}
          {!loading && places.length === 0 && !error && <div className="border border-dashed border-neutral-300 rounded-lg p-10 text-center text-sm text-neutral-500">Search a business type and area to see place results here.</div>}</div>}
        </div>
        <div className="h-[52vh] min-h-[360px] overflow-hidden rounded-lg border border-neutral-200 lg:sticky lg:top-20 lg:h-[calc(100vh-6rem)] lg:min-h-[560px]">
          <iframe title={isWorldView ? "World map" : "Google Maps search results"} src={mapSrc} className="h-full w-full" loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
        </div>
      </section>
      {scrapeHistoryOpen && <div id="maps-scrape-history" className="mt-10 border-t border-neutral-200 pt-2"><HistoryView sourceType="maps" onSendCampaign={onSendCampaign} /></div>}
    </div>
  );
}