import { useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';

import { getAccessToken } from '@/lib/auth-storage';
import { BRAND } from '@/lib/brand';
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
        setErrorMessage(error?.response?.data?.error || error?.message || 'Studio-Sitzung konnte nicht initialisiert werden.');
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
            <h2 style={{ marginTop: 0 }}>PondSec Studio wird geöffnet</h2>
            <p style={{ color: '#9f9f9f' }}>Ihre bestehende {BRAND.product}-Sitzung wird übernommen...</p>
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
            <h2 style={{ marginTop: 0 }}>Studio aktuell nicht verfügbar</h2>
            <p style={{ color: '#ff7b7b' }}>{errorMessage}</p>
            <p style={{ color: '#9f9f9f' }}>
              Prüfen Sie, ob die Studio-Dienste laufen (`docker compose up -d workspace-image runner ide-backend`).
            </p>
          </section>
        </main>
      </div>
    );
  }

  return <Outlet />;
}
