import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useState } from 'react';

import { FileList, type SortDirection, type SortKey, type ViewMode } from '@/components/files/FileList';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';

export function SearchPage() {
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
        <h1 className="mb-2 text-2xl font-semibold">Search</h1>
        <p className="text-sm text-zinc-300">Find files and folders quickly.</p>
      </div>

      <div className="relative max-w-xl">
        <Search className="pointer-events-none absolute left-3 top-3.5 text-zinc-400" size={16} />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="pl-9"
          placeholder="Search by file or folder name"
          aria-label="Search files"
        />
      </div>

      {query.trim().length < 2 ? (
        <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-8 text-sm text-zinc-400">
          Type at least 2 characters.
        </div>
      ) : results.isLoading ? (
        <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-8 text-sm text-zinc-300">Searching…</div>
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
        />
      )}
    </div>
  );
}
