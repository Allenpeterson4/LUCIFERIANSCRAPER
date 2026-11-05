ALTER TABLE public.scrape_results
  ADD COLUMN IF NOT EXISTS business_name text,
  ADD COLUMN IF NOT EXISTS service_summary text,
  ADD COLUMN IF NOT EXISTS category text;

ALTER TABLE public.domain_parse_results
  ADD COLUMN IF NOT EXISTS business_name text,
  ADD COLUMN IF NOT EXISTS service_summary text;

UPDATE public.domain_parse_results
SET business_name = name
WHERE business_name IS NULL AND name IS NOT NULL;