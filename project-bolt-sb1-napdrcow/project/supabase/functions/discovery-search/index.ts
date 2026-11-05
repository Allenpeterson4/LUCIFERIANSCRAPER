import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { filterRelevantCompanies } from "../_shared/company-intent.ts";
import { getSearchSecret } from "../_shared/search-secrets.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const authorization = req.headers.get("Authorization");
    if (!authorization) return jsonResponse({ error: "Sign in to search." }, 401);
    const { data: userData, error: authError } = await supabase.auth.getUser(authorization.replace(/^Bearer\s+/i, ""));
    if (authError || !userData.user) return jsonResponse({ error: "Your session has expired. Sign in again." }, 401);

    const { data: systemSettings, error: settingsError } = await supabase.from("system_settings")
      .select("maintenance_mode,web_search_enabled").eq("id", 1).single();
    if (settingsError || !systemSettings) return jsonResponse({ error: "System settings are unavailable." }, 503);
    if (systemSettings.maintenance_mode) return jsonResponse({ error: "The system is in maintenance mode." }, 503);

    const body = await req.json();
    const provider = body.provider;
    const query = typeof body.query === "string" ? body.query.trim() : "";
    if (!( ["web", "places"] as unknown[]).includes(provider)) return jsonResponse({ error: "Choose web or places search." }, 400);
    if (provider === "web" && !systemSettings.web_search_enabled) return jsonResponse({ error: "Web search is disabled by the administrator." }, 403);
    if (query.length < 2 || query.length > 200) return jsonResponse({ error: "Search must be between 2 and 200 characters." }, 400);

    if (provider === "web") {
      const [apiKey, engineId] = await Promise.all([
        getSearchSecret("google_cse_api_key", "GOOGLE_CSE_API_KEY"),
        getSearchSecret("google_cse_id", "GOOGLE_CSE_ID"),
      ]);
      if (!apiKey || !engineId) return jsonResponse({ error: "Set GOOGLE_CSE_API_KEY and GOOGLE_CSE_ID as Supabase function secrets." }, 503);
      const url = new URL("https://customsearch.googleapis.com/customsearch/v1");
      url.searchParams.set("key", apiKey);
      url.searchParams.set("cx", engineId);
      url.searchParams.set("q", query);
      url.searchParams.set("num", "10");
      const response = await fetch(url);
      if (!response.ok) return jsonResponse({ error: `Google web search returned ${response.status}.` }, 502);
      const data = await response.json();
      const results = (data.items ?? []).map((item: Record<string, string>) => ({
        title: item.title ?? "Untitled result",
        link: item.link ?? "",
        snippet: item.snippet ?? "",
      })).filter((item: { link: string }) => item.link.startsWith("https://") || item.link.startsWith("http://"));
      return jsonResponse({ results });
    }

    const apiKey = await getSearchSecret("google_maps_api_key", "GOOGLE_MAPS_API_KEY");
    if (!apiKey) return jsonResponse({ error: "Set GOOGLE_MAPS_API_KEY as a Supabase function secret." }, 503);
    const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.websiteUri,places.location,places.editorialSummary,places.primaryTypeDisplayName,places.types",
      },
      body: JSON.stringify({ textQuery: query, pageSize: 15 }),
    });
    if (!response.ok) return jsonResponse({ error: `Google Places search returned ${response.status}.` }, 502);
    const data = await response.json();
    const results = (data.places ?? []).map((place: Record<string, unknown>) => {
      const displayName = place.displayName as { text?: string } | undefined;
      const editorialSummary = place.editorialSummary as { text?: string } | undefined;
      const primaryType = place.primaryTypeDisplayName as { text?: string } | undefined;
      const types = Array.isArray(place.types) ? place.types.filter((value): value is string => typeof value === "string") : [];
      const name = displayName?.text ?? "Unnamed business";
      const website = typeof place.websiteUri === "string" ? place.websiteUri : null;
      let domain = "";
      try { if (website) domain = new URL(website).hostname.replace(/^www\./, ""); } catch { /* use empty domain */ }
      const category = primaryType?.text ?? types[0]?.replace(/_/g, " ") ?? "Business";
      return {
        id: place.id,
        name,
        business_name: name,
        domain,
        service_summary: editorialSummary?.text ?? "Core services not listed in source.",
        category,
        source: "maps" as const,
        address: place.formattedAddress ?? "Address unavailable",
        website,
        location: place.location,
      };
    });
    const relevantResults = await filterRelevantCompanies(query, results);
    return jsonResponse({ results: relevantResults });
  } catch (error) {
    console.error("Discovery search failed:", error);
    return jsonResponse({ error: "Search service failed. Try again later." }, 500);
  }
});