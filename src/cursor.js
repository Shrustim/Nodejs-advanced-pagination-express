import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { HttpError } from './validate.js';

function secret() {
  const value = process.env.CURSOR_SECRET;
  if (!value || value.length < 32) {
    throw new Error('Set CURSOR_SECRET to at least 32 characters in .env');
  }
  return value;
}

export function filterFingerprint(filters) {
  const canonical = {
    search: filters.search ?? null,
    category: filters.category ?? null,
    categories: filters.categories ?? null,
    inStock: filters.inStock ?? null,
    minPrice: filters.minPrice ?? null,
    maxPrice: filters.maxPrice ?? null,
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

export function makeCursor({ sortBy, sortDir, filterHash, move, row }) {
  const payload = {
    v: 1,
    sortBy,
    sortDir,
    filterHash,
    move,
    value: row.cursor_sort_value, // PostgreSQL text preserves microseconds and numeric precision.
    id: row.id,                  // BIGINT stays a string; no JS number rounding.
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', secret()).update(body).digest('base64url');
  return `${body}.${signature}`;
}

export function readCursor(token, { sortBy, sortDir, filterHash }) {
  if (typeof token !== 'string' || token.length > 4096 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) {
    throw new HttpError(400, 'Invalid cursor');
  }
  const [body, received] = token.split('.');
  const expected = createHmac('sha256', secret()).update(body).digest('base64url');
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new HttpError(400, 'Invalid cursor signature');
  }
  let payload;
  try { payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); }
  catch { throw new HttpError(400, 'Invalid cursor payload'); }
  if (!payload || payload.v !== 1 || payload.sortBy !== sortBy ||
      payload.sortDir !== sortDir || payload.filterHash !== filterHash ||
      !['next', 'prev'].includes(payload.move) ||
      typeof payload.value !== 'string' || typeof payload.id !== 'string' ||
      !/^[1-9]\d{0,18}$/.test(payload.id) || payload.value.length > 100) {
    throw new HttpError(400, 'Cursor does not match current filters or sorting');
  }
  return payload;
}
