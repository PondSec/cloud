import { describe, expect, it } from 'vitest';

import { isAllowedOrigin } from '../src/utils/origin.js';

describe('origin policy', () => {
  it('accepts explicit allowlist origins', () => {
    expect(isAllowedOrigin('https://app.example.com', ['https://app.example.com'], false)).toBe(true);
  });

  it('rejects unknown origins', () => {
    expect(isAllowedOrigin('https://evil.example.com', ['https://app.example.com'], false)).toBe(false);
  });
});
