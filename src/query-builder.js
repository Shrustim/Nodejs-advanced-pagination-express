// Whitelist column names: never interpolate a user-supplied identifier.
const SORT_FIELDS = Object.freeze({
  created_at: { column: 'created_at', cast: 'timestamptz' },
  price: { column: 'price', cast: 'numeric' },
});

export function sortDefinition(sortBy) { return SORT_FIELDS[sortBy]; }

export function buildFilters(filters) {
  const parts = [];
  const values = [];
  const add = (sql, value) => {
    values.push(value);
    parts.push(sql.replace('?', `$${values.length}`));
  };

  if (filters.search !== undefined) {
    // Treat %, _ and backslash as literal search text rather than wildcard characters.
    const escaped = filters.search.replace(/[\\%_]/g, '\\$&');
    add("p.name ILIKE ? ESCAPE '\\'", `%${escaped}%`);
  }
  if (filters.category !== undefined) add('p.category = ?', filters.category);
  if (filters.categories !== undefined) add('p.category = ANY(?::text[])', filters.categories);
  if (filters.inStock !== undefined) add('p.in_stock = ?', filters.inStock);
  if (filters.minPrice !== undefined) add('p.price >= ?', filters.minPrice);
  if (filters.maxPrice !== undefined) add('p.price <= ?', filters.maxPrice);

  return { parts, values };
}

export function compareOperator(sortDir, side) {
  // ASC: next is greater; DESC: next is smaller.
  const isGreater = (sortDir === 'asc') === (side === 'next');
  return isGreater ? '>' : '<';
}

function withWhere(parts) {
  return parts.length ? `WHERE ${parts.join(' AND ')}` : '';
}

function cursorCondition(sort, operator, n) {
  return `(p.${sort.column}, p.id) ${operator} ($${n}::${sort.cast}, $${n + 1}::bigint)`;
}

export function buildPageQuery(filters, cursor) {
  const sort = sortDefinition(filters.sortBy);
  const { parts, values } = buildFilters(filters);
  const isPrev = cursor?.move === 'prev';
  const side = isPrev ? 'prev' : 'next';
  if (cursor) {
    const op = compareOperator(filters.sortDir, side);
    parts.push(cursorCondition(sort, op, values.length + 1));
    values.push(cursor.value, cursor.id);
  }
  const direction = isPrev
    ? (filters.sortDir === 'asc' ? 'DESC' : 'ASC')
    : filters.sortDir.toUpperCase();
  values.push(filters.limit + 1);
  const sql = `
    SELECT p.id, p.name, p.category, p.price, p.in_stock, p.created_at,
           p.${sort.column}::text AS cursor_sort_value
    FROM products p
    ${withWhere(parts)}
    ORDER BY p.${sort.column} ${direction}, p.id ${direction}
    LIMIT $${values.length}
  `;
  return { sql, values, isPrev };
}

export function buildExistsQuery(filters, anchor, side) {
  const sort = sortDefinition(filters.sortBy);
  const { parts, values } = buildFilters(filters);
  const op = compareOperator(filters.sortDir, side);
  parts.push(cursorCondition(sort, op, values.length + 1));
  values.push(anchor.cursor_sort_value, anchor.id);
  return {
    sql: `SELECT EXISTS (SELECT 1 FROM products p ${withWhere(parts)}) AS found`,
    values,
  };
}
