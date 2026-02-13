import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, FolderPlus, Upload, LogOut, X } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
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
import type { FileNode, FolderTreeNode } from '@/types/api';

interface FileWorkspaceProps {
  showOverview?: boolean;
}

interface IndexedFolder {
  id: number;
  name: string;
  parent_id: number | null;
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

export function FileWorkspace({ showOverview = false }: FileWorkspaceProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const hiddenUploadRef = useRef<HTMLInputElement | null>(null);
  const [currentParentId, setCurrentParentId] = useState<number | null>(null);
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
  });

  const folderIndex = useMemo(() => indexFolders(treeQuery.data ?? []), [treeQuery.data]);

  const breadcrumbs = useMemo(() => {
    const trail: Array<{ id: number | null; label: string }> = [{ id: null, label: 'Start' }];

    let cursor = currentParentId;
    const stack: Array<{ id: number; label: string }> = [];
    while (cursor !== null) {
      const node = folderIndex.get(cursor);
      if (!node) break;
      stack.push({ id: node.id, label: node.name });
      cursor = node.parent_id;
    }

    stack.reverse();
    return trail.concat(stack);
  }, [currentParentId, folderIndex]);

  const isFolderViewActive = currentParentId !== null;
  const activeFolderName = currentParentId === null ? null : (folderIndex.get(currentParentId)?.name ?? 'Ordner');

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

  const filteredFiles = useMemo(() => {
    const q = localSearch.trim().toLowerCase();
    const items = filesQuery.data ?? [];
    if (!q) {
      return items;
    }
    return items.filter((item) => item.name.toLowerCase().includes(q));
  }, [filesQuery.data, localSearch]);

  const shouldShowOverviewPanel =
    showOverview && !isFolderViewActive && (filesQuery.data?.length ?? 0) === 0 && localSearch.trim() === '';

  const handleCreateFolder = async () => {
    const name = window.prompt('Ordnername');
    if (!name) {
      return;
    }
    await createFolderMutation.mutateAsync(name);
  };

  const handleUpload = async (files: File[]) => {
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
      setCurrentParentId(node.parent_id ?? null);
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
    {
      icon: <RefreshCw size={16} />,
      color: 'indigo',
      label: 'Aktualisieren',
      onClick: () => {
        void invalidate();
      },
    },
  ];

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
          currentParentId={currentParentId}
          onSelect={setCurrentParentId}
          onRenameFolder={(node) => {
            void handleRename(node);
          }}
          onMoveFolder={(node) => setMoveNode(folderTreeNodeToFileNode(node))}
          onDeleteFolder={(node) => {
            void handleDelete({ id: node.id, name: node.name, type: 'folder', parent_id: node.parent_id });
          }}
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
                    key={String(crumb.id)}
                    className="rounded-md px-2 py-1 hover:bg-white/10"
                    onClick={() => setCurrentParentId(crumb.id)}
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
                  placeholder={isFolderViewActive ? 'Aktuellen Ordner filtern' : 'Dateien im aktuellen Bereich filtern'}
                  aria-label="Dateien filtern"
                />
              </div>
              <div className="flex items-center gap-2 opacity-100 transition-opacity duration-200 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                <Button variant="secondary" size="sm" onClick={() => hiddenUploadRef.current?.click()}>
                  <Upload size={14} className="mr-1" /> Hochladen
                </Button>
                <Button variant="secondary" size="sm" onClick={handleCreateFolder}>
                  <FolderPlus size={14} className="mr-1" /> Neuer Ordner
                </Button>
                <Button variant="secondary" size="sm" onClick={() => void invalidate()}>
                  <RefreshCw size={14} className="mr-1" /> Aktualisieren
                </Button>
                {isFolderViewActive ? (
                  <Button variant="secondary" size="sm" onClick={() => setCurrentParentId(null)}>
                    <X size={14} className="mr-1" /> Ordner schließen
                  </Button>
                ) : null}
              </div>
            </div>

            {!isFolderViewActive ? (
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
                spotlightRadius={effectsQuality === 'high' ? 360 : 260}
                particleCount={effectsQuality === 'high' ? 10 : 4}
                glowColor="96, 233, 255"
                disableAnimations={!animationsEnabled || effectsQuality === 'low'}
              />
            </div>
          ) : null}

          {isFolderViewActive ? (
            <div className="border-b border-white/10 px-3 py-3">
              <div className="rounded-xl border border-cyan-300/25 bg-cyan-300/10 px-3 py-2">
                <p className="text-xs uppercase tracking-wide text-cyan-100/80">Ordneransicht</p>
                <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-zinc-100">
                    Sie sehen den Inhalt von <span className="font-semibold text-cyan-100">{activeFolderName}</span>
                  </p>
                  <Button variant="secondary" size="sm" onClick={() => setCurrentParentId(null)}>
                    <X size={14} className="mr-1" /> Zur Übersicht
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="px-3 pt-3">
              <UploadDropzone onFiles={handleUpload} disabled={uploadMutation.isPending} />
            </div>
          )}

          <div className="relative flex-1 overflow-hidden p-3">
            <div className="h-full overflow-auto pb-20 pr-1">
              {filesQuery.isLoading ? (
                <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-10 text-center text-sm text-zinc-300">
                  Dateien werden geladen...
                </div>
              ) : (
                <FileList
                  files={filteredFiles}
                  sortKey={sortKey}
                  sortDirection={sortDirection}
                  onSortKeyChange={setSortKey}
                  onSortDirectionChange={setSortDirection}
                  viewMode={viewMode}
                  onViewModeChange={setViewMode}
                  onOpenFolder={(node) => {
                    if (node.type === 'folder') {
                      setCurrentParentId(node.id);
                    }
                  }}
                  onRename={(node) => {
                    void handleRename(node);
                  }}
                  onMove={(node) => setMoveNode(node)}
                  onDelete={(node) => {
                    void handleDelete(node);
                  }}
                  onDownload={(node) => {
                    void api.files.download(node);
                  }}
                  onShare={(node) => setShareNode(node)}
                  onOpenInOffice={(node) => {
                    navigate(`/app/office/${node.id}`);
                  }}
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
