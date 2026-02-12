import { useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';

import { getAccessToken } from '@/lib/auth-storage';
import { ensureIdeSessionFromCloud } from '@/lib/ide-bridge';
import { getIdeToken } from '@/lib/ide-auth';

export function RequireIdeAuth() {
  const location = useLocation();
  const [state, setState] = useState<'checking' | 'ready' | 'unauthenticated' | 'error'>('checking');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (getIdeToken()) {
        if (!cancelled) setState('ready');
        return;
      }

      if (!getAccessToken()) {
        if (!cancelled) setState('unauthenticated');
        return;
      }

      try {
        await ensureIdeSessionFromCloud();
        if (!cancelled) setState('ready');
      } catch (error: any) {
        if (cancelled) return;
        if (!getAccessToken()) {
          setState('unauthenticated');
          return;
        }
        setErrorMessage(error?.response?.data?.error || error?.message || 'IDE session bootstrap failed.');
        setState('error');
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [location.pathname]);

  if (state === 'checking') {
    return (
      <div className="ide-root">
        <main className="workspace-page">
          <section className="card">
            <h2 style={{ marginTop: 0 }}>Opening Cloud IDE</h2>
            <p style={{ color: '#9f9f9f' }}>Using your existing Cloud session...</p>
          </section>
        </main>
      </div>
    );
  }

  if (state === 'unauthenticated') {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (state === 'error') {
    return (
      <div className="ide-root">
        <main className="workspace-page">
          <section className="card">
            <h2 style={{ marginTop: 0 }}>Cloud IDE unavailable</h2>
            <p style={{ color: '#ff7b7b' }}>{errorMessage}</p>
            <p style={{ color: '#9f9f9f' }}>
              Check whether IDE services are running (`docker compose up -d workspace-image runner ide-backend`).
            </p>
          </section>
        </main>
      </div>
    );
  }

  return <Outlet />;
}
