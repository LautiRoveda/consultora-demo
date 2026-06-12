/**
 * T-142 · FU2 · Tests del wizard de onboarding compacto/colapsable.
 * Render con/sin cliente, hrefs del paso 2, arranque colapsado por
 * `defaultCollapsed` y el toggle que persiste la cookie `onboarding_collapsed`.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { OnboardingWizard } from '@/app/(app)/onboarding/OnboardingWizard';

function clearCookies() {
  for (const c of document.cookie.split(';')) {
    const name = c.split('=')[0]?.trim();
    if (name) document.cookie = `${name}=; path=/; max-age=0`;
  }
}

afterEach(() => {
  cleanup();
  clearCookies();
});

describe('OnboardingWizard (T-142-FU2)', () => {
  it('sin cliente: indicador "0 de 2", botón "Crear cliente", sin paso 2', () => {
    render(<OnboardingWizard hasCliente={false} defaultCollapsed={false} />);

    expect(screen.getByText('0 de 2')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Crear cliente/i })).toHaveAttribute(
      'href',
      '/clientes/nuevo',
    );
    expect(screen.queryByRole('link', { name: /Generar informe/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Registrar EPP/i })).not.toBeInTheDocument();
  });

  it('con cliente: indicador "1 de 2", paso 1 listo, botones del paso 2 con sus hrefs', () => {
    render(<OnboardingWizard hasCliente={true} defaultCollapsed={false} />);

    expect(screen.getByText('1 de 2')).toBeInTheDocument();
    expect(screen.getByText(/Primer cliente/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Generar informe/i })).toHaveAttribute(
      'href',
      '/informes/nuevo',
    );
    expect(screen.getByRole('link', { name: /Registrar EPP/i })).toHaveAttribute(
      'href',
      '/epp/entregas/nueva',
    );
  });

  it('defaultCollapsed=true: arranca colapsado y el trigger expande el cuerpo', () => {
    render(<OnboardingWizard hasCliente={true} defaultCollapsed={true} />);

    // Colapsado: el cuerpo (botones del paso 2) no es visible.
    expect(screen.queryByRole('link', { name: /Generar informe/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Expandir/i }));

    expect(screen.getByRole('link', { name: /Generar informe/i })).toBeInTheDocument();
  });

  it('el toggle persiste el colapso en la cookie onboarding_collapsed', () => {
    render(<OnboardingWizard hasCliente={true} defaultCollapsed={false} />);

    // Expandido → colapsar escribe =1.
    fireEvent.click(screen.getByRole('button', { name: /Colapsar/i }));
    expect(document.cookie).toContain('onboarding_collapsed=1');

    // Colapsado → expandir escribe =0.
    fireEvent.click(screen.getByRole('button', { name: /Expandir/i }));
    expect(document.cookie).toContain('onboarding_collapsed=0');
  });
});
