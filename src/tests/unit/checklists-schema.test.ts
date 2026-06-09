/**
 * T-058 · Unit tests del schema Zod de Checklists (bounds 1:1 con los CHECK de
 * T-057) + la lógica pura de auto-suffix de nombres (pickUniqueTemplateName).
 */
import { describe, expect, it } from 'vitest';

import { pickUniqueTemplateName } from '@/app/(app)/checklists/naming';
import {
  addItemSchema,
  addSectionSchema,
  cloneSystemTemplateSchema,
  createChecklistTemplateSchema,
  updateItemSchema,
  updateSectionSchema,
} from '@/app/(app)/checklists/schema';

// UUID v4 válido (version=4, variant=a) — z.string().uuid() en zod v4 valida el variant.
const UUID = '123e4567-e89b-42d3-a456-426614174000';

describe('createChecklistTemplateSchema', () => {
  it('parsea mínimo válido + default tipo_inspeccion=rgrl_463_09', () => {
    const r = createChecklistTemplateSchema.safeParse({ nombre: 'Checklist RGRL' });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.nombre).toBe('Checklist RGRL');
      expect(r.data.tipo_inspeccion).toBe('rgrl_463_09');
    }
  });

  it('trimea el nombre', () => {
    const r = createChecklistTemplateSchema.safeParse({ nombre: '  Mi Template  ' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.nombre).toBe('Mi Template');
  });

  it('rechaza nombre < 2', () => {
    expect(createChecklistTemplateSchema.safeParse({ nombre: 'A' }).success).toBe(false);
  });

  it('rechaza nombre > 200', () => {
    expect(createChecklistTemplateSchema.safeParse({ nombre: 'x'.repeat(201) }).success).toBe(
      false,
    );
  });

  it('rechaza descripcion > 2000', () => {
    const r = createChecklistTemplateSchema.safeParse({
      nombre: 'OK',
      descripcion: 'x'.repeat(2001),
    });
    expect(r.success).toBe(false);
  });

  it('acepta tipo_inspeccion=generico, rechaza otro', () => {
    expect(
      createChecklistTemplateSchema.safeParse({ nombre: 'OK', tipo_inspeccion: 'generico' })
        .success,
    ).toBe(true);
    expect(
      createChecklistTemplateSchema.safeParse({ nombre: 'OK', tipo_inspeccion: 'otro' }).success,
    ).toBe(false);
  });
});

describe('addSectionSchema', () => {
  it('parsea válido', () => {
    const r = addSectionSchema.safeParse({ versionId: UUID, titulo: 'Servicio HyS' });
    expect(r.success).toBe(true);
  });

  it('rechaza titulo vacío', () => {
    const r = addSectionSchema.safeParse({ versionId: UUID, titulo: '   ' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.some((i) => i.path[0] === 'titulo')).toBe(true);
  });

  it('rechaza titulo > 200', () => {
    expect(addSectionSchema.safeParse({ versionId: UUID, titulo: 'x'.repeat(201) }).success).toBe(
      false,
    );
  });

  it('rechaza versionId no-uuid', () => {
    expect(addSectionSchema.safeParse({ versionId: 'nope', titulo: 'S' }).success).toBe(false);
  });
});

describe('addItemSchema', () => {
  it('parsea válido + defaults (cumple_no_aplica / false / true)', () => {
    const r = addItemSchema.safeParse({ sectionId: UUID, texto: '¿Cumple X?' });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.response_type).toBe('cumple_no_aplica');
      expect(r.data.es_critico).toBe(false);
      expect(r.data.es_requerido).toBe(true);
    }
  });

  it('rechaza texto vacío y texto > 1000', () => {
    expect(addItemSchema.safeParse({ sectionId: UUID, texto: '' }).success).toBe(false);
    expect(addItemSchema.safeParse({ sectionId: UUID, texto: 'x'.repeat(1001) }).success).toBe(
      false,
    );
  });

  it('valida response_type contra el enum', () => {
    expect(
      addItemSchema.safeParse({ sectionId: UUID, texto: 'T', response_type: 'si_no' }).success,
    ).toBe(true);
    expect(
      addItemSchema.safeParse({ sectionId: UUID, texto: 'T', response_type: 'xxx' }).success,
    ).toBe(false);
  });

  it('rechaza referencia_normativa > 300', () => {
    const r = addItemSchema.safeParse({
      sectionId: UUID,
      texto: 'T',
      referencia_normativa: 'x'.repeat(301),
    });
    expect(r.success).toBe(false);
  });
});

describe('updateSectionSchema / updateItemSchema · refine ≥1 campo', () => {
  it('updateSection sin campos (solo id) → invalid', () => {
    expect(updateSectionSchema.safeParse({ sectionId: UUID }).success).toBe(false);
  });

  it('updateSection con titulo → ok; descripcion null (clear) → ok', () => {
    expect(updateSectionSchema.safeParse({ sectionId: UUID, titulo: 'Nuevo' }).success).toBe(true);
    expect(updateSectionSchema.safeParse({ sectionId: UUID, descripcion: null }).success).toBe(
      true,
    );
  });

  it('updateItem sin campos → invalid; con es_critico → ok', () => {
    expect(updateItemSchema.safeParse({ itemId: UUID }).success).toBe(false);
    expect(updateItemSchema.safeParse({ itemId: UUID, es_critico: true }).success).toBe(true);
  });
});

describe('cloneSystemTemplateSchema', () => {
  it('nombre es opcional', () => {
    expect(cloneSystemTemplateSchema.safeParse({ systemTemplateId: UUID }).success).toBe(true);
    expect(
      cloneSystemTemplateSchema.safeParse({ systemTemplateId: UUID, nombre: 'Mi RGRL' }).success,
    ).toBe(true);
  });

  it('rechaza systemTemplateId no-uuid y nombre < 2', () => {
    expect(cloneSystemTemplateSchema.safeParse({ systemTemplateId: 'no' }).success).toBe(false);
    expect(
      cloneSystemTemplateSchema.safeParse({ systemTemplateId: UUID, nombre: 'A' }).success,
    ).toBe(false);
  });
});

describe('pickUniqueTemplateName', () => {
  it('devuelve base si está libre', () => {
    expect(pickUniqueTemplateName('RGRL', new Set())).toBe('RGRL');
  });

  it('sufija (copia) si base está tomado', () => {
    expect(pickUniqueTemplateName('RGRL', new Set(['RGRL']))).toBe('RGRL (copia)');
  });

  it('escala a (copia 2), (copia 3) …', () => {
    expect(pickUniqueTemplateName('RGRL', new Set(['RGRL', 'RGRL (copia)']))).toBe(
      'RGRL (copia 2)',
    );
    expect(
      pickUniqueTemplateName('RGRL', new Set(['RGRL', 'RGRL (copia)', 'RGRL (copia 2)'])),
    ).toBe('RGRL (copia 3)');
  });

  it('capa el resultado a max caracteres', () => {
    const base = 'x'.repeat(200);
    expect(pickUniqueTemplateName(base, new Set(), 200)).toHaveLength(200);
  });
});
