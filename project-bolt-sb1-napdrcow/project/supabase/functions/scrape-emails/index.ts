import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { filterRelevantCompanies } from "../_shared/company-intent.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

const JUNK_EMAILS = new Set([
  "sentry@weave.com", "noreply@github.com", "noreply@vercel.com",
  "example@example.com", "test@test.com", "user@example.com",
  "name@example.com", "email@example.com", "you@example.com",
  "your@email.com", "noreply@example.com",
]);

const IMAGE_EXTENSIONS = [".png", ".jpg", ".gif", ".svg", ".webp", ".ico", ".bmp"];
const IRRELEVANT_URL_SEGMENTS = new Set([
  "affiliate", "affiliates", "career", "careers", "cookie", "cookies", "job", "jobs",
  "legal", "partner", "partners", "partnership", "partnerships", "policy", "policies",
  "privacy", "terms",
]);

const BUSINESS_CATEGORIES: Record<string, string[]> = {
  Construction: ["construction", "builder", "contractor", "building", "infrastructure", "architect"],
  Education: ["education", "school", "university", "college", "academy", "institute", "training", "learning"],
  Healthcare: ["healthcare", "medical", "clinic", "hospital", "pharma", "biotech"],
  Manufacturing: ["manufacturing", "manufacturer", "factory", "industrial", "production", "machinery"],
  Technology: ["technology", "software", "digital", "cloud", "saas", "information technology"],
  Agriculture: ["agriculture", "agricultural", "farming", "farm", "crop", "livestock"],
};

function categoryFromText(text: string): string {
  const normalized = text.toLowerCase();
  return Object.entries(BUSINESS_CATEGORIES).find(([, terms]) => terms.some((term) => normalized.includes(term)))?.[0] ?? "Other";
}

function extractPageText(html: string): string {
  return html.replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ").trim();
}

function companyMetadata(html: string, domain: string) {
  const metaTags = html.match(/<meta\b[^>]*>/gi) ?? [];
  const readMeta = (names: string[]) => {
    for (const tag of metaTags) {
      const key = tag.match(/(?:name|property)=["']([^"']+)["']/i)?.[1]?.toLowerCase();
      if (!key || !names.includes(key)) continue;
      const content = tag.match(/content=["']([^"']*)["']/i)?.[1];
      if (content) return content.replace(/&amp;/gi, "&").replace(/&nbsp;|&#160;/gi, " ").trim();
    }
    return "";
  };
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
    ?.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim() ?? "";
  const businessName = readMeta(["og:site_name", "application-name"]) || title.split(/\s[|–—-]\s/)[0] || domain;
  const serviceSummary = readMeta(["description", "og:description", "twitter:description"])
    .slice(0, 240) || "Core services not listed in source.";
  return { business_name: businessName.slice(0, 120), service_summary: serviceSummary, category: categoryFromText(`${businessName} ${serviceSummary}`) };
}

function isIrrelevantPath(value: string): boolean {
  try {
    const url = new URL(value);
    const segments = `${url.pathname} ${url.search}`.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    return segments.some((segment) => IRRELEVANT_URL_SEGMENTS.has(segment));
  } catch {
    return true;
  }
}

function isJunkEmail(email: string): boolean {
  const e = email.toLowerCase();
  if (JUNK_EMAILS.has(e)) return true;
  if (IMAGE_EXTENSIONS.some((ext) => e.endsWith(ext))) return true;
  if (e.startsWith("noreply@") || e.startsWith("no-reply@")) return true;
  if (e.startsWith("donotreply@")) return true;
  return false;
}

function normalizeDomain(input: string): string {
  let d = input.trim().toLowerCase();
  d = d.replace(/^https?:\/\//, "").replace(/^www\./, "");
  d = d.split("/")[0];
  return d;
}

async function fetchWithTimeout(url: string, timeoutMs = 6000, allowedDomain?: string): Promise<string | null> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate",
        Connection: "keep-alive",
        "Upgrade-Insecure-Requests": "1",
      },
      redirect: "follow",
    });
    if (res.status >= 200 && res.status < 400) {
      if (allowedDomain) {
        const finalHost = new URL(res.url).hostname.toLowerCase();
        if (finalHost !== allowedDomain && !finalHost.endsWith(`.${allowedDomain}`)) return null;
      }
      return await res.text();
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function extractEmailsFromHtml(html: string): string[] {
  const found = new Set<string>();

  // 1. Standard email regex
  let match: RegExpExecArray | null;
  EMAIL_REGEX.lastIndex = 0;
  while ((match = EMAIL_REGEX.exec(html)) !== null) {
    const email = match[0].toLowerCase();
    if (!isJunkEmail(email)) found.add(email);
  }

  // 2. mailto: links
  const mailtoRegex = /mailto:\s*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi;
  mailtoRegex.lastIndex = 0;
  while ((match = mailtoRegex.exec(html)) !== null) {
    const email = match[1].toLowerCase();
    if (!isJunkEmail(email)) found.add(email);
  }

  // 3. HTML entity encoded @ (&#64; or &commat;)
  const entityRegex = /[a-zA-Z0-9._%+-]+(?:&#64;|&commat;|&amp;#64;)[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  entityRegex.lastIndex = 0;
  while ((match = entityRegex.exec(html)) !== null) {
    const email = match[0].replace(/&#64;|&commat;|&amp;#64;/g, "@").toLowerCase();
    if (!isJunkEmail(email)) found.add(email);
  }

  // 4. Dot/obfuscated emails: name [at] domain [dot] com, name (at) domain (dot) com
  const obfuscatedRegex = /[a-zA-Z0-9._%+-]+\s*(?:\[(?:at|@)\]|\((?:at|@)\)|\{(?:at|@)\})\s*[a-zA-Z0-9.-]+\s*(?:\[(?:dot|\.)\]|\((?:dot|\.)\)|\{(?:dot|\.)\})\s*[a-zA-Z]{2,}/gi;
  obfuscatedRegex.lastIndex = 0;
  while ((match = obfuscatedRegex.exec(html)) !== null) {
    const email = match[0]
      .replace(/\s*/g, "")
      .replace(/\[(?:at|@)\]|\((?:at|@)\)|\{(?:at|@)\}/g, "@")
      .replace(/\[(?:dot|\.)\]|\((?:dot|\.)\)|\{(?:dot|\.)\}/g, ".")
      .toLowerCase();
    if (email.includes("@") && email.includes(".") && !isJunkEmail(email)) {
      found.add(email);
    }
  }

  // 5. "name at domain dot com" plain text pattern
  const textRegex = /\b([a-zA-Z0-9._%+-]+)\s+at\s+([a-zA-Z0-9][a-zA-Z0-9.-]+)\s+dot\s+([a-zA-Z]{2,})\b/gi;
  textRegex.lastIndex = 0;
  while ((match = textRegex.exec(html)) !== null) {
    const email = `${match[1]}@${match[2]}.${match[3]}`.toLowerCase();
    if (!isJunkEmail(email)) found.add(email);
  }

  // 6. Emails in JSON-LD structured data
  const jsonLdRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  jsonLdRegex.lastIndex = 0;
  while ((match = jsonLdRegex.exec(html)) !== null) {
    try {
      const jsonStr = match[1];
      EMAIL_REGEX.lastIndex = 0;
      let m2: RegExpExecArray | null;
      while ((m2 = EMAIL_REGEX.exec(jsonStr)) !== null) {
        const email = m2[0].toLowerCase();
        if (!isJunkEmail(email)) found.add(email);
      }
    } catch {
      // ignore JSON parse errors
    }
  }

  // 7. Emails in <meta> tags (e.g. reply-to, author)
  const metaRegex = /<meta[^>]+content=["']([^"']*@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})["']/gi;
  metaRegex.lastIndex = 0;
  while ((match = metaRegex.exec(html)) !== null) {
    const inner = match[1];
    EMAIL_REGEX.lastIndex = 0;
    let m2: RegExpExecArray | null;
    while ((m2 = EMAIL_REGEX.exec(inner)) !== null) {
      const email = m2[0].toLowerCase();
      if (!isJunkEmail(email)) found.add(email);
    }
  }

  return Array.from(found);
}

function extractLinks(html: string, baseDomain: string): string[] {
  const links = new Set<string>();
  const linkRegex = /href=["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;
  linkRegex.lastIndex = 0;
  while ((match = linkRegex.exec(html)) !== null) {
    const href = match[1];
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("javascript:")) {
      continue;
    }
    let abs: string;
    try {
      abs = new URL(href, `https://${baseDomain}`).toString();
    } catch {
      continue;
    }
    try {
      const u = new URL(abs);
      if ((u.hostname === baseDomain || u.hostname.endsWith(`.${baseDomain}`)) && !isIrrelevantPath(abs)) {
        links.add(abs);
      }
    } catch {
      // skip invalid
    }
  }
  return Array.from(links);
}

const CONTACT_KEYWORDS = [
  "contact", "kontakt", "about", "team", "support", "help", "staff", "people",
  "sales", "info", "reach", "connect", "services", "products", "solutions", "capabilities", "directory",
];

function prioritizeLinks(links: string[], intent = ""): string[] {
  const priority: string[] = [];
  const rest: string[] = [];
  const seen = new Set<string>();
  const intentTerms = intent.toLowerCase().split(/[^a-z0-9]+/).filter((term) => term.length > 2 && !["and", "for", "the", "with"].includes(term));
  const businessPageMarkers = ["about", "contact", "team", "service", "product", "solution", "capability", "expertise", "industry", "project", "portfolio", "work", "company"];
  for (const l of links) {
    if (seen.has(l)) continue;
    seen.add(l);
    if (isIrrelevantPath(l)) continue;
    const lower = l.toLowerCase();
    const matchesIntent = intentTerms.some((term) => lower.includes(term));
    const isBusinessPage = businessPageMarkers.some((marker) => lower.includes(marker));
    if (matchesIntent || isBusinessPage || CONTACT_KEYWORDS.some((k) => lower.includes(k))) {
      priority.push(l);
    } else if (intentTerms.length === 0) {
      rest.push(l);
    }
  }
  return intentTerms.length > 0 ? priority.slice(0, 12) : [...priority.slice(0, 8), ...rest.slice(0, 4)];
}

async function scrapeDomain(domain: string, intent: string, source: "website" | "maps"): Promise<{
  business_name: string;
  emails: string[];
  service_summary: string;
  category: string;
  pagesScanned: number;
  status: string;
  error: string | null;
}> {
  const allEmails = new Set<string>();
  let pagesScanned = 0;

  const candidates = [
    `https://${domain}`,
    `https://www.${domain}`,
    `http://${domain}`,
    `http://www.${domain}`,
  ];

  let homeHtml: string | null = null;
  for (const c of candidates) {
    homeHtml = await fetchWithTimeout(c, 6000, domain);
    if (homeHtml) break;
  }

  if (!homeHtml) {
    return {
      business_name: domain,
      emails: [],
      service_summary: "Core services not listed in source.",
      category: "Other",
      pagesScanned: 0,
      status: "failed",
      error: "Could not reach the domain. The site may be down, blocking automated requests, or requiring JavaScript to render.",
    };
  }
  const metadata = companyMetadata(homeHtml, domain);
  const [reviewedCompany] = await filterRelevantCompanies(intent, [{
    ...metadata,
    domain,
    source,
    source_context: extractPageText(homeHtml).slice(0, 2000),
  }]);
  if (!reviewedCompany) {
    return {
      ...metadata,
      emails: [],
      pagesScanned: 1,
      status: "not_relevant",
      error: "The source content did not match the requested business focus.",
    };
  }
  const verifiedMetadata = {
    business_name: reviewedCompany.business_name,
    service_summary: reviewedCompany.service_summary,
    category: reviewedCompany.category,
  };
  pagesScanned += 1;
  extractEmailsFromHtml(homeHtml).forEach((e) => allEmails.add(e));

  // Crawl sub-pages
  const links = prioritizeLinks(extractLinks(homeHtml, domain), intent);
  for (const link of links) {
    if (allEmails.size >= 100) break;
    const html = await fetchWithTimeout(link, 6000, domain);
    pagesScanned += 1;
    if (html) {
      const [relevantPage] = await filterRelevantCompanies(intent, [{
        ...verifiedMetadata,
        domain,
        source,
        service_summary: verifiedMetadata.service_summary,
        source_context: extractPageText(html).slice(0, 1200),
      }]);
      if (!relevantPage) continue;
      extractEmailsFromHtml(html).forEach((e) => allEmails.add(e));
      // Also extract links from sub-pages and crawl one level deeper for contact pages
      if (allEmails.size < 20) {
        const subLinks = prioritizeLinks(extractLinks(html, domain), intent)
          .filter((l) => !links.includes(l))
          .slice(0, 3);
        for (const subLink of subLinks) {
          if (allEmails.size >= 50) break;
          const subHtml = await fetchWithTimeout(subLink, 5000, domain);
          pagesScanned += 1;
          if (subHtml) {
            const [relevantPage] = await filterRelevantCompanies(intent, [{
              ...verifiedMetadata,
              domain,
              source,
              service_summary: verifiedMetadata.service_summary,
              source_context: extractPageText(subHtml).slice(0, 1200),
            }]);
            if (!relevantPage) continue;
            extractEmailsFromHtml(subHtml).forEach((e) => allEmails.add(e));
          }
        }
      }
    }
  }

  const emails = Array.from(allEmails);
  if (emails.length === 0) {
    return {
      ...verifiedMetadata,
      emails: [],
      pagesScanned,
      status: "no_emails",
      error: null,
    };
  }
  return { ...verifiedMetadata, emails, pagesScanned, status: "completed", error: null };
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
      return new Response(JSON.stringify({ error: "Missing auth token. Please sign in again." }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData.user) {
      return new Response(JSON.stringify({ error: "Your session has expired. Please sign in again." }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

    const { data: systemSettings, error: settingsError } = await supabase.from("system_settings")
      .select("maintenance_mode,max_domains_per_run").eq("id", 1).single();
    if (settingsError || !systemSettings) {
      return new Response(JSON.stringify({ error: "System settings are unavailable." }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (systemSettings.maintenance_mode) {
      return new Response(JSON.stringify({ error: "The system is in maintenance mode." }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = await req.json();
    const rawDomains: string[] = Array.isArray(body.domains)
      ? body.domains
      : [body.domain];
    const domains = Array.from(
      new Set(
        rawDomains
          .map(normalizeDomain)
          .filter((d) => d.length > 0 && d.includes("."))
      )
    ) as string[];

    if (domains.length === 0) {
      return new Response(JSON.stringify({ error: "No valid domains provided. Please enter a domain like example.com" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const maxDomains = Math.min(5, systemSettings.max_domains_per_run);
    if (domains.length > maxDomains) {
      return new Response(JSON.stringify({ error: `This request exceeds the current limit of ${maxDomains} domains.` }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const domainsToProcess = domains;

    const { data: creditData, error: creditError } = await supabase.rpc("consume_user_credits", {
      p_user_id: userId,
      p_amount: domainsToProcess.length,
      p_reason: "email_domain_scrape",
    });
    const creditResult = Array.isArray(creditData) ? creditData[0] : creditData;
    if (creditError || !creditResult) {
      return new Response(JSON.stringify({ error: "Could not verify credit balance." }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!creditResult.allowed) {
      return new Response(JSON.stringify({
        error: `Not enough credits. This scrape needs ${domainsToProcess.length} credits; ${creditResult.total_remaining} remain.`,
        credits_remaining: creditResult.total_remaining,
      }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const isBulk = domainsToProcess.length > 1;
    const primaryDomain = domainsToProcess[0];
    const sourceType = body.source_type === "maps" ? "maps" : "website";
    const sourceQuery = typeof body.source_query === "string"
      ? body.source_query.trim().slice(0, 200) || null
      : null;
    const intent = typeof body.intent === "string" && body.intent.trim()
      ? body.intent.trim().slice(0, 200)
      : sourceQuery ?? "";
    const requestedLabel = typeof body.batch_label === "string"
      ? body.batch_label.trim().slice(0, 120)
      : "";

    const { data: run, error: runError } = await supabase
      .from("scraping_runs")
      .insert({
        user_id: userId,
        domain: primaryDomain,
        is_bulk: isBulk,
        status: "running",
        source_type: sourceType,
        source_query: sourceQuery,
        batch_label: requestedLabel || `${sourceType === "maps" ? "Maps" : "Website"}: ${sourceQuery || primaryDomain}`,
      })
      .select()
      .single();

    if (runError || !run) {
      return new Response(
        JSON.stringify({ error: "Failed to create scraping run in the database." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const runId = run.id;
    const results: Array<{
      domain: string;
      business_name: string;
      service_summary: string;
      category: string;
      source: "website" | "maps";
      emails: string[];
      status: string;
      pages_scanned: number;
      error: string | null;
    }> = [];

    for (const domain of domainsToProcess) {
      const r = await scrapeDomain(domain, intent, sourceType);
      results.push({
        domain,
        business_name: r.business_name,
        service_summary: r.service_summary,
        category: r.category,
        source: sourceType,
        emails: r.emails,
        status: r.status,
        pages_scanned: r.pagesScanned,
        error: r.error,
      });
      await supabase.from("scrape_results").insert({
        run_id: runId,
        user_id: userId,
        domain,
        business_name: r.business_name,
        service_summary: r.service_summary,
        category: r.category,
        emails: r.emails,
        status: r.status,
        pages_scanned: r.pagesScanned,
        error: r.error,
      });
    }

    const discoveredAt = new Date().toISOString();
    const uniqueContacts = new Map<string, { user_id: string; email: string; domain: string; source_run_id: string; last_seen_at: string }>();
    for (const result of results) {
      for (const rawEmail of result.emails) {
        const email = rawEmail.trim().toLowerCase();
        if (!email) continue;
        uniqueContacts.set(email, {
          user_id: userId,
          email,
          domain: result.domain,
          source_run_id: runId,
          last_seen_at: discoveredAt,
        });
      }
    }
    if (uniqueContacts.size > 0) {
      const { error: contactIndexError } = await supabase
        .from("email_contacts")
        .upsert([...uniqueContacts.values()], { onConflict: "user_id,email" });
      if (contactIndexError) {
        console.error("Could not update the normalized email directory:", contactIndexError.message);
      }
    }

    const totalEmails = results.reduce((sum, r) => sum + r.emails.length, 0);
    const anyFailed = results.some((r) => r.status === "failed");
    const overallStatus = anyFailed && totalEmails === 0 ? "failed" : "completed";

    await supabase
      .from("scraping_runs")
      .update({ status: overallStatus, total_emails: totalEmails })
      .eq("id", runId);

    return new Response(
      JSON.stringify({
        run_id: runId,
        total_emails: totalEmails,
        domains_scraped: domainsToProcess.length,
        credits_remaining: creditResult.total_remaining,
        results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "An unexpected error occurred during scraping." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
