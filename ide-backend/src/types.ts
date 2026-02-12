export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: string;
}

export interface WorkspaceRecord {
  id: string;
  userId: string;
  name: string;
  template: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceSettings {
  env: Record<string, string>;
  commands: {
    run?: string;
    build?: string;
    test?: string;
    preview?: string;
  };
  previewPort?: number;
  languageServers: {
    typescript: boolean;
    python: boolean;
    c: boolean;
  };
  allowEgress: boolean;
}

export interface FileNode {
  path: string;
  name: string;
  type: 'file' | 'directory';
  size: number;
  mtimeMs: number;
}
