import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFilters, buildPageQuery, compareOperator } from '../src/query-builder.js';

test('keyset comparisons flip across direction and movement', () => {
  assert.equal(compareOperator('asc', 'next'), '>');
  assert.equal(compareOperator('asc', 'prev'), '<');
  assert.equal(compareOperator('desc', 'next'), '<');
  assert.equal(compareOperator('desc', 'prev'), '>');
});

test('previous navigation reverses SQL ordering and uses tie breaker', () => {
  const query = buildPageQuery({ limit: 5, sortBy: 'price', sortDir: 'asc' },
    { move: 'prev', value: '499.99', id: '15' });
  assert.match(query.sql, /\(p\.price, p\.id\) < \(\$1::numeric, \$2::bigint\)/);
  assert.match(query.sql, /ORDER BY p\.price DESC, p\.id DESC/);
  assert.deepEqual(query.values, ['499.99', '15', 6]);
});

test('multi-category filter uses parameters, not literal SQL', () => {
  const f = buildFilters({ categories: ['Books', 'Electronics'], search: '10%_\\' });
  assert.ok(f.parts.includes('p.category = ANY($2::text[])'));
  assert.ok(!f.parts.join(' ').includes('Electronics'));
  assert.deepEqual(f.values[1], ['Books', 'Electronics']);
  assert.equal(f.values[0], '%10\\%\\_\\\\%');
});
