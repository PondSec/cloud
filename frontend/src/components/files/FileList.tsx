import { File as FileIcon, Folder, Download, Pencil, MoveRight, Trash2, Grid3X3, List } from 'lucide-react';
import { useMemo } from 'react';

import { Button } from '@/components/ui/button';
import type { FileNode } from '@/types/api';
import { cn, formatBytes, formatDate } from '@/lib/utils';

export type SortKey = 'name' | 'updated_at' | 'size';
export type SortDirection = 'asc' | 'desc';
export type ViewMode = 'list' | 'grid';

interface FileListProps {
  files: FileNode[];
  sortKey: SortKey;
  sortDirection: SortDirection;
  onSortKeyChange: (value: SortKey) => void;
  onSortDirectionChange: (value: SortDirection) => void;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  onOpenFolder?: (node: FileNode) => void;
  onRename?: (node: FileNode) => void;
  onMove?: (node: FileNode) => void;
  onDelete?: (node: FileNode) => void;
  onDownload?: (node: FileNode) => void;
}

function compareValues(a: FileNode, b: FileNode, key: SortKey): number {
  if (key === 'size') {
    return a.size - b.size;
  }
  if (key === 'updated_at') {
    return new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime();
  }
  return a.name.localeCompare(b.name);
}

export function FileList({
  files,
  sortKey,
  sortDirection,
  onSortKeyChange,
  onSortDirectionChange,
  viewMode,
  onViewModeChange,
  onOpenFolder,
  onRename,
  onMove,
  onDelete,
  onDownload,
}: FileListProps) {
  const sorted = useMemo(() => {
    const cloned = [...files];
    cloned.sort((a, b) => {
      const folderBias = a.type === b.type ? 0 : a.type === 'folder' ? -1 : 1;
      if (folderBias !== 0) {
        return folderBias;
      }
      const result = compareValues(a, b, sortKey);
      return sortDirection === 'asc' ? result : -result;
    });
    return cloned;
  }, [files, sortKey, sortDirection]);

  const renderActions = (node: FileNode) => (
    <div className="flex items-center justify-end gap-1">
      {onDownload && node.type === 'file' ? (
        <Button variant="ghost" size="icon" onClick={() => onDownload(node)} aria-label={`Download ${node.name}`}>
          <Download size={15} />
        </Button>
      ) : null}
      {onRename ? (
        <Button variant="ghost" size="icon" onClick={() => onRename(node)} aria-label={`Rename ${node.name}`}>
          <Pencil size={15} />
        </Button>
      ) : null}
      {onMove ? (
        <Button variant="ghost" size="icon" onClick={() => onMove(node)} aria-label={`Move ${node.name}`}>
          <MoveRight size={15} />
        </Button>
      ) : null}
      {onDelete ? (
        <Button variant="ghost" size="icon" onClick={() => onDelete(node)} aria-label={`Delete ${node.name}`}>
          <Trash2 size={15} />
        </Button>
      ) : null}
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-black/20 p-2">
        <div className="flex items-center gap-2 text-sm">
          <label htmlFor="sort-key" className="text-zinc-300">
            Sort
          </label>
          <select
            id="sort-key"
            value={sortKey}
            onChange={(event) => onSortKeyChange(event.target.value as SortKey)}
            className="rounded-lg border border-white/15 bg-black/20 px-2 py-1 text-zinc-100"
          >
            <option value="name">Name</option>
            <option value="updated_at">Date</option>
            <option value="size">Size</option>
          </select>
          <select
            value={sortDirection}
            onChange={(event) => onSortDirectionChange(event.target.value as SortDirection)}
            className="rounded-lg border border-white/15 bg-black/20 px-2 py-1 text-zinc-100"
            aria-label="Sort direction"
          >
            <option value="asc">Ascending</option>
            <option value="desc">Descending</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant={viewMode === 'list' ? 'default' : 'secondary'}
            size="sm"
            onClick={() => onViewModeChange('list')}
            aria-label="List view"
          >
            <List size={15} />
          </Button>
          <Button
            variant={viewMode === 'grid' ? 'default' : 'secondary'}
            size="sm"
            onClick={() => onViewModeChange('grid')}
            aria-label="Grid view"
          >
            <Grid3X3 size={15} />
          </Button>
        </div>
      </div>

      {viewMode === 'list' ? (
        <div className="overflow-x-auto rounded-xl border border-white/10 bg-black/20">
          <table className="min-w-full text-sm">
            <thead className="bg-white/5 text-zinc-300">
              <tr>
                <th className="px-3 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-left">Updated</th>
                <th className="px-3 py-2 text-left">Size</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((node) => (
                <tr
                  key={node.id}
                  tabIndex={0}
                  className="border-t border-white/10 text-zinc-100 hover:bg-white/5 focus-visible:bg-white/10 focus-visible:outline-none"
                  onDoubleClick={() => {
                    if (node.type === 'folder' && onOpenFolder) {
                      onOpenFolder(node);
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && node.type === 'folder' && onOpenFolder) {
                      onOpenFolder(node);
                    }
                  }}
                >
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      className={cn('flex items-center gap-2 rounded-md px-1 py-1 text-left', node.type === 'folder' && 'hover:text-cyan-200')}
                      onClick={() => {
                        if (node.type === 'folder' && onOpenFolder) {
                          onOpenFolder(node);
                        }
                      }}
                    >
                      {node.type === 'folder' ? (
                        <Folder size={16} className="text-cyan-200" />
                      ) : (
                        <FileIcon size={16} className="text-zinc-300" />
                      )}
                      <span className="max-w-[300px] truncate">{node.name}</span>
                    </button>
                  </td>
                  <td className="px-3 py-2 text-zinc-300">{formatDate(node.updated_at)}</td>
                  <td className="px-3 py-2 text-zinc-300">{node.type === 'folder' ? '—' : formatBytes(node.size)}</td>
                  <td className="px-3 py-2">{renderActions(node)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {sorted.map((node) => (
            <div
              key={node.id}
              className="rounded-xl border border-white/10 bg-black/20 p-3 transition hover:bg-white/5"
              tabIndex={0}
              onDoubleClick={() => {
                if (node.type === 'folder' && onOpenFolder) {
                  onOpenFolder(node);
                }
              }}
            >
              <button
                type="button"
                className="mb-3 flex items-center gap-2 text-left"
                onClick={() => {
                  if (node.type === 'folder' && onOpenFolder) {
                    onOpenFolder(node);
                  }
                }}
              >
                {node.type === 'folder' ? (
                  <Folder size={18} className="text-cyan-200" />
                ) : (
                  <FileIcon size={18} className="text-zinc-300" />
                )}
                <span className="truncate text-sm font-medium">{node.name}</span>
              </button>
              <p className="text-xs text-zinc-400">{formatDate(node.updated_at)}</p>
              <p className="text-xs text-zinc-400">{node.type === 'folder' ? 'Folder' : formatBytes(node.size)}</p>
              <div className="mt-2">{renderActions(node)}</div>
            </div>
          ))}
        </div>
      )}

      {sorted.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-10 text-center text-sm text-zinc-400">
          No files found.
        </div>
      ) : null}
    </div>
  );
}
