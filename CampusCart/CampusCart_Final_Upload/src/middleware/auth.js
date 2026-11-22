import jwt from 'jsonwebtoken';
import { rateLimit } from 'express-rate-limit';
import { env } from '../config/env.js';
import { User } from '../models/index.js';
import { ApiError, asyncHandler } from '../utils.js';

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 100,
  standardHeaders: 'draft-8',
  legacyHeaders: false
});

export const authenticate = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw new ApiError(401, 'Authentication token required');
  }

  let payload;
  try {
    payload = jwt.verify(header.slice(7), env.JWT_ACCESS_SECRET);
  } catch {
    throw new ApiError(401, 'Invalid or expired access token');
  }

  const user = await User.findById(payload.sub);
  if (!user || user.status === 'suspended') {
    throw new ApiError(401, 'Account unavailable');
  }
  if (payload.sessionVersion !== (user.sessionVersion ?? 0)) {
    throw new ApiError(401, 'Session has been revoked; please sign in again');
  }

  req.user = user;
  next();
});

export function authorize(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return next(new ApiError(403, 'Insufficient permissions'));
    }
    if (req.user.role === 'seller' && req.user.status !== 'active') {
      return next(new ApiError(403, 'Seller approval is required'));
    }
    next();
  };
}
