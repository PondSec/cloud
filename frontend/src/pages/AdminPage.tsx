import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Save, ShieldCheck, Trash2, UserPlus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { api, toApiMessage } from '@/lib/api';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { formatBytes } from '@/lib/utils';
import type { Role, User } from '@/types/api';

interface RoleDraft {
  name: string;
  description: string;
  permissionCodes: string[];
}

const SYSTEM_ROLE_NAMES = new Set(['admin', 'user']);

function rolePermissionCodes(role: Role): string[] {
  return role.permissions.map((permission) => permission.code).sort();
}

function userRoleIds(user: User): number[] {
  return user.roles.map((role) => role.id).sort((a, b) => a - b);
}

function describeAdminApiError(error: unknown, scope: 'roles' | 'permissions' | 'users' | 'settings'): string {
  const status = (error as { response?: { status?: number } } | null)?.response?.status;
  if (status === 404 && (scope === 'roles' || scope === 'permissions')) {
    return 'Roles API not found on backend. Restart the backend so /admin/roles and /admin/permissions are loaded.';
  }
  return toApiMessage(error);
}

export function AdminPage() {
  const queryClient = useQueryClient();
  const { data: currentUser } = useCurrentUser();

  const canManageSettings = hasPermission(currentUser, PERMISSIONS.SERVER_SETTINGS);
  const canManageUsers = hasPermission(currentUser, PERMISSIONS.USER_MANAGE);
  const canManageRoles = hasPermission(currentUser, PERMISSIONS.ROLE_MANAGE);

  const settingsQuery = useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: api.admin.settings,
    enabled: canManageSettings,
  });

  const usersQuery = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: api.admin.users,
    enabled: canManageUsers,
  });

  const rolesQuery = useQuery({
    queryKey: ['admin', 'roles'],
    queryFn: api.admin.roles,
    enabled: canManageUsers || canManageRoles,
  });

  const permissionsQuery = useQuery({
    queryKey: ['admin', 'permissions'],
    queryFn: api.admin.permissions,
    enabled: canManageRoles || canManageUsers,
  });

  const [allowRegistration, setAllowRegistration] = useState(false);
  const [maxUploadSize, setMaxUploadSize] = useState('26214400');
  const [defaultQuota, setDefaultQuota] = useState('5368709120');

  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newBytesLimit, setNewBytesLimit] = useState('');
  const [newRoleIds, setNewRoleIds] = useState<number[]>([]);

  const [newRoleName, setNewRoleName] = useState('');
  const [newRoleDescription, setNewRoleDescription] = useState('');
  const [newRolePermissionCodes, setNewRolePermissionCodes] = useState<string[]>([]);

  const [roleDrafts, setRoleDrafts] = useState<Record<number, RoleDraft>>({});
  const [userRoleDrafts, setUserRoleDrafts] = useState<Record<number, number[]>>({});

  const users = useMemo(() => usersQuery.data ?? [], [usersQuery.data]);
  const roles = useMemo(() => rolesQuery.data ?? [], [rolesQuery.data]);
  const permissions = useMemo(() => permissionsQuery.data ?? [], [permissionsQuery.data]);

  const defaultUserRoleId = useMemo(() => roles.find((role) => role.name === 'user')?.id ?? null, [roles]);

  useEffect(() => {
    if (!settingsQuery.data) return;
    setAllowRegistration(settingsQuery.data.allow_registration);
    setMaxUploadSize(String(settingsQuery.data.max_upload_size));
    setDefaultQuota(String(settingsQuery.data.default_quota));
  }, [settingsQuery.data]);

  useEffect(() => {
    const nextDrafts: Record<number, RoleDraft> = {};
    for (const role of roles) {
      nextDrafts[role.id] = {
        name: role.name,
        description: role.description ?? '',
        permissionCodes: rolePermissionCodes(role),
      };
    }
    setRoleDrafts(nextDrafts);

    if (defaultUserRoleId !== null && newRoleIds.length === 0) {
      setNewRoleIds([defaultUserRoleId]);
    }
  }, [defaultUserRoleId, newRoleIds.length, roles]);

  useEffect(() => {
    const nextDrafts: Record<number, number[]> = {};
    for (const user of users) {
      nextDrafts[user.id] = userRoleIds(user);
    }
    setUserRoleDrafts(nextDrafts);
  }, [users]);

  const saveSettingsMutation = useMutation({
    mutationFn: () =>
      api.admin.updateSettings({
        allow_registration: allowRegistration,
        max_upload_size: Number(maxUploadSize),
        default_quota: Number(defaultQuota),
      }),
    onSuccess: async () => {
      toast.success('Settings updated');
      await queryClient.invalidateQueries({ queryKey: ['admin', 'settings'] });
    },
    onError: (error) => toast.error(toApiMessage(error)),
  });

  const createRoleMutation = useMutation({
    mutationFn: () =>
      api.admin.createRole({
        name: newRoleName.trim(),
        description: newRoleDescription.trim() || null,
        permission_codes: newRolePermissionCodes,
      }),
    onSuccess: async () => {
      toast.success('Role created');
      setNewRoleName('');
      setNewRoleDescription('');
      setNewRolePermissionCodes([]);
      await queryClient.invalidateQueries({ queryKey: ['admin', 'roles'] });
      await queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
    onError: (error) => toast.error(toApiMessage(error)),
  });

  const updateRoleMutation = useMutation({
    mutationFn: ({ roleId, payload }: { roleId: number; payload: Record<string, unknown> }) =>
      api.admin.updateRole(roleId, payload),
    onSuccess: async () => {
      toast.success('Role updated');
      await queryClient.invalidateQueries({ queryKey: ['admin', 'roles'] });
      await queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
    onError: (error) => toast.error(toApiMessage(error)),
  });

  const deleteRoleMutation = useMutation({
    mutationFn: (roleId: number) => api.admin.deleteRole(roleId),
    onSuccess: async () => {
      toast.success('Role deleted');
      await queryClient.invalidateQueries({ queryKey: ['admin', 'roles'] });
      await queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
    onError: (error) => toast.error(toApiMessage(error)),
  });

  const createUserMutation = useMutation({
    mutationFn: () =>
      api.admin.createUser({
        username: newUsername.trim(),
        password: newPassword,
        bytes_limit: newBytesLimit ? Number(newBytesLimit) : undefined,
        role_ids: canManageRoles ? newRoleIds : undefined,
      }),
    onSuccess: async () => {
      toast.success('User created');
      setNewUsername('');
      setNewPassword('');
      setNewBytesLimit('');
      if (defaultUserRoleId !== null) {
        setNewRoleIds([defaultUserRoleId]);
      }
      await queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
    onError: (error) => toast.error(toApiMessage(error)),
  });

  const updateUserMutation = useMutation({
    mutationFn: ({ userId, payload }: { userId: number; payload: Record<string, unknown> }) =>
      api.admin.updateUser(userId, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      toast.success('User updated');
    },
    onError: (error) => toast.error(toApiMessage(error)),
  });

  const deleteUserMutation = useMutation({
    mutationFn: (userId: number) => api.admin.deleteUser(userId),
    onSuccess: async () => {
      toast.success('User deleted');
      await queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
    onError: (error) => toast.error(toApiMessage(error)),
  });

  if (!canManageSettings && !canManageUsers && !canManageRoles) {
    return (
      <div className="h-full overflow-auto p-4">
        <div className="rounded-2xl border border-amber-300/35 bg-amber-500/10 p-5 text-sm text-amber-100">
          You do not have admin permissions to view this area.
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-4">
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Admin</h1>
          <p className="text-sm text-zinc-300">Define roles, assign granular permissions, and control visibility per user.</p>
        </div>

        {canManageSettings ? (
          <section className="space-y-3 rounded-2xl border border-white/10 bg-black/20 p-4">
            <h2 className="text-lg font-semibold">Server Settings</h2>

            {settingsQuery.isError ? (
              <div className="rounded-xl border border-rose-400/40 bg-rose-500/10 p-3 text-sm text-rose-100">
                {toApiMessage(settingsQuery.error)}
              </div>
            ) : null}

            <label className="flex items-center gap-2 text-sm text-zinc-200">
              <input
                type="checkbox"
                checked={allowRegistration}
                onChange={(event) => setAllowRegistration(event.target.checked)}
              />
              Allow self registration
            </label>

            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm text-zinc-300">Max upload size (bytes)</label>
                <Input value={maxUploadSize} onChange={(event) => setMaxUploadSize(event.target.value)} />
              </div>
              <div>
                <label className="mb-1 block text-sm text-zinc-300">Default quota (bytes)</label>
                <Input value={defaultQuota} onChange={(event) => setDefaultQuota(event.target.value)} />
              </div>
            </div>

            <Button onClick={() => saveSettingsMutation.mutate()} disabled={saveSettingsMutation.isPending}>
              <Save size={14} className="mr-1" />
              Save Settings
            </Button>
          </section>
        ) : null}

        {canManageRoles ? (
          <section className="space-y-4 rounded-2xl border border-white/10 bg-black/20 p-4">
            <div className="flex items-center gap-2">
              <ShieldCheck size={18} />
              <h2 className="text-lg font-semibold">Roles & Permissions</h2>
            </div>

            {rolesQuery.isError ? (
              <div className="rounded-xl border border-rose-400/40 bg-rose-500/10 p-3 text-sm text-rose-100">
                {describeAdminApiError(rolesQuery.error, 'roles')}
              </div>
            ) : null}
            {permissionsQuery.isError ? (
              <div className="rounded-xl border border-rose-400/40 bg-rose-500/10 p-3 text-sm text-rose-100">
                {describeAdminApiError(permissionsQuery.error, 'permissions')}
              </div>
            ) : null}

            <div className="space-y-3 rounded-xl border border-cyan-300/20 bg-cyan-500/5 p-3">
              <h3 className="font-medium">Create Role</h3>
              <div className="grid gap-2 md:grid-cols-2">
                <Input
                  placeholder="Role name (e.g. media-editor)"
                  value={newRoleName}
                  onChange={(event) => setNewRoleName(event.target.value)}
                />
                <Input
                  placeholder="Description (optional)"
                  value={newRoleDescription}
                  onChange={(event) => setNewRoleDescription(event.target.value)}
                />
              </div>

              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {permissions.map((permission) => {
                  const selected = newRolePermissionCodes.includes(permission.code);
                  return (
                    <label key={permission.id} className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-sm">
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={(event) => {
                          const checked = event.target.checked;
                          setNewRolePermissionCodes((prev) =>
                            checked ? [...new Set([...prev, permission.code])] : prev.filter((code) => code !== permission.code),
                          );
                        }}
                      />
                      <span>{permission.code}</span>
                    </label>
                  );
                })}
              </div>

              <Button
                onClick={() => createRoleMutation.mutate()}
                disabled={createRoleMutation.isPending || !newRoleName.trim()}
              >
                <Plus size={14} className="mr-1" />
                Create Role
              </Button>
            </div>

            <div className="space-y-3">
              {roles.map((role) => {
                const draft = roleDrafts[role.id] ?? {
                  name: role.name,
                  description: role.description ?? '',
                  permissionCodes: rolePermissionCodes(role),
                };
                const systemRole = SYSTEM_ROLE_NAMES.has(role.name.toLowerCase());

                return (
                  <div key={role.id} className="space-y-3 rounded-xl border border-white/10 bg-black/25 p-3">
                    <div className="grid gap-2 md:grid-cols-2">
                      <Input
                        value={draft.name}
                        disabled={systemRole}
                        onChange={(event) =>
                          setRoleDrafts((prev) => ({
                            ...prev,
                            [role.id]: { ...draft, name: event.target.value },
                          }))
                        }
                      />
                      <Input
                        value={draft.description}
                        placeholder="Description"
                        onChange={(event) =>
                          setRoleDrafts((prev) => ({
                            ...prev,
                            [role.id]: { ...draft, description: event.target.value },
                          }))
                        }
                      />
                    </div>

                    {systemRole ? (
                      <p className="text-xs text-zinc-400">System role: permissions are managed automatically.</p>
                    ) : null}

                    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                      {permissions.map((permission) => {
                        const checked = draft.permissionCodes.includes(permission.code);
                        return (
                          <label
                            key={`${role.id}-${permission.id}`}
                            className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/35 px-2 py-1.5 text-sm"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={systemRole}
                              onChange={(event) => {
                                const isChecked = event.target.checked;
                                setRoleDrafts((prev) => ({
                                  ...prev,
                                  [role.id]: {
                                    ...draft,
                                    permissionCodes: isChecked
                                      ? [...new Set([...draft.permissionCodes, permission.code])]
                                      : draft.permissionCodes.filter((code) => code !== permission.code),
                                  },
                                }));
                              }}
                            />
                            <span>{permission.code}</span>
                          </label>
                        );
                      })}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button
                        onClick={() =>
                          updateRoleMutation.mutate({
                            roleId: role.id,
                            payload: {
                              name: draft.name.trim(),
                              description: draft.description.trim() || null,
                              permission_codes: draft.permissionCodes,
                            },
                          })
                        }
                        disabled={updateRoleMutation.isPending || !draft.name.trim()}
                      >
                        <Save size={14} className="mr-1" />
                        Save Role
                      </Button>
                      {!systemRole ? (
                        <Button
                          variant="destructive"
                          onClick={() => {
                            if (window.confirm(`Delete role '${role.name}'?`)) {
                              deleteRoleMutation.mutate(role.id);
                            }
                          }}
                          disabled={deleteRoleMutation.isPending}
                        >
                          <Trash2 size={14} className="mr-1" />
                          Delete Role
                        </Button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}

        {canManageUsers ? (
          <>
            <section className="space-y-3 rounded-2xl border border-white/10 bg-black/20 p-4">
              <div className="flex items-center gap-2">
                <UserPlus size={18} />
                <h2 className="text-lg font-semibold">Create User</h2>
              </div>

              {usersQuery.isError ? (
                <div className="rounded-xl border border-rose-400/40 bg-rose-500/10 p-3 text-sm text-rose-100">
                  {describeAdminApiError(usersQuery.error, 'users')}
                </div>
              ) : null}

              <div className="grid gap-2 md:grid-cols-3">
                <Input placeholder="Username" value={newUsername} onChange={(event) => setNewUsername(event.target.value)} />
                <Input
                  placeholder="Password (min 8)"
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                />
                <Input
                  placeholder="Quota bytes (optional)"
                  value={newBytesLimit}
                  onChange={(event) => setNewBytesLimit(event.target.value)}
                />
              </div>

              {canManageRoles ? (
                <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                  {roles.map((role) => {
                    const checked = newRoleIds.includes(role.id);
                    return (
                      <label key={`new-user-role-${role.id}`} className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-sm">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(event) => {
                            const isChecked = event.target.checked;
                            setNewRoleIds((prev) =>
                              isChecked ? [...new Set([...prev, role.id])] : prev.filter((roleId) => roleId !== role.id),
                            );
                          }}
                        />
                        <span>{role.name}</span>
                      </label>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-zinc-400">Role assignment is restricted. New users get the default role.</p>
              )}

              <Button
                onClick={() => createUserMutation.mutate()}
                disabled={
                  createUserMutation.isPending ||
                  !newUsername.trim() ||
                  newPassword.length < 8 ||
                  (canManageRoles && newRoleIds.length === 0)
                }
              >
                <Plus size={14} className="mr-1" />
                Create User
              </Button>
            </section>

            <section className="space-y-3 rounded-2xl border border-white/10 bg-black/20 p-4">
              <h2 className="text-lg font-semibold">Users</h2>

              <div className="space-y-3">
                {users.map((user) => {
                  const roleDraft = userRoleDrafts[user.id] ?? userRoleIds(user);
                  return (
                    <div key={user.id} className="space-y-3 rounded-xl border border-white/10 bg-black/25 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{user.username}</p>
                          <p className="text-xs text-zinc-400">
                            {formatBytes(user.bytes_used)} / {formatBytes(user.bytes_limit)}
                          </p>
                        </div>

                        <div className="flex items-center gap-2">
                          <label className="flex items-center gap-1 text-xs text-zinc-300">
                            <input
                              type="checkbox"
                              checked={user.is_active}
                              onChange={(event) =>
                                updateUserMutation.mutate({
                                  userId: user.id,
                                  payload: { is_active: event.target.checked },
                                })
                              }
                            />
                            Active
                          </label>
                          <Button
                            variant="destructive"
                            size="icon"
                            onClick={() => {
                              if (window.confirm(`Delete ${user.username}?`)) {
                                deleteUserMutation.mutate(user.id);
                              }
                            }}
                            aria-label={`Delete user ${user.username}`}
                          >
                            <Trash2 size={14} />
                          </Button>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-1">
                        {user.roles.map((role) => (
                          <span key={`${user.id}-role-chip-${role.id}`} className="rounded-full border border-cyan-300/30 bg-cyan-500/10 px-2 py-0.5 text-xs text-cyan-100">
                            {role.name}
                          </span>
                        ))}
                      </div>

                      {canManageRoles ? (
                        <>
                          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                            {roles.map((role) => {
                              const checked = roleDraft.includes(role.id);
                              return (
                                <label
                                  key={`${user.id}-role-${role.id}`}
                                  className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/35 px-2 py-1.5 text-sm"
                                >
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={(event) => {
                                      const isChecked = event.target.checked;
                                      setUserRoleDrafts((prev) => ({
                                        ...prev,
                                        [user.id]: isChecked
                                          ? [...new Set([...(prev[user.id] ?? []), role.id])]
                                          : (prev[user.id] ?? []).filter((roleId) => roleId !== role.id),
                                      }));
                                    }}
                                  />
                                  <span>{role.name}</span>
                                </label>
                              );
                            })}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              onClick={() =>
                                updateUserMutation.mutate({
                                  userId: user.id,
                                  payload: { role_ids: roleDraft },
                                })
                              }
                              disabled={updateUserMutation.isPending || roleDraft.length === 0}
                            >
                              <Save size={14} className="mr-1" />
                              Save Roles
                            </Button>
                          </div>
                        </>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </section>
          </>
        ) : null}
      </div>
    </div>
  );
}
