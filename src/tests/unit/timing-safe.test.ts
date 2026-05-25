import { describe, expect, it, vi } from 'vitest';

import { constantTimeEqual } from '@/shared/security/timing-safe';

vi.mock('server-only', () => ({}));

describe('constantTimeEqual', () => {
  it('returns true para strings idénticos', () => {
    expect(
      constantTimeEqual('secret-32-chars-aaaaaaaaaaaaaaaa', 'secret-32-chars-aaaaaaaaaaaaaaaa'),
    ).toBe(true);
  });

  it('returns false para strings distintos same length', () => {
    expect(
      constantTimeEqual('secret-32-chars-aaaaaaaaaaaaaaaa', 'secret-32-chars-bbbbbbbbbbbbbbbb'),
    ).toBe(false);
  });

  it('returns false para length distinta (no leak via timingSafeEqual exception)', () => {
    expect(constantTimeEqual('short', 'much-longer-string-with-different-length')).toBe(false);
  });

  it('returns false para null/undefined provided (no NPE)', () => {
    expect(constantTimeEqual(null, 'expected-secret')).toBe(false);
    expect(constantTimeEqual(undefined, 'expected-secret')).toBe(false);
  });

  it('returns false para empty provided', () => {
    expect(constantTimeEqual('', 'expected-secret')).toBe(false);
  });
});
