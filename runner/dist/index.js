import fs from 'node:fs';
import http from 'node:http';
import express from 'express';
import morgan from 'morgan';
import { requireRunnerSecret } from './auth.js';
import { config } from './config.js';
import { containerRouter } from './api/containers.js';
import { previewRouter } from './api/preview.js';
import { ensureWorkspaceImageBuilt } from './services/docker.js';
import { registerRunnerWs } from './ws/index.js';
async function main() {
    fs.mkdirSync(config.workspacesRoot, { recursive: true });
    await ensureWorkspaceImageBuilt();
    const app = express();
    app.use(morgan('dev'));
    app.use(express.json({ limit: '2mb' }));
    app.get('/health', (_req, res) => {
        res.json({ ok: true, service: 'runner' });
    });
    app.use('/preview', requireRunnerSecret, previewRouter);
    app.use('/containers', requireRunnerSecret, containerRouter);
    app.use((error, _req, res, _next) => {
        const message = error instanceof Error ? error.message : String(error);
        res.status(500).json({ error: message });
    });
    const server = http.createServer(app);
    registerRunnerWs(server);
    server.listen(config.port, '0.0.0.0', () => {
        console.log(`runner listening on :${config.port}`);
    });
}
main().catch((error) => {
    console.error(error);
    process.exit(1);
});
