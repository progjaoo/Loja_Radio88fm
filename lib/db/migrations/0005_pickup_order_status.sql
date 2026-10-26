ALTER TYPE store_order_status
  ADD VALUE IF NOT EXISTS 'picked_up' AFTER 'delivered';
