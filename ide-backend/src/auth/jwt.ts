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

  return {
    sub: String(payload.sub),
    email: String(payload.email),
  };
}
