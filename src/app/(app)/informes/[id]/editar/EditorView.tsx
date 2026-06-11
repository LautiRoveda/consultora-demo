'use client';

import type { FieldValues, UseFormReturn } from 'react-hook-form';
import type { PlantillaClientItem } from '../../plantillas/PlantillaControls';
import type { InformeStatus, InformeTipo } from '../../schema';
import type { UpdateInformeContentInput } from '../schema';
import type { AttachmentClientRow } from './AttachmentsSection';
import { zodResolver } from '@hookform/resolvers/zod';
import { ChevronDown, Sparkles, X } from 'lucide-react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
/**
 * Schema por tipo para `useForm(resolver: zodResolver(...))`. El tipo del
 * informe esta fijo en /editar (a diferencia del wizard), asi que un solo
 * useForm tipado al schema del tipo activo es suficiente.
 *
 * Cast a `ZodType<FieldValues, FieldValues>`: necesario para que zodResolver
 * encaje en `Resolver<FieldValues>`. Las metadata concretas son
 * `Record<string, unknown>` por construccion, asi que el cast es seguro pero
 * TS no puede inferirlo (variance del schema generico).
 */
import { type ZodType } from 'zod';

import { parseSseStream } from '@/shared/ai/sse-client';
import { useMediaQuery } from '@/shared/lib/use-media-query';
import { accidenteMetadataSchema } from '@/shared/templates/accidente/schema';
import { capacitacionMetadataSchema } from '@/shared/templates/capacitacion/schema';
import { otrosMetadataSchema } from '@/shared/templates/otros/schema';
import { TEMPLATE_CLIENT_REGISTRY } from '@/shared/templates/registry/client';
import { relevamientoMetadataSchema } from '@/shared/templates/relevamiento/schema';
import { rgrlMetadataSchema } from '@/shared/templates/rgrl/schema';
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Card, CardContent } from '@/shared/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/shared/ui/collapsible';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/shared/ui/form';
import { Label } from '@/shared/ui/label';
import { Separator } from '@/shared/ui/separator';
import { Textarea } from '@/shared/ui/textarea';

import { PlantillaControls } from '../../plantillas/PlantillaControls';
import { INFORME_TIPO_LABELS } from '../../schema';
import { updateInformeContentAction, updateInformeMetadataAction } from '../actions';
import { MarkdownPreview } from '../MarkdownPreview';
import { updateInformeInputSchema } from '../schema';
import { AttachmentsSection } from './AttachmentsSection';
import { PostPublishEventDialog } from './PostPublishEventDialog';
import { PublishButton } from './PublishButton';

/**
 * T-140 · Editor WYSIWYG (Plate). Client-only + lazy (`ssr:false`) para no
 * penalizar Lighthouse y mantener Plate fuera del chunk principal del editor.
 */
const ReportMarkdownField = dynamic(
  () => import('@/shared/ui/plate/report-markdown-editor').then((m) => m.ReportMarkdownEditor),
  {
    ssr: false,
    loading: () => <div className="bg-muted/30 min-h-[480px] animate-pulse rounded-md border" />,
  },
);

/**
 * T-025 · State machine extendida. `generating-stream` reemplaza al
 * `generating` de T-020 — la diferencia visual es que durante el stream
 * vemos chunks aparecer, y se muestra un boton "Cancelar".
 */
type EditorState = 'idle' | 'generating-stream' | 'generated' | 'saving' | 'saving_metadata';

const USER_PROMPT_MAX = 2000;
/** Fallback de flush si rAF pausa (tab background). En foreground rAF gana. */
const STREAM_FLUSH_FALLBACK_MS = 250;

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

const SCHEMA_BY_TIPO: Record<InformeTipo, ZodType<FieldValues, FieldValues>> = {
  rgrl: rgrlMetadataSchema,
  capacitacion: capacitacionMetadataSchema,
  relevamiento: relevamientoMetadataSchema,
  accidente: accidenteMetadataSchema,
  otros: otrosMetadataSchema,
};

const SUMMARY_TITLE_BY_TIPO: Record<InformeTipo, string> = {
  rgrl: 'Datos del relevamiento',
  capacitacion: 'Datos de la capacitación',
  relevamiento: 'Datos del relevamiento',
  accidente: 'Datos del accidente',
  otros: 'Datos del informe',
};

export function EditorView({
  informeId,
  tipo,
  titulo,
  initialContent,
  initialMetadata,
  initialStatus,
  attachments,
  canEdit,
  autoCreateEventOnSign,
  hasLinkedEvent,
  razonSocial,
  plantillas,
}: {
  informeId: string;
  tipo: InformeTipo;
  titulo: string;
  initialContent: string | null;
  /**
   * T-022: payload typesafe es `unknown` en la signature publica — el server
   * page.tsx valida via el schema del registry antes de pasarlo aca, asi que
   * estructuralmente coincide con el shape esperado.
   */
  initialMetadata: unknown;
  /** T-036: status del informe (draft/published/archived) para el PublishButton. */
  initialStatus: InformeStatus;
  /** T-024: attachments con signed URLs ya generadas por el server (TTL 1h). */
  attachments: AttachmentClientRow[];
  canEdit: boolean;
  /** T-036: toggle de la consultora. Si true, silent path en publish; sino modal. */
  autoCreateEventOnSign: boolean;
  /** T-036: si el informe ya tiene evento vinculado, NO mostrar modal post-publish. */
  hasLinkedEvent: boolean;
  /** T-036: razon_social del metadata para prepop del PostPublishEventDialog. */
  razonSocial: string | null;
  /** T-139: plantillas activas del tipo del informe (filtradas server-side). */
  plantillas: PlantillaClientItem[];
}) {
  const router = useRouter();
  const [state, setState] = useState<EditorState>('idle');
  const [userPrompt, setUserPrompt] = useState('');
  // T-036: state local del PostPublishEventDialog. Se abre solo cuando el
  // PublishButton invoca el callback (condiciones: toggle OFF + tipo recurrente
  // + sin evento previo + publish OK + autoCreatedEventId null).
  const [postPublishOpen, setPostPublishOpen] = useState(false);
  /**
   * T-025 · Buffer del stream visible. Update via rAF para no saturar
   * react-markdown con un re-render por chunk. Al `done` se copia a
   * form.content (state final del editor).
   */
  const [streamingBuffer, setStreamingBuffer] = useState('');

  // T-140 · `resetSignal` fuerza re-deserialize del editor (mount / done del
  // stream / volver de source-mode). `sourceMode` togglea Plate ↔ textarea crudo.
  // `flushEditorRef` serializa lo último tecleado para el guardado (anti stale-save).
  const [resetSignal, setResetSignal] = useState(0);
  const [sourceMode, setSourceMode] = useState(false);
  const flushEditorRef = useRef<(() => string) | null>(null);

  // Refs para cleanup al unmount. Sin esto, navegar mid-stream filtra el
  // fetch + el SDK sigue tirando tokens hasta el message_stop sin que la UI
  // se entere.
  const abortRef = useRef<AbortController | null>(null);
  const bufferRef = useRef('');
  const rafIdRef = useRef<number | null>(null);
  const timeoutIdRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const form = useForm<UpdateInformeContentInput>({
    resolver: zodResolver(updateInformeInputSchema),
    defaultValues: { content: initialContent ?? '' },
  });

  // T-022: form del tipo activo. Schema y defaults vienen del registry +
  // SCHEMA_BY_TIPO. useForm con generic FieldValues para evitar variance
  // issues — el resolver garantiza shape correcto en runtime.
  // T-138: merge con defaults — la metadata persistida pre-T-138 no trae los
  // campos de personalizacion y RHF necesita defaults para TODOS los fields.
  const tipoEntry = TEMPLATE_CLIENT_REGISTRY[tipo];
  const metadataForm = useForm<FieldValues>({
    resolver: zodResolver(SCHEMA_BY_TIPO[tipo]),
    defaultValues:
      initialMetadata && typeof initialMetadata === 'object'
        ? { ...tipoEntry.defaults(), ...initialMetadata }
        : tipoEntry.defaults(),
  });

  const isDesktop = useMediaQuery('(min-width: 768px)');
  const [metadataOpen, setMetadataOpen] = useState<boolean | undefined>(undefined);
  const metadataOpenEffective = metadataOpen ?? (initialMetadata ? isDesktop : true);

  // eslint-disable-next-line react-hooks/incompatible-library
  const watchedContent = form.watch('content');
  const isStreaming = state === 'generating-stream';
  const isPending = isStreaming || state === 'saving' || state === 'saving_metadata';

  const FormComponent = tipoEntry.FormComponent;

  // Cleanup al unmount: abort fetch + cancelar rAF y timeout fallback. Sin
  // esto, navegar a otra ruta mid-stream deja el fetch corriendo en
  // background y los tokens server-side se siguen gastando.
  useEffect(() => {
    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      if (timeoutIdRef.current !== null) {
        clearTimeout(timeoutIdRef.current);
        timeoutIdRef.current = null;
      }
    };
  }, []);

  function scheduleFlush(): void {
    if (rafIdRef.current !== null) return;
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null;
      if (timeoutIdRef.current !== null) {
        clearTimeout(timeoutIdRef.current);
        timeoutIdRef.current = null;
      }
      setStreamingBuffer(bufferRef.current);
    });
    // Fallback: si la pestana esta en background rAF pausa indefinido.
    // El timeout asegura updates ocasionales sin importar el estado del tab.
    if (timeoutIdRef.current === null) {
      timeoutIdRef.current = setTimeout(() => {
        timeoutIdRef.current = null;
        if (rafIdRef.current !== null) {
          cancelAnimationFrame(rafIdRef.current);
          rafIdRef.current = null;
        }
        setStreamingBuffer(bufferRef.current);
      }, STREAM_FLUSH_FALLBACK_MS);
    }
  }

  function flushAndStopThrottle(): void {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    if (timeoutIdRef.current !== null) {
      clearTimeout(timeoutIdRef.current);
      timeoutIdRef.current = null;
    }
    setStreamingBuffer(bufferRef.current);
  }

  async function onGenerate(): Promise<void> {
    if (form.formState.isDirty && watchedContent.trim().length > 0) {
      const ok = window.confirm(
        '¿Reemplazar el contenido actual con el nuevo borrador generado? Tus cambios sin guardar se van a perder.',
      );
      if (!ok) return;
    }

    // Reset del buffer y abort controller para esta corrida.
    bufferRef.current = '';
    setStreamingBuffer('');
    const ac = new AbortController();
    abortRef.current = ac;
    setState('generating-stream');

    let usage: { inputTokens: number; outputTokens: number } | null = null;

    try {
      const res = await fetch(`/api/informes/${informeId}/generate-stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userPrompt: userPrompt.trim() }),
        signal: ac.signal,
      });

      // Error pre-stream (4xx/5xx con JSON body). Despues de status 200 el
      // body es SSE — el error puede venir adentro como evento `error`.
      if (!res.ok) {
        let code = 'INTERNAL_ERROR';
        let message = 'Hubo un error inesperado generando el informe.';
        try {
          const body = (await res.json()) as { code?: string; message?: string };
          code = body.code ?? code;
          message = body.message ?? message;
        } catch {
          // Body no es JSON parseable — usamos los defaults.
        }
        handleErrorCode(code, message);
        return;
      }

      if (!res.body) {
        handleErrorCode('INTERNAL_ERROR', 'Respuesta sin body.');
        return;
      }

      let lastErrorCode: string | null = null;
      let lastErrorMessage = '';

      for await (const event of parseSseStream(res.body)) {
        if (event.type === 'delta') {
          const { text } = JSON.parse(event.data) as { text: string };
          bufferRef.current += text;
          scheduleFlush();
        } else if (event.type === 'usage') {
          usage = JSON.parse(event.data) as { inputTokens: number; outputTokens: number };
        } else if (event.type === 'stop') {
          // No-op visual — el done que sigue cierra el flujo.
        } else if (event.type === 'error') {
          const err = JSON.parse(event.data) as { code: string; message: string };
          lastErrorCode = err.code;
          lastErrorMessage = err.message;
          break;
        } else if (event.type === 'done') {
          break;
        }
      }

      flushAndStopThrottle();

      if (lastErrorCode) {
        // STREAM_ABORTED es silent — fue intencional del usuario.
        if (lastErrorCode === 'STREAM_ABORTED') {
          bufferRef.current = '';
          setStreamingBuffer('');
          setState('idle');
          return;
        }
        handleErrorCode(lastErrorCode, lastErrorMessage);
        return;
      }

      // Exito. Copiamos el buffer al form.content (state autoritativo del
      // editor) y limpiamos el buffer de stream.
      const finalContent = bufferRef.current;
      form.setValue('content', finalContent, { shouldDirty: true });
      // T-140 · re-deserializar el markdown generado al editor Plate.
      setResetSignal((n) => n + 1);
      bufferRef.current = '';
      setStreamingBuffer('');
      setState('generated');
      toast.success('Borrador generado', {
        description: usage
          ? `Tokens usados: ${usage.inputTokens} entrada + ${usage.outputTokens} salida.`
          : undefined,
      });
    } catch (err) {
      // AbortError esperado cuando el usuario clickea "Cancelar" o navega.
      if (err instanceof DOMException && err.name === 'AbortError') {
        bufferRef.current = '';
        setStreamingBuffer('');
        setState('idle');
        return;
      }
      flushAndStopThrottle();
      bufferRef.current = '';
      setStreamingBuffer('');
      handleErrorCode('INTERNAL_ERROR', 'Hubo un error inesperado generando el informe.');
    } finally {
      abortRef.current = null;
    }
  }

  function handleErrorCode(code: string, message: string): void {
    setState('idle');
    switch (code) {
      case 'INVALID_INPUT':
        toast.error('Datos inválidos', { description: message });
        return;
      case 'UNAUTHENTICATED':
        toast.error('Sesión vencida', { description: message });
        router.push('/login');
        return;
      case 'NO_CONSULTORA':
        toast.error('Cuenta sin consultora', { description: message });
        return;
      case 'FORBIDDEN':
        toast.error('Sin permiso', { description: message });
        return;
      case 'NOT_FOUND':
        toast.error('Informe no encontrado', { description: message });
        return;
      case 'RATE_LIMITED':
        toast.error('IA saturada', { description: message });
        return;
      case 'CONTENT_FILTER':
        toast.error('Contenido rechazado por la IA', { description: message });
        return;
      case 'TIMEOUT':
        toast.error('Tiempo agotado', { description: message });
        return;
      case 'BILLING_GATED':
        toast.error('Plan expirado', {
          description: message,
          action: { label: 'Suscribirme', onClick: () => router.push('/settings/billing') },
        });
        return;
      case 'INTERNAL_ERROR':
      default:
        toast.error('Error inesperado', { description: message });
        return;
    }
  }

  function onCancelStream(): void {
    // Dispara el cleanup del fetch + el SDK server-side detecta signal.aborted
    // y emite event:error STREAM_ABORTED antes de cerrar. El reader del
    // for-await captura el error o el AbortError + reseteamos state.
    abortRef.current?.abort();
  }

  async function onSubmit(values: UpdateInformeContentInput) {
    setState('saving');
    // T-140 · Flush: serializar lo último tecleado en Plate (no confiar en el
    // debounce → evita stale-save). En source-mode el valor del form ya es actual.
    const content =
      !sourceMode && flushEditorRef.current ? flushEditorRef.current() : values.content;
    const result = await updateInformeContentAction(informeId, { content });

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
   * T-022 · Submit del form de metadata. El action espera discriminated
   * union {tipo, data} — wrapeamos con el tipo activo del informe.
   */
  async function onSaveMetadata(values: FieldValues) {
    setState('saving_metadata');
    const result = await updateInformeMetadataAction(informeId, {
      tipo,
      data: values,
    });

    if (result.ok) {
      toast.success('Datos guardados');
      router.refresh();
      setState('idle');
      return;
    }

    setState('idle');

    if (result.code === 'INVALID_INPUT') {
      for (const [field, messages] of Object.entries(result.fieldErrors)) {
        metadataForm.setError(field, { message: messages[0] });
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

  // Preview source: durante el stream mostramos el buffer parcial; despues
  // del done (state generated/idle/saving) mostramos el contenido autoritativo.
  const previewContent = isStreaming ? streamingBuffer : watchedContent;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-muted-foreground text-sm">
            <Link href={`/informes/${informeId}`} className="hover:text-foreground hover:underline">
              ← Volver al informe
            </Link>
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-balance break-words">
            Editar: {titulo}
          </h1>
          <p className="text-muted-foreground text-sm">Tipo: {INFORME_TIPO_LABELS[tipo]}</p>
        </div>
        {/* T-036: PublishButton inline en el header. Dispara silent path o
            modal post-firma segun consultora.auto_create_event_on_sign. */}
        <PublishButton
          informeId={informeId}
          status={initialStatus}
          informeTipo={tipo}
          canPublish={canEdit}
          autoCreateEventOnSign={autoCreateEventOnSign}
          hasLinkedEvent={hasLinkedEvent}
          onPostPublishModalRequested={() => setPostPublishOpen(true)}
        />
      </div>

      <Card>
        <CardContent className="pt-6">
          <Collapsible open={metadataOpenEffective} onOpenChange={setMetadataOpen}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold tracking-tight">
                  {SUMMARY_TITLE_BY_TIPO[tipo]}
                </h2>
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
                  {/* T-139 · Aplicar/guardar plantillas de personalizacion.
                      Snapshot-on-apply: copia al form; persiste el flujo normal. */}
                  <PlantillaControls
                    tipo={tipo}
                    form={metadataForm as UseFormReturn<FieldValues>}
                    plantillas={plantillas}
                    disabled={isPending}
                  />
                  <FormComponent
                    form={metadataForm as UseFormReturn<FieldValues>}
                    disabled={isPending}
                  />
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

      <AttachmentsSection
        informeId={informeId}
        initialAttachments={attachments}
        canEdit={canEdit}
      />

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

            {isStreaming ? (
              <Button type="button" variant="outline" onClick={onCancelStream} className="w-full">
                <X className="mr-2 h-4 w-4" />
                Cancelar generación
              </Button>
            ) : (
              <Button
                type="button"
                variant="default"
                disabled={isPending}
                onClick={() => void onGenerate()}
                className="w-full"
              >
                <Sparkles className="mr-2 h-4 w-4" />
                Generar con IA
              </Button>
            )}

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
                      <div className="flex items-center justify-between gap-2">
                        <FormLabel>Contenido del informe</FormLabel>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={isPending}
                          onClick={() => {
                            // Al ir a source-mode, volcar el editor al form SIN
                            // cambiar el estado dirty (el round-trip puede reformatear).
                            if (!sourceMode && flushEditorRef.current) {
                              form.setValue('content', flushEditorRef.current(), {
                                shouldDirty: form.formState.isDirty,
                              });
                            }
                            const next = !sourceMode;
                            setSourceMode(next);
                            // Al volver a WYSIWYG, re-deserializar el markdown editado a mano.
                            if (!next) setResetSignal((n) => n + 1);
                          }}
                        >
                          {sourceMode ? 'Editor visual' : 'Ver markdown'}
                        </Button>
                      </div>
                      <FormControl>
                        {sourceMode ? (
                          <Textarea
                            {...field}
                            rows={20}
                            placeholder="Markdown crudo del informe."
                            className="font-mono text-sm"
                            disabled={isPending}
                          />
                        ) : (
                          <ReportMarkdownField
                            value={field.value}
                            onChange={field.onChange}
                            onBlur={field.onBlur}
                            resetSignal={resetSignal}
                            disabled={isPending}
                            onRegisterFlush={(flush) => {
                              flushEditorRef.current = flush;
                            }}
                          />
                        )}
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
              <MarkdownPreview content={previewContent} />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* T-036 modal post-firma. Solo aparece cuando PublishButton invoca el
          callback (toggle OFF + tipo recurrente + sin evento previo). */}
      <PostPublishEventDialog
        open={postPublishOpen}
        onOpenChange={setPostPublishOpen}
        informeId={informeId}
        informeTipo={tipo}
        informeTitulo={titulo}
        defaultRazonSocial={razonSocial}
      />
    </div>
  );
}
