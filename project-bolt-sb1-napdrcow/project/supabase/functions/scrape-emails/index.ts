import { createClient } from "npm:@supabase/supabase-js@2.57.4";

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

async function fetchWithTimeout(url: string, timeoutMs = 6000): Promise<string | null> {
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
      if (u.hostname.endsWith(baseDomain) || u.hostname === baseDomain) {
        links.add(abs);
      }
    } catch {
      // skip invalid
    }
  }
  return Array.from(links);
}

const CONTACT_KEYWORDS = [
  "contact", "kontakt", "about", "team", "imprint",
  "privacy", "legal", "support", "help", "staff", "people",
  "sales", "info", "reach", "connect", "directory",
];

function prioritizeLinks(links: string[]): string[] {
  const priority: string[] = [];
  const rest: string[] = [];
  const seen = new Set<string>();
  for (const l of links) {
    if (seen.has(l)) continue;
    seen.add(l);
    const lower = l.toLowerCase();
    if (CONTACT_KEYWORDS.some((k) => lower.includes(k))) {
      priority.push(l);
    } else {
      rest.push(l);
    }
  }
  // Take up to 8 contact-priority pages, plus 4 other pages = max 12 sub-pages
  return [...priority.slice(0, 8), ...rest.slice(0, 4)];
}

async function scrapeDomain(domain: string): Promise<{
  emails: string[];
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
    homeHtml = await fetchWithTimeout(c, 6000);
    if (homeHtml) break;
  }

  if (!homeHtml) {
    return {
      emails: [],
      pagesScanned: 0,
      status: "failed",
      error: "Could not reach the domain. The site may be down, blocking automated requests, or requiring JavaScript to render.",
    };
  }
  pagesScanned += 1;
  extractEmailsFromHtml(homeHtml).forEach((e) => allEmails.add(e));

  // Crawl sub-pages
  const links = prioritizeLinks(extractLinks(homeHtml, domain));
  for (const link of links) {
    if (allEmails.size >= 100) break;
    const html = await fetchWithTimeout(link, 6000);
    pagesScanned += 1;
    if (html) {
      extractEmailsFromHtml(html).forEach((e) => allEmails.add(e));
      // Also extract links from sub-pages and crawl one level deeper for contact pages
      if (allEmails.size < 20) {
        const subLinks = prioritizeLinks(extractLinks(html, domain))
          .filter((l) => !links.includes(l))
          .slice(0, 3);
        for (const subLink of subLinks) {
          if (allEmails.size >= 50) break;
          const subHtml = await fetchWithTimeout(subLink, 5000);
          pagesScanned += 1;
          if (subHtml) {
            extractEmailsFromHtml(subHtml).forEach((e) => allEmails.add(e));
          }
        }
      }
    }
  }

  const emails = Array.from(allEmails);
  if (emails.length === 0) {
    return {
      emails: [],
      pagesScanned,
      status: "no_emails",
      error: null,
    };
  }
  return { emails, pagesScanned, status: "completed", error: null };
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
      emails: string[];
      status: string;
      pages_scanned: number;
      error: string | null;
    }> = [];

    for (const domain of domainsToProcess) {
      const r = await scrapeDomain(domain);
      results.push({
        domain,
        emails: r.emails,
        status: r.status,
        pages_scanned: r.pagesScanned,
        error: r.error,
      });
      await supabase.from("scrape_results").insert({
        run_id: runId,
        user_id: userId,
        domain,
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
