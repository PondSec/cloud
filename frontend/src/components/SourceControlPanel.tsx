import { useState } from 'react';

interface SourceControlPanelProps {
  statusOutput: string;
  diffOutput: string;
  onRefresh: () => void;
  onInitRepo: () => void;
  onCloneRepo: (url: string, branch?: string) => void;
  onStage: (path: string) => void;
  onUnstage: (path: string) => void;
  onCommit: (message: string) => void;
  onPull: () => void;
  onPush: () => void;
}

export function SourceControlPanel(props: SourceControlPanelProps) {
  const [cloneUrl, setCloneUrl] = useState('');
  const [cloneBranch, setCloneBranch] = useState('');
  const [stagePath, setStagePath] = useState('');
  const [commitMessage, setCommitMessage] = useState('');

  return (
    <div className="panel-content">
      <div className="row" style={{ marginBottom: 8 }}>
        <button className="btn" onClick={props.onInitRepo}>
          Initialisieren
        </button>
        <button className="btn" onClick={props.onRefresh}>
          Aktualisieren
        </button>
        <button className="btn" onClick={props.onPull}>
          Pull
        </button>
        <button className="btn" onClick={props.onPush}>
          Push
        </button>
      </div>

      <div className="row" style={{ marginBottom: 8 }}>
        <input
          className="input"
          value={cloneUrl}
          onChange={(event) => setCloneUrl(event.target.value)}
          placeholder="https://github.com/org/repo.git"
          style={{ flex: 1 }}
        />
        <input
          className="input"
          value={cloneBranch}
          onChange={(event) => setCloneBranch(event.target.value)}
          placeholder="Branch"
          style={{ width: 110 }}
        />
        <button
          className="btn"
          onClick={() => {
            if (!cloneUrl.trim()) return;
            props.onCloneRepo(cloneUrl.trim(), cloneBranch.trim() || undefined);
          }}
        >
          Klonen
        </button>
      </div>

      <div className="row" style={{ marginBottom: 8 }}>
        <input
          className="input"
          value={stagePath}
          onChange={(event) => setStagePath(event.target.value)}
          placeholder="Dateipfad"
          style={{ flex: 1 }}
        />
        <button className="btn" onClick={() => stagePath.trim() && props.onStage(stagePath.trim())}>
          Stagen
        </button>
        <button className="btn" onClick={() => stagePath.trim() && props.onUnstage(stagePath.trim())}>
          Unstage
        </button>
      </div>

      <div className="row" style={{ marginBottom: 8 }}>
        <input
          className="input"
          value={commitMessage}
          onChange={(event) => setCommitMessage(event.target.value)}
          placeholder="Commit-Nachricht"
          style={{ flex: 1 }}
        />
        <button className="btn primary" onClick={() => commitMessage.trim() && props.onCommit(commitMessage.trim())}>
          Commit
        </button>
      </div>

      <h4 style={{ margin: '8px 0 4px' }}>Status</h4>
      <pre className="diff-view">{props.statusOutput || 'Noch kein Git-Status vorhanden.'}</pre>

      <h4 style={{ margin: '8px 0 4px' }}>Diff</h4>
      <pre className="diff-view">{props.diffOutput || 'Noch kein Diff geladen.'}</pre>
    </div>
  );
}
