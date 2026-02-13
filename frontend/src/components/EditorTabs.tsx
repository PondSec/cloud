import type { OpenFile } from '../state/ide-store';

interface EditorTabsProps {
  files: OpenFile[];
  activePath: string | null;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
}

export function EditorTabs({ files, activePath, onSelect, onClose }: EditorTabsProps) {
  return (
    <div className="tabs" role="tablist" aria-label="Geöffnete Dateireiter">
      {files.map((file) => (
        <div
          key={file.path}
          className={`tab ${file.path === activePath ? 'active' : ''}`}
          role="tab"
          aria-selected={file.path === activePath}
          onClick={() => onSelect(file.path)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              onSelect(file.path);
            }
          }}
          tabIndex={0}
        >
          <span>{file.path.split('/').at(-1)}</span>
          {file.dirty && <span className="dirty" aria-label="Ungespeicherte Änderungen" />}
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onClose(file.path);
            }}
            aria-label={`${file.path} schließen`}
            style={{ border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer' }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
