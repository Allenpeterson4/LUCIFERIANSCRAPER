const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const addressPattern = /^(?=.{1,254}$)(?=.{1,64}@)[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);

  try {
    const payload = await req.json();
    if (!Array.isArray(payload?.emails) || payload.emails.length === 0 || payload.emails.length > 2000) {
      return jsonResponse({ error: "Provide between 1 and 2,000 email addresses." }, 400);
    }
    if (payload.emails.some((email: unknown) => typeof email !== "string" || email.length > 320)) {
      return jsonResponse({ error: "Each address must be text no longer than 320 characters." }, 400);
    }

    const seen = new Set<string>();
    const results = payload.emails.map((value: string) => {
      const email = value.trim();
      const normalized = email.toLowerCase();
      if (!addressPattern.test(normalized)) {
        return { email, status: "invalid", reason: "Address does not match the supported email syntax." };
      }
      if (seen.has(normalized)) {
        return { email, status: "duplicate", reason: "This address appeared earlier in the submitted batch." };
      }
      seen.add(normalized);
      return { email, status: "syntax_valid", reason: null };
    });

    return jsonResponse({
      results,
      summary: {
        totalProcessed: results.length,
        syntaxValidCount: results.filter((result) => result.status === "syntax_valid").length,
        invalidCount: results.filter((result) => result.status === "invalid").length,
        duplicateCount: results.filter((result) => result.status === "duplicate").length,
      },
    });
  } catch {
    return jsonResponse({ error: "Could not process the submitted addresses." }, 400);
  }
});
