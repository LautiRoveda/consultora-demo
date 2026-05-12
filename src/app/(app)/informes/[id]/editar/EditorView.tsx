'use client';

import type { RgrlMetadata } from '@/shared/templates/rgrl/schema';
import type { InformeTipo } from '../../schema';
import type { UpdateInformeContentInput } from '../schema';
import { zodResolver } from '@hookform/resolvers/zod';
import { ChevronDown, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { useMediaQuery } from '@/shared/lib/use-media-query';
import { rgrlMetadataDefaults, RgrlMetadataForm } from '@/shared/templates/rgrl/RgrlMetadataForm';
import { rgrlMetadataSchema } from '@/shared/templates/rgrl/schema';
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Card, CardContent } from '@/shared/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/shared/ui/collapsible';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/shared/ui/form';
import { Label } from '@/shared/ui/label';
import { Separator } from '@/shared/ui/separator';
import { Textarea } from '@/shared/ui/textarea';

import { INFORME_TIPO_LABELS } from '../../schema';
import {
  generateInformeContentAction,
  updateInformeContentAction,
  updateInformeMetadataAction,
} from '../actions';
import { MarkdownPreview } from '../MarkdownPreview';
import { updateInformeInputSchema } from '../schema';

type EditorState = 'idle' | 'generating' | 'generated' | 'saving' | 'saving_metadata';

const USER_PROMPT_MAX = 2000;

const USER_PROMPT_PLACEHOLDERS: Record<InformeTipo, string> = {
  relevamiento:
    'Ej: Planta industrial en Tigre, sector metalmecánico, 80 empleados. Mediciones de ruido en línea de prensa entre 85 y 92 dB. Iluminación en oficinas: 350 a 500 lux.',
  capacitacion:
    'Ej: Capacitación de uso de EPP para 25 operarios del depósito, modalidad presencial, duración 2 hs, dictada el 10/05/2026.',
  rgrl: 'Ej: PYME comercial, 15 empleados, 1 establecimiento en CABA, actividad principal venta minorista de indumentaria, ART La Segunda.',
  accidente:
    'Ej: Operario sufrió corte en mano derecha al manipular sierra eléctrica sin guarda, en sector taller. Fecha 12/05/2026 a las 14:30.',
  otros:
    'Ej: Auditoría interna del sistema de gestión HyS contra ISO 45001, alcance: planta principal, foco en jerarquía de controles y matriz de riesgos.',
};

export function EditorView({
  informeId,
  tipo,
  titulo,
  initialContent,
  initialMetadata,
}: {
  informeId: string;
  tipo: InformeTipo;
  titulo: string;
  initialContent: string | null;
  /** T-021: metadata RGRL pre-cargado por el server. null si no existe. */
  initialMetadata: RgrlMetadata | null;
}) {
  const router = useRouter();
  const [state, setState] = useState<EditorState>('idle');
  const [userPrompt, setUserPrompt] = useState('');

  const form = useForm<UpdateInformeContentInput>({
    resolver: zodResolver(updateInformeInputSchema),
    defaultValues: { content: initialContent ?? '' },
  });

  // T-021: form RGRL del panel arriba. Solo se inicializa para tipo='rgrl'.
  // Para tipos sin metadata, este form queda sin uso (no se renderiza).
  const metadataForm = useForm<RgrlMetadata>({
    resolver: zodResolver(rgrlMetadataSchema),
    defaultValues: initialMetadata ?? rgrlMetadataDefaults(),
  });

  // Collapsible default open behavior: si data vacia, siempre abierto (el
  // user tiene que llenar). Si data poblada, abierto en desktop / cerrado en
  // mobile (evita scroll hasta el editor de contenido).
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const [metadataOpen, setMetadataOpen] = useState<boolean | undefined>(undefined);
  const metadataOpenEffective = metadataOpen ?? (initialMetadata ? isDesktop : true);

  // RHF `watch()` no es memoizable safely (lo dice react-hooks/incompatible-library).
  // Es el patron oficial de RHF para preview live — el lint lo flaggea pero
  // no hay alternativa sin re-implementar el subscriber.
  // eslint-disable-next-line react-hooks/incompatible-library
  const watchedContent = form.watch('content');
  const isPending = state === 'generating' || state === 'saving' || state === 'saving_metadata';
  const showMetadataPanel = tipo === 'rgrl';

  async function onGenerate() {
    // Confirmar overwrite cuando hay contenido sin guardar.
    if (form.formState.isDirty && watchedContent.trim().length > 0) {
      const ok = window.confirm(
        '¿Reemplazar el contenido actual con el nuevo borrador generado? Tus cambios sin guardar se van a perder.',
      );
      if (!ok) return;
    }

    setState('generating');
    const result = await generateInformeContentAction(informeId, {
      userPrompt: userPrompt.trim(),
    });

    if (result.ok) {
      form.setValue('content', result.content, { shouldDirty: true });
      setState('generated');
      toast.success('Borrador generado', {
        description: `Tokens usados: ${result.usage.inputTokens} entrada + ${result.usage.outputTokens} salida.`,
      });
      return;
    }

    setState('idle');
    switch (result.code) {
      case 'INVALID_INPUT':
        toast.error('Datos inválidos', { description: result.message });
        return;
      case 'UNAUTHENTICATED':
        toast.error('Sesión vencida', { description: result.message });
        router.push('/login');
        return;
      case 'NO_CONSULTORA':
        toast.error('Cuenta sin consultora', { description: result.message });
        return;
      case 'FORBIDDEN':
        toast.error('Sin permiso', { description: result.message });
        return;
      case 'NOT_FOUND':
        toast.error('Informe no encontrado', { description: result.message });
        return;
      case 'RATE_LIMITED':
        toast.error('IA saturada', { description: result.message });
        return;
      case 'CONTENT_FILTER':
        toast.error('Contenido rechazado por la IA', { description: result.message });
        return;
      case 'TIMEOUT':
        toast.error('Tiempo agotado', { description: result.message });
        return;
      case 'INTERNAL_ERROR':
        toast.error('Error inesperado', { description: result.message });
        return;
    }
  }

  async function onSubmit(values: UpdateInformeContentInput) {
    setState('saving');
    const result = await updateInformeContentAction(informeId, values);

    if (result.ok) {
      toast.success('Contenido guardado');
      router.push(`/informes/${informeId}`);
      router.refresh();
      return;
    }

    setState('idle');
    if (result.code === 'INVALID_INPUT') {
      for (const [field, messages] of Object.entries(result.fieldErrors)) {
        if (field === 'content') {
          form.setError('content', { message: messages[0] });
        }
      }
      toast.error('Datos inválidos', { description: result.message });
      return;
    }
    switch (result.code) {
      case 'UNAUTHENTICATED':
        toast.error('Sesión vencida', { description: result.message });
        router.push('/login');
        return;
      case 'NO_CONSULTORA':
        toast.error('Cuenta sin consultora', { description: result.message });
        return;
      case 'FORBIDDEN':
        toast.error('Sin permiso', { description: result.message });
        return;
      case 'NOT_FOUND':
        toast.error('Informe no encontrado', { description: result.message });
        return;
      case 'INTERNAL_ERROR':
        toast.error('Error guardando', { description: result.message });
        return;
    }
  }

  /**
   * T-021 · Submit del form RGRL. Persiste via updateInformeMetadataAction;
   * mantiene el panel abierto post-save para que el user pueda continuar
   * editando si quiere (toast confirma el save).
   */
  async function onSaveMetadata(values: RgrlMetadata) {
    setState('saving_metadata');
    const result = await updateInformeMetadataAction(informeId, values);

    if (result.ok) {
      toast.success('Datos guardados');
      // No colapsamos el panel — el user decide.
      // Refresh para que la prxima visita a /editar vea los valores desde el
      // server (el form ya tiene los values en memoria).
      router.refresh();
      setState('idle');
      return;
    }

    setState('idle');

    if (result.code === 'INVALID_INPUT') {
      for (const [field, messages] of Object.entries(result.fieldErrors)) {
        // RHF acepta nested paths con dot notation — mapeamos directo.
        metadataForm.setError(field as keyof RgrlMetadata, { message: messages[0] });
      }
      toast.error('Datos inválidos', { description: result.message });
      return;
    }

    switch (result.code) {
      case 'UNAUTHENTICATED':
        toast.error('Sesión vencida', { description: result.message });
        router.push('/login');
        return;
      case 'NO_CONSULTORA':
        toast.error('Cuenta sin consultora', { description: result.message });
        return;
      case 'FORBIDDEN':
        toast.error('Sin permiso', { description: result.message });
        return;
      case 'NOT_FOUND':
        toast.error('Informe no encontrado', { description: result.message });
        return;
      case 'INTERNAL_ERROR':
        toast.error('Error guardando los datos', { description: result.message });
        return;
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-muted-foreground text-sm">
          <Link href={`/informes/${informeId}`} className="hover:text-foreground hover:underline">
            ← Volver al informe
          </Link>
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Editar: {titulo}</h1>
        <p className="text-muted-foreground text-sm">Tipo: {INFORME_TIPO_LABELS[tipo]}</p>
      </div>

      {showMetadataPanel && (
        <Card>
          <CardContent className="pt-6">
            <Collapsible open={metadataOpenEffective} onOpenChange={setMetadataOpen}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-base font-semibold tracking-tight">Datos del relevamiento</h2>
                  <p className="text-muted-foreground mt-1 text-sm">
                    Se inyectan al prompt de la IA para reducir placeholders.
                  </p>
                </div>
                <CollapsibleTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="shrink-0"
                    aria-label={metadataOpenEffective ? 'Ocultar datos' : 'Mostrar datos'}
                  >
                    <ChevronDown
                      className={`size-4 transition-transform ${
                        metadataOpenEffective ? 'rotate-180' : ''
                      }`}
                    />
                  </Button>
                </CollapsibleTrigger>
              </div>

              <CollapsibleContent className="space-y-4 pt-4">
                <Separator />
                <Form {...metadataForm}>
                  <form
                    onSubmit={(e) => void metadataForm.handleSubmit(onSaveMetadata)(e)}
                    className="space-y-6 pt-2"
                    noValidate
                  >
                    <RgrlMetadataForm form={metadataForm} disabled={isPending} />
                    <div className="flex justify-end">
                      <Button type="submit" disabled={isPending}>
                        {state === 'saving_metadata' ? 'Guardando…' : 'Guardar datos'}
                      </Button>
                    </div>
                  </form>
                </Form>
              </CollapsibleContent>
            </Collapsible>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardContent className="space-y-4 pt-6">
            <div className="space-y-2">
              <Label htmlFor="user-prompt">Contexto opcional para la IA</Label>
              <Textarea
                id="user-prompt"
                value={userPrompt}
                onChange={(e) => setUserPrompt(e.target.value.slice(0, USER_PROMPT_MAX))}
                placeholder={USER_PROMPT_PLACEHOLDERS[tipo]}
                rows={4}
                disabled={isPending}
              />
              <p className="text-muted-foreground text-xs">
                {userPrompt.length} / {USER_PROMPT_MAX} caracteres
              </p>
            </div>

            <Button
              type="button"
              variant="default"
              disabled={isPending}
              onClick={() => void onGenerate()}
              className="w-full"
            >
              <Sparkles className="mr-2 h-4 w-4" />
              {state === 'generating' ? 'Generando con IA…' : 'Generar con IA'}
            </Button>

            {state === 'generated' && (
              <Alert>
                <AlertTitle>Borrador generado</AlertTitle>
                <AlertDescription>
                  El borrador fue generado por IA. Revisalo y editalo antes de guardar — vos firmás
                  como profesional matriculado.
                </AlertDescription>
              </Alert>
            )}

            <Form {...form}>
              <form
                onSubmit={(e) => void form.handleSubmit(onSubmit)(e)}
                className="space-y-4"
                noValidate
              >
                <FormField
                  control={form.control}
                  name="content"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Contenido del informe</FormLabel>
                      <FormControl>
                        <Textarea
                          {...field}
                          rows={20}
                          placeholder="Generá el borrador con IA o escribilo manualmente en markdown."
                          className="font-mono text-sm"
                          disabled={isPending}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" asChild disabled={isPending}>
                    <Link href={`/informes/${informeId}`}>Cancelar</Link>
                  </Button>
                  <Button type="submit" disabled={isPending}>
                    {state === 'saving' ? 'Guardando…' : 'Guardar cambios'}
                  </Button>
                </div>
              </form>
            </Form>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground mb-4 text-xs font-medium tracking-wide uppercase">
              Vista previa
            </p>
            <div className="min-h-[400px]">
              <MarkdownPreview content={watchedContent} />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
