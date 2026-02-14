import { HttpError } from './http-error.js';

const WORKSPACE_ID_PATTERN = /^[a-f0-9-]{36}$/i;

export function assertWorkspaceId(value: string): string {
  const trimmed = (value || '').trim();
  if (!WORKSPACE_ID_PATTERN.test(trimmed)) {
    throw new HttpError(400, 'Invalid workspace id');
  }
  return trimmed;
}
