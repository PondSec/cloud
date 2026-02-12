import { ChevronRight, Folder, MoveRight, Pencil, Trash2 } from 'lucide-react';

import GradualBlur from '@/components/reactbits/GradualBlur';
import type { FolderTreeNode } from '@/types/api';
import { cn } from '@/lib/utils';

interface FolderTreeProps {
  tree: FolderTreeNode[];
  currentParentId: number | null;
  onSelect: (id: number | null) => void;
  onRenameFolder?: (node: FolderTreeNode) => void;
  onMoveFolder?: (node: FolderTreeNode) => void;
  onDeleteFolder?: (node: FolderTreeNode) => void;
}

function TreeItem({
  node,
  depth,
  currentParentId,
  onSelect,
  onRenameFolder,
  onMoveFolder,
  onDeleteFolder,
}: {
  node: FolderTreeNode;
  depth: number;
  currentParentId: number | null;
  onSelect: (id: number | null) => void;
  onRenameFolder?: (node: FolderTreeNode) => void;
  onMoveFolder?: (node: FolderTreeNode) => void;
  onDeleteFolder?: (node: FolderTreeNode) => void;
}) {
  const isActive = currentParentId === node.id;

  return (
    <li>
      <div
        className={cn(
          'group flex w-full items-center gap-1 rounded-xl px-1 py-1 text-left text-sm transition hover:bg-white/10',
          isActive && 'bg-cyan-300/20 text-cyan-100',
        )}
      >
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          onClick={() => onSelect(node.id)}
          aria-label={`Open folder ${node.name}`}
        >
          <ChevronRight size={14} className="opacity-60" />
          <Folder size={14} className="text-cyan-200" />
          <span className="truncate">{node.name}</span>
        </button>

        <div className="mr-1 flex items-center gap-1 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
          {onRenameFolder ? (
            <button
              type="button"
              className="rounded-md p-1 text-zinc-300 hover:bg-white/15 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
              aria-label={`Rename folder ${node.name}`}
              onClick={(event) => {
                event.stopPropagation();
                onRenameFolder(node);
              }}
            >
              <Pencil size={13} />
            </button>
          ) : null}
          {onMoveFolder ? (
            <button
              type="button"
              className="rounded-md p-1 text-zinc-300 hover:bg-white/15 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
              aria-label={`Move folder ${node.name}`}
              onClick={(event) => {
                event.stopPropagation();
                onMoveFolder(node);
              }}
            >
              <MoveRight size={13} />
            </button>
          ) : null}
          {onDeleteFolder ? (
            <button
              type="button"
              className="rounded-md p-1 text-zinc-300 hover:bg-rose-500/20 hover:text-rose-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300"
              aria-label={`Delete folder ${node.name}`}
              onClick={(event) => {
                event.stopPropagation();
                onDeleteFolder(node);
              }}
            >
              <Trash2 size={13} />
            </button>
          ) : null}
        </div>
      </div>

      {node.children.length > 0 ? (
        <ul className="space-y-1">
          {node.children.map((child) => (
            <TreeItem
              key={child.id}
              node={child}
              depth={depth + 1}
              currentParentId={currentParentId}
              onSelect={onSelect}
              onRenameFolder={onRenameFolder}
              onMoveFolder={onMoveFolder}
              onDeleteFolder={onDeleteFolder}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function FolderTree({
  tree,
  currentParentId,
  onSelect,
  onRenameFolder,
  onMoveFolder,
  onDeleteFolder,
}: FolderTreeProps) {
  return (
    <section className="relative flex h-full flex-col overflow-hidden">
      <div className="border-b border-white/10 px-3 py-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-300">Folders</h2>
      </div>

      <div className="relative flex-1 overflow-auto px-2 py-2">
        <ul className="space-y-1 pb-20">
          <li>
            <button
              type="button"
              className={cn(
                'w-full rounded-xl px-2 py-1.5 text-left text-sm transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300',
                currentParentId === null && 'bg-cyan-300/20 text-cyan-100',
              )}
              onClick={() => onSelect(null)}
            >
              Root
            </button>
          </li>
          {tree.map((node) => (
            <TreeItem
              key={node.id}
              node={node}
              depth={0}
              currentParentId={currentParentId}
              onSelect={onSelect}
              onRenameFolder={onRenameFolder}
              onMoveFolder={onMoveFolder}
              onDeleteFolder={onDeleteFolder}
            />
          ))}
        </ul>
        <GradualBlur target="parent" position="bottom" height="5rem" strength={2} divCount={5} curve="bezier" />
      </div>
    </section>
  );
}
