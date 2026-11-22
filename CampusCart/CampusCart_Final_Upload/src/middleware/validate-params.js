import { z } from 'zod';
import { ApiError } from '../utils.js';

const objectId = z.object({ id: z.string().regex(/^[a-f\d]{24}$/i) });
const productId = z.object({ productId: z.string().regex(/^[a-f\d]{24}$/i) });

export function validateIdParam(key = 'id') {
  const schema = key === 'productId' ? productId : objectId;
  return (req, res, next) => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      return next(new ApiError(422, 'Invalid route parameter', result.error.flatten()));
    }
    next();
  };
}
