import 'server-only';

/**
 * T-125 · Shim de compatibilidad. Las tools del asistente IA se movieron al
 * registry (`src/shared/ai/tools/`). Este archivo re-exporta los símbolos que
 * antes vivían acá para no romper imports existentes (el stream + el test del
 * dispatcher). Se elimina en el commit que migra esos imports a `tools/registry`.
 *
 * `EPP_CHAT_TOOLS` es ahora un alias de `CHAT_TOOLS` (que incluye TODOS los
 * módulos, no sólo EPP) — el nombre viejo se conserva sólo para el call site del
 * stream hasta que apunte a `CHAT_TOOLS`.
 */
export { CHAT_TOOLS as EPP_CHAT_TOOLS, dispatchTool } from '@/shared/ai/tools/registry';
export type { DispatchToolResult } from '@/shared/ai/tools/tool-result';
