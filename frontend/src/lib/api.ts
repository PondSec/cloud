import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';

import type {
  AdminSettings,
  AuditLogEntry,
  BackupJob,
  BackupJobStatus,
  BackupJobType,
  ContainersResponse,
  ApiError,
  AuthResponse,
  ExternalShareLink,
  FileNode,
  FolderTreeNode,
  InternalShare,
  MonitoringOverview,
  NetworkResponse,
  OnlyOfficeSession,
  Permission,
  InventoryProContext,
  ResourceQuota,
  ResourceQuotaUsage,
  RestorePoint,
  Role,
  ShareAccess,
  StorageResponse,
  SharedWithMeItem,
  UiPreferences,
  User,
} from '@/types/api';
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
    async inventoryProContext(): Promise<InventoryProContext> {
      const { data } = await client.get<{ inventory_pro: InventoryProContext }>('/auth/inventorypro/context');
      return data.inventory_pro;
    },
    async inventoryProExchange(ticket: string): Promise<AuthResponse> {
      const { data } = await client.post<AuthResponse>('/auth/inventorypro/exchange', { ticket });
      return data;
    },
    async register(username: string, password: string): Promise<AuthResponse | { user: User }> {
      const { data } = await client.post<AuthResponse | { user: User }>('/auth/register', {
        username,
        password,
      });
      return data;
    },
    async uiPreferences(): Promise<{ user_id: number; preferences: UiPreferences; updated_at: string | null }> {
      const { data } = await client.get<{ user_id: number; preferences: UiPreferences; updated_at: string | null }>(
        '/auth/ui-preferences',
      );
      return data;
    },
    async updateUiPreferences(
      payload: Partial<UiPreferences>,
    ): Promise<{ user_id: number; preferences: UiPreferences; updated_at: string | null }> {
      const { data } = await client.put<{ user_id: number; preferences: UiPreferences; updated_at: string | null }>(
        '/auth/ui-preferences',
        payload,
      );
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
    async blob(nodeId: number): Promise<Blob> {
      const response = await client.get<Blob>(`/files/download/${nodeId}`, {
        responseType: 'blob',
      });
      return response.data;
    },
  },
  admin: {
    async settings(): Promise<AdminSettings> {
      const { data } = await client.get<{ settings: AdminSettings }>('/admin/settings');
      return data.settings;
    },
    async updateSettings(payload: Record<string, unknown>): Promise<AdminSettings> {
      const { data } = await client.put<{ settings: AdminSettings }>('/admin/settings', payload);
      return data.settings;
    },
    async users(): Promise<User[]> {
      const { data } = await client.get<{ items: User[] }>('/admin/users');
      return data.items;
    },
    async roles(): Promise<Role[]> {
      const { data } = await client.get<{ items: Role[] }>('/admin/roles');
      return data.items;
    },
    async permissions(): Promise<Permission[]> {
      const { data } = await client.get<{ items: Permission[] }>('/admin/permissions');
      return data.items;
    },
    async createUser(payload: {
      username: string;
      password: string;
      bytes_limit?: number;
      role_ids?: number[];
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
    async createRole(payload: {
      name: string;
      description?: string | null;
      permission_ids?: number[];
      permission_codes?: string[];
    }): Promise<Role> {
      const { data } = await client.post<{ role: Role }>('/admin/roles', payload);
      return data.role;
    },
    async updateRole(roleId: number, payload: Record<string, unknown>): Promise<Role> {
      const { data } = await client.patch<{ role: Role }>(`/admin/roles/${roleId}`, payload);
      return data.role;
    },
    async deleteRole(roleId: number): Promise<void> {
      await client.delete(`/admin/roles/${roleId}`);
    },
  },
  shares: {
    async listInternal(fileId: number): Promise<InternalShare[]> {
      const { data } = await client.get<{ items: InternalShare[] }>(`/shares/internal?file_id=${fileId}`);
      return data.items;
    },
    async upsertInternal(payload: { file_id: number; username: string; access: ShareAccess }): Promise<InternalShare> {
      const { data } = await client.post<{ share: InternalShare }>('/shares/internal', payload);
      return data.share;
    },
    async deleteInternal(shareId: number): Promise<void> {
      await client.delete(`/shares/internal/${shareId}`);
    },
    async sharedWithMe(): Promise<SharedWithMeItem[]> {
      const { data } = await client.get<{ items: SharedWithMeItem[] }>('/shares/shared-with-me');
      return data.items;
    },
    async listExternal(fileId: number): Promise<ExternalShareLink[]> {
      const { data } = await client.get<{ items: ExternalShareLink[] }>(`/shares/external?file_id=${fileId}`);
      return data.items;
    },
    async createExternal(payload: { file_id: number; expires_in_days?: number | null }): Promise<ExternalShareLink> {
      const { data } = await client.post<{ link: ExternalShareLink }>('/shares/external', payload);
      return data.link;
    },
    async deleteExternal(linkId: number): Promise<void> {
      await client.delete(`/shares/external/${linkId}`);
    },
  },
  monitoring: {
    async overview(): Promise<MonitoringOverview> {
      const { data } = await client.get<MonitoringOverview>('/api/monitoring/overview');
      return data;
    },
    async containers(): Promise<ContainersResponse> {
      const { data } = await client.get<ContainersResponse>('/api/monitoring/containers');
      return data;
    },
    async storage(): Promise<StorageResponse> {
      const { data } = await client.get<StorageResponse>('/api/monitoring/storage');
      return data;
    },
    async network(): Promise<NetworkResponse> {
      const { data } = await client.get<NetworkResponse>('/api/monitoring/network');
      return data;
    },
    async snapshots(hours = 24): Promise<{ hours: number; items: Array<Record<string, unknown>> }> {
      const { data } = await client.get<{ hours: number; items: Array<Record<string, unknown>> }>(
        `/api/monitoring/snapshots?hours=${hours}`,
      );
      return data;
    },
    async backups(params?: {
      page?: number;
      page_size?: number;
      status?: BackupJobStatus;
      type?: BackupJobType;
      q?: string;
      from?: string;
      to?: string;
    }): Promise<{ items: BackupJob[]; pagination: { page: number; page_size: number; total: number; total_pages: number } }> {
      const search = new URLSearchParams();
      if (params?.page) search.set('page', String(params.page));
      if (params?.page_size) search.set('page_size', String(params.page_size));
      if (params?.status) search.set('status', params.status);
      if (params?.type) search.set('type', params.type);
      if (params?.q) search.set('q', params.q);
      if (params?.from) search.set('from', params.from);
      if (params?.to) search.set('to', params.to);
      const query = search.toString();
      const { data } = await client.get<{ items: BackupJob[]; pagination: { page: number; page_size: number; total: number; total_pages: number } }>(
        `/api/monitoring/backups${query ? `?${query}` : ''}`,
      );
      return data;
    },
    async backup(id: number): Promise<BackupJob> {
      const { data } = await client.get<{ backup: BackupJob }>(`/api/monitoring/backups/${id}`);
      return data.backup;
    },
    async restorePoints(params?: {
      page?: number;
      page_size?: number;
      scope?: 'system' | 'project' | 'user';
    }): Promise<{ items: RestorePoint[]; pagination: { page: number; page_size: number; total: number; total_pages: number } }> {
      const search = new URLSearchParams();
      if (params?.page) search.set('page', String(params.page));
      if (params?.page_size) search.set('page_size', String(params.page_size));
      if (params?.scope) search.set('scope', params.scope);
      const query = search.toString();
      const { data } = await client.get<{ items: RestorePoint[]; pagination: { page: number; page_size: number; total: number; total_pages: number } }>(
        `/api/monitoring/restore-points${query ? `?${query}` : ''}`,
      );
      return data;
    },
    async createRestorePoint(payload: {
      label: string;
      source_backup_job_id?: number | null;
      scope: 'system' | 'project' | 'user';
      metadata?: Record<string, unknown>;
      size_bytes?: number | null;
    }): Promise<RestorePoint> {
      const { data } = await client.post<{ restore_point: RestorePoint }>('/api/monitoring/restore-points', payload);
      return data.restore_point;
    },
    async restore(restorePointId: number): Promise<{ supported: boolean; message: string; restore_point: RestorePoint }> {
      const { data } = await client.post<{ supported: boolean; message: string; restore_point: RestorePoint }>(
        `/api/monitoring/restore-points/${restorePointId}/restore`,
      );
      return data;
    },
    async quotas(): Promise<ResourceQuota[]> {
      const { data } = await client.get<{ items: ResourceQuota[] }>('/api/monitoring/quotas');
      return data.items;
    },
    async updateQuota(
      userId: number,
      payload: Partial<
        Pick<
          ResourceQuota,
          | 'bytes_limit'
          | 'max_running_containers'
          | 'max_cpu_percent'
          | 'max_ram_mb'
          | 'monthly_bytes_in_limit'
          | 'monthly_bytes_out_limit'
          | 'monthly_bytes_in_used'
          | 'monthly_bytes_out_used'
        >
      >,
    ): Promise<ResourceQuota> {
      const { data } = await client.put<{ quota: ResourceQuota }>(`/api/monitoring/quotas/${userId}`, payload);
      return data.quota;
    },
    async quotaUsage(): Promise<{
      items: ResourceQuotaUsage[];
      container_metrics_available: boolean;
      captured_at: string;
    }> {
      const { data } = await client.get<{
        items: ResourceQuotaUsage[];
        container_metrics_available: boolean;
        captured_at: string;
      }>('/api/monitoring/quotas/usage');
      return data;
    },
  },
  audit: {
    async logs(params?: {
      from?: string;
      to?: string;
      q?: string;
      action?: string;
      user_id?: number;
      success?: boolean;
      severity?: string;
      page?: number;
      page_size?: number;
    }): Promise<{ items: AuditLogEntry[]; pagination: { page: number; page_size: number; total: number; total_pages: number } }> {
      const search = new URLSearchParams();
      if (params?.from) search.set('from', params.from);
      if (params?.to) search.set('to', params.to);
      if (params?.q) search.set('q', params.q);
      if (params?.action) search.set('action', params.action);
      if (params?.user_id !== undefined) search.set('user_id', String(params.user_id));
      if (params?.success !== undefined) search.set('success', params.success ? 'true' : 'false');
      if (params?.severity) search.set('severity', params.severity);
      if (params?.page) search.set('page', String(params.page));
      if (params?.page_size) search.set('page_size', String(params.page_size));

      const query = search.toString();
      const { data } = await client.get<{ items: AuditLogEntry[]; pagination: { page: number; page_size: number; total: number; total_pages: number } }>(
        `/api/audit/logs${query ? `?${query}` : ''}`,
      );
      return data;
    },
    async actions(): Promise<string[]> {
      const { data } = await client.get<{ items: string[] }>('/api/audit/actions');
      return data.items;
    },
    async exportCsv(params?: {
      from?: string;
      to?: string;
      q?: string;
      action?: string;
      user_id?: number;
      success?: boolean;
      severity?: string;
    }): Promise<Blob> {
      const search = new URLSearchParams();
      if (params?.from) search.set('from', params.from);
      if (params?.to) search.set('to', params.to);
      if (params?.q) search.set('q', params.q);
      if (params?.action) search.set('action', params.action);
      if (params?.user_id !== undefined) search.set('user_id', String(params.user_id));
      if (params?.success !== undefined) search.set('success', params.success ? 'true' : 'false');
      if (params?.severity) search.set('severity', params.severity);
      search.set('export', 'csv');
      const query = search.toString();
      const response = await client.get<Blob>(`/api/audit/logs?${query}`, {
        responseType: 'blob',
      });
      return response.data;
    },
  },
  office: {
    async createSession(fileId: number): Promise<OnlyOfficeSession> {
      const { data } = await client.post<OnlyOfficeSession>('/office/session', { file_id: fileId });
      return data;
    },
    async supportedExtensions(): Promise<string[]> {
      const { data } = await client.get<{ extensions: string[] }>('/office/supported');
      return data.extensions;
    },
  },
};
