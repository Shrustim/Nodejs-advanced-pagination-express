import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { app } from '../src/app.js';
import { pool } from '../src/db.js';

let server;
let url;

before(async () => {
  // Tests require the practice database + schema + seed.
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM products');
  assert.ok(rows[0].n > 0, 'Run sql/02_seed.sql first');
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  url = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

async function api(path) {
  const response = await fetch(`${url}${path}`);
  return { status: response.status, body: await response.json() };
}

function getProducts(params) {
  return api(`/products?${new URLSearchParams(params)}`);
}

async function allPages(params) {
  const seen = [];
  let cursor;
  for (let i = 0; i < 1000; i++) {
    const response = await getProducts(cursor ? { ...params, cursor } : params);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const { data, pageInfo } = response.body;
    assert.ok(data.length <= Number(params.limit ?? 10));
    seen.push(...data);
    if (!pageInfo.hasNextPage) return seen;
    assert.ok(pageInfo.nextCursor);
    cursor = pageInfo.nextCursor;
  }
  throw new Error('Too many pages, possible pagination loop');
}

test('traverses every seeded record without duplicates (ties included)', async () => {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM products');
  const data = await allPages({ limit: '7', sortBy: 'price', sortDir: 'asc' });
  assert.equal(data.length, rows[0].n);
  assert.equal(new Set(data.map((p) => p.id)).size, data.length);
  for (let i = 1; i < data.length; i++) {
    const before = data[i - 1];
    const after = data[i];
    const priceDiff = Number(after.price) - Number(before.price);
    assert.ok(priceDiff > 0 || (priceDiff === 0 && BigInt(after.id) > BigInt(before.id)));
  }
});

test('previous cursor returns the same original page', async () => {
  const params = { limit: '6', sortBy: 'created_at', sortDir: 'desc' };
  const first = await getProducts(params);
  const second = await getProducts({ ...params, cursor: first.body.pageInfo.nextCursor });
  assert.equal(second.status, 200);
  assert.equal(second.body.pageInfo.hasPreviousPage, true);
  const back = await getProducts({ ...params, cursor: second.body.pageInfo.previousCursor });
  assert.equal(back.status, 200);
  assert.deepEqual(back.body.data.map((x) => x.id), first.body.data.map((x) => x.id));
});

test('compound filters enforce category, price, availability, search and order', async () => {
  const params = {
    category: 'Electronics', inStock: 'true', minPrice: '200',
    maxPrice: '1250', search: 'Demo Product', sortBy: 'price', sortDir: 'desc', limit: '3',
  };
  const rows = await allPages(params);
  assert.ok(rows.length > 0);
  for (const p of rows) {
    assert.equal(p.category, 'Electronics');
    assert.equal(p.in_stock, true);
    assert.ok(Number(p.price) >= 200 && Number(p.price) <= 1250);
    assert.ok(p.name.includes('Demo Product'));
  }
});

test('multi-category OR group combines with AND price and stock filters', async () => {
  const data = await allPages({ categories: 'Electronics,Books', inStock: 'true',
    minPrice: '300', maxPrice: '800', sortBy: 'price', sortDir: 'asc', limit: '2' });
  assert.ok(data.length > 0);
  assert.ok(data.every((x) => ['Electronics', 'Books'].includes(x.category) &&
    x.in_stock && Number(x.price) >= 300 && Number(x.price) <= 800));
});

test('rejects unsafe or inconsistent parameters', async () => {
  const cases = [
    { sortBy: 'price;DROP TABLE products' },
    { limit: '101' },
    { limit: '-1' },
    { minPrice: '500', maxPrice: '100' },
    { inStock: 'sometimes' },
    { madeUp: 'yes' },
    { categories: 'Books,NotARealCategory' },
    { category: 'Books', categories: 'Electronics' },
    { cursor: 'not.a.valid.cursor' },
  ];
  for (const params of cases) {
    const response = await getProducts(params);
    assert.equal(response.status, 400, JSON.stringify(params));
  }
});

test('signed cursor cannot be reused with different filters or sorting', async () => {
  const start = await getProducts({ limit: '2', sortBy: 'price', sortDir: 'asc' });
  const cursor = start.body.pageInfo.nextCursor;
  assert.ok(cursor);
  assert.equal((await getProducts({ limit: '2', sortBy: 'price', sortDir: 'asc', category: 'Books', cursor })).status, 400);
  assert.equal((await getProducts({ limit: '2', sortBy: 'price', sortDir: 'desc', cursor })).status, 400);
  const tampered = cursor.slice(0, -1) + (cursor.at(-1) === 'A' ? 'B' : 'A');
  assert.equal((await getProducts({ limit: '2', sortBy: 'price', sortDir: 'asc', cursor: tampered })).status, 400);
});

test('a deletion on a previous page does not shift the next page', async () => {
  const prefix = `PaginationProbe-${randomUUID()}`;
  const ids = [];
  try {
    for (let i = 0; i < 5; i++) {
      const { rows } = await pool.query(
        `INSERT INTO products (name, category, price, in_stock, created_at)
         VALUES ($1, 'Books', 777.77, true, '2026-08-01T00:00:00Z') RETURNING id`,
        [`${prefix}-${i}`],
      );
      ids.push(rows[0].id);
    }
    const params = { search: prefix, limit: '2', sortBy: 'created_at', sortDir: 'asc' };
    const first = await getProducts(params);
    assert.deepEqual(first.body.data.map((p) => p.id), ids.slice(0, 2));
    await pool.query('DELETE FROM products WHERE id = $1', [ids[0]]);
    const second = await getProducts({ ...params, cursor: first.body.pageInfo.nextCursor });
    assert.deepEqual(second.body.data.map((p) => p.id), ids.slice(2, 4));
    const third = await getProducts({ ...params, cursor: second.body.pageInfo.nextCursor });
    assert.deepEqual(third.body.data.map((p) => p.id), ids.slice(4));
  } finally {
    if (ids.length) await pool.query('DELETE FROM products WHERE id = ANY($1::bigint[])', [ids]);
  }
});
