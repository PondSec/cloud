import { useEffect, useMemo, useRef, useState } from 'react';

import { ideApi } from '../lib/ide-api';

export type WorkspaceSearchMatch = {
  path: string;
  line: number;
  column: number;
  preview: string;
  match: string;
};

interface SearchPanelProps {
  workspaceId: string;
  onOpenMatch: (path: string, line: number, column: number) => void;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function SearchPanel({ workspaceId, onOpenMatch }: SearchPanelProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState('');
  const [includeGlobs, setIncludeGlobs] = useState('');
  const [excludeGlobs, setExcludeGlobs] = useState('');
  const [isRegex, setIsRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [truncated, setTruncated] = useState(false);
  const [results, setResults] = useState<WorkspaceSearchMatch[]>([]);
  const requestIdRef = useRef(0);

  useEffect(() => {
    // Focus on mount to match typical IDE UX (Ctrl+Shift+F).
    inputRef.current?.focus();
  }, []);

  const grouped = useMemo(() => {
    const map = new Map<string, WorkspaceSearchMatch[]>();
    for (const item of results) {
      const arr = map.get(item.path) ?? [];
      arr.push(item);
      map.set(item.path, arr);
    }
    const entries = Array.from(map.entries());
    entries.sort((a, b) => a[0].localeCompare(b[0]));
    for (const [, arr] of entries) {
      arr.sort((a, b) => (a.line !== b.line ? a.line - b.line : a.column - b.column));
    }
    return entries;
  }, [results]);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      setError('');
      setTruncated(false);
      setLoading(false);
      return;
    }

    const currentRequestId = ++requestIdRef.current;
    setLoading(true);
    setError('');

    const timer = window.setTimeout(() => {
      void ideApi.search
        .text({
          workspaceId,
          query: q,
          isRegex,
          caseSensitive,
          wholeWord,
          include: includeGlobs,
          exclude: excludeGlobs,
          maxResults: 500,
        })
        .then((data) => {
          if (requestIdRef.current !== currentRequestId) return;
          setResults(data.items);
          setTruncated(Boolean(data.truncated));
          setLoading(false);
        })
        .catch((e: any) => {
          if (requestIdRef.current !== currentRequestId) return;
          setLoading(false);
          setResults([]);
          setTruncated(false);
          setError(e?.response?.data?.error || e?.message || 'Suche fehlgeschlagen');
        });
    }, 240);

    return () => window.clearTimeout(timer);
  }, [workspaceId, query, includeGlobs, excludeGlobs, isRegex, caseSensitive, wholeWord]);

  return (
    <div className="panel-content">
      <div className="row" style={{ marginBottom: 8 }}>
        <input
          ref={inputRef}
          className="input"
          placeholder="In Dateien suchen (Workspace)"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          style={{ flex: 1, minWidth: 180 }}
        />
        <button className={`btn ${isRegex ? 'active' : ''}`} type="button" onClick={() => setIsRegex((v) => !v)} title="Regex">
          .*
        </button>
        <button
          className={`btn ${caseSensitive ? 'active' : ''}`}
          type="button"
          onClick={() => setCaseSensitive((v) => !v)}
          title="Groß-/Kleinschreibung"
        >
          Aa
        </button>
        <button
          className={`btn ${wholeWord ? 'active' : ''}`}
          type="button"
          onClick={() => setWholeWord((v) => !v)}
          title="Ganzes Wort"
        >
          W
        </button>
      </div>

      <div className="row" style={{ marginBottom: 8 }}>
        <input
          className="input"
          placeholder="Include (z.B. src/**, *.ts)"
          value={includeGlobs}
          onChange={(event) => setIncludeGlobs(event.target.value)}
          style={{ flex: 1, minWidth: 160 }}
        />
        <input
          className="input"
          placeholder="Exclude (z.B. **/*.min.js)"
          value={excludeGlobs}
          onChange={(event) => setExcludeGlobs(event.target.value)}
          style={{ flex: 1, minWidth: 160 }}
        />
      </div>

      <div style={{ fontSize: 12, color: '#9f9f9f', marginBottom: 8 }}>
        {loading ? 'Suche…' : null}
        {!loading && query.trim() ? `${results.length} Treffer${truncated ? ' (abgeschnitten)' : ''}` : null}
        {error ? <span style={{ color: '#ffb6c8' }}> · {error}</span> : null}
      </div>

      {!query.trim() ? (
        <div style={{ color: '#9f9f9f', fontSize: 12 }}>
          Tipp: <code>Ctrl/Cmd+Shift+F</code> für Workspace-Suche.
        </div>
      ) : null}

      {grouped.map(([file, hits]) => (
        <div key={file} style={{ marginBottom: 10 }}>
          <div className="search-file">{file}</div>
          <div className="search-hits">
            {hits.slice(0, 50).map((hit, idx) => {
              const start = clamp(hit.column - 1, 0, hit.preview.length);
              const end = clamp(start + (hit.match?.length || 0), start, hit.preview.length);
              const before = hit.preview.slice(0, start);
              const mid = hit.preview.slice(start, end);
              const after = hit.preview.slice(end);
              return (
                <button
                  key={`${hit.path}:${hit.line}:${hit.column}:${idx}`}
                  type="button"
                  className="search-hit"
                  onClick={() => onOpenMatch(hit.path, hit.line, hit.column)}
                  title={`${hit.path}:${hit.line}:${hit.column}`}
                >
                  <span className="search-hit-loc">
                    {hit.line}:{hit.column}
                  </span>
                  <span className="search-hit-line">
                    {before}
                    {mid ? <span className="search-hit-match">{mid}</span> : null}
                    {after}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

