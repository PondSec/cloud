const TOKEN_KEY = 'cloudide_token';

export function getIdeToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setIdeToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearIdeToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}
