import type { SmtpSendResponse, QueueProcessResponse } from "@/lib/smtp-types";

async function callSmtpFunction(
  payload: Record<string, unknown>,
  accessToken: string
): Promise<Response> {
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/smtp-send`;
  try {
    return await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
      },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error("Could not connect to the SMTP service. Check your connection and try again.");
  }
}

export async function testSmtpConnection(
  accessToken: string,
  configId?: string
): Promise<SmtpSendResponse> {
  const res = await callSmtpFunction({ action: "test", config_id: configId }, accessToken);
  const data = await res.json();
  if (!res.ok) {
    return { success: false, message: data.error || `Test failed (${res.status})` };
  }
  return data as SmtpSendResponse;
}

export async function sendEmailsNow(
  accessToken: string,
  messageId: string,
  recipients: string[],
  configId?: string,
  options?: { sourceBatchId?: string | null; batchLabel?: string | null }
): Promise<SmtpSendResponse> {
  const res = await callSmtpFunction(
    { action: "send", message_id: messageId, recipients, config_id: configId, ...options },
    accessToken
  );
  const data = await res.json();
  if (!res.ok) {
    return { success: false, message: data.error || `Send failed (${res.status})` };
  }
  return data as SmtpSendResponse;
}

export async function processQueueBatch(
  accessToken: string
): Promise<QueueProcessResponse> {
  const res = await callSmtpFunction({ action: "process_queue" }, accessToken);
  const data = await res.json();
  if (!res.ok) {
    return { success: false, message: data.error || `Queue processing failed (${res.status})` };
  }
  return data as QueueProcessResponse;
}
