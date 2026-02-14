import crypto from 'node:crypto';
import { config } from './config.js';
const AUTH_HEADER = 'x-runner-secret';
function timingSafeEquals(a, b) {
    const aBytes = Buffer.from(a);
    const bBytes = Buffer.from(b);
    if (aBytes.length !== bBytes.length) {
        return false;
    }
    return crypto.timingSafeEqual(aBytes, bBytes);
}
export function requireRunnerSecret(req, res, next) {
    const provided = req.header(AUTH_HEADER);
    const expected = config.runnerSharedSecret;
    if (!provided || !timingSafeEquals(provided, expected)) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }
    next();
}
