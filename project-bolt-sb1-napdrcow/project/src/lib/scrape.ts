import { supabase } from "@/lib/supabase";
import type { CompanyRecord } from "@/lib/types";

export interface ScrapeQueueResponse {
  run_id: string;
  queued: true;
  total_domains: number;
  valid_domains: number;
  credits_remaining: number;
  source_type: "website" | "maps";
}

export interface ScrapeProgress {
  current: number;
  completed: number;
  total: number;
  domain: string;
  phase: "queued" | "processing" | "completed";
}

export interface ScrapeResponseData {
  run_id: string;
  total_emails: number;
  domains_scraped: number;
  results: Array<CompanyRecord & {
    emails: string[];
    status: string;
    pages_scanned: number;
    error: string | null;
  }>;
}

export interface ScrapeOptions {
  sourceType?: "website" | "maps";
  sourceQuery?: string;
  batchLabel?: string;
  intent?: string;
}

export async function scrapeDomains(
  domains: string[],
  accessToken: string,
  options: ScrapeOptions = {},
): Promise<ScrapeQueueResponse> {
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/scrape-emails`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
      },
      body: JSON.stringify({
        action: "enqueue",
        domains,
        source_type: options.sourceType,
        source_query: options.sourceQuery,
        batch_label: options.batchLabel,
        intent: options.intent,
      }),
    });
  } catch {
    throw new Error("Could not connect to the scraping service. Please check your internet connection and try again.");
  }

  if (response.status === 401) {
    await supabase.auth.signOut();
    throw new Error("Your session has expired. Please sign in again.");
  }
  if (!response.ok) {
    let message = `Scraping could not be queued (status ${response.status}).`;
    try {
      const errorBody = await response.json();
      if (typeof errorBody?.error === "string") message = errorBody.error;
    } catch {
      // Keep the status message for a non-JSON response.
    }
    throw new Error(message);
  }

  const data = await response.json() as Partial<ScrapeQueueResponse> & { error?: string };
  if (!data.run_id || !Number.isInteger(data.total_domains)) {
    throw new Error(data.error ?? "The scraping service returned an invalid queue receipt.");
  }
  return {
    run_id: data.run_id,
    queued: true,
    total_domains: Number(data.total_domains),
    valid_domains: Number(data.valid_domains ?? 0),
    credits_remaining: Number(data.credits_remaining ?? 0),
    source_type: data.source_type === "maps" ? "maps" : "website",
  };
}

export async function waitForScrapeRun(
  runId: string,
  totalDomains: number,
  sourceType: "website" | "maps",
  onProgress: (progress: ScrapeProgress) => void,
): Promise<ScrapeResponseData> {
  const terminalStatuses = ["completed", "no_emails", "not_relevant", "failed"];

  while (true) {
    const [completedQuery, processingQuery, queuedQuery] = await Promise.all([
      supabase.from("scrape_domain_jobs").select("id", { count: "exact", head: true })
        .eq("run_id", runId).in("status", terminalStatuses),
      supabase.from("scrape_domain_jobs").select("ordinal,domain,status")
        .eq("run_id", runId).eq("status", "processing").order("ordinal").limit(1).maybeSingle(),
      supabase.from("scrape_domain_jobs").select("ordinal,domain,status")
        .eq("run_id", runId).eq("status", "queued").order("ordinal").limit(1).maybeSingle(),
    ]);
    const queryError = completedQuery.error ?? processingQuery.error ?? queuedQuery.error;
    if (queryError) throw queryError;

    const completed = completedQuery.count ?? 0;
    const activeJob = processingQuery.data ?? queuedQuery.data;
    const active = activeJob as { ordinal: number; domain: string; status: string } | null;
    onProgress({
      current: active?.ordinal ?? completed,
      completed,
      total: totalDomains,
      domain: active?.domain ?? "",
      phase: completed >= totalDomains ? "completed" : active?.status === "processing" ? "processing" : "queued",
    });

    if (completed >= totalDomains) break;
    await new Promise((resolve) => window.setTimeout(resolve, 2000));
  }

  const results: ScrapeResponseData["results"] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.from("scrape_results")
      .select("domain,business_name,service_summary,category,emails,status,pages_scanned,error")
      .eq("run_id", runId)
      .order("created_at", { ascending: true })
      .range(offset, offset + 999);
    if (error) throw error;
    const rows = data ?? [];
    results.push(...rows.map((row) => ({
      ...row,
      business_name: row.business_name ?? row.domain,
      service_summary: row.service_summary ?? "Core services not listed in source.",
      category: row.category ?? "Other",
      source: sourceType,
      emails: row.emails ?? [],
      status: row.status ?? "failed",
      pages_scanned: row.pages_scanned ?? 0,
      error: row.error,
    })));
    if (rows.length < 1000) break;
  }

  return {
    run_id: runId,
    total_emails: results.reduce((sum, result) => sum + result.emails.length, 0),
    domains_scraped: totalDomains,
    results,
  };
}
