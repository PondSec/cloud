import { ExternalLink, RefreshCw } from 'lucide-react';

import { ideApiBaseUrl } from '../lib/ide-api';

interface PreviewPanelProps {
  workspaceId: string;
  token: string;
  port: number;
}

export function PreviewPanel({ workspaceId, token, port }: PreviewPanelProps) {
  const previewUrl = `${ideApiBaseUrl()}/preview/${workspaceId}/${port}/?token=${encodeURIComponent(token)}`;

  return (
    <div className="preview-pane" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="editor-toolbar">
        <div className="row">Preview :{port}</div>
        <div className="row">
          <button
            className="btn"
            onClick={() => {
              const iframe = document.getElementById('preview-frame') as HTMLIFrameElement | null;
              if (iframe) iframe.src = previewUrl;
            }}
          >
            <RefreshCw size={14} />
          </button>
          <a className="btn" href={previewUrl} target="_blank" rel="noreferrer">
            <ExternalLink size={14} />
          </a>
        </div>
      </div>
      <iframe id="preview-frame" title="Live preview" src={previewUrl} style={{ flex: 1, border: 'none', width: '100%' }} />
    </div>
  );
}
