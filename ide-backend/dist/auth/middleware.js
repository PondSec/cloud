import { findUserById } from '../db.js';
import { verifySessionToken } from './jwt.js';
export function requireAuth(req, res, next) {
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
    }
    catch {
        res.status(401).json({ error: 'Invalid or expired token' });
    }
}
export function requireAuthWs(token) {
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
