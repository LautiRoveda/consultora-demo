import type { AdjuntoView } from '../PhotoCapture';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { getCurrentConsultora } from '@/shared/auth/getCurrentConsultora';
import { formatCivilDateAR } from '@/shared/lib/format-date';
import { createSignedChecklistAdjuntoUrl } from '@/shared/storage/checklist-adjuntos';
import { createSignedChecklistFirmaUrl } from '@/shared/storage/checklist-firmas';
import { createClient } from '@/shared/supabase/server';
import { Button } from '@/shared/ui/button';

import { getClienteById } from '../../../clientes/queries';
import { EjecucionDetailView } from '../EjecucionDetailView';
import { EjecucionRunner } from '../EjecucionRunner';
import { getEjecucionBasics, getEjecucionForDetail, getEjecucionForEdit } from '../queries';

/**
 * T-061a/b · Pantalla de una inspección. borrador → runner sección-por-sección;
 * cerrada/anulada → detalle completo (T-061b) con score, hallazgos+fotos, CAPAs,
 * firma, Descargar PDF y Anular. Carga los adjuntos + signed URLs.
 */
export default async function EjecucionRunnerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const consultora = await getCurrentConsultora(supabase, user.id);
  if (!consultora) redirect('/dashboard');

  const basics = await getEjecucionBasics(supabase, id);
  if (!basics) notFound();

  // ── Cerrada / anulada → detalle completo (T-061b). ──────────────────────────
  if (basics.estado !== 'borrador') {
    const detail = await getEjecucionForDetail(supabase, id);
    if (!detail) notFound();

    let firmaUrl: string | null = null;
    if (detail.firmaMatriculado?.firma_storage_path) {
      const { signedUrl } = await createSignedChecklistFirmaUrl(
        supabase,
        detail.firmaMatriculado.firma_storage_path,
      );
      firmaUrl = signedUrl;
    }

    const adjuntosByRespuesta: Record<string, string[]> = {};
    await Promise.all(
      detail.adjuntos.map(async (a) => {
        if (!a.respuesta_id) return;
        const { signedUrl } = await createSignedChecklistAdjuntoUrl(supabase, a.storage_path);
        if (signedUrl) (adjuntosByRespuesta[a.respuesta_id] ??= []).push(signedUrl);
      }),
    );

    return (
      <EjecucionDetailView
        execution={detail.execution}
        sections={detail.sections}
        respuestasByItemId={detail.respuestasByItemId}
        adjuntosByRespuesta={adjuntosByRespuesta}
        firma={detail.firmaMatriculado}
        firmaUrl={firmaUrl}
        acciones={detail.acciones}
        esVigente={detail.esVigente}
        isOwner={consultora.role === 'owner'}
      />
    );
  }

  // ── Borrador → runner (T-061a). ─────────────────────────────────────────────
  const data = await getEjecucionForEdit(supabase, id);
  if (!data) notFound();

  // Adjuntos existentes → signed URLs, agrupados por ítem (respuesta_id → item).
  const itemIdByRespuestaId = new Map<string, string>();
  for (const [itemId, resp] of Object.entries(data.respuestasByItemId)) {
    itemIdByRespuestaId.set(resp.id, itemId);
  }
  const { data: adjuntos } = await supabase
    .from('execution_adjuntos')
    .select('id, respuesta_id, storage_path')
    .eq('execution_id', id)
    .order('created_at', { ascending: true });

  const adjuntosByItemId: Record<string, AdjuntoView[]> = {};
  await Promise.all(
    (adjuntos ?? []).map(async (a) => {
      if (!a.respuesta_id) return;
      const itemId = itemIdByRespuestaId.get(a.respuesta_id);
      if (!itemId) return;
      const { signedUrl } = await createSignedChecklistAdjuntoUrl(supabase, a.storage_path);
      (adjuntosByItemId[itemId] ??= []).push({ id: a.id, src: signedUrl });
    }),
  );

  const cliente = data.execution.cliente_id
    ? await getClienteById(supabase, data.execution.cliente_id)
    : null;

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-center justify-between gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link href="/checklists/ejecuciones">← Inspecciones</Link>
        </Button>
      </div>
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">
          {cliente?.razon_social ?? 'Inspección'}
        </h1>
        {data.execution.fecha_inspeccion && (
          <p className="text-muted-foreground text-sm">
            Inspección del {formatCivilDateAR(data.execution.fecha_inspeccion)} · se guarda sola
          </p>
        )}
      </header>

      <EjecucionRunner
        executionId={data.execution.id}
        isOwner={consultora.role === 'owner'}
        sections={data.sections}
        respuestasByItemId={data.respuestasByItemId}
        adjuntosByItemId={adjuntosByItemId}
      />
    </div>
  );
}
