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
        <button className="btn" type="button" onClick={onRefresh} title="Explorer aktualisieren">
          <RefreshCw size={14} />
        </button>
        <button className="btn" type="button" onClick={onSaveActive} title="Aktive Datei speichern">
          <Save size={14} />
        </button>
      </div>

      <div className="row" style={{ marginBottom: 8 }}>
        <input
          className="input"
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          placeholder="Neuer Datei-/Ordnername"
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
          title="Datei erstellen"
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
          title="Ordner erstellen"
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
              aria-label={`${node.name} umbenennen`}
              title={`${node.name} umbenennen`}
              onClick={() => onRenamePath(node.path)}
            >
              <Pencil size={12} />
            </button>
            <button
              type="button"
              className="btn"
              aria-label={`${node.name} verschieben`}
              title={`${node.name} verschieben`}
              onClick={() => onMovePath(node.path)}
            >
              <ArrowRightLeft size={12} />
            </button>
            <button
              type="button"
              className="btn"
              aria-label={`${node.name} löschen`}
              title={`${node.name} löschen`}
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
