import { Markdown } from '@/shared/ui/markdown';

/**
 * T-020 · Render server-side de markdown para informes.
 *
 * Reutilizable:
 *   - `/informes/[id]` (read-only del contenido persistido).
 *   - `/informes/[id]/editar` (preview live del textarea).
 *
 * T-117-FU3 · El render (mapa de `components` + plugins + sanitize) se extrajo a
 * [`@/shared/ui/markdown`](src/shared/ui/markdown.tsx) para compartirlo con el
 * chat del asistente. Acá queda sólo el empty-state propio de informes.
 */
export function MarkdownPreview({ content }: { content: string | null }) {
  if (!content || content.trim() === '') {
    return (
      <div className="text-muted-foreground py-12 text-center text-sm">
        <p className="text-foreground font-medium">Contenido pendiente</p>
        <p className="mx-auto mt-2 max-w-md">
          Generá un borrador con IA o escribilo manualmente desde el editor.
        </p>
      </div>
    );
  }

  return <Markdown content={content} />;
}
