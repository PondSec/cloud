import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { FileList, type SortDirection, type SortKey, type ViewMode } from '@/components/files/FileList';
import GradualBlur from '@/components/reactbits/GradualBlur';
import { api } from '@/lib/api';

export function RecentsPage() {
  const navigate = useNavigate();
  const [sortKey, setSortKey] = useState<SortKey>('updated_at');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [viewMode, setViewMode] = useState<ViewMode>('list');

  const query = useQuery({
    queryKey: ['files', 'recents'],
    queryFn: () => api.files.recents(50),
  });

  return (
    <div className="relative h-full overflow-hidden p-4">
      <div className="h-full overflow-auto pb-20">
        <h1 className="mb-4 text-2xl font-semibold">Recents</h1>
        {query.isLoading ? (
          <div className="rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-zinc-300">Loading...</div>
        ) : (
          <FileList
            files={query.data ?? []}
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
      <GradualBlur target="parent" position="bottom" height="6rem" strength={2} divCount={6} curve="bezier" />
    </div>
  );
}
