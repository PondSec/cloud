import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Loader2, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { api, toApiMessage } from '@/lib/api';

type DocsEditorInstance = { destroyEditor?: () => void };

const scriptLoaders = new Map<string, Promise<void>>();

function loadDocsApiScript(scriptUrl: string): Promise<void> {
  if (scriptLoaders.has(scriptUrl)) {
    return scriptLoaders.get(scriptUrl)!;
  }

  const promise = new Promise<void>((resolve, reject) => {
    if (typeof window !== 'undefined' && window.DocsAPI?.DocEditor) {
      resolve();
      return;
    }

    const existing = document.querySelector(`script[src="${scriptUrl}"]`) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Failed to load OnlyOffice script.')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = scriptUrl;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load OnlyOffice script.'));
    document.head.appendChild(script);
  });

  scriptLoaders.set(scriptUrl, promise);
  return promise;
}

export function OfficeEditorPage() {
  const navigate = useNavigate();
  const params = useParams<{ fileId: string }>();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<DocsEditorInstance | null>(null);
  const [scriptReady, setScriptReady] = useState(false);
  const [scriptError, setScriptError] = useState<string | null>(null);

  const fileId = Number(params.fileId);
  const isValidFileId = Number.isInteger(fileId) && fileId > 0;

  const sessionQuery = useQuery({
    queryKey: ['office', 'session', fileId],
    queryFn: () => api.office.createSession(fileId),
    enabled: isValidFileId,
  });

  const scriptUrl = useMemo(() => {
    if (!sessionQuery.data) {
      return null;
    }
    return `${sessionQuery.data.document_server_url}/web-apps/apps/api/documents/api.js`;
  }, [sessionQuery.data]);

  useEffect(() => {
    setScriptReady(false);
    setScriptError(null);
    if (!scriptUrl) {
      return;
    }

    let cancelled = false;
    loadDocsApiScript(scriptUrl)
      .then(() => {
        if (!cancelled) {
          setScriptReady(true);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          const message = toApiMessage(error);
          setScriptError(message);
          toast.error(message);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [scriptUrl]);

  useEffect(() => {
    if (!scriptReady || !sessionQuery.data || !hostRef.current) {
      return;
    }
    if (!window.DocsAPI?.DocEditor) {
      toast.error('OnlyOffice client script loaded but DocsAPI is unavailable.');
      return;
    }

    if (editorRef.current?.destroyEditor) {
      editorRef.current.destroyEditor();
      editorRef.current = null;
    }

    hostRef.current.innerHTML = '<div id="onlyoffice-editor-host" style="width:100%;height:100%;"></div>';
    editorRef.current = new window.DocsAPI.DocEditor('onlyoffice-editor-host', sessionQuery.data.config);

    return () => {
      if (editorRef.current?.destroyEditor) {
        editorRef.current.destroyEditor();
        editorRef.current = null;
      }
    };
  }, [scriptReady, sessionQuery.data]);

  if (!isValidFileId) {
    return (
      <div className="h-full p-4">
        <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-8 text-sm text-zinc-300">Invalid file id.</div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col p-4">
      <header className="mb-3 flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2">
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => navigate(-1)}>
            <ArrowLeft size={14} className="mr-1" />
            Back
          </Button>
          <p className="text-sm text-zinc-300">{sessionQuery.data ? sessionQuery.data.config.document.title : `File #${fileId}`}</p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => void sessionQuery.refetch()}>
          <RefreshCw size={14} className="mr-1" />
          Reload Session
        </Button>
      </header>

      <section className="relative min-h-0 flex-1 overflow-hidden rounded-xl border border-white/10 bg-black/20">
        {sessionQuery.isLoading ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-zinc-300">
            <Loader2 size={16} className="animate-spin" />
            Loading Office session...
          </div>
        ) : sessionQuery.isError ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center text-sm text-zinc-300">
            <p>{toApiMessage(sessionQuery.error)}</p>
            <Button variant="secondary" onClick={() => void sessionQuery.refetch()}>
              Retry
            </Button>
          </div>
        ) : scriptError ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center text-sm text-zinc-300">
            <p>{scriptError}</p>
            <p className="text-xs text-zinc-400">
              Ensure OnlyOffice Document Server is running and reachable.
            </p>
            <Button
              variant="secondary"
              onClick={() => {
                setScriptError(null);
                setScriptReady(false);
                void sessionQuery.refetch();
              }}
            >
              Retry
            </Button>
          </div>
        ) : !scriptReady ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-zinc-300">
            <Loader2 size={16} className="animate-spin" />
            Loading OnlyOffice editor...
          </div>
        ) : (
          <div ref={hostRef} className="h-full w-full" />
        )}
      </section>
    </div>
  );
}
