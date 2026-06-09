/**
 * T-131 · Tests del mapa drill-to-action del dashboard.
 *
 * Cubre: las 2 acciones de pilar (EPP/protocolo), el fallback "Ver en agenda"
 * del resto, y exhaustividad (todo `tipo` del calendario resuelve un CTA).
 */
import { describe, expect, it } from 'vitest';

import { EVENT_TIPO_VALUES } from '@/app/(app)/calendario/defaults';
import { drillToAction } from '@/app/(app)/dashboard/drill-to-action';

const EV = (tipo: string) => ({ id: 'evt-123', tipo });

describe('drillToAction', () => {
  it('epp_entrega → planilla Res 299/11 (pilar)', () => {
    expect(drillToAction(EV('epp_entrega'))).toEqual({
      label: 'Generar planilla Res 299/11',
      href: '/epp/entregas/nueva',
      kind: 'pilar',
    });
  });

  it('protocolo_anual → generar informe con IA (pilar)', () => {
    expect(drillToAction(EV('protocolo_anual'))).toEqual({
      label: 'Generar informe con IA',
      href: '/informes/nuevo',
      kind: 'pilar',
    });
  });

  it('tipos sin acción de pilar → "Ver en agenda" con deep-link al evento', () => {
    const sinPilar = [
      'rgrl_anual',
      'capacitacion',
      'calibracion',
      'examen_medico',
      'custom',
      'accion_correctiva',
    ];
    for (const tipo of sinPilar) {
      expect(drillToAction(EV(tipo))).toEqual({
        label: 'Ver en agenda',
        href: '/calendario/agenda?event=evt-123',
        kind: 'agenda',
      });
    }
  });

  it('es exhaustivo: todo tipo del calendario resuelve un CTA con label y href', () => {
    for (const tipo of EVENT_TIPO_VALUES) {
      const action = drillToAction(EV(tipo));
      expect(action.label.length).toBeGreaterThan(0);
      expect(action.href.length).toBeGreaterThan(0);
    }
  });

  it('tipo desconocido (drift defensivo) cae a "Ver en agenda"', () => {
    expect(drillToAction(EV('tipo_inexistente')).kind).toBe('agenda');
  });
});
