ALTER TABLE scraping_runs
  ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'website',
  ADD COLUMN IF NOT EXISTS source_query text,
  ADD COLUMN IF NOT EXISTS batch_label text NOT NULL DEFAULT 'Website scrape';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'scraping_runs_source_type_check'
      AND conrelid = 'public.scraping_runs'::regclass
  ) THEN
    ALTER TABLE scraping_runs
      ADD CONSTRAINT scraping_runs_source_type_check
      CHECK (source_type IN ('website', 'maps'));
  END IF;
END $$;

ALTER TABLE campaign_queue
  ADD COLUMN IF NOT EXISTS source_batch_id uuid REFERENCES scraping_runs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS batch_label text;

CREATE INDEX IF NOT EXISTS idx_scraping_runs_user_source_date
  ON scraping_runs (user_id, source_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_campaign_queue_source_batch
  ON campaign_queue (source_batch_id);
