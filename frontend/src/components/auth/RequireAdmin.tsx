import { Navigate, useLocation } from 'react-router-dom';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { isAdmin } from '@/lib/permissions';

interface RequireAdminProps {
  children: JSX.Element;
  fallbackTo?: string;
}

export function RequireAdmin({ children, fallbackTo = '/app/settings' }: RequireAdminProps) {
  const { data: user, isLoading } = useCurrentUser();
  const location = useLocation();

  if (isLoading) {
    return <div className="flex min-h-screen items-center justify-center text-zinc-200">Admin-Zugriff wird geprüft...</div>;
  }

  if (!isAdmin(user)) {
    return <Navigate to={fallbackTo} replace state={{ from: location }} />;
  }

  return children;
}
