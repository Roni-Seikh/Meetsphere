import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors.js';
import type { Authenticator, AuthUser } from '../types.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/** Verifies "Authorization: Bearer <supabase access token>" and attaches req.user. */
export function requireAuth(authenticate: Authenticator) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) throw new AppError(401, 'UNAUTHENTICATED', 'Please sign in to continue.');
    const user = await authenticate(token);
    if (!user) throw new AppError(401, 'UNAUTHENTICATED', 'Your session is invalid or has expired.');
    req.user = user;
    next();
  };
}

/** Small in-memory cache so every request does not hit Supabase Auth. TTL is short on purpose. */
export function cachedAuthenticator(inner: Authenticator, ttlMs = 30_000, max = 1_000): Authenticator {
  const cache = new Map<string, { user: AuthUser; expires: number }>();
  return async (token) => {
    const now = Date.now();
    const hit = cache.get(token);
    if (hit && hit.expires > now) return hit.user;
    const user = await inner(token);
    if (user) {
      if (cache.size >= max) cache.delete(cache.keys().next().value as string);
      cache.set(token, { user, expires: now + ttlMs });
    } else {
      cache.delete(token);
    }
    return user;
  };
}
