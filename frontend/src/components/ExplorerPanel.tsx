import { FolderPlus, FilePlus, RefreshCw, Save } from 'lucide-react';
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
}

export function ExplorerPanel({
  files,
  currentPath,
  onOpenPath,
  onRefresh,
  onCreateFile,
  onCreateFolder,
  onSaveActive,
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
        </div>
      ))}
    </div>
  );
}
