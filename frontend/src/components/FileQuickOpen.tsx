import { useEffect, useMemo, useRef, useState } from 'react';

import { ideApi } from '../lib/ide-api';

type Item = { id: string; title: string; subtitle?: string; run: () => void };

interface FileQuickOpenProps {
  visible: boolean;
  workspaceId: string;
  recentFiles: string[];
  onClose: () => void;
  onOpenPath: (path: string) => void;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function FileQuickOpen({ visible, workspaceId, recentFiles, onClose, onOpenPath }: FileQuickOpenProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [remoteItems, setRemoteItems] = useState<string[]>([]);
  const [selected, setSelected] = useState(0);
  const requestIdRef = useRef(0);

  const items: Item[] = useMemo(() => {
    const q = query.trim();
    if (!q) {
      return recentFiles.slice(0, 30).map((p) => ({
        id: `recent:${p}`,
        title: p.split('/').at(-1) || p,
        subtitle: p,
        run: () => onOpenPath(p),
      }));
    }
    return remoteItems.map((p) => ({
      id: `file:${p}`,
      title: p.split('/').at(-1) || p,
      subtitle: p,
      run: () => onOpenPath(p),
    }));
  }, [query, recentFiles, remoteItems, onOpenPath]);

  useEffect(() => {
    if (!visible) return;
    setQuery('');
    setLoading(false);
    setError('');
    setRemoteItems([]);
    setSelected(0);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const q = query.trim();
    if (!q) {
      setRemoteItems([]);
      setLoading(false);
      setError('');
      setSelected(0);
      return;
    }

    const currentRequestId = ++requestIdRef.current;
    setLoading(true);
    setError('');

    const timer = window.setTimeout(() => {
      void ideApi.search
        .files(workspaceId, q, 200)
        .then((paths) => {
          if (requestIdRef.current !== currentRequestId) return;
          setRemoteItems(paths);
          setLoading(false);
          setSelected(0);
        })
        .catch((e: any) => {
          if (requestIdRef.current !== currentRequestId) return;
          setRemoteItems([]);
          setLoading(false);
          setSelected(0);
          setError(e?.response?.data?.error || e?.message || 'Dateisuche fehlgeschlagen');
        });
    }, 120);

    return () => window.clearTimeout(timer);
  }, [visible, workspaceId, query]);

  if (!visible) return null;

  const commitSelection = (idx: number) => {
    const item = items[idx];
    if (!item) return;
    item.run();
    onClose();
  };

  return (
    <div
      className="command-palette-overlay"
      onClick={() => onClose()}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <div className="command-palette" onClick={(event) => event.stopPropagation()}>
        <input
          ref={inputRef}
          className="input"
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Datei öffnen (Ctrl/Cmd+P)"
          style={{ width: '100%', borderRadius: 0, border: 'none', borderBottom: '1px solid var(--border)' }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setSelected((v) => clamp(v + 1, 0, Math.max(0, items.length - 1)));
              return;
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault();
              setSelected((v) => clamp(v - 1, 0, Math.max(0, items.length - 1)));
              return;
            }
            if (event.key === 'Enter') {
              event.preventDefault();
              commitSelection(selected);
              return;
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              onClose();
            }
          }}
        />
        <div style={{ maxHeight: 360, overflow: 'auto' }}>
          {loading ? (
            <div className="palette-hint">Suche…</div>
          ) : error ? (
            <div className="palette-hint palette-hint-error">{error}</div>
          ) : !items.length ? (
            <div className="palette-hint">{query.trim() ? 'Keine Dateien gefunden.' : 'Zuletzt geöffnet:'}</div>
          ) : null}

          {items.map((item, idx) => (
            <button
              className={`command-item palette-item ${idx === selected ? 'active' : ''}`}
              key={item.id}
              onMouseEnter={() => setSelected(idx)}
              onClick={() => commitSelection(idx)}
            >
              <div className="palette-item-title">{item.title}</div>
              {item.subtitle ? <div className="palette-item-subtitle">{item.subtitle}</div> : null}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

