# Auditoría detallada · 2026-05-25 · V2

> Profundización de `docs/auditoria-2026-05-25.md` con archivos concretos,
> snippets SQL/TS, smoke tests, esfuerzo en horas. Cada hallazgo lleva el ID
> de V1. Lo que sumo:
>
> - **Archivos** (path real verificado vs `src/`).
> - **Implementación** (SQL/TS snippet concreto, no pseudo-código).
> - **Smoke test** (1-3 comandos copy-pasteable).
> - **Esfuerzo** (horas dev solo).
> - **Dependencias** (hallazgos forward/backward).
> - **Rollback path**.
>
> Si un hallazgo es trivial (D-series, F-series marketing), queda breve.
> Si es crítico (C1/I1/A1/A6), va a 300-500 palabras.

---

## A. Producto

### A1 · Trazabilidad EPP per-empleado + alerta 6m por canal preferido
**Esfuerzo: 16-24h · Depende de: Sprint 5 cerrado (T-100..T-106)**

**Archivos a tocar**:
- NEW `src/app/(app)/clientes/[id]/empleados/[empleadoId]/page.tsx` — detail empleado con tabs (Datos / Entregas EPP / Capacitaciones / Riesgos).
- NEW `src/app/(app)/clientes/[id]/empleados/[empleadoId]/EmpleadoEntregasTab.tsx` — lista cronológica.
- NEW `src/app/(app)/empleados/queries.ts:getEntregasByEmpleado(empleadoId)` — query agregado items + categoría + foto firma.
- MOD `src/shared/notifications/email-templates/` — template `epp-renovacion-individual.tsx` con vars `{empleado_nombre, items, fecha_vencimiento}`.
- MOD `src/shared/telegram/message-templates/` — template equivalente.
- NEW migration `supabase/migrations/<ts>_epp_alerta_individual_offsets.sql` — change `reminder_offsets_days` default per item type (descartable: [], registrable: [14, 3, 0], crítico arnés: [30, 14, 7, 1]).

**Implementación core** (query):
```ts
// src/app/(app)/empleados/queries.ts
export async function getEntregasByEmpleado(
  supabase: SupabaseClient<Database>,
  empleadoId: string,
) {
  return supabase
    .from('epp_entregas')
    .select(`
      id, fecha_entrega, motivo_entrega, created_at,
      epp_entrega_items(
        id, numero_serie, vida_util_meses_override,
        epp_items(nombre, requiere_numero_serie, vida_util_meses, epp_categorias(nombre))
      ),
      firma_url
    `)
    .eq('empleado_id', empleadoId)
    .order('fecha_entrega', { ascending: false });
}
```

**Smoke**:
```bash
# 1. crear 2 entregas para mismo empleado, ver tab muestra ambas con badge "vencido en 2 meses"
# 2. recibir email/Telegram a 14d/3d/0d del vencimiento
# 3. supabase studio: select count(*) from epp_planificaciones where empleado_id='X' and estado='activa'
```

**Rollback**: solo UI + migration sin DROP. Soft revert via git revert. <2min.

**Dependencias**: Sprint 5 completo. Si T-104 (planilla 299/11) o T-105 (calendario auto) no están, esto no tiene valor.

---

### A2 · Chat IA contextual sobre data del tenant
**Esfuerzo: 40-60h · Depende de: A1 + EPP completo**

**Archivos**:
- NEW `src/app/(app)/chat/page.tsx` — UI ChatGPT-style con history.
- NEW `src/app/api/chat/route.ts` — endpoint streaming SSE con tool-use.
- NEW `src/shared/ai/chat-tools.ts` — definición de tools constrained al tenant:
  ```ts
  export const CHAT_TOOLS = [
    {
      name: 'search_empleados',
      description: 'Busca empleados por nombre/apellido/DNI/puesto.',
      input_schema: z.object({ q: z.string().max(100) })
    },
    {
      name: 'get_entregas_empleado',
      description: 'Lista las entregas EPP de un empleado.',
      input_schema: z.object({ empleado_id: z.string().uuid() })
    },
    {
      name: 'search_informes',
      description: 'Busca informes por título/tipo/cliente.',
      input_schema: z.object({ q: z.string().max(100), tipo: z.enum([...]).optional() })
    },
    // ... 8-12 tools total
  ];
  ```
- NEW migration `chat_sessions` (id, consultora_id, user_id, started_at) + `chat_messages` (FK session, role, content, tokens, tool_calls jsonb).
- MOD `src/env.ts` — sumar `ANTHROPIC_CHAT_MODEL` default `claude-sonnet-4-6` (caro pero tools requieren razonamiento).

**Costo proyección**: ~$0.05-0.20 por conversación promedio (5-15 mensajes, cache hit del system prompt ~80%). Plan Pro USD 30 → 150-600 chats/mes posible sin margen negativo. Sumar cap `chat_messages` por mes por consultora.

**Smoke**:
```bash
# 1. user: "fulano rodríguez qué se le entregó la última vez"
# 2. Claude llama search_empleados("rodriguez") → get_entregas_empleado(uuid) → responde
# 3. verificar audit_log row con action='chat_query' + ai_usage_log row
```

**Rollback**: feature flag `consultoras.feature_chat_enabled boolean default false`. Toggle off + redeploy <5min.

**Dependencias forward**: G1 funnel (medir % users que usan chat).

---

### A3 · Casi-accidente vs accidente real
**Esfuerzo: 8-12h**

**Archivos**:
- MOD `src/shared/templates/accidente/schema.ts` — sumar campo discriminante:
  ```ts
  export const accidenteSchema = z.object({
    ...commonClientFields(),
    tipo_accidente: z.enum(['casi_accidente', 'accidente_real']),
    fecha_evento: z.string(),
    // condicionales según tipo_accidente
    ...,
  });
  ```
- MOD `src/shared/ai/prompts/accidente.ts` — branch del prompt:
  ```ts
  export function buildAccidentePrompt(input: AccidenteInput): string {
    if (input.tipo_accidente === 'casi_accidente') {
      return CASI_ACCIDENTE_PROMPT + JSON.stringify(input);
    }
    return ACCIDENTE_REAL_PROMPT + JSON.stringify(input);
  }
  ```
- MOD `src/shared/templates/accidente/AccidenteForm.tsx` — radio inicial + render condicional fields.

**Implementación prompt diferenciado**:
- Casi-accidente: enfoque preventivo, jerarquía de controles, NO denuncia ART, lecciones aprendidas.
- Accidente real: denuncia ART (campos formales art. 30 Ley 24.557), días de baja, parte médico, seguimiento.

**Smoke**:
```bash
# generar 1 informe de cada tipo, verificar prompt distinto en logs + output con secciones distintas
```

**Rollback**: feature flag `accidente_v2_enabled`. Default off mientras testeás.

---

### A4 · Checklists personalizables (M8 + M9 diferidos)
**Esfuerzo: 80-120h sprint dedicado**

**Hold**: NO arrancar pre-launch. Trigger: 3 clientes pidiéndolo. Cuando llegue, briefing CC tipo Sprint 6 original T-057..T-061.

---

### A5 · Carga foto + OCR EPP
**Esfuerzo: 24-32h**

**Archivos**:
- NEW `src/app/api/epp/entregas/from-photo/route.ts` — POST multipart photo → Claude vision → parse → preview JSON → confirm endpoint.
- NEW `src/shared/ai/vision/parse-planilla-299.ts` — prompt vision específico:
  ```
  Sos un parser de planillas Res SRT 299/11. La imagen es una planilla papel con:
  - Empleado: nombre, DNI, firma
  - Items entregados: lista de EPP con cantidades
  - Fecha
  Devolveme JSON shape { empleado_dni, fecha, items: [{ nombre, cantidad }] }
  Si la imagen NO es una planilla 299, devolveme { error: 'NOT_PLANILLA_299' }.
  ```
- MOD `src/app/(app)/epp/entregas/nueva/EntregaWizard.tsx` — paso "subir foto opcional" pre-form con preview de fields auto-poblados.

**Costo**: Sonnet 4.6 vision ~$0.05 por foto. Hard cap 50 fotos/mes por consultora (plan Pro).

**Smoke**:
```bash
# foto real planilla → preview muestra fields → user corrige errores OCR → confirma → entrega creada
```

**Rollback**: feature flag `ocr_enabled`.

---

### A6 · Tablas SRT al prompt IA
**Esfuerzo: 24-32h · Top diferenciador**

**Archivos**:
- NEW `src/shared/ai/srt-tables/index.ts` — export consts por res:
  ```ts
  // src/shared/ai/srt-tables/res-85-12-ruido.ts
  export const RES_85_12_RUIDO = {
    norma: 'Res SRT 85/12',
    vigencia_desde: '2012-04-01',
    parametros: {
      tlv_8h_dBA: 85,
      criterio_pico_dBC: 140,
      escala_dosimetria: [/* tabla NIOSH adaptada */],
    },
    formato_informe: { ... },
  };

  // src/shared/ai/srt-tables/res-84-12-iluminacion.ts
  export const RES_84_12_ILUMINACION = {
    tabla_lux_por_actividad: [
      { actividad: 'Oficina general', lux_minimo: 500 },
      { actividad: 'Tareas finas', lux_minimo: 750 },
      // ... ~40 entries
    ],
  };

  // src/shared/ai/srt-tables/res-295-03-quimicos.ts (más pesado, ~600 sustancias)
  ```
- MOD `src/shared/ai/prompts/relevamiento.ts` — injection condicional según `agente` seleccionado:
  ```ts
  function buildRelevamientoPrompt(input: RelevamientoInput): MessageContent[] {
    const tableContent = injectSRTTables(input.agentes_evaluados);
    return [
      {
        type: 'text',
        text: tableContent,
        cache_control: { type: 'ephemeral' }, // E5 cross-ref
      },
      { type: 'text', text: JSON.stringify(input) },
    ];
  }
  ```
- NEW `src/shared/ai/srt-tables/README.md` — política de actualización (al cambiar una Res SRT, bump version + commit + ADR).

**Implementación clave**: usar prompt caching ephemeral (E5) porque las tablas pesan ~3-5k tokens — sin cache, cada generación paga full input. Con cache, segunda+ generación del mismo día = ~90% off.

**Disclaimer obligatorio** en el output: agregar al system prompt:
```
SIEMPRE incluir al final del informe: "Valores de referencia
Res XX/YY del SRT versión <vigencia_desde>. Verificar vigencia
actual en https://www.srt.gob.ar antes de presentar legalmente."
```

**Smoke**:
```bash
# 1. generar informe relevamiento ruido con datos 92 dB(A) jornada 8h
# 2. verificar output cita "supera TLV 85 dB(A) Res 85/12 SRT, exposición no permitida"
# 3. verificar audit_log payload incluye agente + cache_read_input_tokens > 0
```

**Rollback**: el feature degrada gracefully — si quitás el injection, los prompts vuelven al estado actual. <5min revert.

**Dependencias forward**: A7 (RGRL pre-llenado) usa estas tablas para Res 463/09 indicadores.

---

### A7 · RGRL anual pre-llenado 80%
**Esfuerzo: 24-32h · Depende de A6**

**Archivos**:
- NEW `src/app/(app)/informes/nuevo/rgrl/getContext.ts`:
  ```ts
  export async function getRGRLContext(
    supabase: SupabaseClient<Database>,
    clienteId: string,
    periodo: { desde: string; hasta: string },
  ): Promise<RGRLContext> {
    const [empleados, entregas, accidentes, capacitaciones] = await Promise.all([
      supabase.from('empleados').select('...').eq('cliente_id', clienteId).is('archived_at', null),
      supabase.from('epp_entregas').select('...').eq('cliente_id', clienteId).gte('fecha_entrega', periodo.desde),
      supabase.from('informes').select('...').eq('cliente_id', clienteId).eq('tipo', 'accidente').gte('created_at', periodo.desde),
      supabase.from('informes').select('...').eq('cliente_id', clienteId).eq('tipo', 'capacitacion').gte('created_at', periodo.desde),
    ]);
    return { empleados: empleados.data, entregas, ... };
  }
  ```
- MOD `src/shared/templates/rgrl/schema.ts` — sumar campo `auto_fill_from_data: boolean` (default true). UI muestra "Auto-completar desde mis datos" toggle.
- MOD `src/shared/ai/prompts/rgrl.ts` — branch: si `auto_fill_from_data` → injection del context.

**Trade-off**: el RGRL requiere `accidentes` table real (A10 + A18) para los 8 índices. Sin esa data, el pre-llenado es parcial (~60% no 80%). Si esperamos a A10/A18, esto queda L. Si arrancamos sin índices, M y mejoramos en iteración.

**Smoke**:
```bash
# 1. cliente con 30 empleados + 5 entregas EPP + 1 accidente histórico
# 2. generar RGRL → output incluye secciones pre-llenadas: lista personal, EPP entregado, accidentes mes
# 3. consultor edita el 20% restante en <30 min
```

**Rollback**: toggle UI off + revert prompt change.

---

### A8 · Import CSV empleados/clientes
**Esfuerzo: 16-24h**

**Archivos**:
- NEW `src/app/(app)/clientes/import/page.tsx` — upload CSV + preview tabla + commit.
- NEW `src/app/(app)/empleados/import/page.tsx` — idem.
- NEW `src/app/api/clientes/import-csv/route.ts` — POST CSV → parse → validate per-row con Zod → dedup CUIT → return preview JSON con errors per-row.
- NEW `src/shared/lib/csv-parser.ts` — wrapper papaparse + Zod row validator.

**Implementación key**: NO usar `papaparse` directo en endpoint (parsea full file en memory). Stream parse con `papaparse.parse` streaming mode + cap 5000 rows por upload.

**Smoke**:
```bash
# 1. csv con 100 empleados → preview muestra 95 OK + 5 errors (DNI inválido)
# 2. confirm → bulk insert con audit_log entry "import_csv: 95 rows"
# 3. retry con mismo CSV → dedup detecta los 95 + idempotente
```

**Rollback**: feature flag.

---

### A9 · WhatsApp Business API
**Esfuerzo: 40-60h incl onboarding Meta (~7d calendario)**

**Hold pre-launch**: NO antes de 5 clientes pagos. Meta template approval toma 24-48h cada uno, y vas a necesitar 5-8 templates (welcome, EPP renewal, calendar event, dunning, password reset, etc).

**Archivos previstos**:
- NEW `src/shared/notifications/senders/whatsapp.ts` — adapter Meta Cloud API.
- NEW `src/app/(app)/settings/notificaciones/WhatsAppLink.tsx` — UI opt-in con verify por código.
- NEW migration `whatsapp_subscriptions` (user_id, phone_e164, verified_at).

**Costo**: ~USD 0.005-0.05 por mensaje. Plan Pro 600 notif/mes WhatsApp = USD 3-30. Hardware cap necesario.

---

### A10 · 8 índices SRT (Res 463/09)
**Esfuerzo: 16-24h · Depende de A18**

**Archivos**:
- NEW migration `incidents` table (separada del tipo `accidente` informe):
  ```sql
  create table public.incidents (
    id uuid primary key default gen_random_uuid(),
    consultora_id uuid not null references consultoras(id),
    cliente_id uuid not null references clientes(id),
    empleado_id uuid references empleados(id) on delete set null,
    fecha date not null,
    gravedad text check (gravedad in ('leve','grave','grave_con_baja','mortal')),
    dias_perdidos int default 0,
    denuncia_art_id text, -- código denuncia ART
    informe_id uuid references informes(id),
    causa_raiz text,
    created_at timestamptz default now()
  );
  ```
- NEW `src/shared/lib/srt-indices.ts`:
  ```ts
  export function calculateIF(accidentes: number, horasTrabajadas: number): number {
    return (accidentes * 1_000_000) / horasTrabajadas;
  }
  // ... IG, ID, Incidencia, PESE, etc. 8 funciones
  ```
- NEW page `src/app/(app)/indicadores/page.tsx` — dashboard 8 cards + export PDF.

**Smoke**:
```bash
# 1. cargar 10 incidentes año 2026, dotación 30 personas
# 2. /indicadores muestra IF=1.85, IG=12.3, etc
# 3. export PDF Res 463 con tabla firmable
```

---

### A11 · IPER matriz de riesgos
**Esfuerzo: 60-80h · Fase 2**

Hold. Briefing CC futuro cuando llegue.

### A12 · Capacitaciones módulo dedicado
**Esfuerzo: 60-80h · Fase 2**

Hold.

### A13 · Exámenes médicos
**Esfuerzo: 60-80h · Fase 2**

Hold.

### A14 · Cronograma CIIU
**Esfuerzo: 80-120h · Hold indefinido**

NO recomendado MVP. Data entry pesado para curar 53 obligaciones × ~100 CIIUs.

### A15 · Tabla `establecimientos`
**Esfuerzo: 32-48h · Fase 3**

Migration + add FK opcional a empleados/informes/entregas. Backfill default "Sede principal" para tenants existentes.

### A16 · Marca blanca por plan
**Esfuerzo: 8-16h · Bloquear con Plan Team launch**

**Archivos**:
- MOD `src/app/(print)/informes/[id]/print/page.tsx` — render condicional del footer "Generado con ConsultoraDemo":
  ```tsx
  {plan === 'team' || plan === 'enterprise' ? null : (
    <footer className="text-xs">Generado con ConsultoraDemo</footer>
  )}
  ```

---

### A17 · Resumen semanal Telegram lunes
**Esfuerzo: 6-10h · Quick win**

**Archivos**:
- NEW migration `supabase/migrations/<ts>_weekly_summary_cron.sql`:
  ```sql
  select cron.schedule(
    'weekly_summary_lunes_09_ar',
    '0 12 * * 1', -- lunes 09:00 ART = 12:00 UTC
    $$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'cron_dispatch_base_url') || '/api/cron/weekly-summary',
      headers := jsonb_build_object('X-Cron-Secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_dispatch_secret'))
    );
    $$
  );
  ```
- NEW `src/app/api/cron/weekly-summary/route.ts` — iterate consultoras → query próximos 7d → enviar Telegram via existing sender.
- NEW SQL function `get_weekly_summary(user_id uuid)` — agrega entregas + capacitaciones + informes próximos.

**Smoke**:
```bash
# manual trigger: curl -H "X-Cron-Secret: $SECRET" https://consultora-demo.test-ia.cloud/api/cron/weekly-summary
# verificar bot Telegram recibe mensaje en chat de Lautaro
```

**Rollback**: `select cron.unschedule('weekly_summary_lunes_09_ar');`

---

### A18 · Tabla incidentes
**Esfuerzo: combinado con A10. ~12h adicional.**

Ya cubierto en A10.

---

## B. Arquitectura

### B1 · Doc drift `src/modules/`
**Esfuerzo: 2-3h**

**Archivos a editar**:
- `docs/technical/02-architecture.md` — reemplazar todas las menciones de `src/modules/<nombre>/` por `src/app/(app)/<route>/ + src/shared/<área>/`.
- `docs/technical/04-folder-structure.md` — sweep similar.
- `CLAUDE.md` línea 29 + línea 33 — actualizar.

**Diff concreto sample CLAUDE.md L29**:
```diff
- `src/` (`app/` rutas Next.js · `modules/` 14 módulos · `shared/` UI base + supabase + ai + observability · `tests/` unit + integration + e2e)
+ `src/` (`app/` rutas Next.js + Server Actions/queries co-located por route bajo `(app)/<modulo>/` · `shared/` infra cross-módulo (ai, supabase, notifications, billing, ui base, observability) · `tests/` unit + integration + e2e)
```

**Smoke**: `grep -r "src/modules" docs/ CLAUDE.md` → output vacío post-edit.

---

### B2 · `getInformesByClienteId` cap 50
**Esfuerzo: 1-2h**

**Archivos**:
- MOD `src/app/(app)/clientes/queries.ts:getInformesByClienteId` — sumar params `{ page, pageSize }` con default 50.
- MOD `src/app/(app)/clientes/[id]/page.tsx` — sumar pagination UI cuando `linkedInformes.length === 50` (heurística "podría haber más").

**Smoke**:
```bash
# cliente con 100 informes → primera página 50 + botón "ver más" → fetch página 2
```

---

### B3 · Search client-side filter
**Esfuerzo: 12-16h (cuando aplique)**

Diferible. Cuando trigger: agregar índice GIN trigram:
```sql
create extension if not exists pg_trgm;
create index idx_clientes_search_trgm on clientes using gin (
  (razon_social || ' ' || coalesce(nombre_fantasia, '')) gin_trgm_ops
) where archived_at is null;
```
Cambiar `searchClientesByRazonSocial` a usar `ts_query` en lugar de `.ilike()`.

---

### B4 · PDF Puppeteer pool
**Esfuerzo: 16-24h cuando aplique**

Hold. Trigger: alerta Sentry OOM o `docker stats` > 80% RAM sostenido.

**Implementación**: singleton browser con N pages reusables + queue requests + TTL idle 5min.

---

### B5 · `notification_log` partición
**Esfuerzo: 8-12h cuando aplique**

Hold. Trigger: `select count(*) from notification_log` > 100k.

```sql
-- partition by range (created_at)
create table notification_log_partitioned (like notification_log including all)
  partition by range (created_at);
create table notification_log_2026q3 partition of notification_log_partitioned
  for values from ('2026-07-01') to ('2026-10-01');
-- migrate data, drop old
```

---

### B6 · `audit_log` retención política
**Esfuerzo: 16-24h · Combinable con I1**

**Archivos**:
- NEW migration `<ts>_audit_log_partition_monthly.sql` — convert a partition by month.
- NEW `src/app/api/cron/audit-log-archive/route.ts` — daily cron archive rows > 12 meses al bucket Storage + DROP partition.

Combinar con I1 (Ley 25.326): el cron retention también archiva audit_log del tenant cancelado.

---

### B7 · Cross-tenant defense pre-INSERT audit
**Esfuerzo: 4-8h sweep**

**Pasos**:
1. `grep -rn "createServiceRoleClient\|createClient" src/app -A3 | grep -E "insert\(|upsert\("` — identificar todos los INSERTs.
2. Para cada uno, verificar si el payload incluye FK cross-módulo desde `parsed.data` (input usuario).
3. Aplicar pattern T-050: SELECT RLS-aware antes del INSERT.

**Endpoints específicos a auditar**:
- `src/app/(app)/epp/entregas/actions.ts:createEntregaAction` — `empleado_id` desde input.
- `src/app/(app)/calendario/actions.ts:createEventAction` — `informe_id` opcional.
- `src/app/(app)/epp/catalogo/actions.ts` — `categoria_id` opcional en items.

---

### B8 · Service-role ESLint rule
**Esfuerzo: 3-4h**

**Archivos**:
- MOD `eslint.config.mjs` — sumar custom rule:
  ```js
  {
    files: ['src/app/(app)/**/actions.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['@/shared/supabase/service-role'],
          message: 'service-role queda restringido a route handlers + crons. Usar createClient() server-action con permission gate explícito.',
        }],
      }],
    },
  },
  {
    files: [
      'src/app/(app)/epp/entregas/actions.ts',
      'src/app/api/**/route.ts',
    ],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
  ```

---

### B9 · Helper `optionalString`
**Esfuerzo: 3-5h (helper + migrar 4-5 forms)**

**Archivos**:
- NEW `src/shared/lib/zod-helpers.ts`:
  ```ts
  import { z } from 'zod';

  /**
   * Schema permisivo para fields opcionales en RHF (que defaults a ''),
   * estricto en server action (rechaza '' explícito).
   * Diff: ''  -> undefined en patch.
   */
  export function optionalString(opts: { min?: number; max: number } = {} as { max: number }) {
    return z
      .string()
      .max(opts.max)
      .optional()
      .transform((v) => (v === '' ? undefined : v));
  }
  ```
- MOD `src/app/(app)/clientes/ClienteForm.tsx`, `EmpleadoForm.tsx`, `epp/catalogo/ItemForm.tsx`, etc.

**Smoke**: test integration form con field vacío → patch action sin esa key.

---

### B10 · Rate limit split per-endpoint EARLIER
**Esfuerzo: 4-6h**

**Archivos**:
- MOD `src/shared/security/rate-limit.ts` — sumar param `failMode: 'open' | 'closed'`:
  ```ts
  export async function checkRateLimit(opts: { ..., failMode: 'open' | 'closed' }) {
    try {
      const result = await ratelimit.limit(identifier);
      return result;
    } catch (err) {
      logger.warn({ err, failMode }, 'rate_limit_check_failed');
      if (opts.failMode === 'closed') {
        return { success: false, ... }; // bloquea
      }
      return { success: true, ... }; // permite
    }
  }
  ```
- Cambiar callers de auth (signup/login/recover/magic) a `failMode: 'closed'`.
- AI generation queda `failMode: 'open'`.

---

### B11 · CSP nonce-based
**Esfuerzo: 16-24h · Diferible**

Hold. Implementación con Next 16 middleware + headers per-request es L y rompe HMR. Mantener `unsafe-inline` mientras `rehype-sanitize` cubra XSS.

---

### B12 · Multi-tenant selector
**Esfuerzo: 16-24h cuando trigger**

Hold. Trigger: 1er user member de 2+ consultoras.

---

### B13 · Chromium version pin
**Esfuerzo: 2-4h**

**Archivos**:
- MOD `Dockerfile` — pin Chromium:
  ```dockerfile
  # En lugar de:
  # RUN apk add chromium
  # Hacer:
  RUN apk add chromium=131.0.6778.108-r0 --no-cache
  ```
- NEW `.github/workflows/ci.yml` step — smoke PDF render:
  ```yaml
  - name: PDF render smoke
    run: |
      docker build -t test-pdf .
      docker run --rm test-pdf node -e "import('puppeteer-core').then(p => p.launch({executablePath:'/usr/bin/chromium-browser'}).then(b=>b.close()))"
  ```

---

## C. Operations

### C1 · Health endpoint crones + Sentry alerts
**Esfuerzo: 12-16h · CRÍTICO**

**Archivos**:
- NEW `src/app/api/health/crons/route.ts`:
  ```ts
  export async function GET() {
    const admin = createServiceRoleClient();
    const { data } = await admin
      .from('net._http_response')
      .select('created, status_code, headers')
      .gte('created', new Date(Date.now() - 24 * 60 * 60_000).toISOString())
      .order('created', { ascending: false });

    const cronHealth = {
      'process_pending_reminders': summarize(data, 'process_pending_reminders'),
      'billing_notifications': summarize(data, 'billing_notifications'),
      'billing_dunning_recovery': summarize(data, 'billing_dunning_recovery'),
      'weekly_summary': summarize(data, 'weekly_summary'), // post A17
    };

    const allOk = Object.values(cronHealth).every(c => c.last_run_age_min < c.expected_interval_min * 1.5);
    return NextResponse.json({ ok: allOk, crones: cronHealth }, { status: allOk ? 200 : 503 });
  }

  function summarize(rows, cronName) {
    const matches = rows.filter(r => r.headers?.['X-Cron-Name'] === cronName);
    const lastSuccess = matches.find(r => r.status_code >= 200 && r.status_code < 300);
    return {
      last_run_at: lastSuccess?.created,
      last_run_age_min: lastSuccess ? Math.floor((Date.now() - new Date(lastSuccess.created).getTime()) / 60_000) : null,
      consecutive_failures: countConsecutiveFails(matches),
      expected_interval_min: CRON_EXPECTED[cronName],
    };
  }
  ```
- MOD cada cron endpoint (T-031, T-074, T-CHORE-C) — sumar header `X-Cron-Name: <name>` en el `net.http_post` config Vault.
- NEW Sentry alert rule via UI:
  - Source: HTTP integration polling `/api/health/crons`.
  - Trigger: response.crones.<X>.last_run_age_min > expected_interval * 1.5.
  - Action: Telegram via existing webhook.
- NEW Better Stack monitor adicional:
  ```
  URL: https://consultora-demo.test-ia.cloud/api/health/crons
  Body must contain: '"ok":true'
  Interval: 15 min
  ```

**Smoke**:
```bash
# 1. healthy: curl /api/health/crons → {"ok":true, "crones":{...}}
# 2. simular crash: detener pg_cron job → 15min después monitor dispara alert
```

**Rollback**: solo agregar endpoint nuevo, no afecta otros paths. <1min.

---

### C2 · `ai_usage_log` + dashboard cost per tenant
**Esfuerzo: 12-20h · CRÍTICO cost control**

**Archivos**:
- NEW migration `<ts>_ai_usage_log.sql`:
  ```sql
  create table public.ai_usage_log (
    id uuid primary key default gen_random_uuid(),
    consultora_id uuid not null references consultoras(id) on delete cascade,
    user_id uuid references auth.users(id) on delete set null,
    informe_id uuid references informes(id) on delete set null,
    feature text not null check (feature in ('informe_stream', 'epp_suggest', 'chat')),
    model text not null,
    input_tokens int not null,
    output_tokens int not null,
    cache_read_tokens int default 0,
    cache_creation_tokens int default 0,
    cost_usd numeric(10,6) not null, -- calculado server-side con price table
    created_at timestamptz not null default now()
  );
  create index idx_ai_usage_consultora_month on ai_usage_log(consultora_id, date_trunc('month', created_at));

  alter table ai_usage_log enable row level security;
  create policy ai_usage_select_own on ai_usage_log
    for select using (is_member_of_consultora(consultora_id));
  ```
- NEW `src/shared/ai/usage-tracker.ts` — function `logAiUsage(...)` invocada desde `streamAnthropicMessage` callbacks.onComplete.
- NEW `src/shared/ai/pricing.ts` — tabla precios actualizable:
  ```ts
  export const ANTHROPIC_PRICING_USD = {
    'claude-sonnet-4-6': { input: 3 / 1_000_000, output: 15 / 1_000_000, cache_read: 0.30 / 1_000_000, cache_write: 3.75 / 1_000_000 },
    'claude-haiku-4-5-20251001': { input: 1 / 1_000_000, output: 5 / 1_000_000, cache_read: 0.10 / 1_000_000, cache_write: 1.25 / 1_000_000 },
  };
  ```
- MOD `src/shared/ai/stream.ts:streamAnthropicMessage` — en `callbacks.onComplete`:
  ```ts
  callbacks?.onComplete?.(info);
  await logAiUsage({
    consultoraId: ctx.consultoraId,
    userId: ctx.userId,
    informeId: ctx.informeId,
    feature: 'informe_stream',
    model: info.model,
    usage: info.usage,
  });
  ```

**Smoke**:
```bash
# 1. generar 1 informe → select * from ai_usage_log order by created_at desc limit 1 → row con cost_usd
# 2. /internal/admin dashboard (C5) muestra "Consultora X: USD 0.27 este mes"
```

**Dependencias forward**: E4 (cost caps por plan), C5 (dashboard admin), G3-G4 (analytics per consultora).

---

### C3 · Sentry alert rules
**Esfuerzo: 4-6h setup**

**Sentry UI → Alerts → New alert rule**, configurar 7 reglas:

1. **Error rate spike**: `event.count > 10 in 1h, in module `informes/generate-stream`` → Telegram.
2. **Latency p95**: `transaction.duration p95 > 5000ms in /api/informes/[id]/generate-stream` → email.
3. **New issue type**: `first seen` → Telegram.
4. **MP webhook fails**: `tag:type:'mp_signature_invalid' count > 3 in 1h` → Telegram.
5. **Cron error**: `tag:cron:* and level:error count > 1 in 1h` → Telegram.
6. **DB pool exhaustion**: `message contains 'connection pool exhausted'` → Telegram.
7. **Rate limit fail-open**: `message contains 'rate_limit_check_failed_failing_open' count > 5 in 1h` → email (no Telegram, no urgente).

**Smoke**: detonar manualmente `/api/test-error?type=cron` → alerta Telegram en 1-2 min.

---

### C4 · Smoke runbook post-deploy general
**Esfuerzo: 3-5h**

**Archivos**:
- NEW `docs/operations/post-deploy-smoke-runbook.md` con 12 secciones (10 min total):
  1. `curl /api/health` → 200 + body OK
  2. `curl /api/health/crons` → 200 + todos los crones healthy
  3. Login productivo + dashboard carga
  4. Generar 1 informe sample (cuenta test) → stream OK + audit_log row
  5. Export PDF de un informe existente → bytes match expected size
  6. Subir 1 attachment imagen → magic bytes validados + Sharp pipeline OK
  7. Crear 1 evento calendario manual → row inserted + reminder pending
  8. Trigger manual cron `weekly_summary` → mensaje Telegram OK
  9. Headers verification: `curl -I` → CSP + HSTS + X-Frame DENY
  10. `select count(*) from audit_log where created_at > '<deploy_ts>'` → growing
  11. Better Stack uptime → último check < 5 min OK
  12. Sentry → no nuevos issues últimas 24h

---

### C5 · Dashboard admin interno
**Esfuerzo: 16-24h · Post-C2**

**Archivos**:
- NEW `src/app/internal/page.tsx` — gate por email allowlist:
  ```ts
  const ADMIN_EMAILS = ['lautaroeroveda@gmail.com'];
  export default async function AdminDashboard() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || !ADMIN_EMAILS.includes(user.email!)) notFound();
    // ... fetch métricas
  }
  ```
- NEW queries agregadas: MRR, ARR, N tenants activos, N tenants en trial, churn 30d, AI cost per tenant top 10, EPP entries last 30d, last login per tenant.

---

### C6 · Logs aggregator Better Stack
**Esfuerzo: 4-6h**

Setup Better Stack Logs free tier:
- Add new source "consultora-demo".
- EasyPanel env var `LOG_LEVEL=info` + log driver `loki` (si EasyPanel soporta) o `vector` agent en host.
- Sin código change si EasyPanel + Better Stack tienen integración nativa.

---

### C7 · Test DR cuatrimestral · Discipline
**Esfuerzo: 2-3h ejecución + scheduling**

Action item Lautaro: agendar Google Calendar event recurrente "Test DR" trimestral. Próximo julio 2026.

---

### C8 · Test mensual alerting Better Stack · Discipline
**Esfuerzo: 1h ejecución**

Action item Lautaro: agendar 1er sábado del mes.

---

## D. Developer experience

### D1 · Seed data realista
**Esfuerzo: 6-10h**

**Archivos**:
- MOD `supabase/seed.sql` — sumar fixtures:
  ```sql
  -- 1 consultora demo
  insert into consultoras (id, name, slug, plan, trial_hasta) values
    ('00000000-0000-0000-0000-000000000001', 'Demo Consultora', 'demo', 'pro', null);

  -- 5 clientes
  insert into clientes (consultora_id, razon_social, cuit, ...) values
    (...), -- 5 entries

  -- 30 empleados distribuidos
  -- 10 informes
  -- 20 entregas EPP
  -- 5 eventos calendario
  ```
- NEW script `scripts/seed-demo-data.ts` para data dinámica (timestamps relativos a now).
- MOD `package.json` — `"db:seed:demo": "tsx scripts/seed-demo-data.ts"`.

---

### D2 · Auto-run `pnpm db:types` post-migration
**Esfuerzo: 2-3h**

**Archivos**:
- MOD `.husky/pre-commit`:
  ```bash
  # detectar si hay migrations staged
  if git diff --cached --name-only | grep -q "^supabase/migrations/"; then
    echo "Nueva migration detectada, regenerando types..."
    pnpm db:types && git add src/shared/supabase/types.ts
  fi
  ```

---

### D3 · Docs drift sweep
**Esfuerzo: 4-6h · Quick win**

Editar 4 archivos identificados arriba (B1) + actualizar `CLAUDE.md` "Próximo ticket" + sweep `analisis-completo.md` con la realidad post-CHORE-D.

---

### D4 · ADRs retroactivos 0009-0012
**Esfuerzo: 3-5h**

**Archivos**:
- NEW `docs/adr/0009-puppeteer-no-single-process.md` — CHORE-D decision.
- NEW `docs/adr/0010-timezone-ar-hardcode.md` — T-085 decision.
- NEW `docs/adr/0011-epp-funcion-publica-vs-trigger.md` — T-100 decisión 5.
- NEW `docs/adr/0012-aud-trigger-refinement-pattern.md` — CHORE-C fix AUD-001.

Cada uno 200-300 palabras shape ADR-0001 template.

---

### D5 · Browser pool E2E pre-warm
**Esfuerzo: 16-24h cuando aplique**

T-037-FU1 ya tracked. Hold.

---

### D6 · CI coverage gate
**Esfuerzo: 2-3h**

**Archivos**:
- MOD `.github/workflows/ci.yml`:
  ```yaml
  - name: Unit + component tests with coverage
    run: pnpm test:coverage --reporter=text-summary
  - name: Enforce coverage threshold
    run: |
      LINES=$(jq '.total.lines.pct' coverage/coverage-summary.json)
      if (( $(echo "$LINES < 70" | bc -l) )); then
        echo "::error::Coverage $LINES% < 70%"
        exit 1
      fi
  ```

Soft start: warn 1 mes, blocking después.

---

## E. Performance

### E1 · Lighthouse CI
**Esfuerzo: 3-4h**

**Archivos**:
- NEW `.github/workflows/lighthouse.yml`:
  ```yaml
  - uses: treosh/lighthouse-ci-action@v12
    with:
      urls: |
        https://consultora-demo.test-ia.cloud/
        https://consultora-demo.test-ia.cloud/login
      uploadArtifacts: true
      temporaryPublicStorage: true
  ```
- NEW `lighthouserc.json` con thresholds informativos primer mes.

---

### E2 · Bundle analyzer
**Esfuerzo: 2-3h**

**Archivos**:
- MOD `next.config.ts`:
  ```ts
  import bundleAnalyzer from '@next/bundle-analyzer';
  const withBundleAnalyzer = bundleAnalyzer({ enabled: process.env.ANALYZE === 'true' });
  export default withBundleAnalyzer(withSentryConfig(nextConfig, ...));
  ```
- MOD `package.json` — script `"analyze": "ANALYZE=true pnpm build"`.

---

### E3 · DB slow query review
**Esfuerzo: 1h/mes recurrente**

Action: Supabase Studio → Database → Query Performance → ordenar by `total_exec_time` mensual. Si una query > 100ms p95 → tunear o cachear.

---

### E4 · Cost caps por plan
**Esfuerzo: 6-8h · Post-C2**

**Archivos**:
- NEW `src/shared/billing/ai-caps.ts`:
  ```ts
  export const AI_CAPS_PER_MONTH = {
    trial: { informes: 5, chat_messages: 0 },
    pro: { informes: 50, chat_messages: 200 },
    team: { informes: 200, chat_messages: 1000 },
    enterprise: { informes: -1, chat_messages: -1 }, // unlimited
  };

  export async function checkAiCap(supabase, consultoraId, plan, feature) {
    const used = await supabase
      .from('ai_usage_log')
      .select('id', { count: 'exact', head: true })
      .eq('consultora_id', consultoraId)
      .eq('feature', feature)
      .gte('created_at', startOfMonth(new Date()).toISOString());
    const cap = AI_CAPS_PER_MONTH[plan][feature === 'informe_stream' ? 'informes' : 'chat_messages'];
    if (cap === -1) return { ok: true };
    if (used.count >= cap) return { ok: false, code: 'AI_CAP_REACHED', cap };
    return { ok: true, remaining: cap - used.count };
  }
  ```
- MOD `src/app/api/informes/[id]/generate-stream/route.ts` — check antes del stream.

---

### E5 · Prompt caching ephemeral Anthropic
**Esfuerzo: 2-4h · Quick win**

**Archivos**:
- MOD `src/shared/ai/stream.ts` — el `params.messages` o `params.system` con `cache_control: { type: 'ephemeral' }`:
  ```ts
  // Para system prompt grande (>2048 tokens):
  params.system = [
    { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }
  ];
  ```
- MOD cada uno de los 5 `src/shared/ai/prompts/*.ts` — separar el static prefix del dynamic input.

**Smoke**:
```bash
# generar 2 informes mismo tipo back-to-back
# verificar audit_log: 1er informe cache_creation > 0, 2do informe cache_read > 0
# cost del 2do ~50-90% menor
```

---

### E6 · Image optimization sweep
**Esfuerzo: 6-8h**

`grep -rn "<img " src/` + reemplazo a `<Image>` con `priority` para LCP. Configurar `next.config.ts` `images.domains` con `*.supabase.co`.

---

## F. Marketing / GTM

### F1 · Landing + /precios + /features
**Esfuerzo: 24-40h · Bloqueante captación seria**

**Archivos**:
- NEW `src/app/precios/page.tsx` — tabla planes (Trial / Pro USD 30 / Team USD 100 "próximamente" / Enterprise "consultar") + FAQ pricing + CTA trial.
- NEW `src/app/features/page.tsx` — sections: IA streaming + EPP + Calendario + Multi-canal + Audit log. Cada section con captura/video.
- NEW `src/app/api/og/route.tsx` — dynamic OG image con title.
- MOD `src/app/page.tsx` — agregar testimonial slot (vacío hasta 1er cliente) + nav a /precios + /features.
- MOD `src/app/layout.tsx` metadata — Open Graph + Twitter card + canonical.
- Videos: Loom o screencast manual ~3 videos 30-60s cada uno (IA streaming, EPP entry, calendar alert).

**Implementación copy** (pricing público es ventaja):
```
Hero pricing: "USD 30/mes. 7 días gratis. Sin tarjeta. Cancelás cuando
quieras. — Pricing público porque no tenemos nada que esconder."
```

---

### F2 · Demo interactiva
**Esfuerzo: 12-20h**

Crear tenant `demo@consultora-demo.test-ia.cloud` con data seed (D1) + UI banner "Estás en modo demo · Crear cuenta propia" + read-only enforcement vía RLS condicional.

---

### F3 · Blog SEO
**Esfuerzo: L sustained (5-10h por post)**

- NEW `src/app/blog/[slug]/page.tsx` con MDX.
- 12 posts target primer año: planilla 299/11, RGRL paso a paso, 8 índices SRT con Excel, etc.

---

### F4 · Programa referidos
**Esfuerzo: 16-20h**

Tabla `referrals` + `referral_code` único per user + tracking signup `?ref=X` + crédito ARS al pago efectivo (MP API permite descuentos puntuales).

---

### F5 · Convenio colegio profesional
**Esfuerzo: S técnico + meses negociación**

Hold. Lautaro arranca cuando tenga 3 testimonios reales.

---

### F6 · Onboarding interactivo
**Esfuerzo: 8-12h · CHURN-killer**

**Archivos**:
- NEW `src/app/(app)/dashboard/OnboardingChecklist.tsx` — 4 steps con checkmarks:
  1. Crear primer cliente
  2. Dar de alta un empleado
  3. Generar tu primer informe
  4. Configurar notificaciones (Telegram/email)
- Persistir progreso en `consultoras.onboarding_completed_at` o tabla aparte.
- Banner top dashboard mientras no esté completo.

**Implementación key**: tracking events para G1 (signup → first_client → first_employee → first_informe = activation).

---

### F7 · Email bienvenida custom
**Esfuerzo: 3-5h**

**Archivos**:
- NEW `src/shared/notifications/email-templates/welcome.tsx` — Resend template con CTA "Generar primer informe en 5 min" + link a tutorial.
- MOD signup flow (`src/app/(auth)/signup/actions.ts`) — dispatch welcome post-creación.

---

### F8 · Social proof prep
**Esfuerzo: 1-2h cuando exista**

Section `<Testimonials>` en landing + form `/feedback` para que clientes envíen quote post-uso.

---

## G. Analytics

### G1 · Funnel PostHog
**Esfuerzo: 10-14h**

**Archivos**:
- Setup PostHog Cloud free tier (1M events/mes).
- NEW `src/shared/analytics/posthog.ts` — wrapper:
  ```ts
  export async function trackEvent(name: string, props: Record<string, unknown>) {
    if (env.POSTHOG_API_KEY) {
      await fetch('https://app.posthog.com/capture/', {
        method: 'POST',
        body: JSON.stringify({ api_key: env.POSTHOG_API_KEY, event: name, ... }),
      });
    }
  }
  ```
- Eventos clave a instrumentar: `signup`, `trial_started`, `first_client_added`, `first_employee_added`, `first_informe_generated`, `informe_published`, `plan_upgraded`, `trial_expired`, `subscription_cancelled`.

---

### G2 · Cohort retention
**Esfuerzo: post-G1 zero extra**

PostHog cohorts UI built-in.

---

### G3 · Métricas uso per consultora
**Esfuerzo: 4-6h post-C2**

Query agregado en `/internal/admin` (C5):
```sql
select
  c.id, c.name, c.plan,
  count(distinct i.id) filter (where i.created_at > now() - interval '30 days') as informes_30d,
  count(distinct e.id) as empleados_total,
  count(distinct ep.id) filter (where ep.created_at > now() - interval '30 days') as entregas_epp_30d,
  max(au.last_sign_in_at) as last_login
from consultoras c
left join informes i on i.consultora_id = c.id
left join empleados e on e.consultora_id = c.id and e.archived_at is null
left join epp_entregas ep on ep.consultora_id = c.id
left join consultora_members cm on cm.consultora_id = c.id
left join auth.users au on au.id = cm.user_id
group by c.id;
```

---

### G4 · Cost per consultora
**Esfuerzo: 2-3h post-C2**

Query directo `ai_usage_log` agrupado por `consultora_id` + `date_trunc('month', created_at)`.

---

## H. Security

### H1 · pnpm audit bloqueante CRITICAL
**Esfuerzo: 1-2h**

MOD `.github/workflows/security.yml`:
```yaml
- name: Audit (CRITICAL blocking)
  run: pnpm audit --audit-level=critical || exit 1
- name: Audit (HIGH warning)
  run: pnpm audit --audit-level=high
  continue-on-error: true
```

---

### H2 · HSTS preload submit
**Esfuerzo: 1h**

Action item Lautaro: ir a `https://hstspreload.org/` + submit `consultora-demo.test-ia.cloud`. Verificar criterio (max-age 2y + includeSubDomains + preload + HTTPS-only). Wait 2-4 semanas approval.

---

### H3 · 2FA owners
**Esfuerzo: 16-24h**

**Archivos**:
- MOD Supabase Auth config → enable MFA TOTP.
- NEW `src/app/(app)/settings/security/page.tsx` — UI enrollment + recovery codes.
- MOD signup → forzar enrollment para `consultoras.plan === 'team'`.

---

### H4 · CAPTCHA Turnstile
**Esfuerzo: 8-12h**

**Archivos**:
- NEW `src/shared/security/turnstile.ts` — wrapper Cloudflare Turnstile.
- MOD signup/login forms — render Turnstile widget post 2 fails (track en Redis con TTL 1h).

---

### H5 · Pentest external
**Esfuerzo: XL externo · Hold**

Trigger: 5 clientes pagos. Provider sugerido: Faraday Security o similar boutique AR. Budget ~USD 1500-3000.

---

### H6 · Storage policy audit
**Esfuerzo: 2-3h**

Smoke:
```bash
# 1. Supabase Studio → Storage → cada bucket → Policies tab
# 2. consultora-logos: público OK (es logo público)
# 3. informe-attachments: SOLO signed URLs TTL ≤ 1h
# 4. epp-firmas: SOLO signed URLs TTL ≤ 5 min
# 5. verificar 'public bucket' toggle = false en attachments + epp-firmas
```

Si algún bucket está mal: 1 query SQL ajusta policy + actualizar `src/shared/storage/` para usar signed URL en lugar de public URL.

---

### H7 · MP webhook timingSafe uniformidad
**Esfuerzo: 1h verificación**

`grep -n "timingSafeEqual\|===" src/shared/mercadopago/verify-signature.ts` → confirmar uso. OK ya verificado en lecturas previas (uses `timingSafeEqual` directo).

---

### H8 · CSP nonce
Cross-ref B11. Hold.

---

## I. Compliance Ley 25.326

### I1 · Cron retención_datos_hasta
**Esfuerzo: 12-16h · CRÍTICO**

**Archivos**:
- NEW migration `<ts>_data_retention_cron.sql`:
  ```sql
  create or replace function public.delete_expired_tenants_data()
  returns void
  language plpgsql
  security definer set search_path = ''
  as $$
  declare
    expired_consultora record;
  begin
    for expired_consultora in
      select id, name from public.consultoras
      where retencion_datos_hasta is not null
        and retencion_datos_hasta < now()
    loop
      -- soft archive: marcar todo en cascade como to_delete
      update public.empleados set archived_at = now() where consultora_id = expired_consultora.id and archived_at is null;
      update public.clientes set archived_at = now() where consultora_id = expired_consultora.id and archived_at is null;
      -- archive audit_log al storage (B6)
      perform public.archive_audit_log(expired_consultora.id);
      -- hard delete entrega items y entrega rows después de 7 días grace
      delete from public.epp_entrega_items where consultora_id = expired_consultora.id;
      delete from public.epp_entregas where consultora_id = expired_consultora.id;
      delete from public.informes where consultora_id = expired_consultora.id;
      delete from public.empleados where consultora_id = expired_consultora.id;
      delete from public.clientes where consultora_id = expired_consultora.id;
      -- last: la consultora ya tiene retencion_datos_hasta set, hard delete
      delete from public.consultora_members where consultora_id = expired_consultora.id;
      delete from public.consultoras where id = expired_consultora.id;
      raise notice 'Compliance: deleted tenant %', expired_consultora.id;
    end loop;
  end;
  $$;

  -- Schedule daily 03:00 UTC = 00:00 ART
  select cron.schedule(
    'data_retention_compliance',
    '0 3 * * *',
    $$select public.delete_expired_tenants_data();$$
  );
  ```
- NEW `src/app/api/cron/data-retention-status/route.ts` — readonly check "qué consultoras vencen próximas 30 días" para alerting.

**Smoke**:
```bash
# 1. set retencion_datos_hasta a una consultora demo a ayer
# 2. trigger manual: psql -c "select public.delete_expired_tenants_data();"
# 3. select count(*) from consultoras where id = '<demo>' → 0
# 4. audit_log archive en bucket Storage
```

**Rollback**: backup snapshot pre-cron run + `select cron.unschedule('data_retention_compliance');` instant. Pero el delete es destructivo — TEST ANTES en proyecto temporal.

**Dependencias backward**: B6 (audit_log archive policy).

---

### I2 · Endpoint export GDPR-like
**Esfuerzo: 12-20h · CRÍTICO**

**Archivos**:
- NEW `src/app/api/account/export/route.ts` — POST autenticado dispara job background:
  ```ts
  export async function POST(req: NextRequest) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return new Response(null, { status: 401 });

    const consultora = await getCurrentConsultora(supabase, user.id);
    if (!consultora) return new Response(null, { status: 403 });

    // Async job: queue via pg_cron o Inngest-like; aquí simplificado sync
    const exportId = crypto.randomUUID();
    await generateExport(consultora.id, exportId);
    // sube ZIP a bucket privado + manda email con signed URL TTL 48h
    return NextResponse.json({ jobId: exportId });
  }
  ```
- NEW `src/shared/lib/account-export.ts` — generador ZIP:
  - CSVs: consultoras, clientes, empleados, informes, epp_entregas, epp_entrega_items, calendar_events, audit_log.
  - Media: descarga binarios de logo + attachments + firmas a `media/` dentro del ZIP.
  - Manifest `README.txt` con explicación campo a campo.
- NEW UI `src/app/(app)/settings/cuenta/page.tsx` — botón "Exportar mis datos" + status del último export + lista descargas.
- MOD `src/shared/notifications/email-templates/data-export-ready.tsx` — email con signed URL TTL 48h.

**Smoke**:
```bash
# 1. POST /api/account/export → 202 + jobId
# 2. esperar ~30s
# 3. email llega con link
# 4. download ZIP, verificar contiene 8 CSVs + media/ + README
```

**Rollback**: solo endpoint nuevo + UI nueva. <5min.

---

### I3 · DNI/CUIL encrypt at-rest
**Esfuerzo: 16-24h · Hold Fase 2**

Trade-off: rompe search. Mitigation con `dni_hash` column. Implementación standard `pgp_sym_encrypt(dni, current_setting('app.dni_encryption_key'))`.

Hold.

---

### I4 · Cookie banner
**Esfuerzo: 2-3h**

Hold opt-in. Si llega cliente EU-related.

---

### I5 · DPO contact
**Esfuerzo: 30min**

MOD `src/app/privacidad/page.tsx` — agregar section "Responsable de tratamiento: Lautaro Roveda · dpo@consultora-demo.test-ia.cloud · Buenos Aires, AR".

---

### I6 · Disclaimer profesional PDF
**Esfuerzo: 1-2h**

**Archivos**:
- MOD `src/app/(print)/informes/[id]/print/page.tsx` — footer:
  ```tsx
  <footer className="text-xs text-gray-500 mt-12 border-t pt-4">
    <p>
      Este informe fue generado con asistencia de inteligencia artificial.
      La validación técnica, firma y responsabilidad profesional corresponden
      al matriculado en Higiene y Seguridad Laboral. ConsultoraDemo es una
      herramienta de productividad, no reemplaza criterio profesional ni
      absuelve responsabilidad civil/penal (Ley 19.587, Ley 24.557).
    </p>
    <p className="mt-2">
      Generado el {fecha} con ConsultoraDemo · consultora-demo.test-ia.cloud
    </p>
  </footer>
  ```

**Smoke**: regenerar PDF de un informe existente, abrir → footer presente.

---

### I7 · ToS + Privacy legal review
**Esfuerzo: 2h dev + 2-4 semanas externo**

Action: contactar 1-2 estudios AR (Marval, Brons & Salas, Bruchou) para fee único review. Budget ~USD 500-1500.

Post-review: change `robots.index = true` en `/privacidad` + `/terminos`.

---

### I8 · Página cumplimiento técnico
**Esfuerzo: 3-4h**

NEW `src/app/cumplimiento/page.tsx` — sections: ISO 45001 7.5.3 (audit log), 9.2.1 (revisión), Ley 25.326 (export + retención), screenshots del audit log + link ADR-0006.

---

## J. Pricing & expansion

### J1 · Plan anual con descuento
**Esfuerzo: 4-6h**

**Archivos**:
- MOD `src/shared/mercadopago/preapproval.ts` — sumar `frequency_type: 'months'` + `frequency: 12` opcional.
- MOD `src/app/(app)/upgrade/page.tsx` — toggle mensual/anual + cálculo descuento.
- Env var `ARS_PRICE_ANNUAL` opcional.

---

### J2 · Add-ons
**Esfuerzo: 16-20h · Fase 2**

Hold.

### J3 · Plan Team
**Esfuerzo: XL · Fase 2**

Ya en roadmap.

### J4 · Plan Enterprise
**Esfuerzo: XL · Fase 4**

Ya en roadmap.

### J5 · Trial extension
**Esfuerzo: 2-3h · Quick win**

**Archivos**:
- NEW `src/app/internal/users/[id]/extend-trial/route.ts` — POST con `days` param, gateado admin email.
- MOD `consultoras` audit trigger — capturar `trial_hasta` change.

---

### J6 · FX review policy
**Esfuerzo: 30min dev + recurrente discipline**

MOD `src/env.ts` — comment con fecha último update:
```ts
// ARS_PRICE_MONTHLY: último ajuste 2026-05-20 = ARS 30000 / USD 1.21 = USD 24.79.
// Próximo review: 2026-06-20 (mensual).
```

Action Lautaro: Google Calendar event mensual.

---

### J7 · Discount codes
**Esfuerzo: 16-20h · Post-F5**

Hold hasta convenio AHRA.

---

## Acciones inmediatas recomendadas (esta semana)

Si arrancás hoy con 8h dev disponibles:

1. **D3 docs drift** (3h) — sweep CLAUDE.md + 02-architecture.md + analisis-completo.md.
2. **E5 prompt caching** (2h) — ahorro cost inmediato.
3. **I6 disclaimer PDF** (1h) — compliance básico.
4. **C3 Sentry alerts** (2h) — 7 reglas configuradas.

Total 8h, 4 quick wins de alto valor. Después arrancá con C1 (M, 12-16h) que es el más crítico forward.

¿Por dónde arrancamos?
