import type { ParseDomainsResponse } from "@/lib/types";

export async function parseDomainsFromUrl(
  url: string,
  accessToken: string
): Promise<ParseDomainsResponse> {
  const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/parse-domains`;
  const res = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
    },
    body: JSON.stringify({ url }),
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
  if (!data || !data.domains) {
    throw new Error("Unexpected response from domain parsing service");
  }
  return data as ParseDomainsResponse;
}
