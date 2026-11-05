CREATE TABLE IF NOT EXISTS public.search_service_secrets (
  name text PRIMARY KEY CHECK (name IN ('google_maps_api_key', 'google_cse_api_key', 'google_cse_id')),
  secret_value text NOT NULL CHECK (length(trim(secret_value)) > 0),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.search_service_secrets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.search_service_secrets FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.search_service_secrets TO service_role;