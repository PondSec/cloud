import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { FileList, type SortDirection, type SortKey, type ViewMode } from '@/components/files/FileList';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';

export function SearchPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [viewMode, setViewMode] = useState<ViewMode>('list');

  const inventoryProContext = useQuery({
    queryKey: ['auth', 'inventorypro-context'],
    queryFn: api.auth.inventoryProContext,
  });

  const results = useQuery({
    queryKey: ['files', 'search', query],
    queryFn: () => api.files.search(query),
    enabled: query.trim().length >= 2,
  });

  const inventoryResults = useQuery({
    queryKey: ['inventorypro', 'search', 'global', query],
    queryFn: () => api.auth.inventoryProSearch(query, 10),
    enabled: query.trim().length >= 2 && Boolean(inventoryProContext.data?.available),
  });

  return (
    <div className="h-full space-y-4 overflow-auto p-4">
      <div>
        <h1 className="mb-2 text-2xl font-semibold">Suche</h1>
        <p className="text-sm text-zinc-300">Finden Sie Dateien und Ordner in Sekunden.</p>
      </div>

      <div className="relative max-w-xl">
        <Search className="pointer-events-none absolute left-3 top-3.5 text-zinc-400" size={16} />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="pl-9"
          placeholder="Datei- oder Ordnername eingeben"
          aria-label="Dateien suchen"
        />
      </div>

      {query.trim().length < 2 ? (
        <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-8 text-sm text-zinc-400">
          Geben Sie mindestens 2 Zeichen ein.
        </div>
      ) : results.isLoading ? (
        <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-8 text-sm text-zinc-300">Suche läuft...</div>
      ) : (
        <div className="space-y-6">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-zinc-100">Cloud Dateien</h2>
              <span className="text-xs text-zinc-400">{(results.data ?? []).length} Treffer</span>
            </div>
            <FileList
              files={results.data ?? []}
              sortKey={sortKey}
              sortDirection={sortDirection}
              onSortKeyChange={setSortKey}
              onSortDirectionChange={setSortDirection}
              viewMode={viewMode}
              onViewModeChange={setViewMode}
              onDownload={(node) => {
                void api.files.download(node);
              }}
              onOpenInOffice={(node) => navigate(`/app/office/${node.id}`)}
            />
          </div>

          {inventoryProContext.data?.available ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-zinc-100">Inventory Pro</h2>
                <span className="text-xs text-zinc-400">
                  {inventoryResults.isLoading ? '...' : inventoryResults.data?.count ?? 0} Treffer
                </span>
              </div>

              {inventoryResults.isLoading ? (
                <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-4 text-sm text-zinc-300">
                  InventoryPro-Suche läuft...
                </div>
              ) : inventoryResults.isError ? (
                <div className="rounded-xl border border-rose-300/30 bg-rose-500/10 px-4 py-4 text-sm text-rose-100">
                  InventoryPro konnte nicht durchsucht werden.
                </div>
              ) : (inventoryResults.data?.items?.length || 0) === 0 ? (
                <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-4 text-sm text-zinc-400">
                  Keine InventoryPro-Treffer.
                </div>
              ) : (
                <div className="space-y-1">
                  {(inventoryResults.data?.items || []).map((item) => (
                    <button
                      key={`${item.type}:${item.id}`}
                      type="button"
                      onClick={() => navigate(`/app/inventorypro?next=${encodeURIComponent(item.url)}`)}
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
          ) : null}
        </div>
      )}
    </div>
  );
}
