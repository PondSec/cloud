import { useState } from 'react';

interface RunPanelProps {
  onRunTask: (task: 'run' | 'build' | 'test' | 'preview' | 'custom', command?: string) => void;
  onTogglePreview: () => void;
  previewVisible: boolean;
  previewPort: number;
  onPreviewPortChange: (port: number) => void;
}

export function RunPanel({
  onRunTask,
  onTogglePreview,
  previewVisible,
  previewPort,
  onPreviewPortChange,
}: RunPanelProps) {
  const [customCommand, setCustomCommand] = useState('');

  return (
    <div className="panel-content">
      <div className="row" style={{ marginBottom: 8 }}>
        <button className="btn primary" onClick={() => onRunTask('run')}>
          Run
        </button>
        <button className="btn" onClick={() => onRunTask('build')}>
          Build
        </button>
        <button className="btn" onClick={() => onRunTask('test')}>
          Test
        </button>
        <button className="btn" onClick={() => onRunTask('preview')}>
          Preview
        </button>
      </div>

      <div className="row" style={{ marginBottom: 8 }}>
        <input
          className="input"
          value={customCommand}
          onChange={(event) => setCustomCommand(event.target.value)}
          placeholder="Custom command"
          style={{ flex: 1 }}
        />
        <button
          className="btn"
          onClick={() => {
            if (!customCommand.trim()) return;
            onRunTask('custom', customCommand.trim());
          }}
        >
          Execute
        </button>
      </div>

      <div className="row" style={{ marginBottom: 8 }}>
        <label htmlFor="preview-port">Preview Port</label>
        <input
          id="preview-port"
          className="input"
          value={previewPort}
          onChange={(event) => onPreviewPortChange(Number(event.target.value || 0))}
          style={{ width: 100 }}
        />
        <button className="btn" onClick={onTogglePreview}>
          {previewVisible ? 'Hide Preview' : 'Show Preview'}
        </button>
      </div>

      <p style={{ color: '#9b9b9b', fontSize: 12 }}>
        Debug baseline: run Node with <code>--inspect</code> or Python with <code>debugpy</code> in custom commands.
      </p>
    </div>
  );
}
