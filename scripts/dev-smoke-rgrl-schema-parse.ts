/**
 * T-022 · Smoke check: la metadata RGRL existente en remote sigue parseando OK
 * post-refactor (commonClientFieldsWithSite + fechaIsoField).
 *
 * Lee todas las filas de `informe_metadata` cuyo informe parent es tipo='rgrl'
 * y aplica `rgrlMetadataSchema.safeParse()`. Falla con exit 1 si alguna no parsea.
 *
 * Correr con: `pnpm tsx --env-file=.env.local scripts/dev-smoke-rgrl-schema-parse.ts`.
 */
import type { Database } from '../src/shared/supabase/types';
import { createClient } from '@supabase/supabase-js';

import { rgrlMetadataSchema } from '../src/shared/templates/rgrl/schema';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error('Falta NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const admin = createClient<Database>(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main() {
  // JOIN informes ↔ informe_metadata para filtrar por tipo='rgrl'.
  const { data: rgrlInformes, error: err1 } = await admin
    .from('informes')
    .select('id, titulo, consultora_id, created_at')
    .eq('tipo', 'rgrl');
  if (err1) {
    console.error('Error cargando informes RGRL:', err1);
    process.exit(1);
  }
  if (!rgrlInformes || rgrlInformes.length === 0) {
    console.log('⚠️  No hay informes RGRL en remote — nada que validar.');
    process.exit(0);
  }

  const ids = rgrlInformes.map((i) => i.id);
  const { data: rows, error: err2 } = await admin
    .from('informe_metadata')
    .select('informe_id, data, created_at, updated_at')
    .in('informe_id', ids);
  if (err2) {
    console.error('Error cargando informe_metadata:', err2);
    process.exit(1);
  }

  console.log(`📊 RGRL informes: ${rgrlInformes.length}`);
  console.log(`📊 metadata rows: ${rows?.length ?? 0}`);

  if (!rows || rows.length === 0) {
    console.log('⚠️  No hay rows de metadata para RGRL — refactor no cambia comportamiento.');
    process.exit(0);
  }

  let okCount = 0;
  let failCount = 0;
  for (const row of rows) {
    const parsed = rgrlMetadataSchema.safeParse(row.data);
    if (parsed.success) {
      okCount++;
      console.log(
        `  ✅ informe_id=${row.informe_id} razon_social="${parsed.data.razon_social}" cuit=${parsed.data.cuit}`,
      );
    } else {
      failCount++;
      console.error(
        `  ❌ informe_id=${row.informe_id} FAILS:`,
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      );
    }
  }

  console.log('');
  console.log(`Resultado: ${okCount} OK · ${failCount} FAIL`);
  if (failCount > 0) process.exit(1);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
