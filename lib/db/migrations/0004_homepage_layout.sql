CREATE TABLE IF NOT EXISTS store_homepage_layout (
  id text PRIMARY KEY DEFAULT 'main',
  config jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
