import { ExternalLink, Play, RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { ideApiBaseUrl } from '../lib/ide-api';

interface PreviewPanelProps {
  workspaceId: string;
  token: string;
  port: number;
  onStartPreview: () => Promise<void>;
  onToggleVisible: () => void;
  refreshToken: number;
}

export function PreviewPanel({ workspaceId, token, port, onStartPreview, onToggleVisible, refreshToken }: PreviewPanelProps) {
  const previewUrl = `${ideApiBaseUrl()}/preview/${workspaceId}/${port}/?token=${encodeURIComponent(token)}`;
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [hint, setHint] = useState('');
  const [frameSrc, setFrameSrc] = useState(previewUrl);

  const withCacheBuster = (url: string): string => `${url}${url.includes('?') ? '&' : '?'}_ts=${Date.now()}`;

  const reloadIframe = () => {
    const nextSrc = withCacheBuster(previewUrl);
    setFrameSrc(nextSrc);
    if (iframeRef.current) {
      iframeRef.current.src = nextSrc;
    }
  };

  useEffect(() => {
    setFrameSrc(previewUrl);
  }, [previewUrl]);

  useEffect(() => {
    let cancelled = false;
    const probe = async () => {
      try {
        const response = await fetch(previewUrl, { method: 'GET' });
        if (cancelled) return;
        if (response.ok) {
          setHint('');
          return;
        }
        setHint('Preview is not running. Start it with the play button.');
      } catch {
        if (!cancelled) {
          setHint('Preview service unreachable. Start preview with play.');
        }
      }
    };
    void probe();
    return () => {
      cancelled = true;
    };
  }, [previewUrl, refreshToken]);

  useEffect(() => {
    if (refreshToken <= 0) return;
    reloadIframe();
  }, [refreshToken, previewUrl]);

  return (
    <div className="preview-pane" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="editor-toolbar">
        <div className="row">Preview :{port}</div>
        <div className="row">
          <button
            className="btn"
            onClick={async () => {
              await onStartPreview();
              window.setTimeout(reloadIframe, 450);
            }}
            title="Start preview server"
          >
            <Play size={14} />
          </button>
          <button
            className="btn"
            onClick={() => {
              reloadIframe();
            }}
          >
            <RefreshCw size={14} />
          </button>
          <a className="btn" href={previewUrl} target="_blank" rel="noreferrer">
            <ExternalLink size={14} />
          </a>
          <button className="btn" onClick={onToggleVisible} title="Hide preview">
            Hide
          </button>
        </div>
      </div>
      {hint ? (
        <div style={{ borderBottom: '1px solid var(--border)', padding: '6px 10px', color: '#f8d775', fontSize: 12 }}>{hint}</div>
      ) : null}
      <iframe ref={iframeRef} title="Live preview" src={frameSrc} style={{ flex: 1, border: 'none', width: '100%' }} />
    </div>
  );
}
