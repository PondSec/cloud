import { Navigate, useLocation } from 'react-router-dom';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { hasAllPermissions, hasAnyPermission } from '@/lib/permissions';
import type { PermissionCode } from '@/types/api';

interface RequirePermissionProps {
  children: JSX.Element;
  anyOf?: PermissionCode[];
  allOf?: PermissionCode[];
  fallbackTo?: string;
}

export function RequirePermission({
  children,
  anyOf = [],
  allOf = [],
  fallbackTo = '/app/settings',
}: RequirePermissionProps) {
  const { data: user, isLoading } = useCurrentUser();
  const location = useLocation();

  if (isLoading) {
    return <div className="flex min-h-screen items-center justify-center text-zinc-200">Checking permissions...</div>;
  }

  const anyOfOk = anyOf.length === 0 || hasAnyPermission(user, anyOf);
  const allOfOk = allOf.length === 0 || hasAllPermissions(user, allOf);
  if (!anyOfOk || !allOfOk) {
    return <Navigate to={fallbackTo} replace state={{ from: location }} />;
  }

  return children;
}
