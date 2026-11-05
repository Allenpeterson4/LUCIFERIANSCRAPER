export interface CompanyRecord {
  business_name: string;
  domain: string;
  service_summary: string;
  category: string;
  source: "maps" | "website" | "exhibition" | "b2b";
}

export interface ScrapeResult {
  id: string;
  run_id: string;
  user_id: string;
  domain: string;
  business_name?: string | null;
  service_summary?: string | null;
  category?: string | null;
  emails: string[];
  status: string;
  pages_scanned: number;
  error: string | null;
  created_at: string;
}

export interface ScrapingRun {
  id: string;
  user_id: string;
  domain: string;
  is_bulk: boolean;
  status: string;
  total_emails: number;
  created_at: string;
  source_type: "website" | "maps";
  source_query: string | null;
  batch_label: string;
}

export interface ScrapeCampaignBatch {
  runId: string;
  batchLabel: string;
  emails: string[];
}

export interface ScrapeEdgeResponse {
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

export interface DomainParsingRun {
  id: string;
  user_id: string;
  source_url: string;
  source_type: string;
  status: string;
  total_domains: number;
  created_at: string;
}

export interface DomainParseResult {
  id: string;
  run_id: string;
  user_id: string;
  domain: string;
  name: string | null;
  business_name?: string | null;
  service_summary?: string | null;
  source?: "exhibition" | "b2b";
  category: string | null;
  source_page_url: string | null;
  created_at: string;
}

export interface ParseDomainsResponse {
  run_id: string;
  source_url: string;
  source_type: string;
  intent: string;
  total_domains: number;
  domains: Array<CompanyRecord & {
    name: string | null;
    source_page_url: string | null;
  }>;
}
