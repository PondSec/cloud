import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import http from 'node:http';
import { URL } from 'node:url';

import * as pty from 'node-pty';
import { WebSocketServer, WebSocket } from 'ws';

import { config } from '../config.js';
import { startContainer, workspaceContainerName } from '../services/docker.js';

interface LspFrameParser {
  buffer: string;
  expectedLength: number | null;
}

export function registerRunnerWs(server: http.Server): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const host = req.headers.host ?? 'localhost';
    const url = new URL(req.url ?? '/', `http://${host}`);

    if (url.pathname === '/ws/pty') {
      wss.handleUpgrade(req, socket, head, (ws) => {
        void handlePty(ws, url.searchParams.get('workspaceId'));
      });
      return;
    }

    if (url.pathname === '/ws/lsp') {
      wss.handleUpgrade(req, socket, head, (ws) => {
        void handleLsp(ws, url.searchParams.get('workspaceId'), url.searchParams.get('language'));
      });
      return;
    }

    if (url.pathname === '/ws/exec') {
      wss.handleUpgrade(req, socket, head, (ws) => {
        void handleExec(ws, url.searchParams.get('workspaceId'));
      });
      return;
    }

    socket.destroy();
  });
}

async function handlePty(ws: WebSocket, workspaceId: string | null): Promise<void> {
  if (!workspaceId) {
    ws.close(1008, 'workspaceId required');
    return;
  }

  await startContainer({ workspaceId });
  const container = workspaceContainerName(workspaceId);

  const terminal = pty.spawn(config.dockerBin, ['exec', '-it', container, 'bash', '-lc', `cd /workspaces/${workspaceId} && exec bash`], {
    name: 'xterm-color',
    cols: 120,
    rows: 28,
    cwd: process.cwd(),
    env: process.env as Record<string, string>,
  });

  terminal.onData((data) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'output', data }));
    }
  });

  ws.on('message', (raw) => {
    try {
      const payload = JSON.parse(raw.toString()) as { type: string; data?: string; cols?: number; rows?: number };
      if (payload.type === 'input' && typeof payload.data === 'string') {
        terminal.write(payload.data);
      }
      if (payload.type === 'resize' && payload.cols && payload.rows) {
        terminal.resize(payload.cols, payload.rows);
      }
    } catch {
      // Ignore malformed frames.
    }
  });

  ws.on('close', () => {
    terminal.kill();
  });
}

async function handleExec(ws: WebSocket, workspaceId: string | null): Promise<void> {
  if (!workspaceId) {
    ws.close(1008, 'workspaceId required');
    return;
  }

  await startContainer({ workspaceId });

  ws.on('message', (raw) => {
    const payload = JSON.parse(raw.toString()) as {
      type: 'run';
      cmd: string;
      cwd?: string;
      env?: Record<string, string>;
    };

    if (payload.type !== 'run' || !payload.cmd) {
      return;
    }

    const containerName = workspaceContainerName(workspaceId);
    const args = ['exec', '-i'];
    if (payload.env) {
      for (const [key, value] of Object.entries(payload.env)) {
        args.push('-e', `${key}=${value}`);
      }
    }

    const cwd = payload.cwd || `/workspaces/${workspaceId}`;
    args.push(containerName, 'sh', '-lc', `cd '${cwd.replace(/'/g, `'"'"'`)}' && ${payload.cmd}`);

    const child = spawn(config.dockerBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    child.stdout.on('data', (chunk) => {
      ws.send(JSON.stringify({ type: 'stdout', data: chunk.toString() }));
    });

    child.stderr.on('data', (chunk) => {
      ws.send(JSON.stringify({ type: 'stderr', data: chunk.toString() }));
    });

    child.on('close', (code) => {
      ws.send(JSON.stringify({ type: 'exit', code: code ?? 1 }));
    });
  });
}

async function handleLsp(ws: WebSocket, workspaceId: string | null, language: string | null): Promise<void> {
  if (!workspaceId || !language) {
    ws.close(1008, 'workspaceId and language are required');
    return;
  }

  await startContainer({ workspaceId });
  const container = workspaceContainerName(workspaceId);

  const serverCmd = lspCommand(language);
  if (!serverCmd) {
    ws.close(1008, `Unsupported language: ${language}`);
    return;
  }

  const child = spawn(config.dockerBin, ['exec', '-i', container, 'sh', '-lc', serverCmd], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const parser: LspFrameParser = {
    buffer: '',
    expectedLength: null,
  };

  child.stdout.on('data', (chunk) => {
    parseLspStdout(parser, chunk.toString(), (payload) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(payload);
      }
    });
  });

  child.stderr.on('data', (chunk) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'window/logMessage', params: { type: 2, message: chunk.toString() } }));
    }
  });

  ws.on('message', (raw) => {
    const payload = raw.toString();
    child.stdin.write(encodeLspMessage(payload));
  });

  const close = () => {
    child.kill('SIGTERM');
    if (ws.readyState === ws.OPEN) {
      ws.close();
    }
  };

  ws.on('close', close);
  child.on('close', () => {
    if (ws.readyState === ws.OPEN) {
      ws.close();
    }
  });
}

function lspCommand(language: string): string | null {
  const map: Record<string, string> = {
    typescript: 'typescript-language-server --stdio',
    javascript: 'typescript-language-server --stdio',
    python: 'pyright-langserver --stdio',
    c: 'clangd --background-index',
    cpp: 'clangd --background-index',
    html: 'vscode-html-language-server --stdio',
    css: 'vscode-css-language-server --stdio',
    json: 'vscode-json-language-server --stdio',
    yaml: 'yaml-language-server --stdio',
    bash: 'bash-language-server start',
    shellscript: 'bash-language-server start',
    sh: 'bash-language-server start',
    dockerfile: 'docker-langserver --stdio',
    php: 'intelephense --stdio',
    sql: 'sql-language-server up --method stdio',
    go: 'gopls',
    rust: 'rust-analyzer',
    lua: 'lua-language-server',
    java: 'jdtls',
  };
  return map[language] ?? null;
}

function encodeLspMessage(json: string): string {
  const bytes = Buffer.byteLength(json, 'utf8');
  return `Content-Length: ${bytes}\r\n\r\n${json}`;
}

function parseLspStdout(parser: LspFrameParser, chunk: string, onMessage: (jsonPayload: string) => void): void {
  parser.buffer += chunk;

  while (true) {
    if (parser.expectedLength === null) {
      const headerEnd = parser.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) {
        return;
      }

      const header = parser.buffer.slice(0, headerEnd);
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (!match) {
        parser.buffer = parser.buffer.slice(headerEnd + 4);
        continue;
      }

      parser.expectedLength = Number.parseInt(match[1], 10);
      parser.buffer = parser.buffer.slice(headerEnd + 4);
    }

    if (parser.expectedLength === null || Buffer.byteLength(parser.buffer, 'utf8') < parser.expectedLength) {
      return;
    }

    const body = parser.buffer.slice(0, parser.expectedLength);
    parser.buffer = parser.buffer.slice(parser.expectedLength);
    parser.expectedLength = null;
    onMessage(body);
  }
}
