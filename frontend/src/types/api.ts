export type FileType = 'file' | 'folder';

export interface Permission {
  id: number;
  code: string;
  name: string;
}

export interface Role {
  id: number;
  name: string;
  description: string | null;
  permissions: Permission[];
}

export interface User {
  id: number;
  username: string;
  is_active: boolean;
  bytes_limit: number;
  bytes_used: number;
  roles: Role[];
  created_at: string;
  updated_at: string;
}

export interface AuthResponse {
  access_token: string;
  refresh_token: string;
  user: User;
}

export interface FileNode {
  id: number;
  parent_id: number | null;
  owner_id: number;
  name: string;
  type: FileType;
  size: number;
  mime: string | null;
  storage_path: string | null;
  created_at: string;
  updated_at: string;
}

export interface FolderTreeNode {
  id: number;
  name: string;
  parent_id: number | null;
  owner_id: number;
  children: FolderTreeNode[];
}

export interface AdminSettings {
  allow_registration: boolean;
  max_upload_size: number;
  default_quota: number;
  updated_at: string | null;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    details: Record<string, unknown>;
  };
}
