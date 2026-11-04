export interface ScrapeResult {
  id: string;
  run_id: string;
  user_id: string;
  domain: string;
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
}

export interface ScrapeEdgeResponse {
  run_id: string;
  total_emails: number;
  domains_scraped: number;
  results: Array<{
    domain: string;
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
  category: string | null;
  source_page_url: string | null;
  created_at: string;
}

export interface ParseDomainsResponse {
  run_id: string;
  source_url: string;
  source_type: string;
  total_domains: number;
  domains: Array<{
    domain: string;
    name: string | null;
    category: string;
    source_page_url: string | null;
  }>;
}
