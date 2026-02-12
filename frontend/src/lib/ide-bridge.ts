import { api } from '@/lib/api';
import { getAccessToken } from '@/lib/auth-storage';
import { ideApi } from '@/lib/ide-api';
import { getIdeToken, setIdeToken } from '@/lib/ide-auth';

function ideEmailForUser(userId: number): string {
  return `cloud-user-${userId}@cloud-ide.local`;
}

function idePasswordForUser(userId: number): string {
  return `CloudIDE-Bridge-v1-${userId}-DoNotUseElsewhere!`;
}

export async function ensureIdeSessionFromCloud(): Promise<string> {
  const existing = getIdeToken();
  if (existing) {
    return existing;
  }

  if (!getAccessToken()) {
    throw new Error('CLOUD_AUTH_REQUIRED');
  }

  const cloudUser = await api.auth.me();
  const email = ideEmailForUser(cloudUser.id);
  const password = idePasswordForUser(cloudUser.id);

  try {
    const login = await ideApi.auth.login(email, password);
    setIdeToken(login.token);
    return login.token;
  } catch (loginError: any) {
    const status = loginError?.response?.status;
    if (status && status !== 401 && status !== 404) {
      throw loginError;
    }
  }

  try {
    const register = await ideApi.auth.register(email, password);
    setIdeToken(register.token);
    return register.token;
  } catch (registerError: any) {
    if (registerError?.response?.status === 409) {
      const retry = await ideApi.auth.login(email, password);
      setIdeToken(retry.token);
      return retry.token;
    }
    throw registerError;
  }
}
