import { ExternalLink, Play, RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { idePreviewBaseUrl } from '../lib/ide-api';

type PreviewMode = 'app' | 'markdown';

interface PreviewPanelProps {
  workspaceId: string;
  token: string;
  port: number;
  mode: PreviewMode;
  activeFilePath: string | null;
  markdownSource: string;
  onStartPreview: () => Promise<void>;
  onToggleVisible: () => void;
  refreshToken: number;
}

function safeMarkdownUri(uri: string | null | undefined): string {
  const raw = String(uri ?? '').trim();
  if (!raw) return '';
  const colon = raw.indexOf(':');
  const questionMark = raw.indexOf('?');
  const numberSign = raw.indexOf('#');
  const slash = raw.indexOf('/');
  const hasProtocol =
    colon !== -1 &&
    (slash === -1 || colon < slash) &&
    (questionMark === -1 || colon < questionMark) &&
    (numberSign === -1 || colon < numberSign);

  // Relative URLs (including `#anchors`) are ok.
  if (!hasProtocol) return raw;

  const protocol = raw.slice(0, colon);
  if (/^(https?|mailto)$/i.test(protocol)) return raw;
  return '';
}

function isExternalHref(href: string): boolean {
  return /^(https?:\/\/|mailto:)/i.test(href);
}

const markdownComponents: Components = {
  a({ href, children, ...props }) {
    const safeHref = safeMarkdownUri(href);
    if (!safeHref) {
      return <span>{children}</span>;
    }
    const external = isExternalHref(safeHref);
    return (
      <a href={safeHref} target={external ? '_blank' : undefined} rel={external ? 'noreferrer' : undefined} {...props}>
        {children}
      </a>
    );
  },
  img({ src, alt, title, ...props }) {
    const safeSrc = safeMarkdownUri(src);
    if (!safeSrc) {
      return <span>{alt || 'image'}</span>;
    }
    return <img src={safeSrc} alt={alt ?? ''} title={title} loading="lazy" {...props} />;
  },
};

export function PreviewPanel({
  workspaceId,
  token,
  port,
  mode,
  activeFilePath,
  markdownSource,
  onStartPreview,
  onToggleVisible,
  refreshToken,
}: PreviewPanelProps) {
  // Keep preview on IDE backend origin (usually :18080) so preview code can't tamper with the IDE UI via same-origin access.
  const previewUrl = `${idePreviewBaseUrl()}/preview/${workspaceId}/${port}/?token=${encodeURIComponent(token)}`;
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
    if (mode !== 'app') return;
    setFrameSrc(previewUrl);
  }, [mode, previewUrl]);

  useEffect(() => {
    if (mode !== 'app') {
      setHint('');
      return;
    }

    let cancelled = false;
    const probe = async () => {
      try {
        const response = await fetch(previewUrl, { method: 'GET' });
        if (cancelled) return;
        if (response.ok) {
          setHint('');
          return;
        }
        setHint('Die Vorschau läuft noch nicht. Starten Sie sie mit der Play-Taste.');
      } catch {
        if (!cancelled) {
          setHint(
            `Vorschau-Service nicht erreichbar. Prüfen Sie, ob die IDE-API erreichbar ist (${idePreviewBaseUrl()}) (ggf. Reverse Proxy/Firewall) und starten Sie die Vorschau mit Play.`,
          );
        }
      }
    };
    void probe();
    return () => {
      cancelled = true;
    };
  }, [mode, previewUrl, refreshToken]);

  useEffect(() => {
    if (mode !== 'app') return;
    if (refreshToken <= 0) return;
    reloadIframe();
  }, [mode, refreshToken, previewUrl]);

  return (
    <div className="preview-pane">
      <div className="editor-toolbar">
        <div className="row">
          {mode === 'markdown' ? `Markdown-Vorschau${activeFilePath ? ` · ${activeFilePath}` : ''}` : `Vorschau :${port}`}
        </div>
        <div className="row">
          {mode === 'app' ? (
            <button
              className="btn"
              onClick={async () => {
                await onStartPreview();
                window.setTimeout(reloadIframe, 450);
              }}
              title="Vorschau-Server starten"
            >
              <Play size={14} />
            </button>
          ) : null}
          <button
            className="btn"
            onClick={() => {
              if (mode === 'app') {
                reloadIframe();
              }
            }}
            title={mode === 'app' ? 'Vorschau neu laden' : 'Markdown wird live aktualisiert'}
          >
            <RefreshCw size={14} />
          </button>
          {mode === 'app' ? (
            <a className="btn" href={previewUrl} target="_blank" rel="noreferrer">
              <ExternalLink size={14} />
            </a>
          ) : null}
          <button className="btn" onClick={onToggleVisible} title="Vorschau ausblenden">
            Ausblenden
          </button>
        </div>
      </div>

      {mode === 'markdown' ? (
        <div className="markdown-preview">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            urlTransform={(url) => safeMarkdownUri(url)}
            components={markdownComponents}
          >
            {markdownSource || ''}
          </ReactMarkdown>
        </div>
      ) : (
        <>
          {hint ? (
            <div style={{ borderBottom: '1px solid var(--border)', padding: '6px 10px', color: '#f8d775', fontSize: 12 }}>{hint}</div>
          ) : null}
          <iframe ref={iframeRef} title="Live-Vorschau" src={frameSrc} style={{ flex: 1, border: 'none', width: '100%' }} />
        </>
      )}
    </div>
  );
}
