export interface SmtpConfig {
  id: string;
  user_id: string;
  host: string;
  port: number;
  username: string;
  password: string;
  encryption: string;
  from_email: string;
  from_name: string | null;
  hourly_limit: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface EmailMessage {
  id: string;
  user_id: string;
  subject: string;
  body: string;
  recipient_type: string;
  created_at: string;
  updated_at: string;
}

export interface CampaignQueueItem {
  id: string;
  user_id: string;
  message_id: string;
  smtp_config_id: string;
  recipients: string[];
  status: string;
  total_sent: number;
  total_failed: number;
  batch_size: number;
  next_batch_at: string | null;
  last_batch_at: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface SmtpSendResponse {
  success: boolean;
  sent?: number;
  failed?: number;
  total?: number;
  errors?: string[];
  message: string;
  error?: string;
}

export interface QueueProcessResponse {
  success: boolean;
  sent?: number;
  failed?: number;
  total_sent?: number;
  total_failed?: number;
  total_recipients?: number;
  is_complete?: boolean;
  next_batch_at?: string | null;
  message: string;
  error?: string;
}
