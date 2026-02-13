import { useMutation, useQuery } from '@tanstack/react-query';
import { ExternalLink, Loader2, RefreshCw, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api, toApiMessage } from '@/lib/api';

export function InventoryProPage() {
  const navigate = useNavigate();
  const location = useLocation();

  const [frameKey, setFrameKey] = useState(0);
  const [frameUrl, setFrameUrl] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const autoLaunchRef = useRef<string | null>(null);

  const contextQuery = useQuery({
    queryKey: ['auth', 'inventorypro-context'],
    queryFn: api.auth.inventoryProContext,
  });

  const baseUrl = useMemo(() => (contextQuery.data?.base_url || '').replace(/\/+$/, ''), [contextQuery.data?.base_url]);
  const isAvailable = Boolean(contextQuery.data?.available && baseUrl);
  const nextParam = useMemo(() => {
    const params = new URLSearchParams(location.search);
    const next = (params.get('next') || '').trim();
    if (!next) return '';
    return next.startsWith('/') && !next.startsWith('//') ? next : '/';
  }, [location.search]);

  const summaryQuery = useQuery({
    queryKey: ['inventorypro', 'summary'],
    queryFn: api.auth.inventoryProSummary,
    enabled: isAvailable,
  });

  const recentsQuery = useQuery({
    queryKey: ['inventorypro', 'recents'],
    queryFn: () => api.auth.inventoryProRecents(12),
    enabled: isAvailable,
  });

  const searchResultsQuery = useQuery({
    queryKey: ['inventorypro', 'search', searchQuery],
    queryFn: () => api.auth.inventoryProSearch(searchQuery, 30),
    enabled: isAvailable && searchQuery.trim().length >= 2,
  });

  const launchMutation = useMutation({
    mutationFn: (nextPath: string) => api.auth.inventoryProLaunch(nextPath || '/'),
    onSuccess: (data) => {
      setFrameUrl(data.url || '');
      setFrameKey((prev) => prev + 1);
    },
  });

  const openInEmbeddedUi = (nextPath: string) => {
    launchMutation.mutate(nextPath);
  };

  useEffect(() => {
    if (!isAvailable) return;
    if (!nextParam) return;
    if (autoLaunchRef.current === nextParam) return;
    autoLaunchRef.current = nextParam;
    openInEmbeddedUi(nextParam);
    // Keep URL clean after consuming the deep-link.
    navigate('/app/inventorypro', { replace: true });
  }, [isAvailable, navigate, nextParam]);

  if (contextQuery.isPending) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="rounded-xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-zinc-200">
          <Loader2 size={16} className="mr-2 inline animate-spin" />
          InventoryPro-Kontext wird geladen ...
        </div>
      </div>
    );
  }

  if (contextQuery.isError) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="max-w-xl space-y-3 rounded-2xl border border-rose-300/30 bg-rose-500/10 p-5 text-rose-100">
          <h1 className="text-lg font-semibold">InventoryPro konnte nicht gestartet werden</h1>
          <p className="text-sm">{toApiMessage(contextQuery.error)}</p>
          <Button variant="secondary" onClick={() => contextQuery.refetch()}>
            <RefreshCw size={14} className="mr-1" />
            Erneut versuchen
          </Button>
        </div>
      </div>
    );
  }

  if (!isAvailable) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="max-w-xl space-y-4 rounded-2xl border border-white/10 bg-black/25 p-5">
          <h1 className="text-xl font-semibold text-zinc-100">InventoryPro nicht verfügbar</h1>
          <p className="text-sm text-zinc-300">
            Es ist aktuell keine gültige InventoryPro-URL konfiguriert oder der Dock-Start ist deaktiviert.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Link className="text-sm text-cyan-200 underline-offset-2 hover:underline" to="/app/admin">
              Zu den Server-Einstellungen
            </Link>
            <Button variant="secondary" onClick={() => contextQuery.refetch()}>
              <RefreshCw size={14} className="mr-1" />
              Kontext neu laden
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-black/25 px-3 py-2">
        <div>
          <h1 className="text-sm font-semibold text-zinc-100">Inventory Pro</h1>
          <p className="text-xs text-zinc-400">Eingebettet in Cloud unter /app/inventorypro</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => contextQuery.refetch()}>
            <RefreshCw size={14} className="mr-1" />
            URL neu laden
          </Button>
          <Button
            onClick={() => openInEmbeddedUi('/')}
            disabled={launchMutation.isPending}
            title="InventoryPro per SSO im iFrame starten"
          >
            {launchMutation.isPending ? (
              <>
                <Loader2 size={14} className="mr-1 animate-spin" />
                Verbinde...
              </>
            ) : (
              <>
                <ExternalLink size={14} className="mr-1" />
                InventoryPro öffnen
              </>
            )}
          </Button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[420px_1fr]">
        <div className="min-h-0 space-y-3 overflow-auto rounded-xl border border-white/10 bg-black/20 p-3">
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-[0.12em] text-zinc-400">Übersicht</p>
            {summaryQuery.isLoading ? (
              <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-6 text-sm text-zinc-300">
                <Loader2 size={16} className="mr-2 inline animate-spin" />
                Lade InventoryPro-Zusammenfassung...
              </div>
            ) : summaryQuery.isError ? (
              <div className="space-y-2 rounded-xl border border-rose-300/30 bg-rose-500/10 p-4 text-sm text-rose-100">
                <p className="font-semibold">Zusammenfassung konnte nicht geladen werden</p>
                <p className="text-xs text-rose-100/90">{toApiMessage(summaryQuery.error)}</p>
                <Button variant="secondary" onClick={() => summaryQuery.refetch()}>
                  <RefreshCw size={14} className="mr-1" />
                  Erneut versuchen
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: 'Assets', value: summaryQuery.data?.counts.assets ?? 0 },
                  { label: 'Kategorien', value: summaryQuery.data?.counts.categories ?? 0 },
                  { label: 'Benutzer', value: summaryQuery.data?.counts.users ?? 0 },
                  { label: 'Tickets (offen)', value: summaryQuery.data?.counts.tickets_open ?? 0 },
                ].map((item) => (
                  <div key={item.label} className="rounded-xl border border-white/10 bg-black/25 px-3 py-3">
                    <p className="text-xs text-zinc-400">{item.label}</p>
                    <p className="mt-1 text-2xl font-semibold text-zinc-100">{item.value}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.12em] text-zinc-400">Suche (InventoryPro)</p>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-3.5 text-zinc-400" size={16} />
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                className="pl-9"
                placeholder="Asset, Ticket oder User suchen..."
              />
            </div>

            {searchQuery.trim().length < 2 ? (
              <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-xs text-zinc-400">
                Mindestens 2 Zeichen eingeben.
              </div>
            ) : searchResultsQuery.isLoading ? (
              <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-xs text-zinc-300">
                <Loader2 size={14} className="mr-2 inline animate-spin" />
                Suche läuft...
              </div>
            ) : searchResultsQuery.isError ? (
              <div className="rounded-xl border border-rose-300/30 bg-rose-500/10 px-3 py-3 text-xs text-rose-100">
                {toApiMessage(searchResultsQuery.error)}
              </div>
            ) : (searchResultsQuery.data?.items?.length || 0) === 0 ? (
              <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-xs text-zinc-400">
                Keine Treffer.
              </div>
            ) : (
              <div className="space-y-1">
                {(searchResultsQuery.data?.items || []).map((item) => (
                  <button
                    key={`${item.type}:${item.id}`}
                    type="button"
                    onClick={() => openInEmbeddedUi(item.url)}
                    className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-left text-sm text-zinc-100 transition hover:border-cyan-300/30 hover:bg-black/30"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium">{item.title}</span>
                      <span className="shrink-0 rounded-full border border-white/10 bg-black/25 px-2 py-0.5 text-[11px] text-zinc-300">
                        {item.type}
                      </span>
                    </div>
                    {item.subtitle ? <p className="mt-1 line-clamp-2 text-xs text-zinc-400">{item.subtitle}</p> : null}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs uppercase tracking-[0.12em] text-zinc-400">Recents</p>
              <Button variant="secondary" size="sm" onClick={() => recentsQuery.refetch()}>
                <RefreshCw size={14} className="mr-1" />
                Neu laden
              </Button>
            </div>
            {recentsQuery.isLoading ? (
              <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-xs text-zinc-300">
                <Loader2 size={14} className="mr-2 inline animate-spin" />
                Lade Recents...
              </div>
            ) : recentsQuery.isError ? (
              <div className="rounded-xl border border-rose-300/30 bg-rose-500/10 px-3 py-3 text-xs text-rose-100">
                {toApiMessage(recentsQuery.error)}
              </div>
            ) : (
              <div className="space-y-1">
                {(recentsQuery.data?.items || []).map((item) => (
                  <button
                    key={`${item.type}:${item.id}`}
                    type="button"
                    onClick={() => openInEmbeddedUi(item.url)}
                    className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-left text-sm text-zinc-100 transition hover:border-cyan-300/30 hover:bg-black/30"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium">{item.title}</span>
                      <span className="shrink-0 rounded-full border border-white/10 bg-black/25 px-2 py-0.5 text-[11px] text-zinc-300">
                        {item.type}
                      </span>
                    </div>
                    {item.subtitle ? <p className="mt-1 truncate text-xs text-zinc-400">{item.subtitle}</p> : null}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-xs text-zinc-400">
            <p className="truncate">
              InventoryPro-URL: <span className="text-zinc-200">{baseUrl}</span>
            </p>
          </div>
        </div>

        <div className="min-h-0 overflow-hidden rounded-xl border border-white/10 bg-black/20">
          {frameUrl ? (
            <iframe
              key={frameKey}
              title="Inventory Pro Embedded"
              src={frameUrl}
              className="h-full w-full bg-white"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="flex h-full items-center justify-center p-6 text-center">
              <div className="max-w-md space-y-2 rounded-2xl border border-white/10 bg-black/25 p-5">
                <p className="text-sm font-semibold text-zinc-100">InventoryPro UI ist noch nicht geladen</p>
                <p className="text-xs text-zinc-400">
                  Klicke auf <span className="text-zinc-200">InventoryPro öffnen</span>, um die Oberfläche per SSO einzubetten.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
