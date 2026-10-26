DO $$
BEGIN
  CREATE TYPE store_product_status AS ENUM ('active', 'hidden', 'inactive');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE store_stock_movement_type AS ENUM (
    'inbound',
    'outbound',
    'manual_adjustment',
    'sale',
    'reservation',
    'cancellation',
    'return'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE store_stock_reservation_status AS ENUM ('reserved', 'committed', 'released');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE store_product_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL,
  description text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT store_product_lines_slug_unique UNIQUE (slug)
);
CREATE INDEX store_product_lines_active_idx ON store_product_lines (active);

ALTER TABLE products
  ADD COLUMN line_id uuid REFERENCES store_product_lines(id) ON DELETE SET NULL,
  ADD COLUMN base_sku text,
  ADD COLUMN internal_code text,
  ADD COLUMN piece_type text,
  ADD COLUMN brand text,
  ADD COLUMN material text,
  ADD COLUMN tags text[] NOT NULL DEFAULT '{}',
  ADD COLUMN promotional_price_cents bigint,
  ADD COLUMN promotion_starts_at timestamptz,
  ADD COLUMN promotion_ends_at timestamptz,
  ADD COLUMN status store_product_status NOT NULL DEFAULT 'active';

UPDATE products SET status = CASE WHEN active THEN 'active'::store_product_status ELSE 'inactive'::store_product_status END;

CREATE INDEX products_line_idx ON products (line_id);
CREATE INDEX products_status_featured_idx ON products (status, featured);
CREATE UNIQUE INDEX products_base_sku_unique ON products (base_sku);
CREATE UNIQUE INDEX products_internal_code_unique ON products (internal_code);

CREATE TABLE store_product_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  url text NOT NULL,
  alt text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT store_product_images_order_unique UNIQUE (product_id, sort_order)
);
CREATE UNIQUE INDEX store_product_images_primary_unique ON store_product_images (product_id) WHERE is_primary;
CREATE INDEX store_product_images_product_idx ON store_product_images (product_id);

INSERT INTO store_product_images (product_id, url, alt, sort_order, is_primary)
SELECT id, image_url, name, 0, true
FROM products
WHERE image_url IS NOT NULL AND btrim(image_url) <> '';

ALTER TABLE product_variants RENAME COLUMN price TO price_cents;
ALTER TABLE product_variants
  ALTER COLUMN price_cents TYPE bigint USING round(price_cents * 100)::bigint;
ALTER TABLE product_variants RENAME COLUMN low_stock_threshold TO minimum_stock;
ALTER TABLE product_variants
  ADD COLUMN barcode text,
  ADD COLUMN size text,
  ADD COLUMN color text,
  ADD COLUMN attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN cost_price_cents bigint,
  ADD COLUMN reserved_stock integer NOT NULL DEFAULT 0,
  ADD COLUMN weight_grams integer,
  ADD COLUMN dimensions_cm jsonb;

CREATE UNIQUE INDEX product_variants_barcode_unique ON product_variants (barcode);
CREATE INDEX product_variants_stock_idx ON product_variants (stock, reserved_stock, minimum_stock);

ALTER TABLE store_orders
  RENAME COLUMN subtotal TO subtotal_cents;
ALTER TABLE store_orders
  ALTER COLUMN subtotal_cents TYPE bigint USING round(subtotal_cents * 100)::bigint;
ALTER TABLE store_orders RENAME COLUMN shipping_fee TO shipping_fee_cents;
ALTER TABLE store_orders RENAME COLUMN total TO total_cents;
ALTER TABLE store_orders
  ALTER COLUMN shipping_fee_cents TYPE bigint USING round(shipping_fee_cents * 100)::bigint,
  ALTER COLUMN total_cents TYPE bigint USING round(total_cents * 100)::bigint;

ALTER TABLE store_order_lines
  RENAME COLUMN unit_price TO unit_price_cents;
ALTER TABLE store_order_lines
  ALTER COLUMN unit_price_cents TYPE bigint USING round(unit_price_cents * 100)::bigint;
ALTER TABLE store_order_lines RENAME COLUMN line_total TO line_total_cents;
ALTER TABLE store_order_lines
  ALTER COLUMN line_total_cents TYPE bigint USING round(line_total_cents * 100)::bigint;

ALTER TABLE store_payments
  RENAME COLUMN amount TO amount_cents;
ALTER TABLE store_payments
  ALTER COLUMN amount_cents TYPE bigint USING round(amount_cents * 100)::bigint;

ALTER TABLE store_stock_movements
  ADD COLUMN reserved_delta integer NOT NULL DEFAULT 0,
  ADD COLUMN movement_type store_stock_movement_type NOT NULL DEFAULT 'manual_adjustment',
  ADD COLUMN quantity_before integer,
  ADD COLUMN quantity_after integer;

UPDATE store_stock_movements
SET movement_type = CASE
  WHEN reason ILIKE '%reserva para pedido%' THEN 'reservation'::store_stock_movement_type
  WHEN reason ILIKE '%cancelamento%' THEN 'cancellation'::store_stock_movement_type
  WHEN delta > 0 THEN 'inbound'::store_stock_movement_type
  WHEN delta < 0 THEN 'outbound'::store_stock_movement_type
  ELSE 'manual_adjustment'::store_stock_movement_type
END;

CREATE TABLE store_stock_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES store_orders(id) ON DELETE CASCADE,
  variant_id uuid NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
  quantity integer NOT NULL,
  status store_stock_reservation_status NOT NULL DEFAULT 'reserved',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT store_stock_reservations_order_variant_unique UNIQUE (order_id, variant_id)
);
CREATE INDEX store_stock_reservations_variant_status_idx ON store_stock_reservations (variant_id, status);
CREATE INDEX store_stock_reservations_order_idx ON store_stock_reservations (order_id);

INSERT INTO store_stock_reservations (order_id, variant_id, quantity, status, created_at, updated_at)
SELECT
  order_lines.order_id,
  order_lines.variant_id,
  sum(order_lines.quantity)::integer,
  CASE WHEN orders.status = 'awaiting_payment' AND orders.payment_status = 'pending'
    THEN 'reserved'::store_stock_reservation_status
    ELSE 'committed'::store_stock_reservation_status
  END,
  min(orders.created_at),
  now()
FROM store_order_lines AS order_lines
JOIN store_orders AS orders ON orders.id = order_lines.order_id
WHERE orders.status <> 'cancelled'
GROUP BY order_lines.order_id, order_lines.variant_id, orders.status, orders.payment_status;

WITH pending_reservations AS (
  SELECT variant_id, sum(quantity)::integer AS quantity
  FROM store_stock_reservations
  WHERE status = 'reserved'
  GROUP BY variant_id
)
UPDATE product_variants AS variants
SET
  stock = variants.stock + pending_reservations.quantity,
  reserved_stock = pending_reservations.quantity
FROM pending_reservations
WHERE variants.id = pending_reservations.variant_id;

CREATE TABLE store_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  is_system boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT store_roles_slug_unique UNIQUE (slug)
);
CREATE INDEX store_roles_active_idx ON store_roles (active);

CREATE TABLE store_permissions (
  key text PRIMARY KEY,
  resource text NOT NULL,
  action text NOT NULL,
  description text NOT NULL DEFAULT '',
  CONSTRAINT store_permissions_resource_action_unique UNIQUE (resource, action)
);

CREATE TABLE store_role_permissions (
  role_id uuid NOT NULL REFERENCES store_roles(id) ON DELETE CASCADE,
  permission_key text NOT NULL REFERENCES store_permissions(key) ON DELETE CASCADE,
  CONSTRAINT store_role_permissions_pk PRIMARY KEY (role_id, permission_key)
);
CREATE INDEX store_role_permissions_permission_idx ON store_role_permissions (permission_key);

CREATE TABLE store_user_roles (
  user_id text NOT NULL REFERENCES store_profiles(user_id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES store_roles(id) ON DELETE CASCADE,
  assigned_by text REFERENCES store_profiles(user_id) ON DELETE SET NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT store_user_roles_pk PRIMARY KEY (user_id, role_id)
);
CREATE INDEX store_user_roles_role_idx ON store_user_roles (role_id);

INSERT INTO store_roles (slug, name, description, is_system) VALUES
  ('admin', 'Administrador', 'Acesso completo à loja e à administração de permissões.', true),
  ('manager', 'Gerente', 'Gerencia catálogo, conteúdo, estoque e pedidos, sem administrar permissões.', true),
  ('stockist', 'Estoquista', 'Consulta catálogo e pedidos e administra movimentações de estoque.', true),
  ('support', 'Atendimento', 'Consulta produtos, pedidos e clientes e atualiza o andamento dos pedidos.', true),
  ('viewer', 'Visualizador', 'Acesso somente de leitura aos dados administrativos.', true)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO store_permissions (key, resource, action, description) VALUES
  ('products:read', 'products', 'read', 'Consultar produtos e variações'),
  ('products:create', 'products', 'create', 'Criar produtos'),
  ('products:update', 'products', 'update', 'Editar produtos'),
  ('products:archive', 'products', 'archive', 'Arquivar produtos'),
  ('categories:read', 'categories', 'read', 'Consultar categorias'),
  ('categories:manage', 'categories', 'manage', 'Criar e editar categorias'),
  ('product_lines:read', 'product_lines', 'read', 'Consultar linhas de produtos'),
  ('product_lines:manage', 'product_lines', 'manage', 'Criar e editar linhas de produtos'),
  ('inventory:read', 'inventory', 'read', 'Consultar estoque e movimentações'),
  ('inventory:adjust', 'inventory', 'adjust', 'Ajustar estoque'),
  ('inventory:import', 'inventory', 'import', 'Importar estoque'),
  ('inventory:export', 'inventory', 'export', 'Exportar estoque'),
  ('orders:read', 'orders', 'read', 'Consultar pedidos'),
  ('orders:update', 'orders', 'update', 'Atualizar pedidos e seus estados'),
  ('payments:read', 'payments', 'read', 'Consultar pagamentos'),
  ('payments:confirm', 'payments', 'confirm', 'Confirmar pagamentos'),
  ('payments:refund', 'payments', 'refund', 'Registrar devoluções de pagamento'),
  ('users:read', 'users', 'read', 'Consultar usuários'),
  ('users:manage', 'users', 'manage', 'Administrar usuários'),
  ('roles:read', 'roles', 'read', 'Consultar papéis e permissões'),
  ('roles:manage', 'roles', 'manage', 'Administrar papéis e permissões'),
  ('audit:read', 'audit', 'read', 'Consultar auditoria'),
  ('content:read', 'content', 'read', 'Consultar conteúdo da loja'),
  ('content:manage', 'content', 'manage', 'Editar conteúdo da loja')
ON CONFLICT (key) DO NOTHING;

INSERT INTO store_role_permissions (role_id, permission_key)
SELECT roles.id, permissions.key
FROM store_roles AS roles
CROSS JOIN store_permissions AS permissions
WHERE roles.slug = 'admin'
ON CONFLICT DO NOTHING;

INSERT INTO store_role_permissions (role_id, permission_key)
SELECT roles.id, permissions.key
FROM store_roles AS roles
JOIN store_permissions AS permissions ON permissions.key IN (
  'products:read', 'products:create', 'products:update', 'products:archive',
  'categories:read', 'categories:manage', 'product_lines:read', 'product_lines:manage',
  'inventory:read', 'inventory:adjust', 'inventory:import', 'inventory:export',
  'orders:read', 'orders:update', 'payments:read', 'payments:confirm', 'payments:refund',
  'users:read', 'audit:read', 'content:read', 'content:manage'
)
WHERE roles.slug = 'manager'
ON CONFLICT DO NOTHING;

INSERT INTO store_role_permissions (role_id, permission_key)
SELECT roles.id, permissions.key
FROM store_roles AS roles
JOIN store_permissions AS permissions ON permissions.key IN (
  'products:read', 'product_lines:read', 'inventory:read', 'inventory:adjust',
  'inventory:import', 'inventory:export', 'orders:read', 'orders:update'
)
WHERE roles.slug = 'stockist'
ON CONFLICT DO NOTHING;

INSERT INTO store_role_permissions (role_id, permission_key)
SELECT roles.id, permissions.key
FROM store_roles AS roles
JOIN store_permissions AS permissions ON permissions.key IN (
  'products:read', 'categories:read', 'product_lines:read', 'orders:read', 'orders:update',
  'payments:read', 'users:read', 'content:read'
)
WHERE roles.slug = 'support'
ON CONFLICT DO NOTHING;

INSERT INTO store_role_permissions (role_id, permission_key)
SELECT roles.id, permissions.key
FROM store_roles AS roles
JOIN store_permissions AS permissions ON permissions.action = 'read'
WHERE roles.slug = 'viewer'
ON CONFLICT DO NOTHING;

INSERT INTO store_user_roles (user_id, role_id)
SELECT profiles.user_id, roles.id
FROM store_profiles AS profiles
JOIN store_roles AS roles
  ON roles.slug = CASE profiles.role::text
    WHEN 'admin' THEN 'admin'
    WHEN 'operations' THEN 'stockist'
    ELSE NULL
  END
ON CONFLICT DO NOTHING;
