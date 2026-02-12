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
  previewPort: 3000,

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
      previewPort: settings?.previewPort || 3000,
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
  appendOutput: (line) => set((state) => ({ outputLines: [...state.outputLines, line] })),
  clearOutput: () => set({ outputLines: [] }),
  setProblems: (problems) => set({ problems }),
  setGitStatusRaw: (gitStatusRaw) => set({ gitStatusRaw }),
  setBottomPanel: (bottomPanel) => set({ bottomPanel }),
  setPreviewVisible: (previewVisible) => set({ previewVisible }),
  setPreviewPort: (previewPort) => set({ previewPort }),
}));
