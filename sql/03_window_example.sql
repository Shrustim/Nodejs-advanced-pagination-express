-- Useful window-function example: top 3 most expensive products in each category.
-- This is separate from the cursor endpoint because ranking an entire data set
-- on every page would defeat the performance benefit of keyset pagination.
SELECT id, name, category, price, category_rank
FROM (
  SELECT id, name, category, price,
         ROW_NUMBER() OVER (
           PARTITION BY category ORDER BY price DESC, id DESC
         ) AS category_rank
  FROM products
) ranked
WHERE category_rank <= 3
ORDER BY category, category_rank;

-- Optional learning query: per-category size without GROUP BY collapsing rows.
SELECT id, category,
       COUNT(*) OVER (PARTITION BY category) AS products_in_category
FROM products
ORDER BY category, id
LIMIT 12;
