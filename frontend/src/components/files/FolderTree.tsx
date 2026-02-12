import { ChevronRight, Folder } from 'lucide-react';

import GradualBlur from '@/components/reactbits/GradualBlur';
import type { FolderTreeNode } from '@/types/api';
import { cn } from '@/lib/utils';

interface FolderTreeProps {
  tree: FolderTreeNode[];
  currentParentId: number | null;
  onSelect: (id: number | null) => void;
}

function TreeItem({
  node,
  depth,
  currentParentId,
  onSelect,
}: {
  node: FolderTreeNode;
  depth: number;
  currentParentId: number | null;
  onSelect: (id: number | null) => void;
}) {
  const isActive = currentParentId === node.id;

  return (
    <li>
      <button
        type="button"
        className={cn(
          'group flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left text-sm transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300',
          isActive && 'bg-cyan-300/20 text-cyan-100',
        )}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => onSelect(node.id)}
        aria-label={`Open folder ${node.name}`}
      >
        <ChevronRight size={14} className="opacity-60" />
        <Folder size={14} className="text-cyan-200" />
        <span className="truncate">{node.name}</span>
      </button>

      {node.children.length > 0 ? (
        <ul className="space-y-1">
          {node.children.map((child) => (
            <TreeItem
              key={child.id}
              node={child}
              depth={depth + 1}
              currentParentId={currentParentId}
              onSelect={onSelect}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function FolderTree({ tree, currentParentId, onSelect }: FolderTreeProps) {
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
            />
          ))}
        </ul>
        <GradualBlur target="parent" position="bottom" height="5rem" strength={2} divCount={5} curve="bezier" />
      </div>
    </section>
  );
}
