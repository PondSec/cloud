import { create } from 'zustand';

import type { FileNode, Workspace, WorkspaceSettings } from '../lib/ide-types';

export interface OpenFile {
  path: string;
  content: string;
  language: string;
  dirty: boolean;
}

interface IdeState {
  userToken: string | null;
  currentWorkspace: Workspace | null;
  workspaceSettings: WorkspaceSettings | null;
  explorerPath: string;
  files: FileNode[];
  openFiles: OpenFile[];
  activeFilePath: string | null;
  outputLines: string[];
  problems: string[];
  gitStatusRaw: string;
  bottomPanel: 'terminal' | 'problems' | 'output';
  previewVisible: boolean;
  previewPort: number;

  setUserToken: (token: string | null) => void;
  setWorkspace: (workspace: Workspace | null, settings?: WorkspaceSettings | null) => void;
  setExplorerPath: (path: string) => void;
  setFiles: (items: FileNode[]) => void;
  openFile: (file: OpenFile) => void;
  closeFile: (path: string) => void;
  setActiveFile: (path: string | null) => void;
  updateOpenFileContent: (path: string, content: string) => void;
  markClean: (path: string) => void;
  renameOpenFilePath: (fromPath: string, toPath: string) => void;
  renameOpenFilesByPrefix: (fromPrefix: string, toPrefix: string) => void;
  removeOpenFilesByPrefix: (prefix: string) => void;
  appendOutput: (line: string) => void;
  clearOutput: () => void;
  setProblems: (items: string[]) => void;
  setGitStatusRaw: (value: string) => void;
  setBottomPanel: (panel: 'terminal' | 'problems' | 'output') => void;
  setPreviewVisible: (visible: boolean) => void;
  setPreviewPort: (port: number) => void;
}

export const useIdeStore = create<IdeState>((set, get) => ({
  userToken: null,
  currentWorkspace: null,
  workspaceSettings: null,
  explorerPath: '',
  files: [],
  openFiles: [],
  activeFilePath: null,
  outputLines: [],
  problems: [],
  gitStatusRaw: '',
  bottomPanel: 'terminal',
  previewVisible: true,
  previewPort: 0,

  setUserToken: (token) => set({ userToken: token }),
  setWorkspace: (workspace, settings) =>
    set({
      currentWorkspace: workspace,
      workspaceSettings: settings ?? null,
      explorerPath: '',
      files: [],
      openFiles: [],
      activeFilePath: null,
      outputLines: [],
      problems: [],
      gitStatusRaw: '',
      previewPort: settings?.previewPort ?? 0,
    }),
  setExplorerPath: (explorerPath) => set({ explorerPath }),
  setFiles: (files) => set({ files }),
  openFile: (file) => {
    const existing = get().openFiles.find((item) => item.path === file.path);
    if (existing) {
      set({ activeFilePath: file.path });
      return;
    }

    set((state) => ({
      openFiles: [...state.openFiles, file],
      activeFilePath: file.path,
    }));
  },
  closeFile: (path) =>
    set((state) => {
      const next = state.openFiles.filter((item) => item.path !== path);
      const activeFilePath = state.activeFilePath === path ? next.at(-1)?.path ?? null : state.activeFilePath;
      return { openFiles: next, activeFilePath };
    }),
  setActiveFile: (activeFilePath) => set({ activeFilePath }),
  updateOpenFileContent: (path, content) =>
    set((state) => ({
      openFiles: state.openFiles.map((item) => (item.path === path ? { ...item, content, dirty: true } : item)),
    })),
  markClean: (path) =>
    set((state) => ({
      openFiles: state.openFiles.map((item) => (item.path === path ? { ...item, dirty: false } : item)),
    })),
  renameOpenFilePath: (fromPath, toPath) =>
    set((state) => ({
      openFiles: state.openFiles.map((item) => (item.path === fromPath ? { ...item, path: toPath } : item)),
      activeFilePath: state.activeFilePath === fromPath ? toPath : state.activeFilePath,
    })),
  renameOpenFilesByPrefix: (fromPrefix, toPrefix) =>
    set((state) => {
      const normalized = fromPrefix.endsWith('/') ? fromPrefix : `${fromPrefix}/`;
      const next = state.openFiles.map((item) => {
        if (item.path === fromPrefix) {
          return { ...item, path: toPrefix };
        }
        if (item.path.startsWith(normalized)) {
          const rest = item.path.slice(normalized.length);
          return { ...item, path: `${toPrefix}/${rest}` };
        }
        return item;
      });
      let nextActive = state.activeFilePath;
      if (nextActive === fromPrefix) {
        nextActive = toPrefix;
      } else if (nextActive && nextActive.startsWith(normalized)) {
        const rest = nextActive.slice(normalized.length);
        nextActive = `${toPrefix}/${rest}`;
      }
      return { openFiles: next, activeFilePath: nextActive };
    }),
  removeOpenFilesByPrefix: (prefix) =>
    set((state) => {
      const normalized = prefix.endsWith('/') ? prefix : `${prefix}/`;
      const next = state.openFiles.filter((item) => item.path !== prefix && !item.path.startsWith(normalized));
      const activeStillThere = next.some((item) => item.path === state.activeFilePath);
      return {
        openFiles: next,
        activeFilePath: activeStillThere ? state.activeFilePath : next.at(-1)?.path ?? null,
      };
    }),
  appendOutput: (line) => set((state) => ({ outputLines: [...state.outputLines, line] })),
  clearOutput: () => set({ outputLines: [] }),
  setProblems: (problems) => set({ problems }),
  setGitStatusRaw: (gitStatusRaw) => set({ gitStatusRaw }),
  setBottomPanel: (bottomPanel) => set({ bottomPanel }),
  setPreviewVisible: (previewVisible) => set({ previewVisible }),
  setPreviewPort: (previewPort) => set({ previewPort }),
}));
