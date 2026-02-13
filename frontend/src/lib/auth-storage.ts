const ACCESS_TOKEN_KEY = 'cloud_workspace_access_token';
const REFRESH_TOKEN_KEY = 'cloud_workspace_refresh_token';
export const AUTH_STORAGE_EVENT = 'cloud_workspace_auth_changed';

function emitAuthStorageChanged() {
  window.dispatchEvent(new CustomEvent(AUTH_STORAGE_EVENT));
}

export function getAccessToken(): string | null {
  return window.localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  return window.localStorage.getItem(REFRESH_TOKEN_KEY);
}

export function setAccessToken(token: string): void {
  window.localStorage.setItem(ACCESS_TOKEN_KEY, token);
  emitAuthStorageChanged();
}

export function setAuthSession(accessToken: string, refreshToken: string): void {
  window.localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  window.localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  emitAuthStorageChanged();
}

export function clearAuthSession(): void {
  window.localStorage.removeItem(ACCESS_TOKEN_KEY);
  window.localStorage.removeItem(REFRESH_TOKEN_KEY);
  emitAuthStorageChanged();
}
