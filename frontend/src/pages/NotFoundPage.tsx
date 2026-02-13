import { Link } from 'react-router-dom';
import { BRAND } from '@/lib/brand';

export function NotFoundPage() {
  return (
    <div className="flex min-h-screen items-center justify-center p-6 text-center">
      <div className="space-y-3">
        <h1 className="text-3xl font-semibold">Seite nicht gefunden</h1>
        <p className="text-zinc-300">Dieser Bereich existiert nicht mehr oder wurde verschoben.</p>
        <p className="text-xs text-zinc-400">{BRAND.fullName}</p>
        <Link className="inline-block rounded-xl border border-white/20 px-4 py-2 hover:bg-white/10" to="/app/files">
          Zu den Dateien
        </Link>
      </div>
    </div>
  );
}
