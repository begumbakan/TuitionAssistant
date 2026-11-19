import jwt from 'jsonwebtoken';
import type { NextFunction, Request, Response } from 'express';
import { AppError } from './errors.js';
import type { Role } from './types.js';

export const ISSUER = 'tuition-api';

export interface Claims { sub: string; role: Role; studentNo: string | null }

export function signToken(c: Claims, secret: string, expiresInSec = 3600): string {
  return jwt.sign({ role: c.role, studentNo: c.studentNo }, secret, {
    algorithm: 'HS256', issuer: ISSUER, subject: c.sub, expiresIn: expiresInSec,
  });
}

declare module 'express-serve-static-core' {
  interface Request { auth?: Claims }
}

export function requireAuth(secret: string, roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const h = req.header('authorization') ?? '';
    const m = /^Bearer (.+)$/i.exec(h);
    if (!m) return next(new AppError(401, 'UNAUTHENTICATED', 'Missing bearer token'));
    try {
      const p = jwt.verify(m[1], secret, { algorithms: ['HS256'], issuer: ISSUER }) as any;
      req.auth = { sub: p.sub, role: p.role, studentNo: p.studentNo ?? null };
    } catch {
      return next(new AppError(401, 'UNAUTHENTICATED', 'Invalid or expired token'));
    }
    if (!roles.includes(req.auth.role)) return next(new AppError(403, 'FORBIDDEN', `Role '${req.auth.role}' may not call this operation`));
    next();
  };
}

/** A student may only touch their own record; bank/admin backends may act on any student. */
export function assertCanAccessStudent(auth: Claims | undefined, studentNo: string) {
  if (!auth) throw new AppError(401, 'UNAUTHENTICATED', 'Missing bearer token');
  if (auth.role === 'student' && auth.studentNo !== studentNo) {
    throw new AppError(403, 'FORBIDDEN', 'Students can only access their own tuition data');
  }
}
