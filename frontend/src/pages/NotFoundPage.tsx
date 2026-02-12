import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <div className="flex min-h-screen items-center justify-center p-6 text-center">
      <div className="space-y-3">
        <h1 className="text-3xl font-semibold">Page Not Found</h1>
        <p className="text-zinc-300">The route does not exist.</p>
        <Link className="inline-block rounded-xl border border-white/20 px-4 py-2 hover:bg-white/10" to="/app/files">
          Go to Files
        </Link>
      </div>
    </div>
  );
}
