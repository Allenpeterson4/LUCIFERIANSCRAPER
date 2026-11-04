import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const EXHIBITION_LISTING_MARKERS = [
  "exhibitor list", "exhibitor directory", "exhibitor catalogue", "exhibitor catalog",
  "our exhibitors", "meet the exhibitors", "exhibiting companies", "list of exhibitors",
  "participant list", "participants list", "participant directory", "participants directory",
  "list of participants", "exhibition directory", "exhibitor search results",
];

const DISTRIBUTOR_LISTING_MARKERS = [
  "supplier directory", "supplier list", "vendor directory", "vendor list",
  "seller directory", "seller list", "distributor directory", "distributor list",
  "manufacturer directory", "manufacturer list", "wholesale directory",
  "marketplace sellers", "authorized distributors", "supplier search results",
  "vendor search results", "seller search results",
];

const TARGET_URL_ENTITIES = [
  "exhibitor", "exhibitors", "participant", "participants", "supplier", "suppliers",
  "vendor", "vendors", "seller", "sellers", "manufacturer", "manufacturers",
  "distributor", "distributors",
];

const TARGET_URL_DIRECTORY_MARKERS = [
  "directory", "directories", "list", "lists", "catalog", "catalogue", "catalogues",
  "companies", "results", "exhibitor", "exhibitors", "participant", "participants",
  "supplier", "suppliers", "vendor", "vendors", "seller", "sellers", "distributor",
  "distributors", "manufacturer", "manufacturers",
];

const LISTING_ELEMENT_MARKERS = /(?:exhibitor|participant|supplier|vendor|seller|distributor|manufacturer|company|listing|directory|result|card)/i;
const GENERIC_LINK_LABELS = new Set(["website", "visit", "visit website", "details", "more", "learn more", "view", "click here"]);

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  "Technology & IT": ["tech", "software", "it", "digital", "cloud", "data", "ai", "cyber", "saas", "app"],
  "Manufacturing": ["manufact", "factory", "industrial", "production", "machinery", "equipment"],
  "Energy": ["energy", "solar", "wind", "power", "renewable", "electric", "battery"],
  "Healthcare": ["health", "medical", "pharma", "biotech", "clinic", "hospital", "med"],
  "Food & Beverage": ["food", "beverage", "drink", "catering", "restaurant", "gastronomy", "wine"],
  "Construction": ["construct", "building", "architect", "engineering", "infra"],
  "Automotive": ["auto", "car", "vehicle", "mobility", "transport"],
  "Fashion & Apparel": ["fashion", "apparel", "clothing", "textile", "garment", "wear"],
  "Finance": ["finance", "bank", "insurance", "invest", "fintech", "payment"],
  "Education": ["education", "learn", "school", "academy", "training", "course"],
  "Agriculture": ["agri", "farm", "crop", "livestock", "garden"],
  "Logistics": ["logistic", "shipping", "freight", "cargo", "supply chain", "warehouse"],
  "Real Estate": ["real estate", "property", "realtor", "housing"],
  "Marketing & Media": ["marketing", "media", "advertis", "publish", "broadcast", "pr "],
  "Chemicals": ["chem", "plastic", "polymer", "coating"],
};

const COMMON_PUBLIC_SUFFIXES = new Set([
  "com", "org", "net", "io", "co", "eu", "de", "fr", "uk", "us",
  "info", "biz", "shop", "store", "online", "site", "tech", "app",
  "dev", "ai", "cloud", "agency", "world", "hub", "group", "global",
  "inc", "ltd", "industries", "systems", "solutions", "services",
]);

function categorize(text: string): string {
  const lower = (text || "").toLowerCase();
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some((k) => lower.includes(k))) return category;
  }
  return "Other";
}

function stripNonContentHtml(html: string): string {
  return html
    .replace(/<!--([\s\S]*?)-->/g, " ")
    .replace(/<(script|style|noscript|nav|header|footer|aside)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ");
}

function detectSourceType(html: string): string {
  const content = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").toLowerCase();
  if (EXHIBITION_LISTING_MARKERS.some((marker) => content.includes(marker))) return "exhibition";
  if (DISTRIBUTOR_LISTING_MARKERS.some((marker) => content.includes(marker))) return "b2b";
  return "generic";
}

function isDesignatedTargetUrl(url: URL): boolean {
  const tokens = `${url.hostname} ${url.pathname}`.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const hasTargetEntity = TARGET_URL_ENTITIES.some((marker) => tokens.includes(marker));
  const hasDirectoryMarker = TARGET_URL_DIRECTORY_MARKERS.some((marker) => tokens.includes(marker));
  return hasTargetEntity && hasDirectoryMarker;
}

function extractRootDomain(host: string): string {
  const parts = host.split(".");
  if (parts.length <= 2) return host;
  const twoPartTlds = ["co.uk", "co.jp", "com.au", "com.br", "co.nz", "com.cn", "co.in"];
  const lastTwo = parts.slice(-2).join(".");
  if (twoPartTlds.includes(lastTwo)) {
    return parts.slice(-3).join(".");
  }
  return parts.slice(-2).join(".");
}

interface ExtractedDomain {
  domain: string;
  name: string | null;
  category: string;
  source_page_url: string | null;
}

const SOCIAL_UTILITY_DOMAINS = [
  "facebook.com", "twitter.com", "x.com", "instagram.com", "linkedin.com",
  "youtube.com", "tiktok.com", "pinterest.com", "snapchat.com", "reddit.com",
  "whatsapp.com", "telegram.org", "github.com", "gitlab.com",
  "google.com", "googleapis.com", "gstatic.com", "google-analytics.com",
  "w3.org", "schema.org", "jquery.com", "cdn.jsdelivr.net",
  "unpkg.com", "cloudflare.com", "cloudfront.net", "jsdelivr.net",
  "bootstrapcdn.com", "fontawesome.com",
  "wordpress.com", "wp.com", "gravatar.com", "addtoany.com",
  "addthis.com", "sharethis.com",
];

function isSocialOrUtility(host: string): boolean {
  return SOCIAL_UTILITY_DOMAINS.some((s) => host === s || host.endsWith("." + s));
}

function isCommonPublicSuffix(domain: string): boolean {
  return COMMON_PUBLIC_SUFFIXES.has(domain);
}

function extractDomainsFromHtml(html: string, sourceUrl: string): ExtractedDomain[] {
  const domainMap = new Map<string, ExtractedDomain>();
  let baseHost = "";
  try { baseHost = new URL(sourceUrl).hostname.toLowerCase(); } catch { /* ignore */ }

  const recordPattern = /<(tr|li)\b[^>]*>[\s\S]*?<\/\1\s*>|<div\b[^>]*(?:class|id)=["'][^"']*["'][^>]*>[\s\S]*?<\/div\s*>/gi;
  let recordMatch: RegExpExecArray | null;
  while ((recordMatch = recordPattern.exec(html)) !== null) {
    const record = recordMatch[0];
    const openingTag = record.slice(0, record.indexOf(">") + 1);
    if (!/<(tr|li)\b/i.test(openingTag) && !LISTING_ELEMENT_MARKERS.test(openingTag)) continue;

    const linkPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let linkMatch: RegExpExecArray | null;
    while ((linkMatch = linkPattern.exec(record)) !== null) {
      const href = linkMatch[1];
      const linkText = linkMatch[2].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
      if (!href || !linkText || GENERIC_LINK_LABELS.has(linkText.toLowerCase())) continue;

      let linkedUrl: URL;
      try { linkedUrl = new URL(href, sourceUrl); } catch { continue; }
      if (!/^https?:$/.test(linkedUrl.protocol)) continue;
      const host = linkedUrl.hostname.toLowerCase().replace(/^www\./, "");
      if (!host.includes(".") || host === baseHost || host.endsWith(`.${baseHost}`) || isSocialOrUtility(host)) continue;

      const root = extractRootDomain(host);
      if (isCommonPublicSuffix(root) || domainMap.has(root)) continue;
      domainMap.set(root, {
        domain: root,
        name: linkText.slice(0, 120),
        category: categorize(linkText + " " + root),
        source_page_url: linkedUrl.toString(),
      });
    }
  }

  return Array.from(domainMap.values());
}

async function fetchWithTimeout(url: string, timeoutMs = 12000): Promise<string | null> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; MailHarvestDomainParser/1.0; +https://mailharvest.app/bot)", Accept: "text/html,application/xhtml+xml" },
      redirect: "follow",
    });
    if (!res.ok) return null;
    return await res.text();
  } catch { return null; } finally { clearTimeout(t); }
}

interface ListingInspection {
  source_url: string;
  source_type: string;
  domains: ExtractedDomain[];
}

function isSameSite(url: URL, siteHost: string): boolean {
  return url.hostname === siteHost || url.hostname.endsWith(`.${siteHost}`);
}

function findDirectoryLinks(html: string, siteUrl: URL): URL[] {
  const found = new Map<string, URL>();
  const linkPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = linkPattern.exec(html)) !== null) {
    try {
      const link = new URL(match[1], siteUrl);
      if (!/^https?:$/.test(link.protocol) || !isSameSite(link, siteUrl.hostname) || !isDesignatedTargetUrl(link)) continue;
      link.hash = "";
      found.set(link.toString(), link);
    } catch { /* ignore invalid links */ }
  }
  return Array.from(found.values());
}

async function fetchPage(url: URL): Promise<string | null> {
  const html = await fetchWithTimeout(url.toString());
  if (html) return html;
  if (url.protocol !== "https:") return null;
  const httpUrl = new URL(url.toString());
  httpUrl.protocol = "http:";
  return await fetchWithTimeout(httpUrl.toString());
}

async function inspectListing(url: URL): Promise<ListingInspection | null> {
  if (!isDesignatedTargetUrl(url)) return null;
  const html = await fetchPage(url);
  if (!html) return null;
  const listingHtml = stripNonContentHtml(html);
  const sourceType = detectSourceType(listingHtml);
  if (sourceType === "generic") return null;
  const domains = extractDomainsFromHtml(listingHtml, url.toString());
  if (domains.length === 0) return null;
  return { source_url: url.toString(), source_type: sourceType, domains };
}

async function locateDirectories(inputUrl: URL): Promise<ListingInspection[]> {
  const candidates = new Map<string, URL>();
  if (isDesignatedTargetUrl(inputUrl)) {
    inputUrl.hash = "";
    candidates.set(inputUrl.toString(), inputUrl);
  } else {
    const siteUrl = new URL("/", inputUrl.origin);
    const homepageHtml = await fetchPage(siteUrl);
    if (homepageHtml) {
      for (const link of findDirectoryLinks(stripNonContentHtml(homepageHtml), siteUrl)) {
        candidates.set(link.toString(), link);
      }
    }

    const knownPaths = [
      "/exhibitors", "/exhibitor-list", "/exhibitor-directory", "/participants",
      "/participant-list", "/vendors", "/vendor-directory", "/sellers",
      "/seller-directory", "/suppliers", "/supplier-directory", "/distributors",
      "/distributor-directory",
    ];
    for (const path of knownPaths) {
      const candidate = new URL(path, siteUrl);
      if (isDesignatedTargetUrl(candidate)) candidates.set(candidate.toString(), candidate);
    }
  }

  const inspections = await Promise.all(
    Array.from(candidates.values()).slice(0, 16).map((candidate) => inspectListing(candidate))
  );
  return inspections.filter((inspection): inspection is ListingInspection => inspection !== null)
    .sort((left, right) => right.domains.length - left.domains.length);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing auth token" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData.user) {
      return new Response(JSON.stringify({ error: "Invalid auth token" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const userId = userData.user.id;

    const { data: systemSettings, error: settingsError } = await supabase.from("system_settings")
      .select("maintenance_mode").eq("id", 1).single();
    if (settingsError || !systemSettings) {
      return new Response(JSON.stringify({ error: "System settings are unavailable." }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (systemSettings.maintenance_mode) {
      return new Response(JSON.stringify({ error: "The system is in maintenance mode." }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = await req.json();
    const action = body.action === "extract" ? "extract" : "preview";
    const source = typeof body.url === "string" ? body.url.trim() : "";
    if (!source) {
      return new Response(JSON.stringify({ error: "Enter a website domain or directory URL." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const normalizedInput = /^https?:\/\//i.test(source) ? source : `https://${source}`;
    let inputUrl: URL;
    try {
      inputUrl = new URL(normalizedInput);
    } catch {
      return new Response(JSON.stringify({ error: "Enter a valid website domain or directory URL." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!/^https?:$/.test(inputUrl.protocol) || inputUrl.username || inputUrl.password || !inputUrl.hostname.includes(".")) {
      return new Response(JSON.stringify({ error: "Only public HTTP or HTTPS website domains are supported." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "preview") {
      const inspections = await locateDirectories(inputUrl);
      if (inspections.length === 0) {
        return new Response(JSON.stringify({ error: "No validated exhibitor, participant, vendor, seller, supplier, or distributor directory was found on this site." }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const directory = inspections[0];
      return new Response(JSON.stringify({
        directory_url: directory.source_url,
        source_type: directory.source_type,
        total_listings: directory.domains.length,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const selectedUrl = typeof body.directory_url === "string" ? body.directory_url : "";
    let selectedDirectory: URL;
    try { selectedDirectory = new URL(selectedUrl); } catch {
      return new Response(JSON.stringify({ error: "The selected directory URL is invalid." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!isSameSite(selectedDirectory, inputUrl.hostname) || !isDesignatedTargetUrl(selectedDirectory)) {
      return new Response(JSON.stringify({ error: "The selected URL is not a validated directory on this site." }), { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const confirmedDirectory = await inspectListing(selectedDirectory);
    if (!confirmedDirectory) {
      return new Response(JSON.stringify({ error: "The directory changed or no longer contains valid listing records. No domains were saved." }), { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: creditData, error: creditError } = await supabase.rpc("consume_user_credits", {
      p_user_id: userId,
      p_amount: confirmedDirectory.domains.length,
      p_reason: "directory_listing_extraction",
    });
    const creditResult = Array.isArray(creditData) ? creditData[0] : creditData;
    if (creditError || !creditResult) {
      return new Response(JSON.stringify({ error: "Could not verify credit balance." }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!creditResult.allowed) {
      return new Response(JSON.stringify({
        error: `Not enough credits. This extraction needs ${confirmedDirectory.domains.length} credits; ${creditResult.total_remaining} remain.`,
        credits_remaining: creditResult.total_remaining,
      }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: run, error: runError } = await supabase
      .from("domain_parsing_runs")
      .insert({ user_id: userId, source_url: confirmedDirectory.source_url, source_type: confirmedDirectory.source_type, status: "completed", total_domains: confirmedDirectory.domains.length })
      .select().single();

    if (runError || !run) {
      return new Response(JSON.stringify({ error: "Failed to save parsing run" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const rows = confirmedDirectory.domains.map((domain) => ({ run_id: run.id, user_id: userId, domain: domain.domain, name: domain.name, category: domain.category, source_page_url: domain.source_page_url }));
    const { error: resultsError } = await supabase.from("domain_parse_results").insert(rows);
    if (resultsError) {
      await supabase.from("domain_parsing_runs").delete().eq("id", run.id).eq("user_id", userId);
      return new Response(JSON.stringify({ error: "Could not save directory listings." }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({
      run_id: run.id,
      source_url: confirmedDirectory.source_url,
      source_type: confirmedDirectory.source_type,
      total_domains: confirmedDirectory.domains.length,
      credits_remaining: creditResult.total_remaining,
      domains: confirmedDirectory.domains,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Internal server error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
