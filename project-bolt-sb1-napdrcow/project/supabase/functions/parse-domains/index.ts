import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

const EXHIBITION_KEYWORDS = [
  "exhibit", "exhibitor", "expo", "trade show", "trade fair",
  "fair", "stand", "booth", "hall", "pavilion", "messe",
];

const B2B_KEYWORDS = [
  "marketplace", "supplier", "seller", "vendor", "manufacturer",
  "wholesale", "distributor", "factory", "alibaba", "amazon",
  "ebay", "etsy", "seller list", "store list",
];

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

function detectSourceType(url: string, html: string): string {
  const combined = (url + " " + html).toLowerCase();
  if (EXHIBITION_KEYWORDS.some((k) => combined.includes(k))) return "exhibition";
  if (B2B_KEYWORDS.some((k) => combined.includes(k))) return "b2b";
  return "generic";
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

  // 1. Extract from <a href> links
  const linkRegex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = linkRegex.exec(html)) !== null) {
    const href = match[1];
    const linkText = match[2].replace(/<[^>]*>/g, "").trim();
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("javascript:")) continue;
    let abs: string;
    try { abs = new URL(href, sourceUrl).toString(); } catch { continue; }
    let u: URL;
    try { u = new URL(abs); } catch { continue; }
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    if (!host || !host.includes(".")) continue;
    if (baseHost && (host === baseHost || host.endsWith("." + baseHost))) continue;
    if (isSocialOrUtility(host)) continue;
    const root = extractRootDomain(host);
    if (isCommonPublicSuffix(root)) continue;
    if (!domainMap.has(root)) {
      domainMap.set(root, { domain: root, name: linkText.slice(0, 120) || null, category: categorize(linkText + " " + root), source_page_url: abs });
    }
  }

  // 2. Extract bare domain mentions in text
  const bareDomainRegex = /(?:https?:\/\/)?(?:www\.)?([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.[a-z]{2,}(?:\.[a-z]{2,})?)/gi;
  while ((match = bareDomainRegex.exec(html)) !== null) {
    let host = match[1].toLowerCase().split("/")[0];
    if (!host.includes(".")) continue;
    if (baseHost && (host === baseHost || host.endsWith("." + baseHost))) continue;
    if (isSocialOrUtility(host)) continue;
    const root = extractRootDomain(host);
    if (isCommonPublicSuffix(root)) continue;
    if (!domainMap.has(root)) {
      const idx = match.index;
      const surrounding = html.slice(Math.max(0, idx - 80), idx + match[0].length + 80);
      const textAround = surrounding.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
      domainMap.set(root, { domain: root, name: textAround.slice(0, 120) || null, category: categorize(root), source_page_url: null });
    }
  }

  // 3. Extract from email addresses
  EMAIL_REGEX.lastIndex = 0;
  while ((match = EMAIL_REGEX.exec(html)) !== null) {
    const email = match[0].toLowerCase();
    const atIdx = email.indexOf("@");
    if (atIdx < 0) continue;
    const host = email.slice(atIdx + 1);
    if (!host || !host.includes(".")) continue;
    if (baseHost && (host === baseHost || host.endsWith("." + baseHost))) continue;
    if (isSocialOrUtility(host)) continue;
    const root = extractRootDomain(host);
    if (isCommonPublicSuffix(root)) continue;
    if (!domainMap.has(root)) {
      domainMap.set(root, { domain: root, name: null, category: categorize(root), source_page_url: null });
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

    const body = await req.json();
    const sourceUrl: string = (body.url || body.source_url || "").trim();
    if (!sourceUrl) {
      return new Response(JSON.stringify({ error: "No URL provided" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let normalizedUrl = sourceUrl;
    if (!/^https?:\/\//i.test(normalizedUrl)) normalizedUrl = "https://" + normalizedUrl;

    let html = await fetchWithTimeout(normalizedUrl);
    if (!html) {
      const httpUrl = normalizedUrl.replace(/^https:/, "http:");
      html = await fetchWithTimeout(httpUrl);
    }

    if (!html) {
      return new Response(JSON.stringify({ error: "Could not fetch the provided URL. The site may be unreachable or blocking automated requests." }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const sourceType = detectSourceType(normalizedUrl, html);
    const domains = extractDomainsFromHtml(html, normalizedUrl);

    if (domains.length === 0) {
      return new Response(JSON.stringify({ error: "No exhibitor or seller domains were found on this page. The page may use JavaScript rendering or require a different URL." }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: run, error: runError } = await supabase
      .from("domain_parsing_runs")
      .insert({ user_id: userId, source_url: normalizedUrl, source_type: sourceType, status: "completed", total_domains: domains.length })
      .select().single();

    if (runError || !run) {
      return new Response(JSON.stringify({ error: "Failed to save parsing run" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const rows = domains.map((d) => ({ run_id: run.id, user_id: userId, domain: d.domain, name: d.name, category: d.category, source_page_url: d.source_page_url }));
    await supabase.from("domain_parse_results").insert(rows);

    return new Response(JSON.stringify({ run_id: run.id, source_url: normalizedUrl, source_type: sourceType, total_domains: domains.length, domains }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || "Internal server error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
