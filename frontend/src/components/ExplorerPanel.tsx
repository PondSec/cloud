import { FolderPlus, FilePlus, Pencil, RefreshCw, Save, Trash2, ArrowRightLeft } from 'lucide-react';
import { useMemo, useState } from 'react';

import type { FileNode } from '../lib/ide-types';

interface ExplorerPanelProps {
  files: FileNode[];
  currentPath: string;
  onOpenPath: (path: string) => void;
  onRefresh: () => void;
  onCreateFile: (relativePath: string) => void;
  onCreateFolder: (relativePath: string) => void;
  onSaveActive: () => void;
  onRenamePath: (path: string) => void;
  onMovePath: (path: string) => void;
  onDeletePath: (path: string) => void;
}

export function ExplorerPanel({
  files,
  currentPath,
  onOpenPath,
  onRefresh,
  onCreateFile,
  onCreateFolder,
  onSaveActive,
  onRenamePath,
  onMovePath,
  onDeletePath,
}: ExplorerPanelProps) {
  const [newName, setNewName] = useState('');

  const sorted = useMemo(() => {
    return [...files].sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'directory' ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
  }, [files]);

  const base = currentPath ? `${currentPath.replace(/\/$/, '')}/` : '';

  return (
    <div className="panel-content">
      <div className="row" style={{ marginBottom: 8 }}>
        <button className="btn" type="button" onClick={onRefresh} title="Refresh explorer">
          <RefreshCw size={14} />
        </button>
        <button className="btn" type="button" onClick={onSaveActive} title="Save active file">
          <Save size={14} />
        </button>
      </div>

      <div className="row" style={{ marginBottom: 8 }}>
        <input
          className="input"
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          placeholder="new file/folder"
          style={{ flex: 1 }}
        />
        <button
          className="btn"
          type="button"
          onClick={() => {
            if (!newName.trim()) return;
            onCreateFile(`${base}${newName.trim()}`);
            setNewName('');
          }}
          title="Create file"
        >
          <FilePlus size={14} />
        </button>
        <button
          className="btn"
          type="button"
          onClick={() => {
            if (!newName.trim()) return;
            onCreateFolder(`${base}${newName.trim()}`);
            setNewName('');
          }}
          title="Create folder"
        >
          <FolderPlus size={14} />
        </button>
      </div>

      {currentPath && (
        <button className="workspace-item" onClick={() => onOpenPath('')}>
          ..
        </button>
      )}

      {sorted.map((node) => (
        <div key={node.path} className="file-entry">
          <button
            type="button"
            onClick={() => {
              if (node.type === 'directory') {
                onOpenPath(node.path);
              } else {
                onOpenPath(node.path);
              }
            }}
          >
            {node.type === 'directory' ? `📁 ${node.name}` : `📄 ${node.name}`}
          </button>
          <div className="row">
            <button
              type="button"
              className="btn"
              aria-label={`Rename ${node.name}`}
              title={`Rename ${node.name}`}
              onClick={() => onRenamePath(node.path)}
            >
              <Pencil size={12} />
            </button>
            <button
              type="button"
              className="btn"
              aria-label={`Move ${node.name}`}
              title={`Move ${node.name}`}
              onClick={() => onMovePath(node.path)}
            >
              <ArrowRightLeft size={12} />
            </button>
            <button
              type="button"
              className="btn"
              aria-label={`Delete ${node.name}`}
              title={`Delete ${node.name}`}
              onClick={() => onDeletePath(node.path)}
            >
              <Trash2 size={12} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
