import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FolderOpen, Pencil, Play, Plus, Square, Trash2 } from 'lucide-react';

import { ideApi } from '../lib/ide-api';
import { clearIdeToken } from '../lib/ide-auth';
import type { Workspace } from '../lib/ide-types';

type RuntimeState = Record<string, { running: boolean; loading: boolean }>;
const MAX_AUTO_RETRIES = 12;

function shouldRetryWorkspaceLoad(error: any): boolean {
  const status = error?.response?.status;
  return !status || status === 429 || status >= 500;
}

export function WorkspacesPage() {
  const navigate = useNavigate();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [name, setName] = useState('my-workspace');
  const [template, setTemplate] = useState('node-ts');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [runtime, setRuntime] = useState<RuntimeState>({});
  const retryTimerRef = useRef<number | null>(null);

  function clearRetryTimer(): void {
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }

  async function refresh(options: { autoRetry?: boolean; attempt?: number } = {}): Promise<void> {
    const attempt = options.attempt ?? 0;
    clearRetryTimer();

    try {
      const list = await ideApi.workspace.list();
      setWorkspaces(list);
      setError('');
      for (const workspace of list.slice(0, 24)) {
        if (!runtime[workspace.id]) {
          void refreshRuntime(workspace.id);
        }
      }
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 401) {
        setError(err?.response?.data?.error || 'IDE session expired');
        clearIdeToken();
        navigate('/dev/workspaces', { replace: true });
        return;
      }

      if (options.autoRetry && shouldRetryWorkspaceLoad(err) && attempt < MAX_AUTO_RETRIES) {
        const delayMs = Math.min(8000, 500 * 2 ** attempt);
        setError('IDE API is starting... retrying automatically.');
        retryTimerRef.current = window.setTimeout(() => {
          void refresh({ autoRetry: true, attempt: attempt + 1 });
        }, delayMs);
        return;
      }

      setError(err?.response?.data?.error || 'Failed to load workspaces');
    }
  }

  async function refreshRuntime(workspaceId: string): Promise<void> {
    setRuntime((prev) => ({ ...prev, [workspaceId]: { running: prev[workspaceId]?.running ?? false, loading: true } }));
    try {
      const details = await ideApi.workspace.details(workspaceId);
      setRuntime((prev) => ({ ...prev, [workspaceId]: { running: details.runtime.running, loading: false } }));
    } catch {
      setRuntime((prev) => ({ ...prev, [workspaceId]: { running: false, loading: false } }));
    }
  }

  useEffect(() => {
    void refresh({ autoRetry: true, attempt: 0 });
    return () => {
      clearRetryTimer();
    };
  }, []);

  const sorted = useMemo(
    () => [...workspaces].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    [workspaces],
  );

  return (
    <div className="ide-root">
      <main className="workspace-page">
        <section className="card ide-workspaces-card">
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
            <h2 style={{ margin: 0 }}>Workspace Hub</h2>
            <Link to="/app/files" className="btn">
              Zur Cloud
            </Link>
          </div>
          <p style={{ color: '#a9a9a9', marginTop: 0 }}>Erstellen, starten, umbenennen, löschen und öffnen.</p>

          <div className="row" style={{ marginBottom: 12 }}>
            <input
              className="input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Workspace Name"
              style={{ flex: 1 }}
            />
            <select className="select" value={template} onChange={(event) => setTemplate(event.target.value)}>
              <option value="node-ts">Node / TS</option>
              <option value="python">Python</option>
              <option value="c">C</option>
              <option value="web">HTML/CSS/JS</option>
            </select>
            <button
              className="btn primary"
              disabled={busy}
              onClick={async () => {
                if (!name.trim()) return;
                setBusy(true);
                try {
                  const workspace = await ideApi.workspace.create(name.trim(), template);
                  setName('my-workspace');
                  await refresh();
                  navigate(`/dev/ide/${workspace.id}`);
                } catch (err: any) {
                  setError(err.response?.data?.error || 'Failed to create workspace');
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Plus size={14} /> Create
            </button>
          </div>

          <div className="workspace-list ide-workspace-grid">
            {sorted.map((workspace) => {
              const runtimeInfo = runtime[workspace.id];
              const running = runtimeInfo?.running ?? false;
              const runtimeLoading = runtimeInfo?.loading ?? false;
              return (
                <article key={workspace.id} className="workspace-item ide-workspace-item">
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <div style={{ fontWeight: 700 }}>{workspace.name}</div>
                    <span className={`ide-badge ${running ? 'ide-badge-running' : 'ide-badge-stopped'}`}>
                      {runtimeLoading ? 'checking...' : running ? 'running' : 'stopped'}
                    </span>
                  </div>
                  <div style={{ color: '#a9a9a9', fontSize: 12, marginBottom: 8 }}>
                    {workspace.template} · {new Date(workspace.updatedAt).toLocaleString()}
                  </div>
                  <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                    <button className="btn" onClick={() => navigate(`/dev/ide/${workspace.id}`)}>
                      <FolderOpen size={13} /> Open
                    </button>
                    <button
                      className="btn"
                      onClick={async () => {
                        const next = window.prompt('New workspace name', workspace.name);
                        if (!next || next === workspace.name) return;
                        try {
                          await ideApi.workspace.rename(workspace.id, next.trim());
                          await refresh();
                        } catch (err: any) {
                          setError(err.response?.data?.error || 'Rename failed');
                        }
                      }}
                    >
                      <Pencil size={13} /> Rename
                    </button>
                    <button
                      className="btn"
                      onClick={async () => {
                        try {
                          if (running) {
                            await ideApi.workspace.stop(workspace.id);
                          } else {
                            await ideApi.workspace.start(workspace.id);
                          }
                          await refreshRuntime(workspace.id);
                        } catch (err: any) {
                          setError(err.response?.data?.error || (running ? 'Stop failed' : 'Start failed'));
                        }
                      }}
                    >
                      {running ? <Square size={13} /> : <Play size={13} />} {running ? 'Stop' : 'Start'}
                    </button>
                    <button
                      className="btn danger"
                      onClick={async () => {
                        if (!window.confirm(`Workspace '${workspace.name}' wirklich löschen?`)) return;
                        try {
                          await ideApi.workspace.delete(workspace.id);
                          await refresh();
                        } catch (err: any) {
                          setError(err.response?.data?.error || 'Delete failed');
                        }
                      }}
                    >
                      <Trash2 size={13} /> Delete
                    </button>
                  </div>
                </article>
              );
            })}
          </div>

          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn" onClick={() => void refresh()}>
              Refresh
            </button>
            <button
              className="btn"
              onClick={() => {
                clearIdeToken();
                void refresh();
              }}
            >
              Reset IDE Session
            </button>
          </div>

          {error && <p style={{ color: '#ff7b7b' }}>{error}</p>}
        </section>
      </main>
    </div>
  );
}
