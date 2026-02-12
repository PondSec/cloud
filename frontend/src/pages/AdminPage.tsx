import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api, toApiMessage } from '@/lib/api';
import { formatBytes } from '@/lib/utils';

export function AdminPage() {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: api.admin.settings,
  });

  const usersQuery = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: api.admin.users,
  });

  const [allowRegistration, setAllowRegistration] = useState(false);
  const [maxUploadSize, setMaxUploadSize] = useState('26214400');
  const [defaultQuota, setDefaultQuota] = useState('5368709120');

  useEffect(() => {
    if (!settingsQuery.data) return;
    setAllowRegistration(settingsQuery.data.allow_registration);
    setMaxUploadSize(String(settingsQuery.data.max_upload_size));
    setDefaultQuota(String(settingsQuery.data.default_quota));
  }, [settingsQuery.data]);

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

  const createUserMutation = useMutation({
    mutationFn: (payload: { username: string; password: string; role_names: string[] }) => api.admin.createUser(payload),
    onSuccess: async () => {
      toast.success('User created');
      await queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
    onError: (error) => toast.error(toApiMessage(error)),
  });

  const updateUserMutation = useMutation({
    mutationFn: ({ userId, payload }: { userId: number; payload: Record<string, unknown> }) =>
      api.admin.updateUser(userId, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
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

  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<'user' | 'admin'>('user');

  const users = useMemo(() => usersQuery.data ?? [], [usersQuery.data]);

  return (
    <div className="h-full overflow-auto p-4">
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Admin</h1>
          <p className="text-sm text-zinc-300">Manage server settings, users, and roles.</p>
        </div>

        <section className="space-y-3 rounded-2xl border border-white/10 bg-black/20 p-4">
          <h2 className="text-lg font-semibold">Server Settings</h2>

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
            Save Settings
          </Button>
        </section>

        <section className="space-y-3 rounded-2xl border border-white/10 bg-black/20 p-4">
          <h2 className="text-lg font-semibold">Create User</h2>
          <div className="grid gap-2 md:grid-cols-4">
            <Input
              placeholder="Username"
              value={newUsername}
              onChange={(event) => setNewUsername(event.target.value)}
            />
            <Input
              placeholder="Password"
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
            <select
              className="h-10 rounded-xl border border-white/20 bg-white/10 px-3 text-sm text-zinc-100"
              value={newRole}
              onChange={(event) => setNewRole(event.target.value as 'user' | 'admin')}
            >
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
            <Button
              onClick={() => {
                createUserMutation.mutate({
                  username: newUsername,
                  password: newPassword,
                  role_names: [newRole],
                });
                setNewUsername('');
                setNewPassword('');
                setNewRole('user');
              }}
            >
              Create
            </Button>
          </div>
        </section>

        <section className="space-y-3 rounded-2xl border border-white/10 bg-black/20 p-4">
          <h2 className="text-lg font-semibold">Users</h2>
          <div className="space-y-2">
            {users.map((user) => {
              const isAdmin = user.roles.some((role) => role.name === 'admin');

              return (
                <div key={user.id} className="rounded-xl border border-white/10 bg-black/20 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-medium">{user.username}</p>
                      <p className="text-xs text-zinc-400">
                        {formatBytes(user.bytes_used)} / {formatBytes(user.bytes_limit)}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        value={isAdmin ? 'admin' : 'user'}
                        className="h-9 rounded-lg border border-white/20 bg-white/10 px-2 text-sm"
                        onChange={(event) => {
                          updateUserMutation.mutate({
                            userId: user.id,
                            payload: { role_names: [event.target.value] },
                          });
                        }}
                      >
                        <option value="user">User</option>
                        <option value="admin">Admin</option>
                      </select>

                      <label className="flex items-center gap-1 text-xs text-zinc-300">
                        <input
                          type="checkbox"
                          checked={user.is_active}
                          onChange={(event) => {
                            updateUserMutation.mutate({
                              userId: user.id,
                              payload: { is_active: event.target.checked },
                            });
                          }}
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
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
