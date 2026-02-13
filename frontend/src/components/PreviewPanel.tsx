import { ExternalLink, Play, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { ideApiBaseUrl } from '../lib/ide-api';

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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderInlineMarkdown(input: string): string {
  let output = escapeHtml(input);
  output = output.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, url) => {
    const safeUrl = String(url).trim();
    if (!/^(https?:\/\/|mailto:)/i.test(safeUrl)) {
      return `${label} (${safeUrl})`;
    }
    return `<a href="${safeUrl}" target="_blank" rel="noreferrer">${label}</a>`;
  });
  output = output.replace(/`([^`]+)`/g, '<code>$1</code>');
  output = output.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  output = output.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  return output;
}

function markdownToHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const html: string[] = [];
  let inCode = false;
  let codeLanguage = '';
  let codeLines: string[] = [];
  let inUl = false;
  let inOl = false;
  let inQuote = false;

  const closeLists = () => {
    if (inUl) {
      html.push('</ul>');
      inUl = false;
    }
    if (inOl) {
      html.push('</ol>');
      inOl = false;
    }
  };

  const closeQuote = () => {
    if (!inQuote) return;
    html.push('</blockquote>');
    inQuote = false;
  };

  const flushCodeBlock = () => {
    const className = codeLanguage ? ` class="language-${escapeHtml(codeLanguage)}"` : '';
    html.push(`<pre><code${className}>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
    codeLines = [];
    codeLanguage = '';
  };

  for (const line of lines) {
    const fenceMatch = line.match(/^```([a-zA-Z0-9_-]+)?\s*$/);
    if (fenceMatch) {
      if (inCode) {
        flushCodeBlock();
        inCode = false;
      } else {
        closeLists();
        closeQuote();
        inCode = true;
        codeLanguage = fenceMatch[1] ?? '';
      }
      continue;
    }

    if (inCode) {
      codeLines.push(line);
      continue;
    }

    if (!line.trim()) {
      closeLists();
      closeQuote();
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s*(.+)$/);
    if (headingMatch) {
      closeLists();
      closeQuote();
      const level = (headingMatch[1] ?? '').length;
      const headingText = headingMatch[2] ?? '';
      html.push(`<h${level}>${renderInlineMarkdown(headingText)}</h${level}>`);
      continue;
    }

    const quoteMatch = line.match(/^>\s?(.*)$/);
    if (quoteMatch) {
      closeLists();
      if (!inQuote) {
        html.push('<blockquote>');
        inQuote = true;
      }
      const quoteText = quoteMatch[1] ?? '';
      html.push(`<p>${renderInlineMarkdown(quoteText)}</p>`);
      continue;
    }

    closeQuote();

    const unorderedMatch = line.match(/^[-*+]\s+(.+)$/);
    if (unorderedMatch) {
      if (inOl) {
        html.push('</ol>');
        inOl = false;
      }
      if (!inUl) {
        html.push('<ul>');
        inUl = true;
      }
      const unorderedText = unorderedMatch[1] ?? '';
      html.push(`<li>${renderInlineMarkdown(unorderedText)}</li>`);
      continue;
    }

    const orderedMatch = line.match(/^\d+\.\s+(.+)$/);
    if (orderedMatch) {
      if (inUl) {
        html.push('</ul>');
        inUl = false;
      }
      if (!inOl) {
        html.push('<ol>');
        inOl = true;
      }
      const orderedText = orderedMatch[1] ?? '';
      html.push(`<li>${renderInlineMarkdown(orderedText)}</li>`);
      continue;
    }

    closeLists();

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      html.push('<hr />');
      continue;
    }

    html.push(`<p>${renderInlineMarkdown(line)}</p>`);
  }

  if (inCode) {
    flushCodeBlock();
  }
  closeLists();
  closeQuote();

  if (!html.length) {
    return '<p>Keine Markdown-Inhalte vorhanden.</p>';
  }
  return html.join('\n');
}

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
  const previewUrl = `${ideApiBaseUrl()}/preview/${workspaceId}/${port}/?token=${encodeURIComponent(token)}`;
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [hint, setHint] = useState('');
  const [frameSrc, setFrameSrc] = useState(previewUrl);

  const markdownHtml = useMemo(() => markdownToHtml(markdownSource), [markdownSource]);

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
          setHint('Vorschau-Service nicht erreichbar. Bitte Vorschau mit Play starten.');
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
    <div className="preview-pane" style={{ display: 'flex', flexDirection: 'column' }}>
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
        <div className="markdown-preview" dangerouslySetInnerHTML={{ __html: markdownHtml }} />
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
