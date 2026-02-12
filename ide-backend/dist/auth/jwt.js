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
    return {
        sub: String(payload.sub),
        email: String(payload.email),
    };
}
