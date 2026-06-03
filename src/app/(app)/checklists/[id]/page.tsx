import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { getCurrentConsultora } from '@/shared/auth/getCurrentConsultora';
import { createClient } from '@/shared/supabase/server';
import { Badge } from '@/shared/ui/badge';

import { CloneSystemButton } from '../CloneSystemButton';
import { EditDraftButton } from '../EditDraftButton';
import { estadoLabel, TIPO_INSPECCION_LABELS } from '../labels';
import { getTemplateWithStructure } from '../queries';
import { type TipoInspeccion } from '../schema';
import { TemplateEditor } from './TemplateEditor';
import { TemplateReadOnlyView } from './TemplateReadOnlyView';

export default async function ChecklistTemplatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const consultora = await getCurrentConsultora(supabase, user.id);
  if (!consultora) redirect('/dashboard');

  // Preferimos el borrador (editable). Si no hay, mostramos la última publicada.
  const structure =
    (await getTemplateWithStructure(supabase, id, { which: 'draft' })) ??
    (await getTemplateWithStructure(supabase, id, { which: 'published' }));
  if (!structure) notFound();

  const { template, version, sections } = structure;
  const isSystem = template.consultora_id === null;
  const isOwn = template.consultora_id === consultora.id;
  const isArchived = template.archived_at !== null;
  const canEdit = consultora.role === 'owner';
  const editable = canEdit && isOwn && !isArchived && version.estado === 'draft';

  const tipoLabel =
    TIPO_INSPECCION_LABELS[template.tipo_inspeccion as keyof typeof TIPO_INSPECCION_LABELS] ??
    template.tipo_inspeccion;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-muted-foreground text-sm">
          <Link href="/checklists" className="hover:text-foreground hover:underline">
            ← Volver a Checklists
          </Link>
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{template.nombre}</h1>
          {isSystem ? (
            <Badge variant="outline">Sistema</Badge>
          ) : (
            <Badge variant={version.estado === 'published' ? 'default' : 'secondary'}>
              {estadoLabel(version.estado)} v{version.version_number}
            </Badge>
          )}
          {isArchived && <Badge variant="secondary">Archivado</Badge>}
        </div>
        <p className="text-muted-foreground text-sm">{tipoLabel}</p>
        {template.descripcion && (
          <p className="text-muted-foreground text-sm">{template.descripcion}</p>
        )}
      </div>

      {editable ? (
        <TemplateEditor
          templateId={template.id}
          versionId={version.id}
          nombre={template.nombre}
          descripcion={template.descripcion}
          tipoInspeccion={template.tipo_inspeccion as TipoInspeccion}
          sections={sections}
        />
      ) : (
        <div className="space-y-4">
          {canEdit && (
            <div className="flex flex-wrap items-center gap-2">
              {isSystem && <CloneSystemButton systemTemplateId={template.id} size="default" />}
              {isOwn && !isArchived && version.estado === 'published' && (
                <EditDraftButton templateId={template.id} />
              )}
              {isOwn && isArchived && (
                <p className="text-muted-foreground text-sm">
                  Restaurá el template desde la lista para poder editarlo.
                </p>
              )}
            </div>
          )}
          <TemplateReadOnlyView sections={sections} />
        </div>
      )}
    </div>
  );
}
