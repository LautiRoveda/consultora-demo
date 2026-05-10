import { describe, expect, it } from 'vitest';

import { cn } from '@/shared/lib/utils';

describe('cn', () => {
  it('combina clases simples', () => {
    expect(cn('foo', 'bar')).toBe('foo bar');
  });

  it('aplica twMerge para resolver conflictos de Tailwind', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
  });

  it('ignora valores falsy', () => {
    expect(cn('foo', false, undefined, null, 'bar')).toBe('foo bar');
  });
});
