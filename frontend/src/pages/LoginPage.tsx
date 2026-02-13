import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import GlassSurface from '@/components/reactbits/GlassSurface';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api, toApiMessage } from '@/lib/api';
import { setAuthSession } from '@/lib/auth-storage';
import { BRAND } from '@/lib/brand';
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
      navigate(redirectPath ?? '/app/home', { replace: true });
      toast.success('Willkommen zurück. Ihr Bereich ist bereit.');
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
            <p className="text-xs uppercase tracking-[0.12em] text-cyan-200/90">{BRAND.fullName}</p>
            <h1 className="text-2xl font-semibold">{BRAND.loginTitle}</h1>
            <p className="text-sm text-zinc-300">{BRAND.loginSubtitle}</p>
            <p className="text-xs text-zinc-400">{BRAND.trustLine}</p>
          </div>

          <div className="space-y-2">
            <label htmlFor="username" className="text-sm text-zinc-300">
              Benutzername
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
              Passwort
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
            {mutation.isPending ? 'Anmeldung wird vorbereitet...' : 'Sicher anmelden'}
          </Button>
        </form>
      </GlassSurface>
    </div>
  );
}
