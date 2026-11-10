import express from 'express';
import { pool } from './db.js';
import { parseProductQuery, HttpError } from './validate.js';
import { filterFingerprint, makeCursor, readCursor } from './cursor.js';
import { buildExistsQuery, buildPageQuery } from './query-builder.js';

export const app = express();
app.disable('x-powered-by');

app.get('/health', async (req, res) => {
  await pool.query('SELECT 1');
  res.json({ status: 'ok' });
});

app.get('/products', async (req, res) => {
  const filters = parseProductQuery(req.query);
  const filterHash = filterFingerprint(filters);
  const context = { sortBy: filters.sortBy, sortDir: filters.sortDir, filterHash };
  const cursor = filters.cursor ? readCursor(filters.cursor, context) : null;

  const pageQuery = buildPageQuery(filters, cursor);
  const result = await pool.query(pageQuery.sql, pageQuery.values);
  let rows = result.rows.slice(0, filters.limit);
  if (pageQuery.isPrev) rows = rows.reverse();

  let hasNextPage = false;
  let hasPreviousPage = false;
  if (rows.length) {
    const first = rows[0];
    const last = rows[rows.length - 1];
    const [before, after] = await Promise.all([
      buildExistsQuery(filters, first, 'prev'),
      buildExistsQuery(filters, last, 'next'),
    ].map((query) => pool.query(query.sql, query.values)));
    hasPreviousPage = before.rows[0].found;
    hasNextPage = after.rows[0].found;
  }

  res.json({
    data: rows.map(({ cursor_sort_value, ...product }) => product),
    pageInfo: {
      limit: filters.limit,
      hasNextPage,
      hasPreviousPage,
      nextCursor: hasNextPage ? makeCursor({ ...context, move: 'next', row: rows.at(-1) }) : null,
      previousCursor: hasPreviousPage ? makeCursor({ ...context, move: 'prev', row: rows[0] }) : null,
    },
  });
});

app.use((error, req, res, next) => {
  if (error instanceof HttpError) {
    return res.status(error.status).json({ error: error.message });
  }
  console.error('Request failed:', error);
  res.status(500).json({ error: 'Internal server error' });
});
