import { Navigate } from 'react-router-dom';

import { useCurrentUser } from '@/hooks/useCurrentUser';

export function RequireAdmin({ children }: { children: JSX.Element }) {
  const { data } = useCurrentUser();
  const isAdmin = data?.roles.some((role) => role.name === 'admin');

  if (!isAdmin) {
    return <Navigate to="/app/files" replace />;
  }

  return children;
}
