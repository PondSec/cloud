import http from 'node:http';
import fs from 'node:fs';

import cors from 'cors';
import express from 'express';
import morgan from 'morgan';
import { WebSocketServer } from 'ws';

import { config } from './config.js';
import { apiRouter } from './api/index.js';
import { previewRouter } from './api/preview.js';
import { HttpError } from './utils/http-error.js';
import { handleWsUpgrade } from './ws/bridge.js';

export function createAppServer() {
  fs.mkdirSync(config.workspacesRoot, { recursive: true });
  const allowedOrigins = config.corsOrigin
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  const app = express();
  app.use(morgan('dev'));
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(new Error(`CORS origin not allowed: ${origin}`));
      },
      credentials: false,
    }),
  );
  app.use(express.json({ limit: '4mb' }));

  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'backend' });
  });

  app.use('/api', apiRouter);
  app.use('/preview', previewRouter);

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof HttpError) {
      res.status(error.status).json({ error: error.message });
      return;
    }

    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: message });
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    void handleWsUpgrade(req, socket, head, wss);
  });

  return { app, server };
}
