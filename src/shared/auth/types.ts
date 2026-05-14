import 'server-only';

/**
 * Forma materializada de la consultora del usuario logueado.
 *
 * Subset de `consultoras.Row` + role del membership, ya normalizado
 * (`plan_tier` → `planTier`, etc.). El `role` se proyecta a un union estricto
 * para que el árbol del shell no tenga que defender contra strings arbitrarios
 * (la columna en DB es `text`, pero a nivel app sólo hay dos valores).
 */
export type CurrentConsultora = {
  id: string;
  name: string;
  slug: string;
  planTier: string;
  trialEndsAt: string | null;
  role: 'owner' | 'member';
  /**
   * T-024: path dentro del bucket `consultora-logos`, o null si no se subio
   * un logo. El caller que necesite mostrarlo (Settings + PDF print) genera
   * una signed URL con TTL apropiado.
   */
  logoStoragePath: string | null;
};
