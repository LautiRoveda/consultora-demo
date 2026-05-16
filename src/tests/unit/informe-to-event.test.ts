import { describe, expect, it } from 'vitest';

import {
  buildDefaultEventoTitulo,
  mapInformeTipoToEventoConfig,
} from '@/shared/templates/informe-to-event';

describe('mapInformeTipoToEventoConfig', () => {
  it('rgrl -> rgrl_anual + 12m', () => {
    expect(mapInformeTipoToEventoConfig('rgrl')).toEqual({
      eventTipo: 'rgrl_anual',
      recurrenceMonths: 12,
    });
  });

  it('relevamiento -> protocolo_anual + 12m', () => {
    expect(mapInformeTipoToEventoConfig('relevamiento')).toEqual({
      eventTipo: 'protocolo_anual',
      recurrenceMonths: 12,
    });
  });

  it('capacitacion -> capacitacion + 12m', () => {
    expect(mapInformeTipoToEventoConfig('capacitacion')).toEqual({
      eventTipo: 'capacitacion',
      recurrenceMonths: 12,
    });
  });

  it('accidente -> null (one-off, sin recurrencia)', () => {
    expect(mapInformeTipoToEventoConfig('accidente')).toBeNull();
  });

  it('otros -> null (generico sin recurrencia clara)', () => {
    expect(mapInformeTipoToEventoConfig('otros')).toBeNull();
  });
});

describe('buildDefaultEventoTitulo', () => {
  it('con razon_social + tipo con prefix -> "<prefix> · <razon_social>"', () => {
    const result = buildDefaultEventoTitulo({
      informeTitulo: 'RGRL Acme SA 2026',
      razonSocial: 'Acme SA',
      eventTipo: 'rgrl_anual',
    });
    expect(result).toBe('RGRL anual · Acme SA');
  });

  it('protocolo_anual con razon_social', () => {
    const result = buildDefaultEventoTitulo({
      informeTitulo: 'Relevamiento de ruido Acme SA',
      razonSocial: 'Acme SA',
      eventTipo: 'protocolo_anual',
    });
    expect(result).toBe('Protocolo anual · Acme SA');
  });

  it('capacitacion con razon_social', () => {
    const result = buildDefaultEventoTitulo({
      informeTitulo: 'Capacitacion EPP Acme SA Marzo',
      razonSocial: 'Acme SA',
      eventTipo: 'capacitacion',
    });
    expect(result).toBe('Capacitacion · Acme SA');
  });

  it('razon_social null -> fallback al titulo del informe', () => {
    const result = buildDefaultEventoTitulo({
      informeTitulo: 'RGRL sin metadata',
      razonSocial: null,
      eventTipo: 'rgrl_anual',
    });
    expect(result).toBe('RGRL sin metadata');
  });

  it('razon_social vacio "" -> fallback al titulo del informe', () => {
    const result = buildDefaultEventoTitulo({
      informeTitulo: 'Fallback por razon social vacia',
      razonSocial: '',
      eventTipo: 'rgrl_anual',
    });
    expect(result).toBe('Fallback por razon social vacia');
  });

  it('tipo custom (sin prefix) -> fallback al titulo del informe aunque haya razon_social', () => {
    const result = buildDefaultEventoTitulo({
      informeTitulo: 'Custom event title',
      razonSocial: 'Acme SA',
      eventTipo: 'custom',
    });
    expect(result).toBe('Custom event title');
  });
});
