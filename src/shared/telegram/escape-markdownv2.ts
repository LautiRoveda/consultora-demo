/**
 * T-033 · Escape para Telegram Bot API parse_mode=MarkdownV2.
 *
 * Telegram MarkdownV2 reserva 18 caracteres que DEBEN ser escapados con
 * backslash si aparecen literales en el texto (no como sintaxis):
 *   _ * [ ] ( ) ~ ` > # + - = | { } . !
 *
 * Documentación oficial:
 *   https://core.telegram.org/bots/api#markdownv2-style
 *
 * Esta función NO escapa backslashes pre-existentes ni intenta detectar
 * sintaxis Markdown válida — escapa todos los chars reservados literalmente.
 * El caller que quiera usar sintaxis (bold *texto*, link [a](url), etc) debe
 * NO escapar esa parte y armar el mensaje template-by-template.
 *
 * Pattern de uso:
 *   const safeTitulo = escapeMarkdownV2(event.titulo);
 *   const message = `*${safeTitulo}*\n\nVence el ${safeFecha}`;
 */
export function escapeMarkdownV2(text: string): string {
  // Lista exacta de chars reservados según Telegram docs.
  // Backslash NO está en la lista (es el char de escape).
  // El char `.` y `-` necesitan escape también (común en fechas YYYY-MM-DD).
  return text.replace(/([_*[\]()~`>#+\-=|{}.!])/g, '\\$1');
}
