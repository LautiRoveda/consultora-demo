/**
 * T-117-FU3 · Tests del render markdown compartido (`@/shared/ui/markdown`).
 *
 * Cubre que el markdown NO aparezca crudo (negrita/lista/tabla) y que el sanitize
 * (rehype-sanitize, schema GitHub) strippee HTML peligroso. El contenido viene del
 * modelo IA, así que el sanitize es parte del contrato de seguridad.
 */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Markdown } from '@/shared/ui/markdown';

afterEach(() => cleanup());

describe('Markdown (shared)', () => {
  it('renderiza negrita como <strong> (no deja `**` crudo)', () => {
    const { container } = render(<Markdown content="Esto es **importante**." />);
    expect(container.querySelector('strong')?.textContent).toBe('importante');
    expect(container.textContent).not.toContain('**');
  });

  it('renderiza listas con items reales', () => {
    const { container } = render(<Markdown content={'- uno\n- dos\n'} />);
    expect(container.querySelectorAll('li')).toHaveLength(2);
  });

  it('renderiza tablas GFM', () => {
    const { container } = render(<Markdown content={'| A | B |\n|---|---|\n| 1 | 2 |\n'} />);
    expect(container.querySelector('table')).not.toBeNull();
    expect(container.querySelectorAll('td')).toHaveLength(2);
  });

  it('sanitiza <script> (no lo renderiza ni lo ejecuta)', () => {
    const win = window as unknown as { __xss?: number };
    render(<Markdown content={'Hola <script>window.__xss=1</script> chau'} />);
    expect(document.querySelector('script')).toBeNull();
    expect(win.__xss).toBeUndefined();
  });

  it('sanitiza hrefs javascript:', () => {
    const { container } = render(<Markdown content={'[x](javascript:alert(1))'} />);
    const href = container.querySelector('a')?.getAttribute('href') ?? '';
    expect(href).not.toContain('javascript:');
  });
});
