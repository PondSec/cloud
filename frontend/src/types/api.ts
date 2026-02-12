export type FileType = 'file' | 'folder';

export interface Permission {
  id: number;
  code: string;
  name: string;
}

export type PermissionCode =
  | 'FILE_READ'
  | 'FILE_WRITE'
  | 'FILE_DELETE'
  | 'SHARE_INTERNAL_MANAGE'
  | 'SHARE_EXTERNAL_MANAGE'
  | 'SHARE_VIEW_RECEIVED'
  | 'OFFICE_USE'
  | 'IDE_USE'
  | 'MEDIA_VIEW'
  | 'USER_MANAGE'
  | 'ROLE_MANAGE'
  | 'SERVER_SETTINGS';

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
  permissions: string[];
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

export type ShareAccess = 'read' | 'write';

export interface InternalShare {
  id: number;
  file_id: number;
  shared_with_user_id: number;
  shared_with_username: string | null;
  created_by_id: number;
  created_by_username: string | null;
  access: ShareAccess;
  created_at: string;
  updated_at: string;
}

export interface ExternalShareLink {
  id: number;
  file_id: number;
  created_by_id: number;
  token: string;
  expires_at: string | null;
  created_at: string;
  public_url: string;
  item: FileNode | null;
}

export interface SharedWithMeItem {
  share: InternalShare;
  item: FileNode;
}

export interface OnlyOfficeDocumentPermissions {
  edit: boolean;
  download: boolean;
  print: boolean;
  copy: boolean;
}

export interface OnlyOfficeDocumentConfig {
  fileType: string;
  title: string;
  key: string;
  url: string;
  permissions: OnlyOfficeDocumentPermissions;
}

export interface OnlyOfficeEditorUser {
  id: string;
  name: string;
}

export interface OnlyOfficeEditorConfig {
  mode: 'edit' | 'view';
  callbackUrl: string;
  lang: string;
  user: OnlyOfficeEditorUser;
}

export interface OnlyOfficeSessionConfig {
  document: OnlyOfficeDocumentConfig;
  documentType: 'word' | 'cell' | 'slide' | 'pdf';
  editorConfig: OnlyOfficeEditorConfig;
  token?: string;
}

export interface OnlyOfficeSession {
  file_id: number;
  can_edit: boolean;
  document_server_url: string;
  config: OnlyOfficeSessionConfig;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    details: Record<string, unknown>;
  };
}
