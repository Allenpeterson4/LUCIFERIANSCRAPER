import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface SmtpConfig {
  id: string;
  host: string;
  port: number;
  username: string;
  password: string;
  encryption: string;
  from_email: string;
  from_name: string | null;
}

interface DispatchCampaign {
  id: string;
  user_id: string;
  smtp_config_id: string;
  message_id: string;
  recipients: string[] | null;
  total_sent: number;
  total_failed: number;
  last_batch_at: string | null;
}

interface DispatchMessage {
  id: string;
  subject: string;
  body: string;
  format: "text" | "html";
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try { return JSON.stringify(error); } catch { return String(error); }
}

function isProviderThrottle(error: unknown): boolean {
  return /(?:\b421\b|\b450\b|\b451\b|\b452\b|\b454\b|4\.7\.\d|too many|rate.?limit|throttl|quota exceeded|try again later)/i.test(errorMessage(error));
}

function isTemporaryDeliveryFailure(error: unknown): boolean {
  return isProviderThrottle(error) || /(?:\b4\d{2}\b|temporar|timeout|timed out|econn|network|socket|connection reset|broken pipe)/i.test(errorMessage(error));
}

function retryAfterSeconds(error: unknown): number | null {
  const match = errorMessage(error).match(/retry(?:-after| after)?[:=]?\s*(\d+)\s*(?:s|sec|seconds)?/i);
  return match ? Math.min(86400, Number(match[1])) : null;
}

function nextUtcCreditReset(): string {
  const reset = new Date();
  reset.setUTCHours(24, 0, 0, 0);
  return reset.toISOString();
}

function htmlToPlainText(html: string): string {
  return html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<\/(p|div|li|h[1-6]|tr)\s*>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[\t ]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

async function createSmtpClient(config: SmtpConfig): Promise<SMTPClient> {
  const client = new SMTPClient({
    connection: {
      hostname: config.host,
      port: config.port,
      tls: config.encryption.toLowerCase() === "ssl",
      auth: { username: config.username, password: config.password },
    },
    debug: { noStartTLS: config.encryption.toLowerCase() === "none" },
  });
  return client;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const dispatcherSecret = Deno.env.get("SMTP_DISPATCHER_SECRET");
    const isDispatcher = Boolean(dispatcherSecret && req.headers.get("X-Dispatcher-Secret") === dispatcherSecret);
    let userId: string | null = null;
    if (!isDispatcher) {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) {
        return new Response(JSON.stringify({ error: "Missing auth token" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const token = authHeader.replace(/^Bearer\s+/i, "");
      const { data: userData, error: userError } = await supabase.auth.getUser(token);
      if (userError || !userData.user) {
        return new Response(JSON.stringify({ error: "Invalid auth token" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      userId = userData.user.id;
    }

    const { data: systemSettings, error: settingsError } = await supabase.from("system_settings")
      .select("maintenance_mode").eq("id", 1).single();
    if (settingsError || !systemSettings) {
      return new Response(JSON.stringify({ error: "System settings are unavailable." }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (systemSettings.maintenance_mode) {
      return new Response(JSON.stringify({ error: "The system is in maintenance mode." }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const recordContactDelivery = async (
      email: string,
      ownerId: string,
      messageId: string,
      status: "sent" | "failed",
      error?: string
    ) => {
      const normalizedEmail = email.trim().toLowerCase();
      const { data: contact } = await supabase.from("email_contacts")
        .select("id")
        .eq("user_id", ownerId)
        .eq("email", normalizedEmail)
        .maybeSingle();
      if (!contact) return;

      const now = new Date().toISOString();
      const { error: logError } = await supabase.from("email_delivery_log").upsert({
        user_id: ownerId,
        contact_id: contact.id,
        message_id: messageId,
        status,
        error: error ?? null,
        sent_at: now,
      }, { onConflict: "user_id,contact_id,message_id" });
      if (logError) console.error("Could not record email delivery:", logError.message);

      if (status === "sent") {
        const { error: updateError } = await supabase.from("email_contacts")
          .update({ last_sent_at: now, updated_at: now })
          .eq("id", contact.id)
          .eq("user_id", ownerId);
        if (updateError) console.error("Could not update contact send state:", updateError.message);
      }
    };

    const reserveSendSlot = async (smtpConfigId: string) => {
      const { data, error } = await supabase.rpc("reserve_smtp_send_slot", { p_smtp_config_id: smtpConfigId });
      if (error) throw new Error("Adaptive SMTP rate state is unavailable.");
      return Array.isArray(data) ? data[0] : data;
    };

    const recordDispatchAttempt = async (
      smtpConfigId: string,
      ownerId: string,
      campaignQueueId: string | null,
      recipient: string,
      outcome: "sent" | "failed" | "throttled",
      providerResponse?: string,
      retryAfter?: number | null,
      messageId?: string | null,
    ) => {
      const { data, error } = await supabase.rpc("record_smtp_dispatch_attempt", {
        p_smtp_config_id: smtpConfigId,
        p_user_id: ownerId,
        p_campaign_queue_id: campaignQueueId,
        p_recipient: recipient,
        p_outcome: outcome,
        p_provider_response: providerResponse ?? null,
        p_retry_after_seconds: retryAfter ?? null,
        p_message_id: messageId ?? null,
      });
      if (error) throw new Error("Could not record SMTP dispatch outcome.");
      return data;
    };

    const recordBounceEntry = async (
      smtpConfigId: string,
      ownerId: string,
      campaignQueueId: string,
      messageId: string,
      recipient: string,
      failureReason: string,
    ) => {
      try {
        const { error } = await supabase.rpc("record_smtp_bounce_entry", {
          p_user_id: ownerId,
          p_smtp_config_id: smtpConfigId,
          p_campaign_queue_id: campaignQueueId,
          p_message_id: messageId,
          p_recipient: recipient,
          p_failure_reason: failureReason,
        });
        if (error) throw error;
      } catch (error) {
        console.error("Could not add failed delivery to bounce review list:", errorMessage(error));
      }
    };

    const body = await req.json();
    const action: string = body.action || "test";
    if (action === "dispatch_due" && !isDispatcher) {
      return new Response(JSON.stringify({ error: "Dispatcher access is required." }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (isDispatcher && action !== "dispatch_due") {
      return new Response(JSON.stringify({ error: "The dispatcher may only process due campaigns." }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch the user's active SMTP config
    const fetchConfig = async (configId?: string, ownerId = userId) => {
      let query = supabase.from("smtp_configs").select("*");
      if (ownerId) query = query.eq("user_id", ownerId);
      if (configId) {
        query = query.eq("id", configId);
      } else {
        query = query.eq("is_active", true);
      }
      const { data, error } = await query.maybeSingle();
      if (error || !data) return null;
      return data as SmtpConfig;
    };

    // Fetch a message
    const fetchMessage = async (messageId: string, ownerId = userId) => {
      const { data, error } = await supabase
        .from("email_messages")
        .select("*")
        .eq("id", messageId)
        .eq("user_id", ownerId)
        .maybeSingle();
      if (error || !data) return null;
      return data as DispatchMessage;
    };

    const rawReplyDomain = Deno.env.get("REPLY_TRACKING_DOMAIN")?.trim().toLowerCase().replace(/^@/, "") ?? "";
    const replyTrackingDomain = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(rawReplyDomain)
      ? rawReplyDomain
      : null;

    const createReplyTracking = async (item: DispatchCampaign, ownerId: string, messageId: string, recipient: string) => {
      const token = crypto.randomUUID().replace(/-/g, "");
      const address = `reply+${token}@${replyTrackingDomain}`;
      const normalizedRecipient = recipient.trim().toLowerCase();
      const { data: contact, error: contactError } = await supabase.from("email_contacts")
        .select("id").eq("user_id", ownerId).eq("email", normalizedRecipient).maybeSingle();
      if (contactError) throw new Error("Could not prepare reply tracking for this recipient.");
      const { error } = await supabase.from("email_reply_tracking").insert({
        token,
        user_id: ownerId,
        campaign_queue_id: item.id,
        message_id: messageId,
        contact_id: contact?.id ?? null,
        recipient_email: normalizedRecipient,
        reply_to_address: address,
        sent_at: new Date().toISOString(),
      });
      if (error) throw new Error("Could not prepare reply tracking for this recipient.");
      return { token, address };
    };

    const processCampaign = async (item: DispatchCampaign) => {
      const ownerId = String(item.user_id);
      if (!replyTrackingDomain) {
        const message = "Reply tracking is not configured. Set REPLY_TRACKING_DOMAIN before dispatching campaigns.";
        await supabase.from("campaign_queue").update({ status: "failed", error: message, dispatch_lock_until: null }).eq("id", item.id);
        return { success: false, message };
      }
      const config = await fetchConfig(item.smtp_config_id, ownerId);
      if (!config) {
        await supabase.from("campaign_queue").update({ status: "failed", error: "SMTP config not found", dispatch_lock_until: null }).eq("id", item.id);
        return { success: false, message: "SMTP config not found for campaign." };
      }

      const message = await fetchMessage(item.message_id, ownerId);
      if (!message) {
        await supabase.from("campaign_queue").update({ status: "failed", error: "Message not found", dispatch_lock_until: null }).eq("id", item.id);
        return { success: false, message: "Message not found for campaign." };
      }

      const recipients: string[] = item.recipients ?? [];
      let sent = 0;
      let failed = 0;
      let attempts = 0;
      let nextBatchAt: string | null = null;
      let dispatchError: string | null = null;
      let client: SMTPClient | null = null;
      const startIndex = item.total_sent + item.total_failed;
      const remaining = recipients.slice(startIndex);
      if (remaining.length === 0) {
        await supabase.from("campaign_queue").update({ status: "completed", dispatch_lock_until: null, next_batch_at: null }).eq("id", item.id);
        return { success: true, message: "Campaign completed.", is_complete: true };
      }

      try {
        for (const recipient of remaining.slice(0, 100)) {
          const slot = await reserveSendSlot(config.id);
          if (!slot?.allowed) {
            nextBatchAt = slot?.retry_at ?? new Date(Date.now() + 60_000).toISOString();
            break;
          }

          const { data: creditData, error: creditError } = await supabase.rpc("consume_user_credits", {
            p_user_id: ownerId,
            p_amount: 1,
            p_reason: "smtp_delivery_attempt",
            p_reference_id: item.id,
          });
          const creditResult = Array.isArray(creditData) ? creditData[0] : creditData;
          if (creditError || !creditResult) throw new Error("Could not verify credit balance.");
          if (!creditResult.allowed) {
            nextBatchAt = nextUtcCreditReset();
            dispatchError = `Daily credits exhausted. Campaign resumes at ${new Date(nextBatchAt).toLocaleString()}.`;
            break;
          }

          attempts++;
          if (!client) client = await createSmtpClient(config);
          let replyTracking: { token: string; address: string } | null = null;
          try {
            replyTracking = await createReplyTracking(item, ownerId, message.id, recipient);
            await client.send({
              from: config.from_name ? `${config.from_name} <${config.from_email}>` : config.from_email,
              replyTo: replyTracking.address,
              to: recipient,
              subject: message.subject,
              content: message.format === "html" ? htmlToPlainText(message.body) : message.body,
              ...(message.format === "html" ? { html: message.body } : {}),
            });
            sent++;
          } catch (error) {
            if (replyTracking) {
              await supabase.from("email_reply_tracking").delete().eq("token", replyTracking.token);
            }
            const providerMessage = errorMessage(error);
            if (isTemporaryDeliveryFailure(error)) {
              if (isProviderThrottle(error)) {
                const pauseUntil = await recordDispatchAttempt(
                  config.id, ownerId, item.id, recipient, "throttled", providerMessage, retryAfterSeconds(error), message.id,
                );
                nextBatchAt = typeof pauseUntil === "string" ? pauseUntil : new Date(Date.now() + 60_000).toISOString();
                dispatchError = `Provider throttled delivery. Retry scheduled for ${new Date(nextBatchAt).toLocaleString()}.`;
              } else {
                try {
                  await recordDispatchAttempt(config.id, ownerId, item.id, recipient, "failed", providerMessage, null, message.id);
                } catch (loggingError) {
                  console.error("Could not record temporary SMTP failure:", errorMessage(loggingError));
                }
                nextBatchAt = new Date(Date.now() + 60_000).toISOString();
                dispatchError = `Temporary delivery failure. Retry scheduled for ${new Date(nextBatchAt).toLocaleString()}.`;
              }
              break;
            }
            try {
              await recordDispatchAttempt(config.id, ownerId, item.id, recipient, "failed", providerMessage, null, message.id);
            } catch (loggingError) {
              console.error("Could not record failed SMTP attempt:", errorMessage(loggingError));
            }
            try {
              await recordContactDelivery(recipient, ownerId, message.id, "failed", providerMessage);
            } catch (loggingError) {
              console.error("Could not update contact delivery status:", errorMessage(loggingError));
            }
            await recordBounceEntry(config.id, ownerId, item.id, message.id, recipient, providerMessage);
            failed++;
            continue;
          }

          try {
            await recordDispatchAttempt(config.id, ownerId, item.id, recipient, "sent", undefined, null, message.id);
            await recordContactDelivery(recipient, ownerId, message.id, "sent");
          } catch (error) {
            console.error("SMTP delivery succeeded but bookkeeping failed:", errorMessage(error));
          }
        }
      } catch (error) {
        dispatchError = errorMessage(error);
        nextBatchAt = new Date(Date.now() + 60_000).toISOString();
      } finally {
        if (client) {
          try { await client.close(); } catch { /* ignore */ }
        }
      }

      const totalSent = item.total_sent + sent;
      const totalFailed = item.total_failed + failed;
      const isComplete = totalSent + totalFailed >= recipients.length;
      const retryAt = isComplete ? null : nextBatchAt ?? new Date(Date.now() + 60_000).toISOString();
      await supabase.from("campaign_queue").update({
        status: isComplete ? "completed" : "sending",
        total_sent: totalSent,
        total_failed: totalFailed,
        last_batch_at: attempts > 0 ? new Date().toISOString() : item.last_batch_at,
        next_batch_at: retryAt,
        dispatch_lock_until: null,
        error: dispatchError,
        updated_at: new Date().toISOString(),
      }).eq("id", item.id);

      return {
        success: true,
        sent,
        failed,
        total_sent: totalSent,
        total_failed: totalFailed,
        total_recipients: recipients.length,
        is_complete: isComplete,
        next_batch_at: retryAt,
        message: dispatchError ?? `Adaptive dispatch: ${sent} sent, ${failed} failed${isComplete ? ". Campaign complete." : ". Next attempt scheduled automatically."}`,
      };
    };

    // --- TEST CONNECTION ---
    if (action === "test") {
      const config = await fetchConfig(body.config_id);
      if (!config) {
        return new Response(JSON.stringify({ error: "No SMTP configuration found. Please save your settings first." }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const ownerId = userId!;
      const slot = await reserveSendSlot(config.id);
      if (!slot?.allowed) {
        return new Response(JSON.stringify({ error: "SMTP provider rate limit reached.", retry_at: slot?.retry_at }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: creditData, error: creditError } = await supabase.rpc("consume_user_credits", {
        p_user_id: ownerId,
        p_amount: 1,
        p_reason: "smtp_test_email",
      });
      const creditResult = Array.isArray(creditData) ? creditData[0] : creditData;
      if (creditError || !creditResult) {
        return new Response(JSON.stringify({ error: "Could not verify credit balance." }), {
          status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!creditResult.allowed) {
        return new Response(JSON.stringify({ error: "Not enough credits to send a test email.", credits_remaining: creditResult.total_remaining }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      let client: SMTPClient | null = null;
      try {
        client = await createSmtpClient(config);
        // deno-mailer connects lazily; sending a no-op won't work, so we just try connecting
        // We'll send a test email to the from address itself
        await client.send({
          from: config.from_name ? `${config.from_name} <${config.from_email}>` : config.from_email,
          to: config.from_email,
          subject: "MailHarvest SMTP Test",
          content: "This is a test message from MailHarvest. Your SMTP configuration is working correctly.",
        });
        await recordDispatchAttempt(config.id, ownerId, null, config.from_email, "sent");
        await client.close();
        return new Response(JSON.stringify({ success: true, message: "Test email sent successfully to " + config.from_email }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (err) {
        const providerMessage = errorMessage(err);
        await recordDispatchAttempt(
          config.id,
          ownerId,
          null,
          config.from_email,
          isProviderThrottle(err) ? "throttled" : "failed",
          providerMessage,
          retryAfterSeconds(err),
        );
        if (client) { try { await client.close(); } catch { /* ignore */ } }
        return new Response(JSON.stringify({ error: `SMTP connection failed: ${errorMessage(err)}` }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Queue all campaigns so the adaptive dispatcher regulates every recipient.
    if (action === "send") {
      if (!replyTrackingDomain) {
        return new Response(JSON.stringify({ error: "Reply tracking is not configured. Set REPLY_TRACKING_DOMAIN before dispatching campaigns." }), {
          status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const config = await fetchConfig(body.config_id);
      if (!config) {
        return new Response(JSON.stringify({ error: "No active SMTP configuration found." }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const message = await fetchMessage(body.message_id);
      if (!message) {
        return new Response(JSON.stringify({ error: "Email message not found." }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const recipients: string[] = body.recipients || [];
      if (recipients.length === 0) {
        return new Response(JSON.stringify({ error: "No recipients provided." }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const ownerId = userId!;
      const uniqueRecipients = [...new Set(recipients.map((recipient) => recipient.trim().toLowerCase()).filter(Boolean))];
      if (uniqueRecipients.length === 0) {
        return new Response(JSON.stringify({ error: "No valid recipients provided." }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: creditData, error: creditError } = await supabase.rpc("consume_user_credits", {
        p_user_id: ownerId,
        p_amount: 1,
        p_reason: "campaign_schedule",
        p_reference_id: message.id,
      });
      const creditResult = Array.isArray(creditData) ? creditData[0] : creditData;
      if (creditError || !creditResult) {
        return new Response(JSON.stringify({ error: "Could not verify credit balance." }), {
          status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!creditResult.allowed) {
        return new Response(JSON.stringify({ error: "Not enough credits to schedule this campaign.", credits_remaining: creditResult.total_remaining }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const campaignChunkSize = 20000;
      const campaignCount = Math.ceil(uniqueRecipients.length / campaignChunkSize);
      const requestedBatchLabel = typeof body.batchLabel === "string" ? body.batchLabel.trim().slice(0, 100) : "";
      const campaignRows = Array.from({ length: campaignCount }, (_, index) => {
        const chunkLabel = campaignCount > 1
          ? `${requestedBatchLabel || "Campaign"} (${index + 1}/${campaignCount})`
          : requestedBatchLabel || null;
        return {
          user_id: ownerId,
          message_id: message.id,
          smtp_config_id: config.id,
          recipients: uniqueRecipients.slice(index * campaignChunkSize, (index + 1) * campaignChunkSize),
          source_batch_id: typeof body.sourceBatchId === "string" ? body.sourceBatchId : null,
          batch_label: chunkLabel,
          status: "queued",
          batch_size: 100,
          next_batch_at: new Date().toISOString(),
        };
      });
      const { data: campaigns, error } = await supabase.from("campaign_queue").insert(campaignRows).select("id");
      if (error || !campaigns || campaigns.length !== campaignCount) {
        return new Response(JSON.stringify({ error: "Could not queue campaign for adaptive dispatch." }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({
        success: true,
        total: uniqueRecipients.length,
        queued_campaigns: campaignCount,
        credits_remaining: creditResult.total_remaining,
        message: `Scheduled ${uniqueRecipients.length} recipients across ${campaignCount} adaptive queue${campaignCount === 1 ? "" : "s"}. Delivery will follow the selected SMTP provider's limits.`,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "process_queue") {
      const { data: queueItems, error } = await supabase.rpc("claim_due_smtp_campaigns", {
        p_user_id: userId!,
        p_limit: 1,
      });
      if (error) {
        return new Response(JSON.stringify({ error: "Could not claim a due campaign." }), {
          status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!queueItems?.length) {
        return new Response(JSON.stringify({ success: true, message: "No queued batches to process." }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify(await processCampaign(queueItems[0])), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "dispatch_due") {
      const { data: queueItems, error } = await supabase.rpc("claim_due_smtp_campaigns", {
        p_user_id: null,
        p_limit: 25,
      });
      if (error) {
        return new Response(JSON.stringify({ error: "Could not claim due campaigns." }), {
          status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const results = await Promise.all((queueItems ?? []).map((item: DispatchCampaign) => processCampaign(item)));
      return new Response(JSON.stringify({ success: true, processed: results.length, results }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action. Use test, send, process_queue, or dispatch_due." }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: errorMessage(err) || "Internal server error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
