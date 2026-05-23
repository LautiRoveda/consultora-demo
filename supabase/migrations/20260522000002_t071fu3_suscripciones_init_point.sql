-- =============================================================================
-- T-071-FU3 · ADD COLUMN suscripciones.init_point
-- =============================================================================
--
-- Persiste la URL del checkout MP devuelta por createPreapproval para permitir
-- recovery flow cuando el user abandona el flow a mitad. La UI muestra 2
-- botones en suscripciones estado='pendiente_autorizacion': continuar con el
-- init_point existente, o cancelar y empezar de nuevo.
--
-- NULL después de que la sub se autorice (no se usa más). NULL en suscripciones
-- legacy creadas pre-FU3 — el SubscribeButton hace fallback al re-crear si
-- detecta init_point null defensivamente.
--
-- Audit trigger NO se modifica: init_point es operacional (URL pública del
-- checkout), no semántico — no agregar al diff guard ni al payload.

alter table public.suscripciones add column init_point text;

comment on column public.suscripciones.init_point is
  'T-071-FU3: URL del checkout MP guardada al crear preapproval. Permite recovery cuando el user abandona el flow. NULL post-autorizacion (no se usa mas).';
