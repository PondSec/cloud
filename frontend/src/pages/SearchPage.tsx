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

  const results = useQuery({
    queryKey: ['files', 'search', query],
    queryFn: () => api.files.search(query),
    enabled: query.trim().length >= 2,
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
      )}
    </div>
  );
}
