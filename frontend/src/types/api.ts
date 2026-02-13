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
  inventory_pro: {
    enabled: boolean;
    base_url: string;
    sync_enabled: boolean;
    sso_enabled: boolean;
    enforce_sso: boolean;
    auto_provision_users: boolean;
    dock_enabled: boolean;
    default_role_name: string;
    has_shared_secret: boolean;
    sync_endpoint: string;
    sso_ticket_endpoint: string;
    sso_exchange_endpoint: string;
  };
  updated_at: string | null;
}

export interface InventoryProContext {
  enabled: boolean;
  dock_enabled: boolean;
  base_url: string;
  launch_url: string;
  available: boolean;
}

export type DockPosition = 'bottom' | 'left' | 'right';

export interface UiPreferences {
  effectsQuality: 'low' | 'medium' | 'high';
  animationsEnabled: boolean;
  cornerRadius: number;
  panelOpacity: number;
  uiScale: number;
  accentHue: number;
  accentSaturation: number;
  accentLightness: number;
  dockPosition: DockPosition;
  dockEdgeOffset: number;
  dockBaseItemSize: number;
  dockMagnification: number;
  dockPanelHeight: number;
  dockOrder: string[];
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

export interface MetricSeriesPoint {
  ts: string;
  net_bytes_sent: number | null;
  net_bytes_recv: number | null;
  cpu_percent: number | null;
  memory_percent: number | null;
  disk_percent: number | null;
}

export interface MonitoringOverview {
  health: {
    status: 'ok' | 'degraded';
    degraded_mode: boolean;
    messages: string[];
  };
  kpis: {
    cpu_percent: number | null;
    memory_percent: number | null;
    disk_percent: number | null;
    network_total_bytes: {
      sent: number | null;
      recv: number | null;
    };
  };
  host: {
    available: boolean;
    reason: string | null;
    cpu_percent: number | null;
    memory_percent: number | null;
    memory_used_bytes: number | null;
    memory_total_bytes: number | null;
    disk_percent: number | null;
    disk_used_bytes: number | null;
    disk_free_bytes: number | null;
    disk_total_bytes: number | null;
    disk_read_bytes: number | null;
    disk_write_bytes: number | null;
    net_bytes_sent: number | null;
    net_bytes_recv: number | null;
    load_average: {
      one: number | null;
      five: number | null;
      fifteen: number | null;
    };
    per_interface: Array<{
      name: string;
      bytes_sent: number;
      bytes_recv: number;
      packets_sent: number;
      packets_recv: number;
      errin: number;
      errout: number;
      dropin: number;
      dropout: number;
    }>;
    captured_at: string;
  };
  containers: {
    available: boolean;
    reason: string | null;
    running: number;
    total: number;
  };
  backups: {
    running: number;
    last_success_at: string | null;
    last_failure_at: string | null;
  };
  snapshots: {
    interval_seconds: number;
    retention_days: number;
    latest_ts: string | null;
    trend_last_hour: MetricSeriesPoint[];
  };
  captured_at: string;
}

export interface ContainerMetric {
  id: string;
  name: string;
  image: string;
  status: string;
  running: boolean;
  started_at: string | null;
  uptime_seconds: number | null;
  cpu_percent: number | null;
  memory_usage_bytes: number | null;
  memory_limit_bytes: number | null;
  memory_percent: number | null;
  restart_count: number;
  ports: Array<{
    container_port: string;
    host_port: number | string;
    host_ip: string;
  }>;
  labels: Record<string, string>;
  env_summary: {
    count: number;
    keys: string[];
  };
}

export interface ContainersResponse {
  available: boolean;
  reason: string | null;
  running_containers: number;
  total_containers: number;
  items: ContainerMetric[];
  captured_at: string;
}

export interface StorageResponse {
  total_bytes: number;
  used_bytes: number;
  free_bytes: number;
  per_user: Array<{
    user_id: number;
    username: string;
    bytes_used: number;
    bytes_limit: number;
    usage_percent: number | null;
  }>;
  per_project: Array<{
    project: string;
    size_bytes: number;
    file_count?: number;
  }>;
  top_directories: Array<{
    path: string;
    size_bytes: number;
  }>;
  provider: {
    psutil: boolean;
  };
  captured_at: string;
}

export interface NetworkResponse {
  totals: {
    bytes_sent: number | null;
    bytes_recv: number | null;
  };
  interfaces: Array<{
    name: string;
    bytes_sent: number;
    bytes_recv: number;
    packets_sent: number;
    packets_recv: number;
    errin: number;
    errout: number;
    dropin: number;
    dropout: number;
  }>;
  provider: {
    psutil: boolean;
    reason: string | null;
  };
  trends: {
    last_hour: MetricSeriesPoint[];
    last_day: MetricSeriesPoint[];
  };
  captured_at: string;
}

export type BackupJobType = 'full' | 'incremental';
export type BackupJobStatus = 'scheduled' | 'running' | 'success' | 'failed';

export interface BackupJob {
  id: number;
  type: BackupJobType;
  status: BackupJobStatus;
  started_at: string | null;
  finished_at: string | null;
  size_bytes: number | null;
  target: string;
  logs?: string;
  error_message: string | null;
  created_by_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface RestorePoint {
  id: number;
  created_at: string;
  label: string;
  source_backup_job_id: number | null;
  scope: 'system' | 'project' | 'user';
  metadata: Record<string, unknown>;
  size_bytes: number | null;
}

export interface ResourceQuota {
  user_id: number;
  username: string | null;
  bytes_limit: number;
  bytes_used: number;
  max_running_containers: number;
  max_cpu_percent: number;
  max_ram_mb: number;
  monthly_bytes_in_limit: number;
  monthly_bytes_out_limit: number;
  monthly_bytes_in_used: number;
  monthly_bytes_out_used: number;
  usage_month: string;
  updated_at: string;
}

export interface ResourceQuotaUsage {
  user_id: number;
  username: string;
  storage: {
    bytes_used: number;
    bytes_limit: number;
    usage_percent: number | null;
  };
  containers: {
    running: number | null;
    max_running_containers: number;
    max_cpu_percent: number;
    max_ram_mb: number;
  };
  bandwidth: {
    usage_month: string;
    bytes_in_used: number;
    bytes_out_used: number;
    bytes_in_limit: number;
    bytes_out_limit: number;
  };
}

export interface AuditLogEntry {
  id: number;
  ts: string;
  created_at: string;
  actor_user_id: number | null;
  actor_username: string | null;
  actor_ip: string | null;
  user_agent: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  metadata: Record<string, unknown>;
  severity: string;
  success: boolean;
}
