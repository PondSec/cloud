import http from 'node:http';
import fs from 'node:fs';

import cors from 'cors';
import express from 'express';
import morgan from 'morgan';
import { WebSocketServer } from 'ws';

import { config, isProd } from './config.js';
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
  const allowAllOrigins = allowedOrigins.includes('*');

  const isLocalHost = (hostname: string): boolean => {
    const normalized = hostname.replace(/^\[|\]$/g, '').toLowerCase();
    return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1' || normalized === '0.0.0.0';
  };

  // Allow local-network dev hosts (app.py binds Vite to 0.0.0.0 and often prints a LAN IP URL).
  const isPrivateIpv4 = (hostname: string): boolean => {
    const raw = hostname.replace(/^\[|\]$/g, '');
    const parts = raw.split('.');
    if (parts.length !== 4) return false;
    const nums = parts.map((p) => Number.parseInt(p, 10));
    if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
    const [a, b] = nums;
    if (a === 10) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    return false;
  };

  const app = express();
  app.use(morgan('dev'));
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin) {
          callback(null, true);
          return;
        }
        if (allowAllOrigins || allowedOrigins.includes(origin)) {
          callback(null, true);
          return;
        }

        // Dev convenience: accept localhost/private LAN origins unless explicitly in production mode.
        if (!isProd) {
          try {
            const url = new URL(origin);
            if (url.protocol === 'http:' || url.protocol === 'https:') {
              if (isLocalHost(url.hostname) || isPrivateIpv4(url.hostname)) {
                callback(null, true);
                return;
              }
            }
          } catch {
            // ignore
          }
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
