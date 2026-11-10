import { z } from 'zod';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const money = z.string()
  .regex(/^(0|[1-9]\d*)(\.\d{1,2})?$/, 'Use a non-negative price with up to 2 decimals')
  .transform(Number)
  .refine((v) => Number.isSafeInteger(Math.round(v * 100)) && v <= 1_000_000_000,
    'Price is too large');

const schema = z.object({
  limit: z.string().regex(/^[1-9]\d*$/).transform(Number)
    .pipe(z.number().int().min(1).max(100)).default(10),
  sortBy: z.enum(['created_at', 'price']).default('created_at'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
  search: z.string().trim().min(1).max(100).optional(),
  category: z.enum(['Electronics', 'Furniture', 'Books', 'Clothing']).optional(),
  // OR inside this filter: categories=Electronics,Books
  categories: z.string().min(1).transform((s) => s.split(',').map((v) => v.trim()))
    .refine((xs) => xs.length <= 4 && xs.every((x) => ['Electronics', 'Furniture', 'Books', 'Clothing'].includes(x)),
      'Use comma-separated allowed categories')
    .transform((xs) => [...new Set(xs)].sort()).optional(),
  inStock: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  minPrice: money.optional(),
  maxPrice: money.optional(),
  cursor: z.string().min(1).max(4096).optional(),
}).strict().superRefine((data, ctx) => {
  if (data.category !== undefined && data.categories !== undefined) {
    ctx.addIssue({ code: 'custom', message: 'Use category or categories, not both', path: ['categories'] });
  }
  if (data.minPrice !== undefined && data.maxPrice !== undefined && data.minPrice > data.maxPrice) {
    ctx.addIssue({ code: 'custom', message: 'minPrice must be <= maxPrice', path: ['minPrice'] });
  }
});

export function parseProductQuery(query) {
  const result = schema.safeParse(query);
  if (!result.success) {
    throw new HttpError(400, result.error.issues.map((x) => `${x.path.join('.') || 'query'}: ${x.message}`).join('; '));
  }
  return result.data;
}
