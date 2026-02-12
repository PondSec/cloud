import type { PermissionCode, User } from '@/types/api';

export const PERMISSIONS = {
  FILE_READ: 'FILE_READ',
  FILE_WRITE: 'FILE_WRITE',
  FILE_DELETE: 'FILE_DELETE',
  SHARE_INTERNAL_MANAGE: 'SHARE_INTERNAL_MANAGE',
  SHARE_EXTERNAL_MANAGE: 'SHARE_EXTERNAL_MANAGE',
  SHARE_VIEW_RECEIVED: 'SHARE_VIEW_RECEIVED',
  OFFICE_USE: 'OFFICE_USE',
  IDE_USE: 'IDE_USE',
  MEDIA_VIEW: 'MEDIA_VIEW',
  USER_MANAGE: 'USER_MANAGE',
  ROLE_MANAGE: 'ROLE_MANAGE',
  SERVER_SETTINGS: 'SERVER_SETTINGS',
} as const satisfies Record<PermissionCode, PermissionCode>;

export function userPermissions(user: User | null | undefined): Set<string> {
  if (!user) return new Set<string>();
  if (Array.isArray(user.permissions) && user.permissions.length > 0) {
    return new Set<string>(user.permissions);
  }

  return new Set<string>(
    user.roles.flatMap((role) => role.permissions.map((permission) => permission.code)),
  );
}

export function hasPermission(user: User | null | undefined, permission: PermissionCode): boolean {
  return userPermissions(user).has(permission);
}

export function hasAnyPermission(user: User | null | undefined, permissions: PermissionCode[]): boolean {
  const set = userPermissions(user);
  return permissions.some((permission) => set.has(permission));
}

export function hasAllPermissions(user: User | null | undefined, permissions: PermissionCode[]): boolean {
  const set = userPermissions(user);
  return permissions.every((permission) => set.has(permission));
}
