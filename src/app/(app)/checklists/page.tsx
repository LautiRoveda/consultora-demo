import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getCurrentConsultora } from '@/shared/auth/getCurrentConsultora';
import { createClient } from '@/shared/supabase/server';
import { Button } from '@/shared/ui/button';

import { EmptyChecklistsCTA } from './EmptyChecklistsCTA';
import { IncludeArchivedToggle } from './IncludeArchivedToggle';
import { getChecklistTemplates } from './queries';
import { TemplatesList } from './TemplatesList';

type SearchParams = { archived?: string };

export default async function ChecklistsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const consultora = await getCurrentConsultora(supabase, user.id);
  if (!consultora) redirect('/dashboard');

  const includeArchived = sp.archived === '1';
  const templates = await getChecklistTemplates(supabase, { includeArchived });
  const canEdit = consultora.role === 'owner';

  const ownTemplates = templates.filter((t) => !t.isSystem);
  const systemTemplate = templates.find((t) => t.isSystem);
  const showEmptyCta = canEdit && ownTemplates.length === 0 && !includeArchived;

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Checklists</h1>
          <p className="text-muted-foreground text-sm">
            Templates de inspección reutilizables (RGRL y propios). Editá un borrador, publicá una
            versión y ejecutalo en obra.
          </p>
        </div>
        {canEdit && (
          <Button asChild>
            <Link href="/checklists/nuevo">Nuevo template</Link>
          </Button>
        )}
      </div>

      <div className="flex justify-end">
        <IncludeArchivedToggle checked={includeArchived} />
      </div>

      {showEmptyCta && <EmptyChecklistsCTA systemTemplateId={systemTemplate?.id ?? null} />}

      <TemplatesList templates={templates} canEdit={canEdit} />
    </div>
  );
}
