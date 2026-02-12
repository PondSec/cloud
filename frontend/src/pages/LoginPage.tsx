import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import GlassSurface from '@/components/reactbits/GlassSurface';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api, toApiMessage } from '@/lib/api';
import { setAuthSession } from '@/lib/auth-storage';
import { queryClient } from '@/lib/query-client';

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const mutation = useMutation({
    mutationFn: () => api.auth.login(username, password),
    onSuccess: async (response) => {
      setAuthSession(response.access_token, response.refresh_token);
      await queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
      const redirectPath = (location.state as { from?: { pathname?: string } } | undefined)?.from?.pathname;
      navigate(redirectPath ?? '/app/files', { replace: true });
      toast.success('Welcome back');
    },
    onError: (error) => toast.error(toApiMessage(error)),
  });

  return (
    <div className="relative flex min-h-screen items-center justify-center p-6">
      <GlassSurface
        width={460}
        height="auto"
        borderRadius={24}
        className="w-full max-w-md border border-white/20"
        backgroundOpacity={0.08}
        displace={0.4}
      >
        <form
          className="w-full space-y-4 p-8"
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
        >
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold">Cloud Workspace</h1>
            <p className="text-sm text-zinc-300">Sign in to your workspace.</p>
          </div>

          <div className="space-y-2">
            <label htmlFor="username" className="text-sm text-zinc-300">
              Username
            </label>
            <Input
              id="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              required
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="password" className="text-sm text-zinc-300">
              Password
            </label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </div>

          <Button type="submit" className="w-full" disabled={mutation.isPending}>
            {mutation.isPending ? 'Signing in...' : 'Sign In'}
          </Button>
        </form>
      </GlassSurface>
    </div>
  );
}
