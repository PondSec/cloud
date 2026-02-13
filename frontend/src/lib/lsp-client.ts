import type * as monaco from 'monaco-editor';

import { ideApiBaseUrl } from './ide-api';

type JsonRpcRequest = { jsonrpc: '2.0'; id: number; method: string; params?: unknown };
type JsonRpcNotification = { jsonrpc: '2.0'; method: string; params?: unknown };

type Pending = {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
};

export class LspClient {
  private readonly workspaceId: string;
  private readonly language:
    | 'typescript'
    | 'javascript'
    | 'python'
    | 'c'
    | 'cpp'
    | 'html'
    | 'css'
    | 'json'
    | 'yaml'
    | 'bash'
    | 'dockerfile'
    | 'php'
    | 'sql'
    | 'go'
    | 'rust'
    | 'lua'
    | 'java';
  private readonly token: string;
  private ws: WebSocket | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private initialized = false;
  private diagnosticsHandler: ((params: any) => void) | null = null;

  constructor(args: {
    workspaceId: string;
    language:
      | 'typescript'
      | 'javascript'
      | 'python'
      | 'c'
      | 'cpp'
      | 'html'
      | 'css'
      | 'json'
      | 'yaml'
      | 'bash'
      | 'dockerfile'
      | 'php'
      | 'sql'
      | 'go'
      | 'rust'
      | 'lua'
      | 'java';
    token: string;
  }) {
    this.workspaceId = args.workspaceId;
    this.language = args.language;
    this.token = args.token;
  }

  onDiagnostics(handler: (params: any) => void): void {
    this.diagnosticsHandler = handler;
  }

  async connect(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return;
    }

    const wsBase = ideApiBaseUrl().replace(/^http/, 'ws');
    const url = `${wsBase}/ws/lsp?workspaceId=${encodeURIComponent(this.workspaceId)}&language=${encodeURIComponent(this.language)}&token=${encodeURIComponent(this.token)}`;

    this.ws = new WebSocket(url);

    await new Promise<void>((resolve, reject) => {
      if (!this.ws) {
        reject(new Error('LSP WebSocket not initialized'));
        return;
      }

      this.ws.onopen = () => resolve();
      this.ws.onerror = () => reject(new Error('LSP socket error'));
    });

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(String(event.data));
        this.handleIncoming(msg);
      } catch {
        // Ignore malformed payload.
      }
    };

    this.ws.onclose = () => {
      this.initialized = false;
      for (const [, deferred] of this.pending) {
        deferred.reject(new Error('LSP socket closed'));
      }
      this.pending.clear();
    };

    await this.initialize();
  }

  dispose(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.close();
    }
    this.ws = null;
    this.pending.clear();
    this.initialized = false;
  }

  async didOpen(uri: string, languageId: string, text: string): Promise<void> {
    await this.connect();
    this.notify('textDocument/didOpen', {
      textDocument: {
        uri,
        languageId,
        version: 1,
        text,
      },
    });
  }

  async didChange(uri: string, version: number, text: string): Promise<void> {
    await this.connect();
    this.notify('textDocument/didChange', {
      textDocument: { uri, version },
      contentChanges: [{ text }],
    });
  }

  async requestCompletion(uri: string, position: monaco.Position): Promise<any[]> {
    await this.connect();
    const result = await this.request('textDocument/completion', {
      textDocument: { uri },
      position: toLspPosition(position),
    });

    if (Array.isArray(result)) {
      return result;
    }
    if (result?.items && Array.isArray(result.items)) {
      return result.items;
    }
    return [];
  }

  async requestDefinition(uri: string, position: monaco.Position): Promise<any> {
    await this.connect();
    return this.request('textDocument/definition', {
      textDocument: { uri },
      position: toLspPosition(position),
    });
  }

  async requestRename(uri: string, position: monaco.Position, newName: string): Promise<any> {
    await this.connect();
    return this.request('textDocument/rename', {
      textDocument: { uri },
      position: toLspPosition(position),
      newName,
    });
  }

  async requestFormatting(uri: string): Promise<any[] | null> {
    await this.connect();
    const result = await this.request('textDocument/formatting', {
      textDocument: { uri },
      options: {
        tabSize: 2,
        insertSpaces: true,
      },
    });

    return Array.isArray(result) ? result : null;
  }

  private async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    await this.request('initialize', {
      processId: null,
      clientInfo: { name: 'cloudide-web', version: '0.1.0' },
      rootUri: `file:///workspaces/${this.workspaceId}`,
      capabilities: {
        textDocument: {
          completion: {},
          definition: {},
          rename: {},
          publishDiagnostics: {},
        },
      },
      workspaceFolders: [
        {
          uri: `file:///workspaces/${this.workspaceId}`,
          name: this.workspaceId,
        },
      ],
    });

    this.notify('initialized', {});
    this.initialized = true;
  }

  private handleIncoming(message: any): void {
    if (typeof message.id === 'number') {
      const pending = this.pending.get(message.id);
      if (!pending) return;

      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error.message || 'LSP request failed'));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (message.method === 'textDocument/publishDiagnostics' && this.diagnosticsHandler) {
      this.diagnosticsHandler(message.params);
    }
  }

  private notify(method: string, params?: unknown): void {
    const payload: JsonRpcNotification = {
      jsonrpc: '2.0',
      method,
      params,
    };
    this.ws?.send(JSON.stringify(payload));
  }

  private async request(method: string, params?: unknown): Promise<any> {
    await this.connect();

    const id = this.nextId++;
    const payload: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    const promise = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });

    this.ws?.send(JSON.stringify(payload));
    return promise;
  }
}

function toLspPosition(position: monaco.Position): { line: number; character: number } {
  return {
    line: position.lineNumber - 1,
    character: position.column - 1,
  };
}
