import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';

import type { AdminSettings, ApiError, AuthResponse, FileNode, FolderTreeNode, User } from '@/types/api';
import { clearAuthSession, getAccessToken, getRefreshToken, setAccessToken } from './auth-storage';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';

interface RetriableRequestConfig extends InternalAxiosRequestConfig {
  _retry?: boolean;
}

const client = axios.create({
  baseURL: API_BASE_URL,
});

let refreshPromise: Promise<string> | null = null;

const refreshAccessToken = async (): Promise<string> => {
  const refreshToken = getRefreshToken();
  if (!refreshToken) {
    throw new Error('Missing refresh token');
  }

  const { data } = await axios.post<{ access_token: string }>(
    `${API_BASE_URL}/auth/refresh`,
    {},
    {
      headers: { Authorization: `Bearer ${refreshToken}` },
    },
  );

  setAccessToken(data.access_token);
  return data.access_token;
};

client.interceptors.request.use((config) => {
  const accessToken = getAccessToken();
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

client.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<ApiError>) => {
    const request = error.config as RetriableRequestConfig | undefined;

    if (!request || error.response?.status !== 401 || request._retry) {
      return Promise.reject(error);
    }

    request._retry = true;

    try {
      if (!refreshPromise) {
        refreshPromise = refreshAccessToken().finally(() => {
          refreshPromise = null;
        });
      }

      const newAccessToken = await refreshPromise;
      request.headers.Authorization = `Bearer ${newAccessToken}`;
      return client(request);
    } catch (refreshError) {
      clearAuthSession();
      return Promise.reject(refreshError);
    }
  },
);

export function toApiMessage(error: unknown): string {
  if (axios.isAxiosError<ApiError>(error)) {
    return error.response?.data?.error?.message ?? 'Request failed.';
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'Unexpected error.';
}

export const api = {
  auth: {
    async login(username: string, password: string): Promise<AuthResponse> {
      const { data } = await client.post<AuthResponse>('/auth/login', { username, password });
      return data;
    },
    async me(): Promise<User> {
      const { data } = await client.get<{ user: User }>('/auth/me');
      return data.user;
    },
    async register(username: string, password: string): Promise<AuthResponse | { user: User }> {
      const { data } = await client.post<AuthResponse | { user: User }>('/auth/register', {
        username,
        password,
      });
      return data;
    },
  },
  files: {
    async tree(): Promise<FolderTreeNode[]> {
      const { data } = await client.get<{ items: FolderTreeNode[] }>('/files/tree');
      return data.items;
    },
    async list(parentId: number | null): Promise<FileNode[]> {
      const params = new URLSearchParams();
      if (parentId !== null) {
        params.set('parent_id', String(parentId));
      }
      const { data } = await client.get<{ items: FileNode[] }>(`/files/list?${params.toString()}`);
      return data.items;
    },
    async createFolder(name: string, parentId: number | null): Promise<FileNode> {
      const { data } = await client.post<{ item: FileNode }>('/files/folder', { name, parent_id: parentId });
      return data.item;
    },
    async upload(file: File, parentId: number | null): Promise<FileNode> {
      const form = new FormData();
      form.append('file', file);
      if (parentId !== null) {
        form.append('parent_id', String(parentId));
      }
      const { data } = await client.post<{ item: FileNode }>('/files/upload', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return data.item;
    },
    async update(nodeId: number, payload: { name?: string; parent_id?: number | null }): Promise<FileNode> {
      const { data } = await client.patch<{ item: FileNode }>(`/files/${nodeId}`, payload);
      return data.item;
    },
    async remove(nodeId: number): Promise<void> {
      await client.delete(`/files/${nodeId}`);
    },
    async recents(limit = 20): Promise<FileNode[]> {
      const { data } = await client.get<{ items: FileNode[] }>(`/files/recents?limit=${limit}`);
      return data.items;
    },
    async search(query: string): Promise<FileNode[]> {
      const { data } = await client.get<{ items: FileNode[] }>(`/files/search?q=${encodeURIComponent(query)}`);
      return data.items;
    },
    async download(node: FileNode): Promise<void> {
      const response = await client.get<Blob>(`/files/download/${node.id}`, {
        responseType: 'blob',
      });
      const url = URL.createObjectURL(response.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = node.name;
      link.click();
      URL.revokeObjectURL(url);
    },
  },
  admin: {
    async settings(): Promise<AdminSettings> {
      const { data } = await client.get<{ settings: AdminSettings }>('/admin/settings');
      return data.settings;
    },
    async updateSettings(payload: Partial<AdminSettings>): Promise<AdminSettings> {
      const { data } = await client.put<{ settings: AdminSettings }>('/admin/settings', payload);
      return data.settings;
    },
    async users(): Promise<User[]> {
      const { data } = await client.get<{ items: User[] }>('/admin/users');
      return data.items;
    },
    async createUser(payload: {
      username: string;
      password: string;
      bytes_limit?: number;
      role_names?: string[];
      is_active?: boolean;
    }): Promise<User> {
      const { data } = await client.post<{ user: User }>('/admin/users', payload);
      return data.user;
    },
    async updateUser(userId: number, payload: Record<string, unknown>): Promise<User> {
      const { data } = await client.patch<{ user: User }>(`/admin/users/${userId}`, payload);
      return data.user;
    },
    async deleteUser(userId: number): Promise<void> {
      await client.delete(`/admin/users/${userId}`);
    },
  },
};
