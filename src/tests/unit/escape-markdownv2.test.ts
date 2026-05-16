/**
 * T-033 · Tests del helper escapeMarkdownV2.
 *
 * Cobertura:
 *  - Escape de los 18 chars reservados de Telegram MarkdownV2.
 *  - Strings vacíos.
 *  - Strings sin chars reservados (passthrough).
 *  - Unicode + multi-byte preservado.
 *  - Idempotencia (escape de string ya escapado escapa los backslashes — esperado).
 */
import { describe, expect, it } from 'vitest';

import { escapeMarkdownV2 } from '@/shared/telegram/escape-markdownv2';

describe('escapeMarkdownV2', () => {
  it('escapa underscore', () => {
    expect(escapeMarkdownV2('hola_mundo')).toBe('hola\\_mundo');
  });

  it('escapa asterisco', () => {
    expect(escapeMarkdownV2('a*b')).toBe('a\\*b');
  });

  it('escapa brackets', () => {
    expect(escapeMarkdownV2('[link]')).toBe('\\[link\\]');
  });

  it('escapa parentesis', () => {
    expect(escapeMarkdownV2('texto (extra)')).toBe('texto \\(extra\\)');
  });

  it('escapa tilde, backtick, gt, hash, plus, eq', () => {
    expect(escapeMarkdownV2('~`>#+=')).toBe('\\~\\`\\>\\#\\+\\=');
  });

  it('escapa pipe, braces, dot, exclamation', () => {
    expect(escapeMarkdownV2('|{}.!')).toBe('\\|\\{\\}\\.\\!');
  });

  it('escapa minus (crítico para fechas YYYY-MM-DD)', () => {
    expect(escapeMarkdownV2('2026-06-15')).toBe('2026\\-06\\-15');
  });

  it('string vacío retorna vacío', () => {
    expect(escapeMarkdownV2('')).toBe('');
  });

  it('sin chars reservados → passthrough', () => {
    expect(escapeMarkdownV2('Hola Mundo 123 áéíóú ñ')).toBe('Hola Mundo 123 áéíóú ñ');
  });

  it('escapa los 18 chars reservados a la vez', () => {
    expect(escapeMarkdownV2('_*[]()~`>#+-=|{}.!')).toBe(
      '\\_\\*\\[\\]\\(\\)\\~\\`\\>\\#\\+\\-\\=\\|\\{\\}\\.\\!',
    );
  });

  it('preserva unicode (emojis, acentos)', () => {
    expect(escapeMarkdownV2('🔔 Vencimiento próximo')).toBe('🔔 Vencimiento próximo');
  });

  it('idempotencia parcial: escapar 2 veces escapa los backslashes', () => {
    const once = escapeMarkdownV2('a.b');
    const twice = escapeMarkdownV2(once);
    expect(once).toBe('a\\.b');
    // Backslash NO está en la lista de chars reservados → NO se escapa.
    // El punto SI se escapa la segunda vez tambien — produce \\.
    expect(twice).toBe('a\\\\.b');
  });

  it('string solo con chars seguros queda intacto incluso si parece markdown', () => {
    // Ojo: "negrita" sin asteriscos queda igual. Los asteriscos los escapamos.
    expect(escapeMarkdownV2('negrita')).toBe('negrita');
  });

  it('multi-byte chars (emojis 4-byte) no se rompen', () => {
    expect(escapeMarkdownV2('🇦🇷 Argentina')).toBe('🇦🇷 Argentina');
  });
});
