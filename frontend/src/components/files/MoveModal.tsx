import { useMemo, useState } from 'react';

import GlassSurface from '@/components/reactbits/GlassSurface';
import { Button } from '@/components/ui/button';
import type { FileNode, FolderTreeNode } from '@/types/api';

interface MoveModalProps {
  open: boolean;
  node: FileNode | null;
  tree: FolderTreeNode[];
  onClose: () => void;
  onConfirm: (parentId: number | null) => Promise<void>;
}

function flattenTree(nodes: FolderTreeNode[], depth = 0): Array<{ id: number; name: string; depth: number }> {
  const result: Array<{ id: number; name: string; depth: number }> = [];
  for (const node of nodes) {
    result.push({ id: node.id, name: node.name, depth });
    result.push(...flattenTree(node.children, depth + 1));
  }
  return result;
}

export function MoveModal({ open, node, tree, onClose, onConfirm }: MoveModalProps) {
  const [selectedParentId, setSelectedParentId] = useState<number | null>(null);

  const options = useMemo(() => flattenTree(tree), [tree]);

  if (!open || !node) {
    return null;
  }

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/45 p-4">
      <GlassSurface width={560} height="auto" borderRadius={20} className="w-full max-w-xl border border-white/20">
        <div className="w-full space-y-4 p-5">
          <h3 className="text-lg font-semibold">Move “{node.name}”</h3>
          <p className="text-sm text-zinc-300">Choose a destination folder.</p>

          <div className="max-h-64 space-y-1 overflow-auto rounded-xl border border-white/15 bg-black/20 p-2">
            <button
              type="button"
              className={`block w-full rounded-lg px-2 py-1.5 text-left text-sm ${
                selectedParentId === null ? 'bg-cyan-300/20 text-cyan-100' : 'hover:bg-white/10'
              }`}
              onClick={() => setSelectedParentId(null)}
            >
              Root
            </button>

            {options.map((option) => (
              <button
                key={option.id}
                type="button"
                className={`block w-full rounded-lg px-2 py-1.5 text-left text-sm ${
                  selectedParentId === option.id ? 'bg-cyan-300/20 text-cyan-100' : 'hover:bg-white/10'
                }`}
                style={{ paddingLeft: `${option.depth * 16 + 8}px` }}
                onClick={() => setSelectedParentId(option.id)}
              >
                {option.name}
              </button>
            ))}
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button
              onClick={async () => {
                await onConfirm(selectedParentId);
                onClose();
              }}
            >
              Move
            </Button>
          </div>
        </div>
      </GlassSurface>
    </div>
  );
}
