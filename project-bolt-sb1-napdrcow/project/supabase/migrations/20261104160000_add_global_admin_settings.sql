CREATE TABLE IF NOT EXISTS public.system_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  allow_signups boolean NOT NULL DEFAULT true,
  maintenance_mode boolean NOT NULL DEFAULT false,
  max_domains_per_run integer NOT NULL DEFAULT 5 CHECK (max_domains_per_run BETWEEN 1 AND 5),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.system_settings TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.system_settings TO service_role;

CREATE POLICY "public_read_system_settings" ON public.system_settings
  FOR SELECT TO anon, authenticated USING (true);

INSERT INTO public.system_settings (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.enforce_signup_setting()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.system_settings WHERE id = 1 AND allow_signups
  ) THEN
    RAISE EXCEPTION 'New account registration is disabled by the administrator.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_signup_setting
  BEFORE INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.enforce_signup_setting();