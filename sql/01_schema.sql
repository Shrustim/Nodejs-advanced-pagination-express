-- Run this file inside database advanced_pagination_practice.
CREATE TABLE IF NOT EXISTS products (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  price NUMERIC(12,2) NOT NULL CHECK (price >= 0),
  in_stock BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- Equality filter + keyset ordering. PostgreSQL can scan B-tree indexes backwards.
CREATE INDEX IF NOT EXISTS idx_products_created_id
  ON products (created_at, id);
CREATE INDEX IF NOT EXISTS idx_products_price_id
  ON products (price, id);
CREATE INDEX IF NOT EXISTS idx_products_category_price_id
  ON products (category, price, id);
CREATE INDEX IF NOT EXISTS idx_products_category_created_id
  ON products (category, created_at, id);
