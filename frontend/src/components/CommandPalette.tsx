import { useEffect, useMemo, useRef, useState } from 'react';

interface CommandPaletteProps {
  visible: boolean;
  onClose: () => void;
  commands: Array<{ id: string; title: string; run: () => void }>;
}

export function CommandPalette({ visible, onClose, commands }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!visible) return;
    setQuery('');
    setSelected(0);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [visible]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return commands;
    return commands.filter((item) => item.title.toLowerCase().includes(q));
  }, [commands, query]);

  if (!visible) return null;

  return (
    <div className="command-palette-overlay" onClick={onClose}>
      <div className="command-palette" onClick={(event) => event.stopPropagation()}>
        <input
          ref={inputRef}
          className="input"
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Befehl eingeben (Ctrl/Cmd+Shift+P)"
          style={{ width: '100%', borderRadius: 0, border: 'none', borderBottom: '1px solid var(--border)' }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setSelected((v) => Math.min(v + 1, Math.max(0, filtered.length - 1)));
              return;
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault();
              setSelected((v) => Math.max(0, v - 1));
              return;
            }
            if (event.key === 'Enter') {
              event.preventDefault();
              const cmd = filtered[selected] ?? filtered[0];
              if (!cmd) return;
              cmd.run();
              onClose();
              return;
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              onClose();
            }
          }}
        />
        <div style={{ maxHeight: 360, overflow: 'auto' }}>
          {filtered.map((cmd, idx) => (
            <button
              className={`command-item ${idx === selected ? 'active' : ''}`}
              key={cmd.id}
              onMouseEnter={() => setSelected(idx)}
              onClick={() => {
                cmd.run();
                onClose();
              }}
            >
              {cmd.title}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
