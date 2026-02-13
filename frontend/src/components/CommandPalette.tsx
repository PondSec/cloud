import { useMemo, useState } from 'react';

interface CommandPaletteProps {
  visible: boolean;
  onClose: () => void;
  commands: Array<{ id: string; title: string; run: () => void }>;
}

export function CommandPalette({ visible, onClose, commands }: CommandPaletteProps) {
  const [query, setQuery] = useState('');

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
          className="input"
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Befehl eingeben"
          style={{ width: '100%', borderRadius: 0, border: 'none', borderBottom: '1px solid var(--border)' }}
        />
        <div style={{ maxHeight: 360, overflow: 'auto' }}>
          {filtered.map((cmd) => (
            <button
              className="command-item"
              key={cmd.id}
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
