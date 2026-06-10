import { describe, expect, it } from 'vitest';

import {
  renderCamposPersonalizadosBlock,
  renderEstructuraSolicitadaBlock,
  renderInstruccionesAdicionalesBlock,
} from '@/shared/templates/common/render-extra';

/**
 * T-138 fase 1 · Formato de los bloques de personalizacion del user message.
 *
 * El contrato "ausente → []" es backward-compat critico: un informe sin
 * personalizacion debe producir un user message byte-identico a pre-T-138.
 * La parte adversarial (payloads de inyeccion completos) vive en
 * templates-seguridad-injection.test.ts; aca se ancla el formato.
 */

describe('renderCamposPersonalizadosBlock', () => {
  it('ausente o vacio → [] (user message identico a pre-T-138)', () => {
    expect(renderCamposPersonalizadosBlock(undefined)).toEqual([]);
    expect(renderCamposPersonalizadosBlock([])).toEqual([]);
  });

  it('formato: header + un bullet "label: valor" por campo + linea vacia final', () => {
    const lines = renderCamposPersonalizadosBlock([
      { label: 'N° de expediente', valor: 'EXP-2026-001' },
      { label: 'Norma interna', valor: 'IRAM 3800' },
    ]);
    expect(lines).toEqual([
      '**Campos personalizados (definidos por el consultor):**',
      '- N° de expediente: EXP-2026-001',
      '- Norma interna: IRAM 3800',
      '',
    ]);
  });

  it('sanitiza backticks y colapsa valores multilinea a una sola linea', () => {
    const lines = renderCamposPersonalizadosBlock([
      { label: 'Equipo `critico`', valor: 'linea 1\nlinea 2\n# heading' },
    ]);
    expect(lines).toEqual([
      '**Campos personalizados (definidos por el consultor):**',
      "- Equipo 'critico': linea 1 linea 2 # heading",
      '',
    ]);
  });
});

describe('renderEstructuraSolicitadaBlock (T-138 fase 2)', () => {
  const LABELS = { objeto: 'Objeto del informe', alcance: 'Alcance' };

  it('ausente o vacio → [] (informe en estructura estandar, sin bloque)', () => {
    expect(renderEstructuraSolicitadaBlock(undefined, LABELS)).toEqual([]);
    expect(renderEstructuraSolicitadaBlock([], LABELS)).toEqual([]);
  });

  it('lista numerada: catalogo por label (trusted) + custom sanitizada con descripcion', () => {
    const lines = renderEstructuraSolicitadaBlock(
      [
        { kind: 'catalogo', seccion_id: 'alcance' },
        { kind: 'custom', titulo: 'Plan de izaje', descripcion: 'Secuencia y señalero' },
        { kind: 'catalogo', seccion_id: 'objeto' },
      ],
      LABELS,
    );
    expect(lines).toEqual([
      '**Estructura solicitada (el informe debe contener SOLO estas secciones, en este orden):**',
      '1. Alcance',
      '2. [Sección personalizada] Plan de izaje — Secuencia y señalero',
      '3. Objeto del informe',
      '',
    ]);
  });

  it('custom sin descripcion: solo titulo; titulo malicioso queda sanitizado e inline', () => {
    const lines = renderEstructuraSolicitadaBlock(
      [{ kind: 'custom', titulo: 'Izaje `critico`\n# inyectado' }],
      LABELS,
    );
    expect(lines[1]).toBe("1. [Sección personalizada] Izaje 'critico' # inyectado");
    expect(lines.join('\n')).not.toContain('`');
  });
});

describe('renderInstruccionesAdicionalesBlock', () => {
  it('ausente → []', () => {
    expect(renderInstruccionesAdicionalesBlock(undefined)).toEqual([]);
    // '' no llega aca (normalize la dropea), pero el guard truthy la cubre.
    expect(renderInstruccionesAdicionalesBlock('')).toEqual([]);
  });

  it('header marca la jerarquia + contenido blockquoteado por linea', () => {
    const lines = renderInstruccionesAdicionalesBlock('priorizá EPP\nconclusiones simples');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('Instrucciones adicionales del consultor');
    expect(lines[0]).toContain('NUNCA modifican las reglas');
    expect(lines[1]).toBe('> priorizá EPP\n> conclusiones simples');
    expect(lines[2]).toBe('');
  });

  it('sanitiza antes de blockquotear (backticks + heading injection)', () => {
    const lines = renderInstruccionesAdicionalesBlock('usa ```code```\n# inyectado');
    const body = lines[1]!;
    expect(body).not.toContain('`');
    // Toda linea del cuerpo queda dentro del blockquote.
    for (const l of body.split('\n')) {
      expect(l.startsWith('> ')).toBe(true);
    }
  });
});
