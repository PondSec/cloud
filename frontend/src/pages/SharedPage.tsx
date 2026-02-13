import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FolderOpen, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { FileList, type SortDirection, type SortKey, type ViewMode } from '@/components/files/FileList';
import { Button } from '@/components/ui/button';
import { api, toApiMessage } from '@/lib/api';
import { isOnlyOfficeSupportedFileName } from '@/lib/utils';
import type { FileNode, SharedWithMeItem } from '@/types/api';

function accessLabel(access: 'read' | 'write'): string {
  return access === 'write' ? 'Schreiben' : 'Lesen';
}

export function SharedPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selectedShare, setSelectedShare] = useState<SharedWithMeItem | null>(null);
  const [pathIds, setPathIds] = useState<number[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [viewMode, setViewMode] = useState<ViewMode>('list');

  const sharedQuery = useQuery({
    queryKey: ['shares', 'shared-with-me'],
    queryFn: api.shares.sharedWithMe,
  });

  useEffect(() => {
    if (!selectedShare) {
      return;
    }
    if (selectedShare.item.type === 'folder') {
      setPathIds([selectedShare.item.id]);
    } else {
      setPathIds([]);
    }
  }, [selectedShare]);

  const currentParentId = pathIds.length > 0 ? pathIds[pathIds.length - 1] : null;

  const folderItemsQuery = useQuery({
    queryKey: ['files', 'list', 'shared', currentParentId],
    queryFn: () => api.files.list(currentParentId as number),
    enabled: selectedShare?.item.type === 'folder' && currentParentId !== null,
  });

  const writable = selectedShare?.share.access === 'write';

  const updateMutation = useMutation({
    mutationFn: ({ nodeId, payload }: { nodeId: number; payload: { name?: string; parent_id?: number | null } }) =>
      api.files.update(nodeId, payload),
    onSuccess: async () => {
      toast.success('Eintrag aktualisiert');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['files', 'list', 'shared', currentParentId] }),
        queryClient.invalidateQueries({ queryKey: ['shares', 'shared-with-me'] }),
      ]);
    },
    onError: (error) => toast.error(toApiMessage(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: (nodeId: number) => api.files.remove(nodeId),
    onSuccess: async () => {
      toast.success('Eintrag gelöscht');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['files', 'list', 'shared', currentParentId] }),
        queryClient.invalidateQueries({ queryKey: ['shares', 'shared-with-me'] }),
      ]);
    },
    onError: (error) => toast.error(toApiMessage(error)),
  });

  const selectedHeader = useMemo(() => {
    if (!selectedShare) {
      return 'Wählen Sie links eine Freigabe aus.';
    }
    const fromUser = selectedShare.share.created_by_username ?? `Benutzer #${selectedShare.share.created_by_id}`;
    return `Freigegeben von ${fromUser} (${accessLabel(selectedShare.share.access)})`;
  }, [selectedShare]);

  return (
    <div className="h-full p-4">
      <div className="grid h-full gap-4 lg:grid-cols-[320px_1fr]">
        <aside className="overflow-auto rounded-2xl border border-white/10 bg-black/20 p-3">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h1 className="text-lg font-semibold">Freigaben für mich</h1>
            <Button variant="secondary" size="icon" onClick={() => void sharedQuery.refetch()} aria-label="Freigaben aktualisieren">
              <RefreshCw size={14} />
            </Button>
          </div>

          <div className="space-y-2">
            {(sharedQuery.data ?? []).map((entry) => {
              const isActive = selectedShare?.share.id === entry.share.id;
              return (
                <button
                  key={entry.share.id}
                  type="button"
                  className={`w-full rounded-xl border px-3 py-2 text-left transition ${
                    isActive
                      ? 'border-cyan-300/40 bg-cyan-300/15 text-cyan-50'
                      : 'border-white/10 bg-black/20 hover:bg-white/10'
                  }`}
                  onClick={() => setSelectedShare(entry)}
                >
                  <p className="truncate text-sm font-medium">{entry.item.name}</p>
                  <p className="text-xs text-zinc-400">
                    {entry.item.type === 'folder' ? 'Ordner' : 'Datei'} · {accessLabel(entry.share.access)}
                  </p>
                </button>
              );
            })}

            {!sharedQuery.isLoading && (sharedQuery.data?.length ?? 0) === 0 ? (
              <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-6 text-sm text-zinc-400">
                Aktuell liegen keine internen Freigaben vor.
              </div>
            ) : null}
          </div>
        </aside>

        <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-white/10 bg-black/20">
          <header className="border-b border-white/10 px-4 py-3">
            <p className="text-sm text-zinc-300">{selectedHeader}</p>
          </header>

          <div className="min-h-0 flex-1 overflow-auto p-3">
            {!selectedShare ? (
              <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-8 text-sm text-zinc-400">
                Wählen Sie eine Freigabe aus, um Inhalte zu öffnen oder herunterzuladen.
              </div>
            ) : selectedShare.item.type === 'file' ? (
              <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                <p className="text-base font-medium">{selectedShare.item.name}</p>
                <p className="mt-1 text-sm text-zinc-400">Direkte Dateifreigabe</p>
                <div className="mt-4 flex items-center gap-2">
                  {isOnlyOfficeSupportedFileName(selectedShare.item.name) ? (
                    <Button
                      variant="secondary"
                      onClick={() => {
                        navigate(`/app/office/${selectedShare.item.id}`);
                      }}
                    >
                      In Office öffnen
                    </Button>
                  ) : null}
                  <Button
                    onClick={() => {
                      void api.files.download(selectedShare.item);
                    }}
                  >
                    <Download size={14} className="mr-1" /> Herunterladen
                  </Button>
                  {writable ? (
                    <Button
                      variant="secondary"
                      onClick={async () => {
                        const name = window.prompt('Neuer Name', selectedShare.item.name);
                        if (!name || name === selectedShare.item.name) return;
                        await updateMutation.mutateAsync({ nodeId: selectedShare.item.id, payload: { name } });
                      }}
                    >
                      Umbenennen
                    </Button>
                  ) : null}
                  {writable ? (
                    <Button
                      variant="destructive"
                      onClick={async () => {
                        if (!window.confirm(`${selectedShare.item.name} wirklich löschen?`)) return;
                        await deleteMutation.mutateAsync(selectedShare.item.id);
                        setSelectedShare(null);
                      }}
                    >
                      Löschen
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                  <div className="flex items-center gap-2 text-sm text-zinc-200">
                    <FolderOpen size={15} className="text-cyan-200" />
                    <span>{selectedShare.item.name}</span>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={pathIds.length <= 1}
                    onClick={() => {
                      setPathIds((prev) => prev.slice(0, -1));
                    }}
                  >
                    Zurück
                  </Button>
                </div>

                <FileList
                  files={folderItemsQuery.data ?? []}
                  sortKey={sortKey}
                  sortDirection={sortDirection}
                  onSortKeyChange={setSortKey}
                  onSortDirectionChange={setSortDirection}
                  viewMode={viewMode}
                  onViewModeChange={setViewMode}
                  onOpenFolder={(node) => {
                    if (node.type === 'folder') {
                      setPathIds((prev) => [...prev, node.id]);
                    }
                  }}
                  onDownload={(node) => {
                    void api.files.download(node);
                  }}
                  onOpenInOffice={(node) => navigate(`/app/office/${node.id}`)}
                  onRename={
                    writable
                      ? (node) => {
                          const name = window.prompt('Neuer Name', node.name);
                          if (!name || name === node.name) return;
                          void updateMutation.mutateAsync({ nodeId: node.id, payload: { name } });
                        }
                      : undefined
                  }
                  onDelete={
                    writable
                      ? (node) => {
                          if (!window.confirm(`${node.name} wirklich löschen?`)) return;
                          void deleteMutation.mutateAsync(node.id);
                        }
                      : undefined
                  }
                />
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
