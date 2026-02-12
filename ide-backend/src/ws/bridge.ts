import fs from 'node:fs';
import path from 'node:path';
import { URL } from 'node:url';

import chokidar from 'chokidar';
import type { IncomingMessage } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';

import { config } from '../config.js';
import { requireAuthWs } from '../auth/middleware.js';
import { requireWorkspace, workspaceRootPath, readWorkspaceSettings } from '../workspace/service.js';
import { ensureWorkspaceContainer } from '../services/runner-client.js';

interface UpgradeContext {
  server: WebSocketServer;
}

function parseQuery(req: IncomingMessage): URL {
  const host = req.headers.host ?? 'localhost';
  return new URL(req.url ?? '/', `http://${host}`);
}

function wsAuth(url: URL): { userId: string; email: string } {
  const token = url.searchParams.get('token');
  return requireAuthWs(token);
}

export function registerWebSocketBridge(context: UpgradeContext): void {
  context.server.on('connection', () => {
    // Handled per-route in upgrade dispatch.
  });
}

export async function handleWsUpgrade(req: IncomingMessage, socket: any, head: Buffer, wss: WebSocketServer): Promise<void> {
  const url = parseQuery(req);
  const pathname = url.pathname;

  if (!pathname.startsWith('/ws/')) {
    socket.destroy();
    return;
  }

  try {
    if (pathname === '/ws/files') {
      const auth = wsAuth(url);
      const workspaceId = must(url.searchParams.get('workspaceId'), 'workspaceId query is required');
      requireWorkspace(workspaceId, auth.userId);
      wss.handleUpgrade(req, socket, head, (ws) => {
        watchFiles(ws, workspaceId);
      });
      return;
    }

    if (pathname === '/ws/terminal' || pathname === '/ws/lsp' || pathname === '/ws/tasks') {
      const auth = wsAuth(url);
      const workspaceId = must(url.searchParams.get('workspaceId'), 'workspaceId query is required');
      const workspace = requireWorkspace(workspaceId, auth.userId);
      const settings = readWorkspaceSettings(workspace.id);
      await ensureWorkspaceContainer({ workspaceId: workspace.id, allowEgress: settings.allowEgress });

      const targetPath = pathname === '/ws/terminal' ? '/ws/pty' : pathname === '/ws/lsp' ? '/ws/lsp' : '/ws/exec';
      const targetUrl = new URL(targetPath, config.runnerWsUrl);
      targetUrl.searchParams.set('workspaceId', workspaceId);

      const language = url.searchParams.get('language');
      if (language) {
        targetUrl.searchParams.set('language', language);
      }

      wss.handleUpgrade(req, socket, head, (clientWs) => {
        proxyWs(clientWs, targetUrl.toString());
      });
      return;
    }

    socket.destroy();
  } catch {
    socket.destroy();
  }
}

function proxyWs(clientWs: WebSocket, target: string): void {
  const upstream = new WebSocket(target);
  const pendingClientMessages: Array<{ data: Parameters<WebSocket['send']>[0]; isBinary: boolean }> = [];

  clientWs.on('message', (data, isBinary) => {
    if (upstream.readyState === WebSocket.OPEN) {
      upstream.send(data, { binary: isBinary });
      return;
    }
    if (upstream.readyState === WebSocket.CONNECTING) {
      pendingClientMessages.push({ data, isBinary });
    }
  });

  upstream.on('open', () => {
    for (const frame of pendingClientMessages) {
      if (upstream.readyState !== WebSocket.OPEN) {
        break;
      }
      upstream.send(frame.data, { binary: frame.isBinary });
    }
    pendingClientMessages.length = 0;
  });

  upstream.on('message', (data, isBinary) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(data, { binary: isBinary });
    }
  });

  const closeBoth = () => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.close();
    }
    if (upstream.readyState === WebSocket.OPEN) {
      upstream.close();
    }
  };

  clientWs.on('close', closeBoth);
  upstream.on('close', closeBoth);
  clientWs.on('error', closeBoth);
  upstream.on('error', closeBoth);
}

function watchFiles(ws: WebSocket, workspaceId: string): void {
  const root = workspaceRootPath(workspaceId);
  fs.mkdirSync(root, { recursive: true });

  const watcher = chokidar.watch(root, {
    ignoreInitial: true,
    persistent: true,
    depth: 12,
  });

  const emit = (event: string, absPath: string) => {
    const rel = path.relative(root, absPath).replace(/\\/g, '/');
    ws.send(JSON.stringify({ event, path: rel }));
  };

  watcher.on('add', (file) => emit('add', file));
  watcher.on('change', (file) => emit('change', file));
  watcher.on('unlink', (file) => emit('unlink', file));
  watcher.on('addDir', (file) => emit('addDir', file));
  watcher.on('unlinkDir', (file) => emit('unlinkDir', file));

  ws.on('close', () => {
    void watcher.close();
  });
}

function must(value: string | null, message: string): string {
  if (!value) {
    throw new Error(message);
  }
  return value;
}
