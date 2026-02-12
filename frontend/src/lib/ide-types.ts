export interface User {
  id: string;
  email: string;
}

export interface Workspace {
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

export interface WorkspaceRuntime {
  running: boolean;
  containerName: string;
}
