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

const SERVICE_EMAIL_DOMAIN_SUFFIXES = [
  "sentry.wixpress.com",
  "sentry-next.wixpress.com",
  "sentry.io",
];

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
  "Food & Beverage": ["food", "beverage", "restaurant", "catering", "wine", "drink"],
  "Fashion & Apparel": ["fashion", "apparel", "clothing", "textile", "garment", "footwear", "shoes"],
  Automotive: ["automotive", "vehicle", "mobility", "transport", "car"],
  Energy: ["energy", "solar", "wind", "renewable", "electric", "battery"],
  Finance: ["finance", "bank", "insurance", "fintech", "payment"],
  Logistics: ["logistics", "shipping", "freight", "cargo", "warehouse"],
  "Real Estate": ["real estate", "property", "realtor", "housing"],
  "Marketing & Media": ["marketing", "media", "advertising", "publishing", "broadcast"],
  Chemicals: ["chemical", "chemicals", "plastic", "polymer", "coating"],
};

function categoryFromText(text: string): string {
  const normalized = ` ${text.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim()} `;
  return Object.entries(BUSINESS_CATEGORIES).find(([, terms]) => terms.some((term) => {
    const normalizedTerm = ` ${term.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim()} `;
    return normalized.includes(normalizedTerm);
  }))?.[0] ?? "Other";
}

function inferIndustryIntent(text: string): string {
  const normalized = ` ${text.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim()} `;
  return Object.entries(BUSINESS_CATEGORIES)
    .filter(([, terms]) => terms.some((term) => {
      const normalizedTerm = ` ${term.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim()} `;
      return normalized.includes(normalizedTerm);
    }))
    .map(([category]) => category)
    .join(" ");
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
  const domain = e.slice(e.lastIndexOf("@") + 1).replace(/\.$/, "");
  if (JUNK_EMAILS.has(e)) return true;
  if (SERVICE_EMAIL_DOMAIN_SUFFIXES.some((suffix) => domain === suffix || domain.endsWith(`.${suffix}`))) return true;
  if (IMAGE_EXTENSIONS.some((ext) => e.endsWith(ext))) return true;
  if (e.startsWith("noreply@") || e.startsWith("no-reply@")) return true;
  if (e.startsWith("donotreply@")) return true;
  return false;
}

interface DomainTask {
  input: string;
  domain: string;
  startUrl: string | null;
  error: string | null;
}

interface ScrapeDomainJob {
  id: string;
  run_id: string;
  user_id: string;
  ordinal: number;
  input: string;
  domain: string;
  start_url: string | null;
  intent: string;
  source_type: "website" | "maps";
  status: string;
  attempts: number;
  error: string | null;
}

interface StoredScrapeResult {
  job_id: string;
  run_id: string;
  user_id: string;
  domain: string;
  business_name: string;
  service_summary: string;
  category: string;
  emails: string[];
  status: string;
  pages_scanned: number;
  error: string | null;
}

function parseDomainTask(input: string): DomainTask {
  const value = input.trim();
  if (!value) return { input: value, domain: "", startUrl: null, error: "Enter a domain such as example.com." };

  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) {
      return { input: value, domain: "", startUrl: null, error: "Only public HTTP or HTTPS websites are supported." };
    }
    const domain = url.hostname.toLowerCase().replace(/^www\./, "");
    const labels = domain.split(".");
    const validHostname = domain.length <= 253 && labels.length >= 2 && labels.every((label) =>
      label.length >= 1 && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label)
    );
    if (!validHostname) return { input: value, domain, startUrl: null, error: "This does not look like a valid public domain." };
    return { input: value, domain, startUrl: url.toString(), error: null };
  } catch {
    return { input: value, domain: "", startUrl: null, error: "This does not look like a valid website URL or domain." };
  }
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

function extractLinks(html: string, baseDomain: string, baseUrl = `https://${baseDomain}`): string[] {
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
      abs = new URL(href, baseUrl).toString();
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

async function scrapeDomain(domain: string, intent: string, source: "website" | "maps", startUrl?: string): Promise<{
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
    ...(startUrl ? [startUrl] : []),
    `https://${domain}`,
    `https://www.${domain}`,
    `http://${domain}`,
    `http://www.${domain}`,
  ];

  let homeHtml: string | null = null;
  let homeUrl = `https://${domain}`;
  for (const c of candidates) {
    homeHtml = await fetchWithTimeout(c, 6000, domain);
    if (homeHtml) {
      homeUrl = c;
      break;
    }
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
  const effectiveIntent = intent || inferIndustryIntent(`${domain} ${extractPageText(homeHtml).slice(0, 2000)} ${metadata.business_name} ${metadata.service_summary}`);
  const [reviewedCompany] = await filterRelevantCompanies(effectiveIntent, [{
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
  const links = prioritizeLinks(extractLinks(homeHtml, domain, homeUrl), effectiveIntent);
  for (const link of links) {
    if (allEmails.size >= 100) break;
    const html = await fetchWithTimeout(link, 6000, domain);
    pagesScanned += 1;
    if (html) {
      const [relevantPage] = await filterRelevantCompanies(effectiveIntent, [{
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
        const subLinks = prioritizeLinks(extractLinks(html, domain, link), effectiveIntent)
          .filter((l) => !links.includes(l))
          .slice(0, 3);
        for (const subLink of subLinks) {
          if (allEmails.size >= 50) break;
          const subHtml = await fetchWithTimeout(subLink, 5000, domain);
          pagesScanned += 1;
          if (subHtml) {
            const [relevantPage] = await filterRelevantCompanies(effectiveIntent, [{
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

async function finalizeScrapeRun(supabase: ReturnType<typeof createClient>, runId: string) {
  const { data: jobs, error: jobsError } = await supabase.from("scrape_domain_jobs").select("status").eq("run_id", runId);
  if (jobsError || !jobs) throw jobsError ?? new Error("Could not read scrape job states.");
  const terminalStatuses = new Set(["completed", "no_emails", "not_relevant", "failed"]);
  const allFinished = jobs.length > 0 && jobs.every((job) => terminalStatuses.has(job.status));
  const { data: results, error: resultsError } = await supabase.from("scrape_results").select("emails,status").eq("run_id", runId);
  if (resultsError || !results) throw resultsError ?? new Error("Could not read scrape results.");
  const totalEmails = results.reduce((sum, result) => sum + (result.emails?.length ?? 0), 0);
  const status = !allFinished ? "running" : jobs.every((job) => job.status === "failed") ? "failed" : "completed";
  const { error: updateError } = await supabase.from("scraping_runs").update({ status, total_emails: totalEmails }).eq("id", runId);
  if (updateError) throw updateError;
  return { status, totalEmails, completed: jobs.filter((job) => terminalStatuses.has(job.status)).length, total: jobs.length };
}

async function processScrapeJob(supabase: ReturnType<typeof createClient>, job: ScrapeDomainJob) {
  let result: StoredScrapeResult;
  if (job.error) {
    result = {
      job_id: job.id,
      run_id: job.run_id,
      user_id: job.user_id,
      domain: job.domain || job.input,
      business_name: job.domain || job.input,
      service_summary: "This entry could not be processed as a public website.",
      category: "Other",
      emails: [],
      status: "failed",
      pages_scanned: 0,
      error: job.error,
    };
  } else {
    try {
      const scraped = await scrapeDomain(job.domain, job.intent || inferIndustryIntent(job.input), job.source_type, job.start_url ?? undefined);
      result = {
        job_id: job.id,
        run_id: job.run_id,
        user_id: job.user_id,
        domain: job.domain,
        business_name: scraped.business_name,
        service_summary: scraped.service_summary,
        category: scraped.category,
        emails: scraped.emails,
        status: scraped.status,
        pages_scanned: scraped.pagesScanned,
        error: scraped.error,
      };
    } catch (error) {
      console.error(`Queued domain scrape failed for ${job.domain}:`, error instanceof Error ? error.message : "unknown error");
      result = {
        job_id: job.id,
        run_id: job.run_id,
        user_id: job.user_id,
        domain: job.domain,
        business_name: job.domain,
        service_summary: "The website could not be processed.",
        category: "Other",
        emails: [],
        status: "failed",
        pages_scanned: 0,
        error: "The site could not be reached or processed. Check the address and try again.",
      };
    }
  }

  const { data: stored, error: saveError } = await supabase.from("scrape_results")
    .upsert(result, { onConflict: "job_id" })
    .select("id")
    .single();
  if (saveError || !stored) throw saveError ?? new Error("Could not save this domain result.");

  const { error: jobUpdateError } = await supabase.from("scrape_domain_jobs").update({
    status: result.status,
    result_id: stored.id,
    error: result.error,
    locked_until: null,
    updated_at: new Date().toISOString(),
  }).eq("id", job.id);
  if (jobUpdateError) throw jobUpdateError;

  if (result.emails.length > 0) {
    const discoveredAt = new Date().toISOString();
    const contacts = [...new Set(result.emails.map((email) => email.trim().toLowerCase()).filter(Boolean))].map((email) => ({
      user_id: job.user_id,
      email,
      domain: job.domain,
      source_run_id: job.run_id,
      last_seen_at: discoveredAt,
    }));
    const { error: contactError } = await supabase.from("email_contacts").upsert(contacts, { onConflict: "user_id,email" });
    if (contactError) console.error(`Could not index queued emails for ${job.domain}:`, contactError.message);
  }

  const runState = await finalizeScrapeRun(supabase, job.run_id);
  return { result, run: runState };
}

async function kickScrapeWorker(supabaseUrl: string, dispatcherSecret: string) {
  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/scrape-emails`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Scrape-Dispatcher-Secret": dispatcherSecret },
      body: JSON.stringify({ action: "dispatch_due" }),
    });
    if (!response.ok) console.error("Could not kick scrape worker:", response.status);
  } catch (error) {
    console.error("Could not kick scrape worker:", error instanceof Error ? error.message : "unknown error");
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);
    const body = await req.json();

    if (body.action === "dispatch_due") {
      const dispatcherSecret = Deno.env.get("SCRAPE_DISPATCHER_SECRET");
      if (!dispatcherSecret || req.headers.get("x-scrape-dispatcher-secret") !== dispatcherSecret) {
        return new Response(JSON.stringify({ error: "Dispatcher access is required." }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: settings } = await supabase.from("system_settings").select("maintenance_mode").eq("id", 1).maybeSingle();
      if (settings?.maintenance_mode) return new Response(JSON.stringify({ success: true, paused: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

      const { data: jobs, error: claimError } = await supabase.rpc("claim_due_scrape_domain_jobs", { p_limit: 1 });
      if (claimError) {
        console.error("Could not claim a scrape job:", claimError.message);
        return new Response(JSON.stringify({ error: "Could not claim a queued domain." }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const job = (jobs as ScrapeDomainJob[] | null)?.[0];
      if (!job) return new Response(JSON.stringify({ success: true, processed: 0 }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

      const processed = await processScrapeJob(supabase, job);
      const nextSecret = Deno.env.get("SCRAPE_DISPATCHER_SECRET");
      if (nextSecret) EdgeRuntime.waitUntil(kickScrapeWorker(supabaseUrl, nextSecret));
      return new Response(JSON.stringify({ success: true, processed: 1, job_id: job.id, status: processed.result.status, run: processed.run }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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

    if (body.action === "enqueue") {
      const rawDomains: unknown[] = Array.isArray(body.domains) ? body.domains : [body.domain];
      const uniqueTasks = new Map<string, DomainTask>();
      for (const rawTarget of rawDomains) {
        const task = parseDomainTask(typeof rawTarget === "string" ? rawTarget : String(rawTarget ?? ""));
        if (!task.input) continue;
        const key = task.error ? task.input.toLowerCase() : task.domain;
        if (!uniqueTasks.has(key)) uniqueTasks.set(key, task);
      }
      const tasks = Array.from(uniqueTasks.values());
      if (tasks.length === 0) {
        return new Response(JSON.stringify({ error: "Enter at least one domain or website URL." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const sourceType = body.source_type === "maps" ? "maps" : "website";
      const sourceQuery = typeof body.source_query === "string" ? body.source_query.trim().slice(0, 200) : "";
      const intent = typeof body.intent === "string" ? body.intent.trim().slice(0, 200) : "";
      const batchLabel = typeof body.batch_label === "string" ? body.batch_label.trim().slice(0, 120) : "";
      const { data: queued, error: enqueueError } = await supabase.rpc("enqueue_scrape_batch", {
        p_user_id: userId,
        p_source_type: sourceType,
        p_source_query: sourceQuery || null,
        p_batch_label: batchLabel || null,
        p_intent: intent,
        p_tasks: tasks.map((task) => ({
          input: task.input,
          domain: task.domain,
          start_url: task.startUrl,
          error: task.error,
        })),
      });
      if (enqueueError || !queued) {
        const message = enqueueError?.message ?? "Could not add domains to the scrape queue.";
        const status = /not enough credits/i.test(message) ? 402 : 503;
        return new Response(JSON.stringify({ error: message }), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const dispatcherSecret = Deno.env.get("SCRAPE_DISPATCHER_SECRET");
      if (dispatcherSecret) EdgeRuntime.waitUntil(kickScrapeWorker(supabaseUrl, dispatcherSecret));
      return new Response(JSON.stringify({
        run_id: queued.run_id,
        queued: true,
        total_domains: queued.total_domains,
        valid_domains: queued.valid_domains,
        credits_remaining: queued.credits_remaining,
        source_type: sourceType,
      }), { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const rawDomains: unknown[] = Array.isArray(body.domains)
      ? body.domains
      : [body.domain];
    const uniqueTasks = new Map<string, DomainTask>();
    for (const rawTarget of rawDomains) {
      const task = parseDomainTask(typeof rawTarget === "string" ? rawTarget : String(rawTarget ?? ""));
      if (!task.input) continue;
      const key = task.error ? task.input.toLowerCase() : task.domain;
      if (!uniqueTasks.has(key)) uniqueTasks.set(key, task);
    }
    const tasks = Array.from(uniqueTasks.values());

    if (tasks.length === 0) {
      return new Response(JSON.stringify({ error: "No valid domains provided. Please enter a domain like example.com" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const maxDomains = Math.min(5, systemSettings.max_domains_per_run);
    if (tasks.length > maxDomains) {
      return new Response(JSON.stringify({ error: `This request exceeds the current limit of ${maxDomains} domains.` }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const validTasks = tasks.filter((task) => !task.error);
    const domainsToProcess = validTasks.map((task) => task.domain);
    let creditsRemaining: number | null = null;

    if (validTasks.length > 0) {
      const { data: creditData, error: creditError } = await supabase.rpc("consume_user_credits", {
        p_user_id: userId,
        p_amount: validTasks.length,
        p_reason: "email_domain_scrape",
      });
      const creditResult = Array.isArray(creditData) ? creditData[0] : creditData;
      if (creditError || !creditResult) {
        return new Response(JSON.stringify({ error: "Could not verify credit balance." }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      creditsRemaining = Number(creditResult.total_remaining);
      if (!creditResult.allowed) {
        return new Response(JSON.stringify({
          error: `Not enough credits. This scrape needs ${validTasks.length} credits; ${creditResult.total_remaining} remain.`,
          credits_remaining: creditResult.total_remaining,
        }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    const isBulk = tasks.length > 1;
    const primaryDomain = tasks[0].domain || tasks[0].input;
    const sourceType = body.source_type === "maps" ? "maps" : "website";
    const sourceQuery = typeof body.source_query === "string"
      ? body.source_query.trim().slice(0, 200) || null
      : null;
    const requestedIntent = typeof body.intent === "string" && body.intent.trim()
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
    type DomainResult = {
      domain: string;
      business_name: string;
      service_summary: string;
      category: string;
      source: "website" | "maps";
      emails: string[];
      status: string;
      pages_scanned: number;
      error: string | null;
    };

    const processBatch = async (emit: (event: Record<string, unknown>) => Promise<void>) => {
      const results: DomainResult[] = [];
      for (let index = 0; index < tasks.length; index += 1) {
        const task = tasks[index];
        const domain = task.domain || task.input;
        await emit({ type: "progress", current: index + 1, completed: index, total: tasks.length, domain, phase: "processing" });

        let result: DomainResult;
        if (task.error) {
          result = {
            domain,
            business_name: domain,
            service_summary: "This entry could not be processed as a public website.",
            category: "Other",
            source: sourceType,
            emails: [],
            status: "failed",
            pages_scanned: 0,
            error: task.error,
          };
        } else {
          try {
            const intent = requestedIntent || inferIndustryIntent(task.input);
            const scraped = await scrapeDomain(task.domain, intent, sourceType, task.startUrl ?? undefined);
            result = {
              domain: task.domain,
              business_name: scraped.business_name,
              service_summary: scraped.service_summary,
              category: scraped.category,
              source: sourceType,
              emails: scraped.emails,
              status: scraped.status,
              pages_scanned: scraped.pagesScanned,
              error: scraped.error,
            };
          } catch (error) {
            console.error(`Domain scrape failed for ${task.domain}:`, error instanceof Error ? error.message : "unknown error");
            result = {
              domain: task.domain,
              business_name: task.domain,
              service_summary: "The website could not be processed.",
              category: "Other",
              source: sourceType,
              emails: [],
              status: "failed",
              pages_scanned: 0,
              error: "The site could not be reached or processed. Check the address and try again.",
            };
          }
        }

        try {
          const { error: resultError } = await supabase.from("scrape_results").insert({
            run_id: runId,
            user_id: userId,
            domain: result.domain,
            business_name: result.business_name,
            service_summary: result.service_summary,
            category: result.category,
            emails: result.emails,
            status: result.status,
            pages_scanned: result.pages_scanned,
            error: result.error,
          });
          if (resultError) throw resultError;
        } catch (error) {
          console.error(`Could not save scrape result for ${domain}:`, error instanceof Error ? error.message : "unknown error");
          result.status = "failed";
          result.error = "The domain was processed, but its result could not be saved to history.";
        }

        await emit({ type: "result", result });
        results.push(result);
        await emit({ type: "progress", current: index + 1, completed: index + 1, total: tasks.length, domain, phase: "completed" });
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
        try {
          const { error: contactIndexError } = await supabase
            .from("email_contacts")
            .upsert([...uniqueContacts.values()], { onConflict: "user_id,email" });
          if (contactIndexError) throw contactIndexError;
        } catch (error) {
          console.error("Could not update the normalized email directory:", error instanceof Error ? error.message : "unknown error");
        }
      }

      const totalEmails = results.reduce((sum, result) => sum + result.emails.length, 0);
      const overallStatus = results.every((result) => result.status === "failed") ? "failed" : "completed";
      try {
        const { error: runUpdateError } = await supabase.from("scraping_runs")
          .update({ status: overallStatus, total_emails: totalEmails }).eq("id", runId);
        if (runUpdateError) throw runUpdateError;
      } catch (error) {
        console.error("Could not finalize scrape history:", error instanceof Error ? error.message : "unknown error");
      }

      return {
        run_id: runId,
        total_emails: totalEmails,
        domains_scraped: tasks.length,
        credits_remaining: creditsRemaining,
        results,
      };
    };

    if (body.stream === true) {
      const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
      const writer = writable.getWriter();
      const encoder = new TextEncoder();
      let writeQueue = Promise.resolve();
      const emit = (event: Record<string, unknown>) => {
        writeQueue = writeQueue.then(() => writer.write(encoder.encode(`${JSON.stringify(event)}\n`))).catch(() => undefined);
        return writeQueue;
      };
      void (async () => {
        try {
          const payload = await processBatch(emit);
          await emit({ type: "complete", ...payload });
        } catch (error) {
          await emit({ type: "error", error: error instanceof Error ? error.message : "The batch could not be completed." });
        } finally {
          await writeQueue;
          try { await writer.close(); } catch { /* client may have disconnected */ }
        }
      })();
      return new Response(readable, {
        headers: { ...corsHeaders, "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache" },
      });
    }

    const payload = await processBatch(async () => undefined);
    return new Response(JSON.stringify(payload), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "An unexpected error occurred during scraping." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
