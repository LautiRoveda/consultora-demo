/**
 * T-023 · Smoke local del endpoint GET /api/informes/[id]/pdf.
 *
 * Crea consultora + user + informe con contenido via admin SDK, hace signIn
 * usando @supabase/ssr con un cookieStore mutable (mismo patron que los tests
 * integration) para que el SDK escriba las cookies en el formato correcto,
 * y curlea el endpoint forwardeando esas cookies.
 *
 * Pre: `pnpm dev` corriendo en localhost:3000 con CHROMIUM_PATH apuntando
 * al binario de Chrome (Windows) o Chromium (linux/docker).
 *
 * Correr: `pnpm exec tsx --env-file=.env.local scripts/smoke-pdf-export.ts`.
 */
import type { Database } from '../src/shared/supabase/types';
import { writeFile } from 'node:fs/promises';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const baseUrl = process.env.SMOKE_BASE_URL ?? 'http://localhost:3000';

const admin = createClient<Database>(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const runId = `${Date.now().toString(36)}`;
const slug = `t023-smoke-${runId}`;
const email = `t023-smoke-${runId}@example.com`;
const password = 'SmokePassword123!';

async function main(): Promise<void> {
  console.log(`[smoke] runId=${runId}`);

  // 1. Consultora.
  const { data: c, error: cErr } = await admin
    .from('consultoras')
    .insert({ name: 'T023 smoke', slug })
    .select('id')
    .single();
  if (cErr || !c) throw new Error(`consultora insert: ${cErr?.message}`);
  console.log(`[smoke] consultoraId=${c.id}`);

  // 2. User + membership + claim.
  const { data: u, error: uErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (uErr || !u.user) throw new Error(`user create: ${uErr?.message}`);
  const userId = u.user.id;
  console.log(`[smoke] userId=${userId}`);

  await admin
    .from('consultora_members')
    .insert({ user_id: userId, consultora_id: c.id, role: 'owner' });
  await admin.auth.admin.updateUserById(userId, {
    app_metadata: { consultora_id: c.id },
  });

  // 3. Informe con contenido markdown (representa lo que generaria Claude).
  const contenido = `# Informe RGRL — Acme SA

## 1. Identificación del establecimiento

- **Razón social:** Acme SA
- **CUIT:** 30-12345678-9
- **Domicilio:** Av. Industrial 1234, Tigre, Buenos Aires
- **Actividad:** Fabricación de estructuras metálicas
- **Cantidad de empleados:** 80

## 2. Hallazgos preliminares

El relevamiento detectó las siguientes situaciones que requieren tratamiento:

1. Falta de señalización de salidas de emergencia en sector de producción.
2. EPP vencido en planilla de entrega (Res. SRT 299/11).
3. Audiometrías pendientes para el 30% del personal de planta.

## 3. Recomendaciones

| Item | Acción | Plazo | Norma |
|------|--------|-------|-------|
| Salidas emergencia | Cartelería fotoluminiscente | 30 días | Decreto 351/79 |
| EPP | Renovación + planilla Res 299 | 15 días | Res. SRT 299/11 |
| Audiometrías | Coordinar con ART | 60 días | Decreto 658/96 |

## 4. Observaciones generales

El establecimiento muestra cumplimiento aceptable de los aspectos relevados, con las observaciones listadas arriba pendientes de tratamiento en los plazos indicados.

_Documento generado por ConsultoraDemo. El profesional matriculado firmante asume la responsabilidad técnica._
`;

  const { data: informe, error: iErr } = await admin
    .from('informes')
    .insert({
      consultora_id: c.id,
      tipo: 'rgrl',
      titulo: 'Smoke RGRL Acme SA',
      created_by: userId,
      contenido,
    })
    .select('id')
    .single();
  if (iErr || !informe) throw new Error(`informe insert: ${iErr?.message}`);
  console.log(`[smoke] informeId=${informe.id}`);

  // 4. SignIn via createServerClient con cookieStore mutable. Mismo patron
  // que los tests integration: el SDK escribe las cookies en el formato que
  // el server SSR despues va a leer.
  const cookieStore: { name: string; value: string }[] = [];
  const ssrClient = createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll: () => cookieStore.map((c) => ({ ...c })),
      setAll: (cookiesToSet) => {
        for (const { name, value } of cookiesToSet) {
          const idx = cookieStore.findIndex((c) => c.name === name);
          if (idx >= 0) cookieStore[idx] = { name, value };
          else cookieStore.push({ name, value });
        }
      },
    },
  });

  const { error: siErr } = await ssrClient.auth.signInWithPassword({ email, password });
  if (siErr) throw new Error(`signin: ${siErr.message}`);
  console.log(`[smoke] signin OK, cookies escritas=${cookieStore.length}`);
  for (const c of cookieStore) {
    console.log(`[smoke]   cookie: ${c.name} (${c.value.length} chars)`);
  }

  // 5. Forwardear las cookies al endpoint via header `cookie:`.
  const cookieHeader = cookieStore
    .map((c) => `${c.name}=${encodeURIComponent(c.value)}`)
    .join('; ');

  // 6. Curl al endpoint.
  const t0 = Date.now();
  const res = await fetch(`${baseUrl}/api/informes/${informe.id}/pdf`, {
    method: 'GET',
    headers: { cookie: cookieHeader, 'user-agent': 'smoke-pdf-export/1.0' },
  });
  const ms = Date.now() - t0;
  console.log(`[smoke] response status=${res.status} ms=${ms}`);
  console.log(`[smoke] content-type=${res.headers.get('content-type')}`);
  console.log(`[smoke] content-disposition=${res.headers.get('content-disposition')}`);
  console.log(`[smoke] content-length=${res.headers.get('content-length')}`);

  const buf = Buffer.from(await res.arrayBuffer());
  console.log(`[smoke] body bytes=${buf.length}`);
  console.log(`[smoke] magic bytes=${buf.subarray(0, 5).toString()}`);

  if (res.status === 200) {
    const outPath = `/tmp/smoke-${informe.id}.pdf`;
    await writeFile(outPath, buf);
    console.log(`[smoke] PDF guardado en ${outPath}`);
  } else {
    console.log(`[smoke] error body: ${buf.toString('utf-8')}`);
  }

  // 7. Cleanup.
  await admin.auth.admin.deleteUser(userId).catch(() => {});
  console.log('[smoke] cleanup OK');
}

main().catch((err) => {
  console.error('[smoke] FATAL', err);
  process.exit(1);
});
