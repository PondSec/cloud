import { isProd } from '../config.js';

function normalizeHost(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, '').toLowerCase();
}

function isLocalHost(hostname: string): boolean {
  const normalized = normalizeHost(hostname);
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1' || normalized === '0.0.0.0';
}

function isPrivateIpv4(hostname: string): boolean {
  const raw = normalizeHost(hostname);
  const parts = raw.split('.');
  if (parts.length !== 4) return false;
  const nums = parts.map((p) => Number.parseInt(p, 10));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = nums;
  return a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

export function isAllowedOrigin(origin: string | undefined, allowedOrigins: string[], allowAllOrigins: boolean): boolean {
  if (!origin) {
    return false;
  }
  if (allowAllOrigins || allowedOrigins.includes(origin)) {
    return true;
  }
  if (!isProd) {
    try {
      const url = new URL(origin);
      if ((url.protocol === 'http:' || url.protocol === 'https:') && (isLocalHost(url.hostname) || isPrivateIpv4(url.hostname))) {
        return true;
      }
    } catch {
      return false;
    }
  }
  return false;
}
