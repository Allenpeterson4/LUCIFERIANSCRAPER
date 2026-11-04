import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { SMTPClient } from "npm:denomailer@1.6.0";

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
  hourly_limit: number;
}

function getEncryption(encryption: string): "NONE" | "TLS" | "STARTTLS" {
  switch (encryption.toLowerCase()) {
    case "ssl":
      return "TLS";
    case "tls":
      return "STARTTLS";
    default:
      return "NONE";
  }
}

async function createSmtpClient(config: SmtpConfig): Promise<SMTPClient> {
  const client = new SMTPClient({
    connection: {
      hostname: config.host,
      port: config.port,
      tls: getEncryption(config.encryption),
      auth: { username: config.username, password: config.password },
    },
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

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing auth token" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData.user) {
      return new Response(JSON.stringify({ error: "Invalid auth token" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

    const body = await req.json();
    const action: string = body.action || "test";

    // Fetch the user's active SMTP config
    const fetchConfig = async (configId?: string) => {
      let query = supabase.from("smtp_configs").select("*").eq("user_id", userId);
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
    const fetchMessage = async (messageId: string) => {
      const { data, error } = await supabase
        .from("email_messages")
        .select("*")
        .eq("id", messageId)
        .eq("user_id", userId)
        .maybeSingle();
      if (error || !data) return null;
      return data as { id: string; subject: string; body: string };
    };

    // --- TEST CONNECTION ---
    if (action === "test") {
      const config = await fetchConfig(body.config_id);
      if (!config) {
        return new Response(JSON.stringify({ error: "No SMTP configuration found. Please save your settings first." }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
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
        await client.close();
        return new Response(JSON.stringify({ success: true, message: "Test email sent successfully to " + config.from_email }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (err) {
        if (client) { try { await client.close(); } catch { /* ignore */ } }
        return new Response(JSON.stringify({ error: `SMTP connection failed: ${err.message || err}` }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // --- SEND NOW (manual send to a list of recipients) ---
    if (action === "send") {
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

      // Limit immediate sends to the hourly limit
      const toSend = recipients.slice(0, config.hourly_limit);
      const fromAddr = config.from_name ? `${config.from_name} <${config.from_email}>` : config.from_email;

      let client: SMTPClient | null = null;
      let sent = 0;
      let failed = 0;
      const errors: string[] = [];

      try {
        client = await createSmtpClient(config);
        for (const recipient of toSend) {
          try {
            await client.send({
              from: fromAddr,
              to: recipient,
              subject: message.subject,
              content: message.body,
            });
            sent++;
          } catch (err) {
            failed++;
            errors.push(`${recipient}: ${err.message || err}`);
          }
        }
        await client.close();
      } catch (err) {
        if (client) { try { await client.close(); } catch { /* ignore */ } }
        return new Response(JSON.stringify({ error: `Failed to connect to SMTP server: ${err.message || err}` }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({
        success: true,
        sent,
        failed,
        total: toSend.length,
        errors: errors.slice(0, 10),
        message: `Sent ${sent} email${sent !== 1 ? "s" : ""}${failed > 0 ? `, ${failed} failed` : ""}.`,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // --- PROCESS QUEUE BATCH ---
    if (action === "process_queue") {
      // Find queue items that are due for a batch
      const now = new Date().toISOString();
      const { data: queueItems } = await supabase
        .from("campaign_queue")
        .select("*")
        .eq("user_id", userId)
        .in("status", ["queued", "sending"])
        .or(`next_batch_at.is.null,next_batch_at.lte.${now}`)
        .order("created_at", { ascending: true })
        .limit(1);

      if (!queueItems || queueItems.length === 0) {
        return new Response(JSON.stringify({ success: true, message: "No queued batches to process." }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const item = queueItems[0];
      const config = await fetchConfig(item.smtp_config_id);
      if (!config) {
        await supabase.from("campaign_queue").update({ status: "failed", error: "SMTP config not found" }).eq("id", item.id);
        return new Response(JSON.stringify({ error: "SMTP config not found for queue item." }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const message = await fetchMessage(item.message_id);
      if (!message) {
        await supabase.from("campaign_queue").update({ status: "failed", error: "Message not found" }).eq("id", item.id);
        return new Response(JSON.stringify({ error: "Message not found for queue item." }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const allRecipients: string[] = item.recipients || [];
      const alreadySent = item.total_sent + item.total_failed;
      const remaining = allRecipients.slice(alreadySent);
      const batchSize = Math.min(item.batch_size, config.hourly_limit);
      const batch = remaining.slice(0, batchSize);

      if (batch.length === 0) {
        await supabase.from("campaign_queue").update({ status: "completed" }).eq("id", item.id);
        return new Response(JSON.stringify({ success: true, message: "Campaign completed." }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const fromAddr = config.from_name ? `${config.from_name} <${config.from_email}>` : config.from_email;
      let sent = 0;
      let failed = 0;
      let client: SMTPClient | null = null;

      try {
        client = await createSmtpClient(config);
        for (const recipient of batch) {
          try {
            await client.send({ from: fromAddr, to: recipient, subject: message.subject, content: message.body });
            sent++;
          } catch {
            failed++;
          }
        }
        await client.close();
      } catch (err) {
        if (client) { try { await client.close(); } catch { /* ignore */ } }
        const nextBatch = new Date(Date.now() + 60 * 60 * 1000).toISOString();
        await supabase.from("campaign_queue").update({
          status: "sending",
          error: `SMTP error: ${err.message || err}`,
          next_batch_at: nextBatch,
          updated_at: now,
        }).eq("id", item.id);
        return new Response(JSON.stringify({ error: `SMTP connection failed: ${err.message || err}` }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const newSent = item.total_sent + sent;
      const newFailed = item.total_failed + failed;
      const totalProcessed = newSent + newFailed;
      const isComplete = totalProcessed >= allRecipients.length;
      const nextBatchAt = isComplete ? null : new Date(Date.now() + 60 * 60 * 1000).toISOString();

      await supabase.from("campaign_queue").update({
        status: isComplete ? "completed" : "sending",
        total_sent: newSent,
        total_failed: newFailed,
        last_batch_at: now,
        next_batch_at: nextBatchAt,
        error: null,
        updated_at: now,
      }).eq("id", item.id);

      return new Response(JSON.stringify({
        success: true,
        sent,
        failed,
        total_sent: newSent,
        total_failed: newFailed,
        total_recipients: allRecipients.length,
        is_complete: isComplete,
        next_batch_at: nextBatchAt,
        message: `Batch sent: ${sent} success, ${failed} failed. ${isComplete ? "Campaign complete." : "Next batch in 1 hour."}`,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "Unknown action. Use test, send, or process_queue." }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || "Internal server error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
