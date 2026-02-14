import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Folder, RefreshCw, FolderPlus, Upload, LogOut, X, Code2, ExternalLink, Pencil, MoveRight, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';

import { FileList, type SortDirection, type SortKey, type ViewMode } from '@/components/files/FileList';
import { FolderTree } from '@/components/files/FolderTree';
import { MoveModal } from '@/components/files/MoveModal';
import { ShareModal } from '@/components/files/ShareModal';
import { UploadDropzone } from '@/components/files/UploadDropzone';
import GlassIcons from '@/components/reactbits/GlassIcons';
import GradualBlur from '@/components/reactbits/GradualBlur';
import MagicBento from '@/components/reactbits/MagicBento';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useUiPrefs } from '@/contexts/UiPrefsContext';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { api, toApiMessage } from '@/lib/api';
import { clearAuthSession } from '@/lib/auth-storage';
import { BRAND } from '@/lib/brand';
import { ideApi } from '@/lib/ide-api';
import { ensureIdeSessionFromCloud } from '@/lib/ide-bridge';
import type { FileNode as IdeFileNode, Workspace } from '@/lib/ide-types';
import { PERMISSIONS, hasPermission } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import type { FileNode, FolderTreeNode } from '@/types/api';

interface FileWorkspaceProps {
  showOverview?: boolean;
}

interface IndexedFolder {
  id: number;
  name: string;
  parent_id: number | null;
}

interface WorkspaceSelection {
  workspaceId: string;
  workspaceName: string;
  path: string;
}

interface WorkspaceFolderEntry {
  name: string;
  path: string;
}

function indexFolders(tree: FolderTreeNode[]): Map<number, IndexedFolder> {
  const map = new Map<number, IndexedFolder>();

  const walk = (nodes: FolderTreeNode[]) => {
    for (const node of nodes) {
      map.set(node.id, {
        id: node.id,
        name: node.name,
        parent_id: node.parent_id,
      });
      walk(node.children);
    }
  };

  walk(tree);
  return map;
}

function isAncestorOrSelf(folderId: number, currentFolderId: number | null, index: Map<number, IndexedFolder>): boolean {
  let cursor = currentFolderId;
  while (cursor !== null) {
    if (cursor === folderId) {
      return true;
    }
    cursor = index.get(cursor)?.parent_id ?? null;
  }
  return false;
}

function folderTreeNodeToFileNode(node: FolderTreeNode): FileNode {
  const now = new Date().toISOString();
  return {
    id: node.id,
    parent_id: node.parent_id,
    owner_id: node.owner_id,
    name: node.name,
    type: 'folder',
    size: 0,
    mime: 'inode/directory',
    storage_path: null,
    created_at: now,
    updated_at: now,
  };
}

function shouldRetryWorkspaceLoad(error: any): boolean {
  const status = error?.response?.status;
  return !status || status === 429 || status >= 500;
}

function workspaceTreeKey(workspaceId: string, path: string): string {
  return `${workspaceId}:${path || '/'}`;
}

function idFromString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) + 1;
}

function workspaceNodeToFileNode(workspaceId: string, node: IdeFileNode): FileNode {
  const ts = new Date(node.mtimeMs || Date.now()).toISOString();
  return {
    id: idFromString(`workspace:${workspaceId}:${node.path}`),
    parent_id: null,
    owner_id: 0,
    name: node.name,
    type: node.type === 'directory' ? 'folder' : 'file',
    size: node.size ?? 0,
    mime: node.type === 'directory' ? 'inode/directory' : null,
    storage_path: `workspace://${workspaceId}/${node.path}`,
    created_at: ts,
    updated_at: ts,
  };
}

export function FileWorkspace({ showOverview = false }: FileWorkspaceProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const hiddenUploadRef = useRef<HTMLInputElement | null>(null);
  const [currentParentId, setCurrentParentId] = useState<number | null>(null);
  const [workspaceSelection, setWorkspaceSelection] = useState<WorkspaceSelection | null>(null);
  const [workspaceExpanded, setWorkspaceExpanded] = useState<Record<string, boolean>>({ __root__: true });
  const [workspaceDirCache, setWorkspaceDirCache] = useState<Record<string, WorkspaceFolderEntry[]>>({});
  const [workspaceDirLoading, setWorkspaceDirLoading] = useState<Record<string, boolean>>({});
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [localSearch, setLocalSearch] = useState('');
  const [moveNode, setMoveNode] = useState<FileNode | null>(null);
  const [shareNode, setShareNode] = useState<FileNode | null>(null);

  const {
    prefs: { effectsQuality, animationsEnabled },
  } = useUiPrefs();

  const { data: user } = useCurrentUser();

  const treeQuery = useQuery({
    queryKey: ['files', 'tree'],
    queryFn: api.files.tree,
  });

  const filesQuery = useQuery({
    queryKey: ['files', 'list', currentParentId],
    queryFn: () => api.files.list(currentParentId),
    enabled: workspaceSelection === null,
  });

  const canUseIde = hasPermission(user, PERMISSIONS.IDE_USE);

  const workspacesQuery = useQuery({
    queryKey: ['ide', 'workspaces', 'files-page'],
    queryFn: async () => {
      await ensureIdeSessionFromCloud();
      return ideApi.workspace.list();
    },
    enabled: canUseIde,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: (failureCount, error) => shouldRetryWorkspaceLoad(error) && failureCount < 2,
  });

  const workspaceFilesQuery = useQuery({
    queryKey: ['ide', 'workspace-files', workspaceSelection?.workspaceId, workspaceSelection?.path],
    queryFn: async () => {
      if (!workspaceSelection) return [];
      await ensureIdeSessionFromCloud();
      return ideApi.files.list(workspaceSelection.workspaceId, workspaceSelection.path);
    },
    enabled: canUseIde && workspaceSelection !== null,
    staleTime: 10_000,
    retry: (failureCount, error) => shouldRetryWorkspaceLoad(error) && failureCount < 2,
  });

  const folderIndex = useMemo(() => indexFolders(treeQuery.data ?? []), [treeQuery.data]);
  const isWorkspaceView = workspaceSelection !== null;
  const isCloudFolderViewActive = !isWorkspaceView && currentParentId !== null;
  const activeFolderName = currentParentId === null ? null : (folderIndex.get(currentParentId)?.name ?? 'Ordner');
  const workspaceNameById = useMemo(() => {
    return new Map((workspacesQuery.data ?? []).map((workspace) => [workspace.id, workspace.name]));
  }, [workspacesQuery.data]);

  const selectCloudFolder = useCallback((id: number | null) => {
    setWorkspaceSelection(null);
    setCurrentParentId(id);
  }, []);

  const markWorkspaceAncestorsExpanded = useCallback((workspaceId: string, path: string) => {
    const normalized = path
      .split('/')
      .map((part) => part.trim())
      .filter(Boolean);

    setWorkspaceExpanded((prev) => {
      const next = { ...prev, __root__: true, [workspaceTreeKey(workspaceId, '')]: true };
      let running = '';
      for (const segment of normalized) {
        running = running ? `${running}/${segment}` : segment;
        next[workspaceTreeKey(workspaceId, running)] = true;
      }
      return next;
    });
  }, []);

  const selectWorkspacePath = useCallback(
    (workspaceId: string, workspaceName: string, path: string) => {
      setCurrentParentId(null);
      setWorkspaceSelection({ workspaceId, workspaceName, path });
      markWorkspaceAncestorsExpanded(workspaceId, path);
    },
    [markWorkspaceAncestorsExpanded],
  );

  const loadWorkspaceDirectories = useCallback(
    async (workspaceId: string, path: string) => {
      const key = workspaceTreeKey(workspaceId, path);
      if (workspaceDirCache[key] || workspaceDirLoading[key]) {
        return;
      }

      setWorkspaceDirLoading((prev) => ({ ...prev, [key]: true }));
      try {
        await ensureIdeSessionFromCloud();
        const list = await ideApi.files.list(workspaceId, path);
        const directories = list
          .filter((item) => item.type === 'directory')
          .map((item) => ({ name: item.name, path: item.path }))
          .sort((a, b) => a.name.localeCompare(b.name));
        setWorkspaceDirCache((prev) => ({ ...prev, [key]: directories }));
      } catch (error) {
        toast.error(toApiMessage(error));
      } finally {
        setWorkspaceDirLoading((prev) => ({ ...prev, [key]: false }));
      }
    },
    [workspaceDirCache, workspaceDirLoading],
  );

  const toggleWorkspaceFolder = useCallback(
    async (workspaceId: string, path: string) => {
      const key = workspaceTreeKey(workspaceId, path);
      let nextExpanded = false;
      setWorkspaceExpanded((prev) => {
        nextExpanded = !prev[key];
        return { ...prev, __root__: true, [key]: nextExpanded };
      });
      if (nextExpanded) {
        await loadWorkspaceDirectories(workspaceId, path);
      }
    },
    [loadWorkspaceDirectories],
  );

  useEffect(() => {
    if (!workspaceSelection || !workspaceFilesQuery.data) return;
    const key = workspaceTreeKey(workspaceSelection.workspaceId, workspaceSelection.path);
    const directories = workspaceFilesQuery.data
      .filter((item) => item.type === 'directory')
      .map((item) => ({ name: item.name, path: item.path }))
      .sort((a, b) => a.name.localeCompare(b.name));
    setWorkspaceDirCache((prev) => ({ ...prev, [key]: directories }));
  }, [workspaceFilesQuery.data, workspaceSelection]);

  const breadcrumbs = useMemo(() => {
    const crumbs: Array<{ key: string; label: string; onClick: () => void }> = [
      { key: 'home', label: 'Start', onClick: () => selectCloudFolder(null) },
    ];

    if (!workspaceSelection) {
      let cursor = currentParentId;
      const stack: Array<{ id: number; label: string }> = [];
      while (cursor !== null) {
        const node = folderIndex.get(cursor);
        if (!node) break;
        stack.push({ id: node.id, label: node.name });
        cursor = node.parent_id;
      }
      stack.reverse().forEach((item) => {
        crumbs.push({
          key: `cloud:${item.id}`,
          label: item.label,
          onClick: () => selectCloudFolder(item.id),
        });
      });
      return crumbs;
    }

    const workspaceName =
      workspaceSelection.workspaceName || workspaceNameById.get(workspaceSelection.workspaceId) || 'Workspace';
    crumbs.push({ key: 'workspaces', label: 'Workspaces', onClick: () => setWorkspaceSelection(null) });
    crumbs.push({
      key: `ws:${workspaceSelection.workspaceId}:root`,
      label: workspaceName,
      onClick: () => selectWorkspacePath(workspaceSelection.workspaceId, workspaceName, ''),
    });

    const segments = workspaceSelection.path
      .split('/')
      .map((segment) => segment.trim())
      .filter(Boolean);
    let runningPath = '';
    segments.forEach((segment) => {
      runningPath = runningPath ? `${runningPath}/${segment}` : segment;
      const segmentPath = runningPath;
      crumbs.push({
        key: `ws:${workspaceSelection.workspaceId}:${segmentPath}`,
        label: segment,
        onClick: () => selectWorkspacePath(workspaceSelection.workspaceId, workspaceName, segmentPath),
      });
    });

    return crumbs;
  }, [currentParentId, folderIndex, selectCloudFolder, selectWorkspacePath, workspaceNameById, workspaceSelection]);

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['files'] }),
      queryClient.invalidateQueries({ queryKey: ['auth', 'me'] }),
      queryClient.invalidateQueries({ queryKey: ['files', 'recents'] }),
    ]);
  };

  const createFolderMutation = useMutation({
    mutationFn: (name: string) => api.files.createFolder(name, currentParentId),
    onSuccess: async () => {
      toast.success('Ordner erstellt');
      await invalidate();
    },
    onError: (error) => toast.error(toApiMessage(error)),
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => api.files.upload(file, currentParentId),
    onSuccess: async () => {
      await invalidate();
    },
    onError: (error) => toast.error(toApiMessage(error)),
  });

  const updateMutation = useMutation({
    mutationFn: ({ nodeId, payload }: { nodeId: number; payload: { name?: string; parent_id?: number | null } }) =>
      api.files.update(nodeId, payload),
    onSuccess: async () => {
      toast.success('Eintrag aktualisiert');
      await invalidate();
    },
    onError: (error) => toast.error(toApiMessage(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: (nodeId: number) => api.files.remove(nodeId),
    onSuccess: async () => {
      toast.success('Eintrag gelöscht');
      await invalidate();
    },
    onError: (error) => toast.error(toApiMessage(error)),
  });

  const filteredCloudFiles = useMemo(() => {
    const q = localSearch.trim().toLowerCase();
    const items = filesQuery.data ?? [];
    if (!q) {
      return items;
    }
    return items.filter((item) => item.name.toLowerCase().includes(q));
  }, [filesQuery.data, localSearch]);

  const workspaceListItems = useMemo(() => {
    if (!workspaceSelection) return [];
    return (workspaceFilesQuery.data ?? []).map((item) => workspaceNodeToFileNode(workspaceSelection.workspaceId, item));
  }, [workspaceFilesQuery.data, workspaceSelection]);

  const workspaceNodeLookup = useMemo(() => {
    const map = new Map<number, { workspaceId: string; workspaceName: string; path: string; type: IdeFileNode['type'] }>();
    if (!workspaceSelection) {
      return map;
    }
    (workspaceFilesQuery.data ?? []).forEach((item) => {
      map.set(idFromString(`workspace:${workspaceSelection.workspaceId}:${item.path}`), {
        workspaceId: workspaceSelection.workspaceId,
        workspaceName: workspaceSelection.workspaceName,
        path: item.path,
        type: item.type,
      });
    });
    return map;
  }, [workspaceFilesQuery.data, workspaceSelection]);

  const filteredWorkspaceFiles = useMemo(() => {
    const q = localSearch.trim().toLowerCase();
    if (!q) {
      return workspaceListItems;
    }
    return workspaceListItems.filter((item) => item.name.toLowerCase().includes(q));
  }, [workspaceListItems, localSearch]);

  const activeListFiles = isWorkspaceView ? filteredWorkspaceFiles : filteredCloudFiles;
  const isListLoading = isWorkspaceView ? workspaceFilesQuery.isLoading : filesQuery.isLoading;

  const filteredWorkspaces = useMemo<Workspace[]>(() => {
    const q = localSearch.trim().toLowerCase();
    const items = [...(workspacesQuery.data ?? [])].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
    if (!q) {
      return items;
    }
    return items.filter((item) => `${item.name} ${item.template}`.toLowerCase().includes(q));
  }, [workspacesQuery.data, localSearch]);

  const shouldShowOverviewPanel =
    showOverview && !isWorkspaceView && !isCloudFolderViewActive && (filesQuery.data?.length ?? 0) === 0 && localSearch.trim() === '';
  const showUploadDropzone = !isWorkspaceView && currentParentId === null;

  const handleCreateFolder = async () => {
    if (isWorkspaceView) {
      toast.info('Im Workspace erstellen Sie Ordner direkt im Studio.');
      return;
    }
    const name = window.prompt('Ordnername');
    if (!name) {
      return;
    }
    await createFolderMutation.mutateAsync(name);
  };

  const handleUpload = async (files: File[]) => {
    if (isWorkspaceView) {
      toast.info('Uploads sind hier nur für Cloud-Dateien verfügbar.');
      return;
    }
    for (const file of files) {
      await uploadMutation.mutateAsync(file);
    }
    toast.success(`${files.length} Datei(en) hochgeladen`);
  };

  const handleRename = async (node: Pick<FileNode, 'id' | 'name'>) => {
    const name = window.prompt('Neuer Name', node.name);
    if (!name || name === node.name) {
      return;
    }
    await updateMutation.mutateAsync({ nodeId: node.id, payload: { name } });
  };

  const handleDelete = async (node: Pick<FileNode, 'id' | 'name' | 'type' | 'parent_id'>) => {
    if (!window.confirm(`${node.name} wirklich löschen? Dieser Schritt kann nicht rückgängig gemacht werden.`)) {
      return;
    }

    const shouldExitCurrentFolder =
      node.type === 'folder' && isAncestorOrSelf(node.id, currentParentId, folderIndex);

    await deleteMutation.mutateAsync(node.id);

    if (shouldExitCurrentFolder) {
      selectCloudFolder(node.parent_id ?? null);
    }
  };

  const resolveWorkspaceNode = (node: Pick<FileNode, 'id' | 'name'>) => {
    if (!workspaceSelection) return null;
    const ref = workspaceNodeLookup.get(node.id);
    if (!ref) {
      toast.error('Workspace-Eintrag konnte nicht gefunden werden.');
      return null;
    }
    return ref;
  };

  const workspacePathName = (path: string, fallback: string) => path.split('/').filter(Boolean).at(-1) ?? fallback;
  const workspaceParentPath = (path: string) => {
    const idx = path.lastIndexOf('/');
    return idx >= 0 ? path.slice(0, idx) : '';
  };

  const remapWorkspaceSelectionAfterRename = (workspaceId: string, fromPath: string, toPath: string) => {
    setWorkspaceSelection((prev) => {
      if (!prev || prev.workspaceId !== workspaceId) return prev;
      if (prev.path === fromPath) {
        return { ...prev, path: toPath };
      }
      if (prev.path.startsWith(`${fromPath}/`)) {
        return { ...prev, path: `${toPath}${prev.path.slice(fromPath.length)}` };
      }
      return prev;
    });
  };

  const remapWorkspaceSelectionAfterDelete = (workspaceId: string, removedPath: string) => {
    setWorkspaceSelection((prev) => {
      if (!prev || prev.workspaceId !== workspaceId) return prev;
      if (prev.path === removedPath || prev.path.startsWith(`${removedPath}/`)) {
        return { ...prev, path: workspaceParentPath(removedPath) };
      }
      return prev;
    });
  };

  const refreshWorkspaceView = async (workspaceId: string) => {
    setWorkspaceDirCache({});
    await queryClient.invalidateQueries({ queryKey: ['ide', 'workspace-files', workspaceId] });
    await workspaceFilesQuery.refetch();
  };

  const handleWorkspacePathRename = async (workspaceId: string, path: string, fallbackName: string) => {
    const currentName = workspacePathName(path, fallbackName);
    const nextName = window.prompt('Neuer Name', currentName)?.trim();
    if (!nextName || nextName === currentName) {
      return;
    }

    const parentPath = workspaceParentPath(path);
    const targetPath = parentPath ? `${parentPath}/${nextName}` : nextName;

    try {
      await ensureIdeSessionFromCloud();
      await ideApi.files.rename(workspaceId, path, targetPath);
      remapWorkspaceSelectionAfterRename(workspaceId, path, targetPath);
      toast.success('Eintrag aktualisiert');
      await refreshWorkspaceView(workspaceId);
    } catch (error) {
      toast.error(toApiMessage(error));
    }
  };

  const handleWorkspacePathMove = async (workspaceId: string, path: string) => {
    const targetPath = window.prompt('Neuer Zielpfad (inkl. Datei-/Ordnername)', path)?.trim();
    if (!targetPath || targetPath === path) {
      return;
    }

    try {
      await ensureIdeSessionFromCloud();
      await ideApi.files.rename(workspaceId, path, targetPath);
      remapWorkspaceSelectionAfterRename(workspaceId, path, targetPath);
      toast.success('Eintrag verschoben');
      await refreshWorkspaceView(workspaceId);
    } catch (error) {
      toast.error(toApiMessage(error));
    }
  };

  const handleWorkspacePathDelete = async (workspaceId: string, path: string, name: string) => {
    if (!window.confirm(`${name} wirklich löschen? Dieser Schritt kann nicht rückgängig gemacht werden.`)) {
      return;
    }

    try {
      await ensureIdeSessionFromCloud();
      await ideApi.files.remove(workspaceId, path);
      remapWorkspaceSelectionAfterDelete(workspaceId, path);
      toast.success('Eintrag gelöscht');
      await refreshWorkspaceView(workspaceId);
    } catch (error) {
      toast.error(toApiMessage(error));
    }
  };

  const handleWorkspaceRename = async (node: Pick<FileNode, 'id' | 'name'>) => {
    const ref = resolveWorkspaceNode(node);
    if (!ref) return;
    await handleWorkspacePathRename(ref.workspaceId, ref.path, node.name);
  };

  const handleWorkspaceMove = async (node: Pick<FileNode, 'id' | 'name'>) => {
    const ref = resolveWorkspaceNode(node);
    if (!ref) return;
    await handleWorkspacePathMove(ref.workspaceId, ref.path);
  };

  const handleWorkspaceDelete = async (node: Pick<FileNode, 'id' | 'name'>) => {
    const ref = resolveWorkspaceNode(node);
    if (!ref) return;
    await handleWorkspacePathDelete(ref.workspaceId, ref.path, node.name);
  };

  const handleWorkspaceDownload = async (node: Pick<FileNode, 'id' | 'name'>) => {
    const ref = resolveWorkspaceNode(node);
    if (!ref || ref.type !== 'file') return;

    try {
      await ensureIdeSessionFromCloud();
      const content = await ideApi.files.read(ref.workspaceId, ref.path);
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = node.name;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(toApiMessage(error));
    }
  };

  const quickActions = [
    {
      icon: <Upload size={16} />,
      color: 'blue',
      label: 'Hochladen',
      onClick: () => hiddenUploadRef.current?.click(),
    },
    {
      icon: <FolderPlus size={16} />,
      color: 'green',
      label: 'Ordner',
      onClick: handleCreateFolder,
    },
    ...(canUseIde
      ? [
          {
            icon: <Code2 size={16} />,
            color: 'purple',
            label: 'Studio',
            onClick: () => navigate('/dev/workspaces'),
          },
        ]
      : []),
    {
      icon: <RefreshCw size={16} />,
      color: 'indigo',
      label: 'Aktualisieren',
      onClick: () => {
        void invalidate();
      },
    },
  ];

  const activeWorkspaceName = workspaceSelection
    ? workspaceSelection.workspaceName || workspaceNameById.get(workspaceSelection.workspaceId) || 'Workspace'
    : null;

  const renderWorkspaceDirectories = (workspace: Workspace, path: string, depth: number): JSX.Element | null => {
    const key = workspaceTreeKey(workspace.id, path);
    const children = workspaceDirCache[key] ?? [];
    const loading = workspaceDirLoading[key];

    if (loading) {
      return <div className="px-2 py-1 text-xs text-zinc-500">Lädt...</div>;
    }

    if (children.length === 0) {
      return null;
    }

    return (
      <ul className="space-y-1">
        {children.map((child) => {
          const childKey = workspaceTreeKey(workspace.id, child.path);
          const expanded = Boolean(workspaceExpanded[childKey]);
          const active = workspaceSelection?.workspaceId === workspace.id && workspaceSelection.path === child.path;

          return (
            <li key={childKey}>
              <div
                className={cn(
                  'group flex items-center gap-1 rounded-lg px-1 py-1 text-sm transition hover:bg-white/10',
                  active && 'bg-cyan-300/20 text-cyan-100',
                )}
              >
                <button
                  type="button"
                  className="rounded p-1 text-zinc-400 hover:bg-white/10 hover:text-zinc-200"
                  onClick={() => {
                    void toggleWorkspaceFolder(workspace.id, child.path);
                  }}
                  aria-label={`${child.name} aufklappen`}
                >
                  <ChevronRight size={13} className={cn('transition-transform', expanded && 'rotate-90')} />
                </button>
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
                  style={{ paddingLeft: `${depth * 14 + 6}px` }}
                  onClick={() => selectWorkspacePath(workspace.id, workspace.name, child.path)}
                >
                  <Folder size={13} className="text-cyan-200" />
                  <span className="truncate">{child.name}</span>
                </button>
                <div className="mr-1 flex items-center gap-1 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
                  <button
                    type="button"
                    className="rounded-md p-1 text-zinc-300 hover:bg-white/15 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
                    aria-label={`${child.name} umbenennen`}
                    onClick={(event) => {
                      event.stopPropagation();
                      void handleWorkspacePathRename(workspace.id, child.path, child.name);
                    }}
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    type="button"
                    className="rounded-md p-1 text-zinc-300 hover:bg-white/15 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
                    aria-label={`${child.name} verschieben`}
                    onClick={(event) => {
                      event.stopPropagation();
                      void handleWorkspacePathMove(workspace.id, child.path);
                    }}
                  >
                    <MoveRight size={13} />
                  </button>
                  <button
                    type="button"
                    className="rounded-md p-1 text-zinc-300 hover:bg-rose-500/20 hover:text-rose-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300"
                    aria-label={`${child.name} löschen`}
                    onClick={(event) => {
                      event.stopPropagation();
                      void handleWorkspacePathDelete(workspace.id, child.path, child.name);
                    }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
              {expanded ? renderWorkspaceDirectories(workspace, child.path, depth + 1) : null}
            </li>
          );
        })}
      </ul>
    );
  };

  const workspaceRootItems = canUseIde ? (
    <li>
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left text-sm font-semibold text-zinc-200 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
        onClick={() => {
          setWorkspaceExpanded((prev) => ({ ...prev, __root__: !prev.__root__ }));
        }}
      >
        <ChevronRight size={14} className={cn('transition-transform', workspaceExpanded.__root__ && 'rotate-90')} />
        <Folder size={14} className="text-cyan-200" />
        <span>Workspaces</span>
      </button>

      {workspaceExpanded.__root__ ? (
        <ul className="mt-1 space-y-1">
          {workspacesQuery.isLoading ? <li className="px-2 py-1 text-xs text-zinc-500">Workspaces werden geladen...</li> : null}
          {workspacesQuery.isError ? <li className="px-2 py-1 text-xs text-amber-200">Studio aktuell nicht erreichbar.</li> : null}
          {!workspacesQuery.isLoading && !workspacesQuery.isError && (workspacesQuery.data?.length ?? 0) === 0 ? (
            <li className="px-2 py-1 text-xs text-zinc-500">Keine Workspaces vorhanden.</li>
          ) : null}
          {!workspacesQuery.isLoading && !workspacesQuery.isError
            ? (workspacesQuery.data ?? [])
                .slice()
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((workspace) => {
                  const rootKey = workspaceTreeKey(workspace.id, '');
                  const expanded = Boolean(workspaceExpanded[rootKey]);
                  const activeRoot =
                    workspaceSelection?.workspaceId === workspace.id && (workspaceSelection.path === '' || !workspaceSelection.path);

                  return (
                    <li key={workspace.id}>
                      <div
                        className={cn(
                          'group flex items-center gap-1 rounded-lg px-1 py-1 text-sm transition hover:bg-white/10',
                          activeRoot && 'bg-cyan-300/20 text-cyan-100',
                        )}
                      >
                        <button
                          type="button"
                          className="rounded p-1 text-zinc-400 hover:bg-white/10 hover:text-zinc-200"
                          onClick={() => {
                            void toggleWorkspaceFolder(workspace.id, '');
                          }}
                          aria-label={`${workspace.name} aufklappen`}
                        >
                          <ChevronRight size={13} className={cn('transition-transform', expanded && 'rotate-90')} />
                        </button>
                        <button
                          type="button"
                          className="flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
                          onClick={() => selectWorkspacePath(workspace.id, workspace.name, '')}
                        >
                          <Folder size={13} className="text-cyan-200" />
                          <span className="truncate">{workspace.name}</span>
                        </button>
                      </div>
                      {expanded ? renderWorkspaceDirectories(workspace, '', 1) : null}
                    </li>
                  );
                })
            : null}
        </ul>
      ) : null}
    </li>
  ) : null;

  return (
    <div className="flex h-full w-full gap-4 p-4">
      <input
        ref={hiddenUploadRef}
        type="file"
        className="hidden"
        multiple
        onChange={async (event) => {
          if (!event.target.files) return;
          await handleUpload(Array.from(event.target.files));
          event.currentTarget.value = '';
        }}
      />

      <aside className="w-72 shrink-0 overflow-hidden rounded-2xl border border-white/10 bg-black/20">
        <FolderTree
          tree={treeQuery.data ?? []}
          currentParentId={workspaceSelection ? -1 : currentParentId}
          onSelect={selectCloudFolder}
          onRenameFolder={(node) => {
            void handleRename(node);
          }}
          onMoveFolder={(node) => setMoveNode(folderTreeNodeToFileNode(node))}
          onDeleteFolder={(node) => {
            void handleDelete({ id: node.id, name: node.name, type: 'folder', parent_id: node.parent_id });
          }}
          extraRootItems={workspaceRootItems}
        />
      </aside>

      <section className="relative flex-1 overflow-hidden rounded-2xl border border-white/10 bg-black/20">
        <div className="flex h-full flex-col overflow-hidden">
          <header className="group space-y-3 border-b border-white/10 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <nav className="flex flex-wrap items-center gap-2 text-sm text-zinc-300" aria-label="Pfadnavigation">
                {breadcrumbs.map((crumb) => (
                  <button
                    type="button"
                    key={crumb.key}
                    className="rounded-md px-2 py-1 hover:bg-white/10"
                    onClick={crumb.onClick}
                  >
                    {crumb.label}
                  </button>
                ))}
              </nav>

              <div className="flex items-center gap-2 text-xs">
                <span className="rounded-full border border-cyan-300/30 bg-cyan-300/10 px-2 py-1 text-cyan-100">
                  {user?.username} · {BRAND.fullName}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    void api.auth.logout().catch(() => {});
                    clearAuthSession();
                    queryClient.clear();
                    navigate('/login', { replace: true });
                  }}
                >
                  <LogOut size={14} className="mr-1" />
                  Abmelden
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="max-w-md flex-1">
                <Input
                  value={localSearch}
                  onChange={(event) => setLocalSearch(event.target.value)}
                  placeholder={
                    isWorkspaceView
                      ? 'Aktuellen Workspace-Pfad filtern'
                      : isCloudFolderViewActive
                        ? 'Aktuellen Ordner filtern'
                        : 'Dateien im aktuellen Bereich filtern'
                  }
                  aria-label="Dateien filtern"
                />
              </div>
              <div className="flex items-center gap-2 opacity-100 transition-opacity duration-200 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                <Button variant="secondary" size="sm" onClick={() => hiddenUploadRef.current?.click()} disabled={isWorkspaceView}>
                  <Upload size={14} className="mr-1" /> Hochladen
                </Button>
                <Button variant="secondary" size="sm" onClick={handleCreateFolder} disabled={isWorkspaceView}>
                  <FolderPlus size={14} className="mr-1" /> Neuer Ordner
                </Button>
                {canUseIde ? (
                  <Button variant="secondary" size="sm" onClick={() => navigate('/dev/workspaces')}>
                    <Code2 size={14} className="mr-1" /> Studio
                  </Button>
                ) : null}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    if (isWorkspaceView) {
                      void workspaceFilesQuery.refetch();
                      return;
                    }
                    void invalidate();
                  }}
                >
                  <RefreshCw size={14} className="mr-1" /> Aktualisieren
                </Button>
                {isCloudFolderViewActive || isWorkspaceView ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      if (isWorkspaceView) {
                        setWorkspaceSelection(null);
                        return;
                      }
                      selectCloudFolder(null);
                    }}
                  >
                    <X size={14} className="mr-1" /> Bereich schließen
                  </Button>
                ) : null}
              </div>
            </div>

            {!isCloudFolderViewActive && !isWorkspaceView ? (
              <div className="hidden sm:block">
                <GlassIcons items={quickActions} />
              </div>
            ) : null}
          </header>

          {shouldShowOverviewPanel ? (
            <div className="border-b border-white/10 px-3 py-2">
              <MagicBento
                textAutoHide
                enableStars={effectsQuality !== 'low'}
                enableSpotlight={animationsEnabled && effectsQuality !== 'low'}
                enableBorderGlow
                enableTilt={false}
                enableMagnetism={false}
                clickEffect={animationsEnabled}
                spotlightRadius={effectsQuality === 'high' ? 320 : 240}
                particleCount={effectsQuality === 'high' ? 6 : 3}
                glowColor="96, 233, 255"
                disableAnimations={!animationsEnabled || effectsQuality === 'low'}
              />
            </div>
          ) : null}

          {isWorkspaceView ? (
            <div className="border-b border-white/10 px-3 py-3">
              <div className="rounded-xl border border-cyan-300/25 bg-cyan-300/10 px-3 py-2">
                <p className="text-xs uppercase tracking-wide text-cyan-100/80">Workspace-Ansicht</p>
                <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-zinc-100">
                    Sie sehen <span className="font-semibold text-cyan-100">{activeWorkspaceName}</span>
                    {workspaceSelection?.path ? (
                      <>
                        {' '}
                        / <span className="text-cyan-100">{workspaceSelection.path}</span>
                      </>
                    ) : null}
                  </p>
                  <Button variant="secondary" size="sm" onClick={() => setWorkspaceSelection(null)}>
                    <X size={14} className="mr-1" /> Zur Cloud-Übersicht
                  </Button>
                </div>
              </div>
            </div>
          ) : isCloudFolderViewActive ? (
            <div className="border-b border-white/10 px-3 py-3">
              <div className="rounded-xl border border-cyan-300/25 bg-cyan-300/10 px-3 py-2">
                <p className="text-xs uppercase tracking-wide text-cyan-100/80">Ordneransicht</p>
                <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-zinc-100">
                    Sie sehen den Inhalt von <span className="font-semibold text-cyan-100">{activeFolderName}</span>
                  </p>
                  <Button variant="secondary" size="sm" onClick={() => selectCloudFolder(null)}>
                    <X size={14} className="mr-1" /> Zur Übersicht
                  </Button>
                </div>
              </div>
            </div>
          ) : showUploadDropzone ? (
            <div className="px-3 pt-3">
              <UploadDropzone onFiles={handleUpload} disabled={uploadMutation.isPending} />
            </div>
          ) : null}

          <div className="relative flex-1 overflow-hidden p-3">
            <div className="h-full overflow-auto pb-20 pr-1">
              {!isWorkspaceView && !isCloudFolderViewActive && canUseIde ? (
                <section className="mb-3 rounded-xl border border-white/10 bg-black/20 p-3">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-[11px] uppercase tracking-wide text-zinc-400">PondSec Studio</p>
                      <h3 className="text-sm font-semibold text-zinc-100">Workspaces in Dateien</h3>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => void workspacesQuery.refetch()}
                        disabled={workspacesQuery.isFetching}
                      >
                        <RefreshCw size={14} className={cn('mr-1', workspacesQuery.isFetching && 'animate-spin')} /> Sync
                      </Button>
                      <Button variant="secondary" size="sm" onClick={() => navigate('/dev/workspaces')}>
                        <Code2 size={14} className="mr-1" /> Verwalten
                      </Button>
                    </div>
                  </div>

                  {workspacesQuery.isLoading ? (
                    <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-5 text-sm text-zinc-300">
                      Workspaces werden geladen...
                    </div>
                  ) : null}

                  {workspacesQuery.isError ? (
                    <div className="rounded-lg border border-amber-300/25 bg-amber-300/10 px-3 py-4 text-sm text-amber-100">
                      Studio ist aktuell nicht erreichbar. Sie können Dateien normal weiter nutzen.
                    </div>
                  ) : null}

                  {!workspacesQuery.isLoading && !workspacesQuery.isError && filteredWorkspaces.length === 0 ? (
                    <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-5 text-sm text-zinc-300">
                      Keine passenden Workspaces gefunden.
                    </div>
                  ) : null}

                  {!workspacesQuery.isLoading && !workspacesQuery.isError && filteredWorkspaces.length > 0 ? (
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {filteredWorkspaces.map((workspace) => (
                        <button
                          key={workspace.id}
                          type="button"
                          className="group rounded-lg border border-white/10 bg-black/25 p-3 text-left transition hover:border-cyan-300/30 hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
                          onClick={() => navigate(`/dev/ide/${workspace.id}`)}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-sm font-semibold text-zinc-100">{workspace.name}</span>
                            <ExternalLink size={14} className="text-zinc-400 transition group-hover:text-cyan-200" />
                          </div>
                          <p className="mt-1 text-xs text-zinc-400">{workspace.template}</p>
                          <p className="mt-1 text-xs text-zinc-500">
                            Aktualisiert: {new Date(workspace.updatedAt).toLocaleString()}
                          </p>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </section>
              ) : null}

              {isListLoading ? (
                <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-10 text-center text-sm text-zinc-300">
                  {isWorkspaceView ? 'Workspace-Inhalt wird geladen...' : 'Dateien werden geladen...'}
                </div>
              ) : (
                <FileList
                  files={activeListFiles}
                  sortKey={sortKey}
                  sortDirection={sortDirection}
                  onSortKeyChange={setSortKey}
                  onSortDirectionChange={setSortDirection}
                  viewMode={viewMode}
                  onViewModeChange={setViewMode}
                  onOpenFolder={(node) => {
                    if (node.type === 'folder') {
                      if (isWorkspaceView) {
                        const ref = workspaceNodeLookup.get(node.id);
                        if (ref && ref.type === 'directory') {
                          selectWorkspacePath(ref.workspaceId, ref.workspaceName, ref.path);
                        }
                        return;
                      }
                      selectCloudFolder(node.id);
                    }
                  }}
                  onRename={
                    (node) => {
                      if (isWorkspaceView) {
                        void handleWorkspaceRename(node);
                        return;
                      }
                      void handleRename(node);
                    }
                  }
                  onMove={(node) => {
                    if (isWorkspaceView) {
                      void handleWorkspaceMove(node);
                      return;
                    }
                    setMoveNode(node);
                  }}
                  onDelete={
                    (node) => {
                      if (isWorkspaceView) {
                        void handleWorkspaceDelete(node);
                        return;
                      }
                      void handleDelete(node);
                    }
                  }
                  onDownload={
                    (node) => {
                      if (isWorkspaceView) {
                        void handleWorkspaceDownload(node);
                        return;
                      }
                      void api.files.download(node);
                    }
                  }
                  onShare={isWorkspaceView ? undefined : (node) => setShareNode(node)}
                  onOpenInOffice={
                    isWorkspaceView
                      ? undefined
                      : (node) => {
                          navigate(`/app/office/${node.id}`);
                        }
                  }
                />
              )}
            </div>
            <GradualBlur target="parent" position="bottom" height="6rem" strength={2} divCount={6} curve="bezier" />
          </div>
        </div>
      </section>

      <MoveModal
        open={moveNode !== null}
        node={moveNode}
        tree={treeQuery.data ?? []}
        onClose={() => setMoveNode(null)}
        onConfirm={async (parentId) => {
          if (!moveNode) return;
          await updateMutation.mutateAsync({ nodeId: moveNode.id, payload: { parent_id: parentId } });
        }}
      />

      <ShareModal open={shareNode !== null} node={shareNode} onClose={() => setShareNode(null)} />
    </div>
  );
}
