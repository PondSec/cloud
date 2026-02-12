import type { NextFunction, Request, Response } from 'express';

import { findUserById } from '../db.js';
import { verifySessionToken } from './jwt.js';

declare global {
  namespace Express {
    interface Request {
      auth?: {
        userId: string;
        email: string;
      };
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing bearer token' });
    return;
  }

  const token = header.slice('Bearer '.length).trim();

  try {
    const payload = verifySessionToken(token);
    const user = findUserById(payload.sub);
    if (!user) {
      res.status(401).json({ error: 'User not found' });
      return;
    }

    req.auth = {
      userId: user.id,
      email: user.email,
    };
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function requireAuthWs(token: string | null): { userId: string; email: string } {
  if (!token) {
    throw new Error('Missing token');
  }

  const payload = verifySessionToken(token);
  const user = findUserById(payload.sub);
  if (!user) {
    throw new Error('User not found');
  }

  return {
    userId: user.id,
    email: user.email,
  };
}
