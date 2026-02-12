import { URL } from 'node:url';
import { Router } from 'express';
import { verifySessionToken } from '../auth/jwt.js';
import { requireWorkspace } from '../workspace/service.js';
import { config } from '../config.js';
export const previewRouter = Router();
async function forwardPreview(req, res, pathSuffix) {
    try {
        const token = typeof req.query.token === 'string' ? req.query.token : null;
        if (!token) {
            res.status(401).json({ error: 'Missing preview token' });
            return;
        }
        const session = verifySessionToken(token);
        requireWorkspace(req.params.workspaceId, session.sub);
        const target = new URL(`/preview/${req.params.workspaceId}/${req.params.port}/${pathSuffix}`, config.runnerUrl);
        for (const [key, value] of Object.entries(req.query)) {
            if (key === 'token')
                continue;
            if (typeof value === 'string') {
                target.searchParams.set(key, value);
            }
        }
        const headers = {
            accept: req.headers.accept ?? '*/*',
        };
        const hostHeader = req.headers.host;
        if (typeof hostHeader === 'string') {
            headers.host = hostHeader;
        }
        const userAgent = req.headers['user-agent'];
        if (typeof userAgent === 'string') {
            headers['user-agent'] = userAgent;
        }
        const upstream = await fetch(target.toString(), {
            method: req.method,
            headers,
        });
        res.status(upstream.status);
        upstream.headers.forEach((value, key) => {
            if (key.toLowerCase() === 'transfer-encoding')
                return;
            res.setHeader(key, value);
        });
        if (!upstream.body) {
            res.end();
            return;
        }
        const reader = upstream.body.getReader();
        while (true) {
            const chunk = await reader.read();
            if (chunk.done)
                break;
            res.write(Buffer.from(chunk.value));
        }
        res.end();
    }
    catch (error) {
        res.status(502).json({ error: 'Preview proxy failed', detail: String(error) });
    }
}
previewRouter.use('/:workspaceId/:port', async (req, res) => {
    await forwardPreview(req, res, '');
});
previewRouter.use('/:workspaceId/:port/*', async (req, res) => {
    await forwardPreview(req, res, req.params[0] ?? '');
});
