import axios from 'axios';

import { clearIdeToken, getIdeToken } from './ide-auth';
import type { FileNode, User, Workspace, WorkspaceSettings, WorkspaceRuntime } from './ide-types';

function stripTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function computeIdeApiBaseUrl(): string {
  // In dev we proxy IDE through Vite (/ide) so LAN access doesn't require opening :18080.
  if (typeof window !== 'undefined' && import.meta.env.DEV) {
    return stripTrailingSlash(`${window.location.origin}/ide`);
  }

  const envValue = String(import.meta.env.VITE_IDE_API_BASE_URL || '').trim();
  if (envValue) {
    return stripTrailingSlash(envValue);
  }

  if (typeof window !== 'undefined') {
    // Default: use same-origin proxy route (see vite.config.ts).
    return stripTrailingSlash(`${window.location.origin}/ide`);
  }

  return 'http://localhost:18080';
}

const IDE_API_BASE_URL = computeIdeApiBaseUrl();

const ideClient = axios.create({
  baseURL: `${IDE_API_BASE_URL}/api`,
});

ideClient.interceptors.request.use((config) => {
  const token = getIdeToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

ideClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error?.response?.status === 401) {
      clearIdeToken();
    }
    return Promise.reject(error);
  },
);

export function ideApiBaseUrl(): string {
  return IDE_API_BASE_URL;
}

export function idePreviewBaseUrl(): string {
  // Optional override: allow hosting previews on a separate origin (recommended for isolation).
  const previewEnvValue = String(import.meta.env.VITE_IDE_PREVIEW_BASE_URL || '').trim();
  if (previewEnvValue) return stripTrailingSlash(previewEnvValue);

  const ideEnvValue = String(import.meta.env.VITE_IDE_API_BASE_URL || '').trim();
  if (ideEnvValue) return stripTrailingSlash(ideEnvValue);

  if (typeof window !== 'undefined') {
    const protocol = window.location.protocol || 'http:';
    const hostname = window.location.hostname || 'localhost';
    const bracketedHost = hostname.includes(':') ? `[${hostname}]` : hostname;
    const isIpv4 = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname);
    const isLocalHost = hostname === 'localhost' || hostname.endsWith('.localhost');

    // Prefer a separate origin when we're on localhost / an IP (usually local/LAN dev where :18080 is reachable).
    if (isLocalHost || isIpv4) {
      return stripTrailingSlash(`${protocol}//${bracketedHost}:18080`);
    }

    // Default: use the same-origin IDE proxy route (see vite.config.ts). This works behind reverse proxies
    // where exposing a separate :18080 port isn't practical.
    return stripTrailingSlash(`${window.location.origin}/ide`);
  }

  return 'http://localhost:18080';
}

export const ideApi = {
  auth: {
    async register(email: string, password: string): Promise<{ token: string; user: User }> {
      const { data } = await ideClient.post<{ token: string; user: User }>('/auth/register', { email, password });
      return data;
    },
    async login(email: string, password: string): Promise<{ token: string; user: User }> {
      const { data } = await ideClient.post<{ token: string; user: User }>('/auth/login', { email, password });
      return data;
    },
    async me(): Promise<User> {
      const { data } = await ideClient.get<{ user: User }>('/auth/me');
      return data.user;
    },
  },
  workspace: {
    async list(): Promise<Workspace[]> {
      const { data } = await ideClient.get<{ items: Workspace[] }>('/workspaces');
      return data.items;
    },
    async create(name: string, template: string): Promise<Workspace> {
      const { data } = await ideClient.post<{ workspace: Workspace }>('/workspaces', { name, template });
      return data.workspace;
    },
    async rename(workspaceId: string, name: string): Promise<Workspace> {
      const { data } = await ideClient.patch<{ workspace: Workspace }>(`/workspaces/${encodeURIComponent(workspaceId)}`, {
        name,
      });
      return data.workspace;
    },
    async delete(workspaceId: string): Promise<void> {
      await ideClient.delete(`/workspaces/${encodeURIComponent(workspaceId)}`);
    },
    async details(workspaceId: string): Promise<{ workspace: Workspace; settings: WorkspaceSettings; runtime: WorkspaceRuntime }> {
      const { data } = await ideClient.get<{ workspace: Workspace; settings: WorkspaceSettings; runtime: WorkspaceRuntime }>(
        `/workspaces/${encodeURIComponent(workspaceId)}`,
      );
      return data;
    },
    async start(workspaceId: string): Promise<WorkspaceRuntime> {
      const { data } = await ideClient.post<{ status: WorkspaceRuntime }>(`/workspaces/${encodeURIComponent(workspaceId)}/start`);
      return data.status;
    },
    async stop(workspaceId: string): Promise<void> {
      await ideClient.post(`/workspaces/${encodeURIComponent(workspaceId)}/stop`);
    },
  },
  files: {
    async list(workspaceId: string, path = ''): Promise<FileNode[]> {
      const { data } = await ideClient.get<{ items: FileNode[] }>(`/files/${encodeURIComponent(workspaceId)}/list`, {
        params: { path },
      });
      return data.items;
    },
    async read(workspaceId: string, path: string): Promise<string> {
      const { data } = await ideClient.get<{ content: string }>(`/files/${encodeURIComponent(workspaceId)}/read`, {
        params: { path },
      });
      return data.content;
    },
    async write(workspaceId: string, path: string, content: string): Promise<void> {
      await ideClient.put(`/files/${encodeURIComponent(workspaceId)}/write`, { path, content });
    },
    async create(workspaceId: string, path: string, type: 'file' | 'directory'): Promise<void> {
      await ideClient.post(`/files/${encodeURIComponent(workspaceId)}/create`, { path, type });
    },
    async rename(workspaceId: string, fromPath: string, toPath: string): Promise<void> {
      await ideClient.patch(`/files/${encodeURIComponent(workspaceId)}/rename`, { fromPath, toPath });
    },
    async remove(workspaceId: string, path: string): Promise<void> {
      await ideClient.delete(`/files/${encodeURIComponent(workspaceId)}/delete`, {
        params: { path },
      });
    },
  },
  git: {
    async init(workspaceId: string): Promise<void> {
      await ideClient.post(`/git/${encodeURIComponent(workspaceId)}/git/init`);
    },
    async clone(workspaceId: string, url: string, branch?: string): Promise<void> {
      await ideClient.post(`/git/${encodeURIComponent(workspaceId)}/git/clone`, { url, branch });
    },
    async status(workspaceId: string): Promise<string> {
      const { data } = await ideClient.get<{ output: string }>(`/git/${encodeURIComponent(workspaceId)}/git/status`);
      return data.output;
    },
    async diff(workspaceId: string): Promise<string> {
      const { data } = await ideClient.get<{ output: string }>(`/git/${encodeURIComponent(workspaceId)}/git/diff`);
      return data.output;
    },
    async stage(workspaceId: string, path: string): Promise<void> {
      await ideClient.post(`/git/${encodeURIComponent(workspaceId)}/git/stage`, { path });
    },
    async unstage(workspaceId: string, path: string): Promise<void> {
      await ideClient.post(`/git/${encodeURIComponent(workspaceId)}/git/unstage`, { path });
    },
    async commit(workspaceId: string, message: string): Promise<void> {
      await ideClient.post(`/git/${encodeURIComponent(workspaceId)}/git/commit`, { message });
    },
    async pull(workspaceId: string): Promise<string> {
      const { data } = await ideClient.post<{ output: string }>(`/git/${encodeURIComponent(workspaceId)}/git/pull`);
      return data.output;
    },
    async push(workspaceId: string): Promise<string> {
      const { data } = await ideClient.post<{ output: string }>(`/git/${encodeURIComponent(workspaceId)}/git/push`);
      return data.output;
    },
  },
  tasks: {
    async run(workspaceId: string, task: 'run' | 'build' | 'test' | 'preview' | 'custom', command?: string) {
      const { data } = await ideClient.post<{ stdout: string; stderr: string; exitCode: number }>(
        `/tasks/${encodeURIComponent(workspaceId)}/tasks/run`,
        { task, command },
      );
      return data;
    },
  },
  search: {
    async files(workspaceId: string, q: string, limit = 120): Promise<string[]> {
      const { data } = await ideClient.get<{ items: string[] }>(`/search/${encodeURIComponent(workspaceId)}/files`, {
        params: { q, limit },
      });
      return data.items;
    },
    async text(args: {
      workspaceId: string;
      query: string;
      isRegex?: boolean;
      caseSensitive?: boolean;
      wholeWord?: boolean;
      include?: string[] | string;
      exclude?: string[] | string;
      maxResults?: number;
    }): Promise<{ items: Array<{ path: string; line: number; column: number; preview: string; match: string }>; truncated: boolean }> {
      const { data } = await ideClient.post<{
        items: Array<{ path: string; line: number; column: number; preview: string; match: string }>;
        truncated: boolean;
      }>(`/search/${encodeURIComponent(args.workspaceId)}/text`, {
        query: args.query,
        isRegex: args.isRegex ?? false,
        caseSensitive: args.caseSensitive ?? false,
        wholeWord: args.wholeWord ?? false,
        include: args.include,
        exclude: args.exclude,
        maxResults: args.maxResults ?? 500,
      });
      return data;
    },
  },
};
