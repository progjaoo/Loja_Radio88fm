ALTER TABLE store_order_lines
  ADD COLUMN fiscal_ncm text,
  ADD COLUMN fiscal_origin text,
  ADD COLUMN fiscal_unit text,
  ADD COLUMN fiscal_tax_unit text,
  ADD COLUMN fiscal_cest text,
  ADD COLUMN fiscal_category_id text,
  ADD COLUMN original_unit_price_cents bigint NOT NULL DEFAULT 0;

CREATE TYPE store_fiscal_mode AS ENUM ('manual', 'nfeio');
CREATE TYPE store_fiscal_document_status AS ENUM (
  'pending', 'processing', 'authorized', 'rejected', 'cancelled', 'exempt', 'submission_unknown'
);

CREATE TABLE store_fiscal_settings (
  id text PRIMARY KEY DEFAULT 'default',
  issuer_legal_name text,
  issuer_trade_name text,
  issuer_cnpj text,
  state_registration text,
  state_tax_id text,
  tax_regime text,
  municipality_code text,
  issuer_address jsonb,
  default_cfop text,
  invoice_series integer,
  invoice_defaults jsonb,
  nfeio_payment_method text,
  nfeio_payment_type text,
  nfeio_test_setup_confirmed boolean NOT NULL DEFAULT false,
  nfeio_certificate_confirmed boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE store_fiscal_product_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  ncm text NOT NULL,
  origin text NOT NULL,
  unit text NOT NULL,
  tax_unit text NOT NULL,
  cest text,
  cfop text,
  tax_payload jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT store_fiscal_product_profile_product_unique UNIQUE (product_id)
);

CREATE TABLE store_fiscal_category_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  cfop text,
  tax_payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT store_fiscal_category_rule_category_unique UNIQUE (category_id)
);

CREATE TABLE store_fiscal_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES store_orders(id) ON DELETE RESTRICT,
  tax_number text NOT NULL,
  legal_name text NOT NULL,
  email text NOT NULL,
  address jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT store_fiscal_recipient_order_unique UNIQUE (order_id)
);

CREATE TABLE store_fiscal_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES store_orders(id) ON DELETE RESTRICT,
  mode store_fiscal_mode NOT NULL,
  status store_fiscal_document_status NOT NULL DEFAULT 'pending',
  environment text NOT NULL DEFAULT 'homologacao',
  invoice_number text,
  series text,
  access_key text,
  nfeio_invoice_id text,
  xml_object_path text,
  danfe_object_path text,
  rejection_reason text,
  exemption_reason text,
  cancellation_reason text,
  issued_at timestamptz,
  authorized_at timestamptz,
  cancelled_at timestamptz,
  submitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT store_fiscal_document_order_unique UNIQUE (order_id)
);
CREATE UNIQUE INDEX store_fiscal_document_nfeio_id_unique
  ON store_fiscal_documents (nfeio_invoice_id) WHERE nfeio_invoice_id IS NOT NULL;
CREATE INDEX store_fiscal_document_status_idx
  ON store_fiscal_documents (status, created_at);

CREATE TABLE store_fiscal_document_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid REFERENCES store_fiscal_documents(id) ON DELETE CASCADE,
  provider_event_id text,
  dedupe_key text,
  event_type text NOT NULL,
  status text NOT NULL,
  message text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  processing_status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  processed_at timestamptz,
  locked_at timestamptz,
  next_attempt_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX store_fiscal_event_provider_id_unique
  ON store_fiscal_document_events (provider_event_id) WHERE provider_event_id IS NOT NULL;
CREATE UNIQUE INDEX store_fiscal_event_dedupe_key_unique
  ON store_fiscal_document_events (dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX store_fiscal_event_document_idx
  ON store_fiscal_document_events (document_id, created_at);

INSERT INTO store_permissions (key, resource, action, description) VALUES
  ('fiscal:read', 'fiscal', 'read', 'Consultar dados fiscais e documentos'),
  ('fiscal:export', 'fiscal', 'export', 'Exportar dados fiscais para o contador'),
  ('fiscal:manage', 'fiscal', 'manage', 'Gerenciar configurações e documentos fiscais')
ON CONFLICT (key) DO NOTHING;

INSERT INTO store_roles (slug, name, description, is_system) VALUES
  ('accountant', 'Contador', 'Consulta e exporta dados fiscais, sem acesso a dados financeiros ou administração geral.', true)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO store_role_permissions (role_id, permission_key)
SELECT roles.id, permissions.key
FROM store_roles AS roles
CROSS JOIN store_permissions AS permissions
WHERE roles.slug = 'admin' AND permissions.key IN ('fiscal:read', 'fiscal:export', 'fiscal:manage')
ON CONFLICT DO NOTHING;

INSERT INTO store_role_permissions (role_id, permission_key)
SELECT roles.id, permissions.key
FROM store_roles AS roles
CROSS JOIN store_permissions AS permissions
WHERE roles.slug = 'accountant' AND permissions.key IN ('fiscal:read', 'fiscal:export')
ON CONFLICT DO NOTHING;

INSERT INTO store_fiscal_settings (id) VALUES ('default') ON CONFLICT (id) DO NOTHING;
