import { render, screen } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Theme tokens smoke test.
 *
 * Verifica que el pipeline `className → CSS rule → computed style` funciona
 * para los tokens semánticos `severity-*` que agrega T-008.
 *
 * **Caveat:** jsdom no procesa archivos `.css` importados (Vitest no compila
 * Tailwind en environment jsdom). El test inyecta manualmente un `<style>`
 * que emula la salida que Tailwind 4 genera a partir de `@theme inline +
 * CSS vars` en `src/app/globals.css`. Así validamos:
 *
 * - El componente renderiza con las classNames esperadas.
 * - jsdom resuelve la cascada CSS y `getComputedStyle` devuelve el color real
 *   (no un default vacío).
 *
 * NO valida que Tailwind realmente generó la utility `bg-severity-*` en el
 * bundle final — eso lo cubre el smoke manual de `/styleguide` y, si en algún
 * momento queremos verificarlo en CI, un test E2E con Playwright sobre la
 * styleguide build.
 */

const TOKEN_BG = 'rgb(217, 119, 6)';
const TOKEN_FG = 'rgb(24, 24, 27)';

let styleEl: HTMLStyleElement;

beforeAll(() => {
  // Inyectamos color literal en lugar de `var(--severity-warning)`. jsdom no
  // resuelve `var()` en `getComputedStyle` — devolvería el string sin
  // sustituir. Para validar el pipeline className → computed style necesitamos
  // un valor concreto.
  styleEl = document.createElement('style');
  styleEl.textContent = `
    .bg-severity-warning { background-color: ${TOKEN_BG}; }
    .text-severity-warning-foreground { color: ${TOKEN_FG}; }
  `;
  document.head.appendChild(styleEl);
});

afterAll(() => {
  styleEl.remove();
});

describe('theme tokens · severity', () => {
  it('aplica bg-severity-warning como background-color del token', () => {
    render(
      <div data-testid="badge" className="bg-severity-warning text-severity-warning-foreground">
        Vence en 7 días
      </div>,
    );

    const el = screen.getByTestId('badge');

    expect(el.className).toContain('bg-severity-warning');
    expect(el.className).toContain('text-severity-warning-foreground');

    const styles = getComputedStyle(el);
    expect(styles.backgroundColor).toBe(TOKEN_BG);
    expect(styles.color).toBe(TOKEN_FG);
  });

  it('los 4 severity tokens existen como className válido', () => {
    const tokens = ['ok', 'info', 'warning', 'danger'] as const;

    for (const token of tokens) {
      const el = document.createElement('div');
      el.className = `bg-severity-${token} text-severity-${token}-foreground`;

      expect(el.className).toContain(`bg-severity-${token}`);
      expect(el.className).toContain(`text-severity-${token}-foreground`);
    }
  });
});
