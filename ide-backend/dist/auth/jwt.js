import jwt from 'jsonwebtoken';
import { config } from '../config.js';
export function signSessionToken(payload) {
    return jwt.sign(payload, config.jwtSecret, {
        expiresIn: config.jwtExpiresIn,
        issuer: 'cloudide-backend',
        audience: 'cloudide-client',
    });
}
export function verifySessionToken(token) {
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
