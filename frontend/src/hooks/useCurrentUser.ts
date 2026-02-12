import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { getAccessToken } from '@/lib/auth-storage';

export function useCurrentUser() {
  return useQuery({
    queryKey: ['auth', 'me'],
    queryFn: api.auth.me,
    enabled: Boolean(getAccessToken()),
  });
}
