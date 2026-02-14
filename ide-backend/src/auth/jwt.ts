import jwt from 'jsonwebtoken';

import { config } from '../config.js';

export interface SessionTokenPayload {
  sub: string;
  email: string;
}

export function signSessionToken(payload: SessionTokenPayload): string {
  return jwt.sign(payload as object, config.jwtSecret as jwt.Secret, {
    expiresIn: config.jwtExpiresIn,
    issuer: 'cloudide-backend',
    audience: 'cloudide-client',
  } as jwt.SignOptions);
}

export function verifySessionToken(token: string): SessionTokenPayload {
  const payload = jwt.verify(token, config.jwtSecret, {
    issuer: 'cloudide-backend',
    audience: 'cloudide-client',
  });

  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid session token payload');
  }

  if (typeof payload.sub !== 'string' || !payload.sub.trim()) {
    throw new Error('Invalid session token subject');
  }
  if (typeof payload.email !== 'string' || !payload.email.trim()) {
    throw new Error('Invalid session token email');
  }

  return {
    sub: payload.sub,
    email: payload.email.toLowerCase(),
  };
}
