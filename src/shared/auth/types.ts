import 'server-only';

/**
 * Forma materializada de la consultora del usuario logueado.
 *
 * Subset de `consultoras.Row` + role del membership, ya normalizado
 * (`plan` → `plan`, `trial_hasta` → `trialHasta`, etc.). El `role` se proyecta a un union estricto
 * para que el árbol del shell no tenga que defender contra strings arbitrarios
 * (la columna en DB es `text`, pero a nivel app sólo hay dos valores).
 */
export type CurrentConsultora = {
  id: string;
  name: string;
  slug: string;
  plan: string;
  trialHasta: string | null;
  role: 'owner' | 'member';
  /**
   * T-024: path dentro del bucket `consultora-logos`, o null si no se subio
   * un logo. El caller que necesite mostrarlo (Settings + PDF print) genera
   * una signed URL con TTL apropiado.
   */
  logoStoragePath: string | null;
  /**
   * T-036: si true, al publicar un informe con tipo recurrente
   * (rgrl / relevamiento / capacitacion) se crea silently el calendar_event
   * con fecha = today + 12m (sin preguntar). Default false = modal post-firma.
   * Per-consultora, edit owner-only via updateAutoCreateEventToggleAction.
   */
  autoCreateEventOnSign: boolean;
};
