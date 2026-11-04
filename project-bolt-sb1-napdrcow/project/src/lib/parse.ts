import type { ParseDomainsResponse } from "@/lib/types";

export interface DirectoryPreview {
  directory_url: string;
  source_type: string;
  total_listings: number;
}

async function callParseFunction<T>(body: Record<string, string>, accessToken: string): Promise<T> {
  const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/parse-domains`;
  const res = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const errBody = await res.json();
      if (errBody?.error) message = errBody.error;
    } catch {
      // ignore parse error
    }
    throw new Error(message);
  }

  const data = await res.json();
  if (!data) {
    throw new Error("Unexpected response from domain parsing service");
  }
  return data as T;
}

export function previewDomainDirectory(url: string, accessToken: string): Promise<DirectoryPreview> {
  return callParseFunction<DirectoryPreview>({ action: "preview", url }, accessToken);
}

export function extractDomainDirectory(
  url: string,
  directoryUrl: string,
  accessToken: string,
): Promise<ParseDomainsResponse> {
  return callParseFunction<ParseDomainsResponse>({ action: "extract", url, directory_url: directoryUrl }, accessToken);
}
