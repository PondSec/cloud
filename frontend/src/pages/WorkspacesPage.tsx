import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { ideApi } from '../lib/ide-api';
import { clearIdeToken } from '../lib/ide-auth';
import type { Workspace } from '../lib/ide-types';

export function WorkspacesPage() {
  const navigate = useNavigate();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [name, setName] = useState('my-workspace');
  const [template, setTemplate] = useState('node-ts');
  const [error, setError] = useState('');

  async function refresh(): Promise<void> {
    try {
      const list = await ideApi.workspace.list();
      setWorkspaces(list);
      setError('');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load workspaces');
      if (err.response?.status === 401) {
        clearIdeToken();
        navigate('/dev/workspaces', { replace: true });
      }
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <div className="ide-root">
      <main className="workspace-page">
        <section className="card">
          <h2 style={{ marginTop: 0 }}>Workspaces</h2>

          <div className="row" style={{ marginBottom: 8 }}>
            <input className="input" value={name} onChange={(event) => setName(event.target.value)} style={{ flex: 1 }} />
            <select className="select" value={template} onChange={(event) => setTemplate(event.target.value)}>
              <option value="node-ts">Node / TS</option>
              <option value="python">Python</option>
              <option value="c">C</option>
              <option value="web">HTML/CSS/JS</option>
            </select>
            <button
              className="btn primary"
              onClick={async () => {
                try {
                  const workspace = await ideApi.workspace.create(name, template);
                  await refresh();
                  navigate(`/dev/ide/${workspace.id}`);
                } catch (err: any) {
                  setError(err.response?.data?.error || 'Failed to create workspace');
                }
              }}
            >
              Create
            </button>
          </div>

          <div className="workspace-list">
            {workspaces.map((workspace) => (
              <button className="workspace-item" key={workspace.id} onClick={() => navigate(`/dev/ide/${workspace.id}`)}>
                <div style={{ fontWeight: 600 }}>{workspace.name}</div>
                <div style={{ color: '#a9a9a9', fontSize: 12 }}>
                  {workspace.template} · {new Date(workspace.updatedAt).toLocaleString()}
                </div>
              </button>
            ))}
          </div>

          <div className="row" style={{ marginTop: 8 }}>
            <button
              className="btn"
              onClick={() => {
                clearIdeToken();
                navigate('/dev/workspaces', { replace: true });
              }}
            >
              Reset IDE Session
            </button>
            <button className="btn" onClick={() => void refresh()}>
              Refresh
            </button>
          </div>

          {error && <p style={{ color: '#ff7b7b' }}>{error}</p>}
        </section>
      </main>
    </div>
  );
}
