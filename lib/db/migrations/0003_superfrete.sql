CREATE TABLE IF NOT EXISTS store_shipping_settings (
  id text PRIMARY KEY DEFAULT 'main',
  settings jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE store_orders
  ADD COLUMN IF NOT EXISTS shipping_service_id text,
  ADD COLUMN IF NOT EXISTS shipping_carrier text,
  ADD COLUMN IF NOT EXISTS shipping_days integer,
  ADD COLUMN IF NOT EXISTS shipping_quote jsonb,
  ADD COLUMN IF NOT EXISTS superfrete_label_id text,
  ADD COLUMN IF NOT EXISTS shipping_label_status text,
  ADD COLUMN IF NOT EXISTS shipping_label_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS stripe_session_id text,
  ADD COLUMN IF NOT EXISTS stripe_payment_id text;
CREATE UNIQUE INDEX IF NOT EXISTS store_orders_superfrete_label_unique ON store_orders(superfrete_label_id);
INSERT INTO store_permissions (key, resource, action, description) VALUES
 ('shipping:read', 'shipping', 'read', 'Consultar configurações de frete'),
 ('shipping:manage', 'shipping', 'manage', 'Editar configurações de frete')
ON CONFLICT (key) DO NOTHING;
INSERT INTO store_role_permissions (role_id, permission_key)
SELECT id, permission FROM store_roles CROSS JOIN (VALUES ('shipping:read'), ('shipping:manage')) AS p(permission)
WHERE slug = 'admin' AND is_system = true
ON CONFLICT DO NOTHING;
