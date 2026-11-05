import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Reply-Webhook-Secret, Authorization",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function stringValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "Email" in value && typeof value.Email === "string") return value.Email;
  if (value && typeof value === "object" && "email" in value && typeof value.email === "string") return value.email;
  return "";
}

async function readPayload(req: Request): Promise<Record<string, unknown>> {
  const contentType = req.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("application/json")) {
    const value = await req.json();
    return value && typeof value === "object" ? value as Record<string, unknown> : {};
  }
  const form = await req.formData();
  return Object.fromEntries([...form.entries()].map(([key, value]) => [key, typeof value === "string" ? value : value.name]));
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);

  const configuredSecret = Deno.env.get("REPLY_WEBHOOK_SECRET");
  if (configuredSecret) {
    const authorization = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    const suppliedSecret = req.headers.get("x-reply-webhook-secret") ?? authorization;
    if (suppliedSecret !== configuredSecret) return jsonResponse({ error: "Unauthorized webhook." }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return jsonResponse({ error: "Reply tracking is not configured." }, 503);

  try {
    const payload = await readPayload(req);
    const toValues = [payload.To, payload.to, payload.recipient, payload.OriginalRecipient, payload.original_recipient]
      .flatMap((value) => Array.isArray(value) ? value.map(stringValue) : [stringValue(value)])
      .filter(Boolean);
    const recipientAddresses = toValues.join(" ");
    const tokenMatch = recipientAddresses.match(/reply\+([0-9a-f]{32})@/i);
    if (!tokenMatch) return jsonResponse({ error: "No valid tracked Reply-To address was found." }, 400);
    const token = tokenMatch[1].toLowerCase();
    const sender = stringValue(payload.From ?? payload.from ?? payload.sender).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]?.toLowerCase() ?? null;
    const subject = stringValue(payload.Subject ?? payload.subject).trim().slice(0, 200) || null;
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { data: tracking, error: lookupError } = await supabase.from("email_reply_tracking")
      .select("token,user_id,contact_id,replied_at")
      .eq("token", token)
      .not("sent_at", "is", null)
      .maybeSingle();
    if (lookupError) return jsonResponse({ error: "Could not verify the reply address." }, 500);
    if (!tracking) return jsonResponse({ error: "Tracked reply address not found." }, 404);
    if (tracking.replied_at) return jsonResponse({ received: true, already_recorded: true });

    const repliedAt = new Date().toISOString();
    if (tracking.contact_id) {
      const { error: contactError } = await supabase.from("email_contacts")
        .update({ replied_at: repliedAt, updated_at: repliedAt })
        .eq("id", tracking.contact_id)
        .eq("user_id", tracking.user_id);
      if (contactError) return jsonResponse({ error: "Could not update reply status." }, 500);
    }

    const { error: updateError } = await supabase.from("email_reply_tracking")
      .update({ replied_at: repliedAt, reply_from: sender, reply_subject: subject })
      .eq("token", token)
      .is("replied_at", null);
    if (updateError) return jsonResponse({ error: "Could not record reply status." }, 500);
    return jsonResponse({ received: true });
  } catch (error) {
    console.error("Reply webhook processing failed:", error instanceof Error ? error.message : "unknown error");
    return jsonResponse({ error: "Could not process inbound reply." }, 400);
  }
});
