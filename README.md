# Advanced Pagination & Filtering — Express + PostgreSQL

A focused hands-on project for keyset/cursor pagination, previous/next pages, signed opaque cursors, multiple AND/OR search filters, sort whitelists, parameterized SQL, composite indexes, window functions, and automated tests.

## What you learn

1. Why offset pagination becomes expensive at deep pages and can shift when rows are inserted/deleted.
2. How `(sort_field, id)` creates a **unique deterministic order** even when the sort field repeats.
3. How a signed opaque cursor refers to the boundary record without exposing a database offset.
4. How backward pagination inverts the query direction and reverses results back into display order.
5. How to reject invalid filters and unsafe sorting, combine conditions, and preserve cursor/filter consistency.
6. How to test missing/duplicate records, inspect indexes, and use window functions where they are useful.

## Prerequisites

- Node.js 20+ (LTS recommended), npm, PostgreSQL, pgAdmin **or** `psql`, Postman (optional).
- Use a **separate practice database**, not a production or tenant database.
- No Docker, Redis, ORM, or frontend is required.

## Step 1 — install dependencies

From this project directory in PowerShell:

```powershell
npm install
```

This installs packages defined in `package.json`: `express`, `pg`, `dotenv`, `zod`.

## Step 2 — create the database and tables

In pgAdmin: connect to your local server, create a database named **advanced_pagination_practice**. Open Query Tool for that database. Run `sql/01_schema.sql`, then `sql/02_seed.sql`.

Or run in PowerShell if `psql` is on PATH:

```powershell
psql -h localhost -U postgres -d postgres -c "CREATE DATABASE advanced_pagination_practice;"
psql -h localhost -U postgres -d advanced_pagination_practice -f sql/01_schema.sql
psql -h localhost -U postgres -d advanced_pagination_practice -f sql/02_seed.sql
```

`01_schema.sql` creates products and four indexes. `02_seed.sql` loads 80 demo products. **Warning:** the seed truncates only the `products` table in this practice database each time you run it.

Check in pgAdmin:

```sql
SELECT COUNT(*) FROM products;   -- 80
SELECT * FROM products ORDER BY id LIMIT 5;
```

## Step 3 — configure environment

```powershell
Copy-Item .env.example .env
```

Open `.env` and replace the PostgreSQL password and `CURSOR_SECRET`. Example:

```env
DATABASE_URL=postgresql://postgres:YOUR_REAL_PASSWORD@localhost:5432/advanced_pagination_practice
PORT=3000
CURSOR_SECRET=put_a_long_random_string_at_least_32_characters_here
```

For a random 32-byte hex secret in PowerShell:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Paste it after `CURSOR_SECRET=`. Do not commit `.env`. If the DB password includes `@`, `#`, `/`, `%`, `:` or other URL-reserved characters, **percent-encode it** in `DATABASE_URL` (for example `@` becomes `%40`).

## Step 4 — start the API

```powershell
npm run dev
```

Expected terminal message:

```text
Pagination API running on http://localhost:3000
```

Test connection in Postman or a browser:

```text
GET http://localhost:3000/health
```

Expected: `{ "status": "ok" }`. An HTTP 500 here usually means the DB URL, credentials, server, or database setup needs fixing.

## Step 5 — test the API in Postman

Select **GET**, paste each example into the address bar, then press **Send**:

| Requirement | Request |
|---|---|
| First page (default newest) | `http://localhost:3000/products?limit=5` |
| Next page | Repeat same URL with `&cursor=TOKEN_FROM_nextCursor` |
| Previous page | Repeat same URL with `&cursor=TOKEN_FROM_previousCursor` |
| Oldest first | `http://localhost:3000/products?sortBy=created_at&sortDir=asc&limit=5` |
| Lowest price first | `http://localhost:3000/products?sortBy=price&sortDir=asc&limit=5` |
| Highest price first | `http://localhost:3000/products?sortBy=price&sortDir=desc&limit=5` |
| Search by text | `http://localhost:3000/products?search=Demo%20Product%20010` |
| Single category | `http://localhost:3000/products?category=Books` |
| Multiple categories (OR) | `http://localhost:3000/products?categories=Books,Electronics` |
| In stock only | `http://localhost:3000/products?inStock=true` |
| Price between values | `http://localhost:3000/products?minPrice=300&maxPrice=900` |
| Combined filters | `http://localhost:3000/products?categories=Books,Electronics&inStock=true&minPrice=300&maxPrice=900&sortBy=price&sortDir=asc&limit=5` |
| Invalid sort field (400) | `http://localhost:3000/products?sortBy=password` |
| Invalid price range (400) | `http://localhost:3000/products?minPrice=1000&maxPrice=100` |

**Example response shape** (IDs and data depend on chosen query):

```json
{
  "data": [
    { "id": "76", "name": "Demo Product 076", "category": "Electronics", "price": "799.99", "in_stock": true, "created_at": "2026-01-07T00:00:00.000Z" }
  ],
  "pageInfo": {
    "limit": 5,
    "hasNextPage": true,
    "hasPreviousPage": false,
    "nextCursor": "<generated opaque token>",
    "previousCursor": null
  }
}
```

> `data` above shows one illustrative row only, not the complete `limit=5` response. `id` and `price` are strings because PostgreSQL BIGINT and NUMERIC should not silently lose precision in JavaScript.

For Postman, paste the full `nextCursor` without quotes. Use the **same filters and sort parameters** on every page. The API rejects cursors reused with different search filters or sorting.

### PowerShell alternative

```powershell
$first = Invoke-RestMethod 'http://localhost:3000/products?limit=5&sortBy=price&sortDir=asc'
$first.data | Format-Table id,name,price
$cursor = [uri]::EscapeDataString($first.pageInfo.nextCursor)
$second = Invoke-RestMethod "http://localhost:3000/products?limit=5&sortBy=price&sortDir=asc&cursor=$cursor"
$second.data | Format-Table id,name,price
```

## Step 6 — understand how cursors work

For ascending price order:

```text
(price,id): (100,1), (100,2), (100,5), (200,3), (300,4)
Page 1, limit=2: (100,1), (100,2)
Next cursor anchor: (100,2)
Page 2 WHERE (price,id) > (100,2): (100,5), (200,3)
```

The `id` tie-breaker ensures that repeated prices do **not** cause `(100,5)` to be skipped. Descending order uses `<` instead of `>`.

For Previous, the query finds records before the **first** displayed row, sorts in the opposite direction to get the nearest neighbors, limits the result, then reverses the array back into normal display order.

The signed cursor stores: version, sort field/direction, filter hash, movement (`next`/`prev`), exact sort value, record ID. It is **opaque to clients but NOT encrypted**. It must never contain passwords or sensitive data. The HMAC signature prevents tampering, and the filter hash prevents accidental reuse with changed filters. Changing `CURSOR_SECRET` invalidates existing cursors.

The API performs one page query plus two small `EXISTS` checks to provide accurate `hasNextPage` and `hasPreviousPage` for the currently visible rows.

## Step 7 — query-builder layer and filter rules

- `src/validate.js`: validates all query arguments and rejects unknown fields with HTTP 400.
- `src/query-builder.js`: builds `WHERE` clauses and `$1`, `$2`, ... parameter arrays; only predefined SQL sort columns are interpolated.
- `src/cursor.js`: generates/verifies signed cursors and hashes the normalized filters.
- `src/app.js`: runs the page query, reverses backward pages, checks both page boundaries, and creates the API response.
- `src/db.js`: PostgreSQL connection pool; `src/server.js`: starts Express.

Compound rule example:

```text
(categories = Books OR Electronics)
AND (price >= 300)
AND (price <= 900)
AND (in_stock = true)
AND (name contains optional search text)
```

`categories=Books,Electronics` is validated as an allowlist, sorted/deduplicated, and safely passed into a PostgreSQL `ANY($n::text[])` expression. You can use **either** `category` or `categories`, not both.

Whitelisted sort fields: `created_at`, `price`. Allowed directions: `asc`, `desc`. Maximum page size: `100`. `created_at`, `price` and `id` are non-null in this sample; nullable sort fields need explicit NULL ordering and cursor logic.

## Step 8 — confirm indexes and query performance

Run in pgAdmin:

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, name, price
FROM products
WHERE category = 'Books' AND price >= 300
  AND (price, id) > (499.99::numeric, 10::bigint)
ORDER BY price ASC, id ASC
LIMIT 11;
```

Look for index scans, rows scanned, and execution time. Only 80 rows are seeded, so the optimizer may reasonably choose a sequential scan. For a realistic comparison, bulk-load **many more** records into the practice DB, then run `ANALYZE products;` and repeat `EXPLAIN`.

B-tree indexes on `(created_at,id)` and `(price,id)` support ascending and descending keyset navigation. Category-leading composite indexes support the matching category filter + order. More indexes have write/storage costs; add new ones only for measured queries.

Optional for large substring searches (requires PostgreSQL `pg_trgm` extension availability/permission):

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_products_name_trgm
  ON products USING GIN (name gin_trgm_ops);
```

Substring `ILIKE '%term%'` normally cannot use a standard B-tree prefix index efficiently; the trigram index may help for longer search terms. Very short search terms may still scan many rows.

## Step 9 — run the window-function examples

Run `sql/03_window_example.sql` in pgAdmin. The first query uses:

```sql
ROW_NUMBER() OVER (PARTITION BY category ORDER BY price DESC, id DESC)
```

It ranks each category's products by price so you can retrieve **top 3 products per category**. The second query demonstrates `COUNT(*) OVER (PARTITION BY category)` for category counts without collapsing detail rows. These are valid **analytics** uses; don't calculate full-table row numbers just to implement deep cursor pagination.

## Step 10 — test functionality automatically

**Use the dedicated practice database** because one test inserts and deletes temporary products. Keep PostgreSQL running, then execute:

```powershell
npm test
```

`test/api.test.js` checks:

1. Forward navigation returns every seeded record once with repeated prices.
2. Backward navigation returns the original first page.
3. Compound filters and multi-category OR filters work.
4. Bad limit, sort field, unknown parameters, and price ranges return 400.
5. Tampered cursors and mismatched cursor filters/sorts return 400.
6. Deleting a record from an earlier page does not shift subsequent pages when the sort key stays immutable.

Run tests after seeding. Avoid running them against production data or while another process is modifying the same test rows.

## Step 11 — limitations to understand

- Stable `(sort_value,id)` prevents skips/duplicates caused by **equal sort values** and avoids offset shifting from deletions before the cursor.
- It does **not** create a frozen database snapshot across HTTP requests. New rows may appear or be absent depending on their sort position; deletions can remove items before you see them.
- If a product's `price` changes while traversing `sortBy=price`, it can move between pages and reappear or be missed. For the strongest continuity use an immutable sorting field, or implement a snapshot/export workflow if a fixed view is required.
- The page query and the two `EXISTS` queries use separate statements; very high concurrent write activity can make page flags momentarily inconsistent. A single repeatable-read transaction can align the statements for one API request, but not freeze subsequent requests.
- This project deliberately does not return an exact `totalCount` on each page: full counts can be expensive on huge filtered datasets. Provide an optional count endpoint only if UI requirements justify it.
- Cursor HMAC authenticates **integrity**, not secrecy. Keep cursor contents non-sensitive. In production, also apply authentication, tenant/user scope and authorization in the query and cursor hash if applicable.

## Mistakes to avoid (specific to this task)

1. Using only `ORDER BY price` or `ORDER BY created_at` without a unique `id` tie-breaker.
2. Using large `OFFSET` queries for deep paging and expecting stable results during writes.
3. Using `>=` or `<=` for the next/previous anchor (repeats the boundary row); use strict `>` or `<`.
4. Using the next-page comparison for a previous-page request without reversing the SQL order and output array.
5. Putting user-provided sort fields directly into SQL instead of a whitelist.
6. Concatenating user-provided search/filter values into SQL instead of parameterized `$n` values.
7. Allowing empty, negative, fractional or unbounded `limit` values.
8. Reusing a cursor after changing a filter or sort without restarting at page one.
9. Converting BIGINT IDs to JS Number or TIMESTAMPTZ sort keys to millisecond-only ISO strings (precision loss).
10. Forgetting indexes that match the filter plus stable sort, or assuming every index speeds every query.
11. Relying on `COUNT(*) OVER()` to get a total on every high-volume cursor request without assessing performance.
12. Claiming keyset pagination guarantees zero duplicates under **mutable sort fields** or a true cross-request snapshot.
13. Forgetting to test same-price/timestamp records and both directions after rows are deleted/inserted.
14. Leaving cursors unsigned or embedding credentials/sensitive data in their payload.

## Trusted references

- PostgreSQL row comparisons: https://www.postgresql.org/docs/current/functions-comparisons.html
- PostgreSQL window functions: https://www.postgresql.org/docs/current/tutorial-window.html
- node-postgres parameterized SQL: https://node-postgres.com/features/queries
- Express 5 error handling: https://expressjs.com/en/5x/guide/error-handling/
