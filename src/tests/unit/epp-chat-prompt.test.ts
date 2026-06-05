/**
 * T-117-FU1 · El system prompt del asistente lleva la fecha de hoy (TZ AR) para
 * que el modelo razone plazos de vencimiento. Test determinístico inyectando `now`.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

describe('buildEppChatSystemPrompt (T-117-FU1)', () => {
  it('incluye la fecha de hoy en formato AR (DD/MM/AAAA) + la TZ', async () => {
    const { buildEppChatSystemPrompt } = await import('@/shared/ai/prompts/epp-chat');
    // 12:00 UTC → en TZ AR (UTC-3) sigue siendo el 04/06/2026 (sin cruce de día).
    const prompt = buildEppChatSystemPrompt(new Date('2026-06-04T12:00:00Z'));
    expect(prompt).toContain('Hoy es 04/06/2026');
    expect(prompt).toContain('hora de Argentina');
  });

  it('mantiene el system prompt base (reglas anti-alucinación) como prefijo', async () => {
    const { buildEppChatSystemPrompt, EPP_CHAT_SYSTEM_PROMPT } =
      await import('@/shared/ai/prompts/epp-chat');
    const prompt = buildEppChatSystemPrompt(new Date('2026-06-04T12:00:00Z'));
    expect(prompt.startsWith(EPP_CHAT_SYSTEM_PROMPT)).toBe(true);
  });
});
