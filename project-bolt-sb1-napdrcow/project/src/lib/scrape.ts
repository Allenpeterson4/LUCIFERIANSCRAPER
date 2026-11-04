import { supabase } from "@/lib/supabase";

export interface ScrapeResponseData {
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

export async function scrapeDomains(
  domains: string[],
  accessToken: string
): Promise<ScrapeResponseData> {
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/scrape-emails`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
      },
      body: JSON.stringify({ domains }),
    });
  } catch {
    throw new Error(
      "Could not connect to the scraping service. Please check your internet connection and try again."
    );
  }

  if (res.status === 401) {
    await supabase.auth.signOut();
    throw new Error("Your session has expired. Please sign in again.");
  }

  if (!res.ok) {
    let message = `Scraping failed (status ${res.status})`;
    try {
      const errBody = await res.json();
      if (errBody?.error) message = errBody.error;
    } catch {
      // response wasn't JSON — keep default message
    }
    throw new Error(message);
  }

  let data: ScrapeResponseData;
  try {
    data = await res.json();
  } catch {
    throw new Error("Received an invalid response from the scraping service.");
  }

  if (!data || !Array.isArray(data.results)) {
    throw new Error("The scraping service returned an unexpected response.");
  }
  return data;
}
