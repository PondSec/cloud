import { Navigate, Outlet, useLocation } from 'react-router-dom';

import { clearAuthSession, getAccessToken } from '@/lib/auth-storage';
import { useCurrentUser } from '@/hooks/useCurrentUser';

export function RequireAuth() {
  const location = useLocation();
  const token = getAccessToken();
  const { isLoading, isError } = useCurrentUser();

  if (!token) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (isLoading) {
    return <div className="flex min-h-screen items-center justify-center text-zinc-200">Authenticating...</div>;
  }

  if (isError) {
    clearAuthSession();
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <Outlet />;
}
