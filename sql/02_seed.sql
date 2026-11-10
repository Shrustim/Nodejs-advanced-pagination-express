-- DEMO DATABASE ONLY: clears the products table each time it is run.
TRUNCATE TABLE products RESTART IDENTITY;

INSERT INTO products (name, category, price, in_stock, created_at)
SELECT
  'Demo Product ' || LPAD(n::text, 3, '0'),
  (ARRAY['Electronics', 'Furniture', 'Books', 'Clothing'])[(n % 4) + 1],
  (199.99 + (n % 9) * 150)::numeric(12,2),
  n % 3 <> 0,
  TIMESTAMPTZ '2026-01-01 00:00:00+00' + (n % 7) * INTERVAL '1 day'
FROM generate_series(1, 80) AS s(n);

-- Same timestamp and same price deliberately recur to test tie-breakers.
SELECT COUNT(*) AS total_products FROM products;
