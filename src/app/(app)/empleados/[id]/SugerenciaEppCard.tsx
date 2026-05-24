'use client';

import { Sparkles } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { Skeleton } from '@/shared/ui/skeleton';

/**
 * T-106 · Card "Sugerencia EPP" en el detail del empleado.
 *
 * Botón "Sugerir EPP recomendado" → fetch POST /api/epp/sugerir-epp →
 * render lista de items con confianza + justificación + CTA "Crear entrega
 * con estos items" que redirige al wizard pre-cargado (solo items con
 * confianza > 60%, los demás son ruido para el flow operativo).
 *
 * NO persiste la sugerencia — es runtime. Si el user quiere registrarla,
 * el wizard hace el commit estándar via `createEntregaAction`.
 *
 * Empty state si el empleado no tiene puestos asignados: explica el
 * próximo paso al consultor sin disparar la request.
 */

const CONFIDENCE_THRESHOLD_FOR_PRESELECT = 60;

type Suggestion = {
  item_id: string;
  item_nombre: string;
  categoria_nombre: string;
  confianza_porcentaje: number;
  justificacion: string;
};

type OkResponse = {
  suggestions: Suggestion[];
  puestos_considerados: Array<{ puesto_id: string; nombre: string; riesgos: string[] }>;
  catalogo_considerado_count: number;
  recientes_excluidos: Array<{ item_id: string; item_nombre: string; vence_aprox: string }>;
  tokens_used: { input: number; output: number; cost_usd: number };
  model: string;
};

type EmptyResponse = {
  suggestions: [];
  reason: 'NO_PUESTOS' | 'NO_CATALOGO';
  message: string;
};

type ApiResponse = OkResponse | EmptyResponse;

interface Props {
  empleadoId: string;
  tienePuestos: boolean;
}

export function SugerenciaEppCard({ empleadoId, tienePuestos }: Props) {
  const router = useRouter();
  const [state, setState] = useState<
    | { kind: 'idle' }
    | { kind: 'loading' }
    | { kind: 'ok'; data: OkResponse }
    | { kind: 'empty'; reason: EmptyResponse['reason']; message: string }
  >({ kind: 'idle' });

  async function handleSuggest() {
    setState({ kind: 'loading' });
    try {
      const res = await fetch('/api/epp/sugerir-epp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ empleado_id: empleadoId }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
        handleErrorCode(body.code, res.status, body.message);
        setState({ kind: 'idle' });
        return;
      }

      const data = (await res.json()) as ApiResponse;
      if (data.suggestions.length === 0 && 'reason' in data) {
        setState({ kind: 'empty', reason: data.reason, message: data.message });
        return;
      }
      setState({ kind: 'ok', data: data as OkResponse });
    } catch {
      toast.error('Error de red', { description: 'No pudimos conectar con la IA. Reintentá.' });
      setState({ kind: 'idle' });
    }
  }

  function handleErrorCode(code: string | undefined, status: number, message?: string) {
    switch (code) {
      case 'BILLING_GATED':
        toast.error('Suscripción inactiva', {
          description: message ?? 'Renová tu plan para usar la IA.',
        });
        return;
      case 'RATE_LIMITED':
        toast.error('Demasiadas sugerencias', {
          description: message ?? 'Esperá un minuto y reintentá.',
        });
        return;
      case 'EMPLEADO_NOT_FOUND':
        toast.error('Empleado no encontrado', {
          description: 'Recargá la página.',
        });
        return;
      case 'AI_PARSE_ERROR':
        toast.error('Respuesta IA inválida', {
          description: 'Reintentá en unos segundos.',
        });
        return;
      case 'UNAUTHENTICATED':
        toast.error('Sesión vencida');
        router.push('/login');
        return;
      default:
        toast.error('No se pudo generar la sugerencia', {
          description: message ?? `Error ${status}.`,
        });
    }
  }

  function handleCreateEntrega() {
    if (state.kind !== 'ok') return;
    const itemsParaPreselect = state.data.suggestions
      .filter((s) => s.confianza_porcentaje >= CONFIDENCE_THRESHOLD_FOR_PRESELECT)
      .map((s) => s.item_id);
    if (itemsParaPreselect.length === 0) {
      toast.info('Sin items de alta confianza', {
        description: 'Las sugerencias actuales están debajo del umbral de preselección.',
      });
      return;
    }
    const query = new URLSearchParams({
      empleado: empleadoId,
      items: itemsParaPreselect.join(','),
    });
    router.push(`/epp/entregas/nueva?${query.toString()}`);
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" aria-hidden />
            Sugerencia EPP (IA)
          </CardTitle>
          <CardDescription>
            Recomendación basada en los puestos asignados, los riesgos cargados y el catálogo activo
            de tu consultora. Filtra items con vida útil vigente.
          </CardDescription>
        </div>
        <Button
          onClick={() => void handleSuggest()}
          disabled={!tienePuestos || state.kind === 'loading'}
          size="sm"
          data-testid="sugerir-epp-button"
        >
          {state.kind === 'loading' ? 'Generando…' : 'Sugerir EPP'}
        </Button>
      </CardHeader>
      <CardContent>
        {!tienePuestos && (
          <p className="text-muted-foreground text-sm">
            Asigná puestos al empleado primero. La IA usa los riesgos asociados para recomendar EPP.
          </p>
        )}

        {tienePuestos && state.kind === 'idle' && (
          <p className="text-muted-foreground text-sm">
            Tocá <strong>Sugerir EPP</strong> para pedirle a la IA un listado recomendado.
          </p>
        )}

        {state.kind === 'loading' && (
          <ul className="space-y-2" aria-busy="true" aria-label="Generando sugerencias">
            {[0, 1, 2, 3].map((i) => (
              <li key={i} className="flex items-center gap-3 rounded-md border p-3">
                <Skeleton className="h-5 w-5 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
                <Skeleton className="h-5 w-12" />
              </li>
            ))}
          </ul>
        )}

        {state.kind === 'empty' && <p className="text-muted-foreground text-sm">{state.message}</p>}

        {state.kind === 'ok' && state.data.suggestions.length === 0 && (
          <p className="text-muted-foreground text-sm">
            La IA no encontró items aplicables. Revisá que tu catálogo cubra los riesgos de los
            puestos.
          </p>
        )}

        {state.kind === 'ok' && state.data.suggestions.length > 0 && (
          <>
            <ul className="space-y-3">
              {state.data.suggestions.map((s) => (
                <li
                  key={s.item_id}
                  className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{s.item_nombre}</span>
                      <Badge variant="outline">{s.categoria_nombre}</Badge>
                    </div>
                    <p className="text-muted-foreground text-sm">{s.justificacion}</p>
                  </div>
                  <ConfidenceBadge value={s.confianza_porcentaje} />
                </li>
              ))}
            </ul>
            <div className="mt-4 flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-muted-foreground text-xs">
                {state.data.recientes_excluidos.length > 0 && (
                  <>
                    {state.data.recientes_excluidos.length} item
                    {state.data.recientes_excluidos.length === 1 ? '' : 's'} excluido
                    {state.data.recientes_excluidos.length === 1 ? '' : 's'} por vida útil
                    vigente.{' '}
                  </>
                )}
                Modelo: {state.data.model}.
              </p>
              <Button onClick={handleCreateEntrega} variant="default" size="sm">
                Crear entrega con estos items →
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ConfidenceBadge({ value }: { value: number }) {
  const variant: 'default' | 'secondary' | 'outline' =
    value >= 90 ? 'default' : value >= 60 ? 'secondary' : 'outline';
  return <Badge variant={variant}>{value}%</Badge>;
}
