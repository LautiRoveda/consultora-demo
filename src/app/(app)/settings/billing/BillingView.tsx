'use client';

import type { FacturaRow, SuscripcionRow } from './queries';
import { Receipt } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';

import { formatARS } from '@/shared/lib/format-ars';
import { trialDaysLeft } from '@/shared/lib/trial-days';
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardContent } from '@/shared/ui/card';

import { CancelPendingButton } from './CancelPendingButton';
import { CancelSubscriptionButton } from './CancelSubscriptionButton';
import { SubscribeButton } from './SubscribeButton';

type EstadoFactura = 'pendiente' | 'pagada' | 'fallida' | 'reembolsada';
type EstadoSuscripcion =
  | 'trial'
  | 'pendiente_autorizacion'
  | 'activa'
  | 'morosa'
  | 'cancelada'
  | 'expirada';

/**
 * T-072 · Vista de billing.
 *
 * Render-only del estado calculado en el server component. Toda mutación
 * (subscribe/cancel) la dispara un sub-component que invoca server actions
 * existentes (T-071). El single source of truth del estado vive en
 * `suscripciones` — esta vista NUNCA decide por su cuenta.
 *
 * Branching por `suscripcion?.estado`:
 *   - null + plan='trial' → CTA suscribirme (caso 95% del trial).
 *   - pendiente_autorizacion → redirect pendiente, link al initPoint MP.
 *   - activa → muestra fecha próx cobro + CTA cancelar.
 *   - morosa → warning + link externo a MP (retry lo hace MP, no nosotros).
 *   - cancelada con cancelar_en futuro → mostrar fecha de bajada efectiva.
 *   - expirada → CTA suscribirme + mensaje de retención de datos.
 */

interface BillingViewProps {
  role: 'owner' | 'member';
  trialHasta: string | null;
  suscripcion: SuscripcionRow | null;
  invoices: FacturaRow[];
  priceCentavos: number;
  page: number;
  hasNext: boolean;
  statusParam: 'success' | 'pending' | 'failure' | null;
}

export function BillingView({
  role,
  trialHasta,
  suscripcion,
  invoices,
  priceCentavos,
  page,
  hasNext,
  statusParam,
}: BillingViewProps) {
  const router = useRouter();
  const toastedRef = useRef(false);

  // Toast post-redirect Mercado Pago (back_url).
  // useEffect en lugar de inline para no spammear en cada re-render +
  // limpia el query param después para que el F5 no re-dispare el toast.
  useEffect(() => {
    if (!statusParam || toastedRef.current) return;
    toastedRef.current = true;
    switch (statusParam) {
      case 'success':
        toast.success('Suscripción autorizada', {
          description: 'Procesando primer cobro. Te avisamos cuando se acredite.',
        });
        break;
      case 'pending':
        toast.info('Suscripción en proceso', {
          description: 'Mercado Pago está procesando tu autorización.',
        });
        break;
      case 'failure':
        toast.error('No se pudo autorizar', {
          description: 'Volvé a intentarlo o usá otro medio de pago.',
        });
        break;
    }
    // Limpia el ?status= de la URL.
    router.replace('/settings/billing');
  }, [statusParam, router]);

  const isOwner = role === 'owner';

  return (
    <div className="space-y-6">
      {!isOwner && (
        <Alert>
          <AlertTitle>Solo el owner puede gestionar la suscripción</AlertTitle>
          <AlertDescription>
            Sos member de la consultora. Pedile al owner que actualice la facturación si lo
            necesitás.
          </AlertDescription>
        </Alert>
      )}

      <PlanCurrentCard
        trialHasta={trialHasta}
        suscripcion={suscripcion}
        priceCentavos={priceCentavos}
        isOwner={isOwner}
      />

      <InvoicesList invoices={invoices} page={page} hasNext={hasNext} />
    </div>
  );
}

function PlanCurrentCard({
  trialHasta,
  suscripcion,
  priceCentavos,
  isOwner,
}: {
  trialHasta: string | null;
  suscripcion: SuscripcionRow | null;
  priceCentavos: number;
  isOwner: boolean;
}) {
  const estado = suscripcion?.estado ?? null;

  // Trial puro: no hay fila en suscripciones todavía. Es el 95% del primer
  // ingreso a esta vista.
  if (!suscripcion) {
    const days = trialDaysLeft(trialHasta);
    const trialExpired = days !== null && days <= 0;
    return (
      <SettingsCard
        title={trialExpired ? 'Trial vencido' : 'Plan Trial'}
        badge={
          trialExpired ? (
            <Badge variant="destructive">Vencido</Badge>
          ) : (
            <Badge variant="outline">Trial</Badge>
          )
        }
      >
        <p className="text-muted-foreground text-sm">
          {trialExpired
            ? 'Tu trial expiró. Suscribite para seguir usando ConsultoraDemo. Tus datos están protegidos por 30 días post-trial.'
            : days !== null
              ? `Tenés ${days} ${days === 1 ? 'día' : 'días'} restantes en tu trial.`
              : 'Estás en período de prueba.'}
        </p>
        <p className="text-muted-foreground text-sm">
          Plan Pro: <strong>{formatARS(priceCentavos)}</strong> mensuales.
        </p>
        {isOwner && (
          <div>
            <SubscribeButton />
          </div>
        )}
      </SettingsCard>
    );
  }

  switch (estado as EstadoSuscripcion) {
    case 'pendiente_autorizacion':
      return (
        <SettingsCard
          title="Procesando suscripción"
          badge={<Badge variant="outline">Pendiente</Badge>}
        >
          <p className="text-muted-foreground text-sm">
            Te redirigimos a Mercado Pago para autorizar el cobro recurrente. Si cerraste la pestaña
            por error, continuá donde quedaste o cancelá y empezá de nuevo.
          </p>
          {isOwner &&
            (suscripcion.init_point ? (
              <div className="flex flex-wrap gap-2">
                <Button asChild data-testid="continue-authorization-link">
                  <a href={suscripcion.init_point} target="_blank" rel="noreferrer noopener">
                    Continuar autorización en Mercado Pago
                  </a>
                </Button>
                <CancelPendingButton suscripcionId={suscripcion.id} />
              </div>
            ) : (
              // Fallback defensivo: sub pre-FU3 sin init_point persistido.
              <div className="flex flex-wrap gap-2">
                <SubscribeButton label="Reintentar autorización" />
                <CancelPendingButton suscripcionId={suscripcion.id} />
              </div>
            ))}
        </SettingsCard>
      );

    case 'activa':
      return (
        <SettingsCard
          title="Plan Pro"
          badge={
            <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
              Activa
            </Badge>
          }
        >
          <p className="text-muted-foreground text-sm">
            <strong>{formatARS(priceCentavos)}</strong> mensuales · Próximo cobro:{' '}
            <strong>{formatDateAR(suscripcion.periodo_fin)}</strong>.
          </p>
          {isOwner && (
            <div>
              <CancelSubscriptionButton
                suscripcionId={suscripcion.id}
                periodoFin={suscripcion.periodo_fin}
              />
            </div>
          )}
        </SettingsCard>
      );

    case 'morosa':
      return (
        <SettingsCard
          title="Plan Pro"
          badge={
            <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-300">
              Pago pendiente
            </Badge>
          }
        >
          <p className="text-muted-foreground text-sm">
            Hay un cobro pendiente. Mercado Pago está reintentando automáticamente. Si el problema
            persiste, actualizá tu medio de pago desde el panel de Mercado Pago.
          </p>
          {isOwner && (
            <Button asChild variant="outline">
              <a
                href="https://www.mercadopago.com.ar/subscriptions"
                target="_blank"
                rel="noreferrer noopener"
              >
                Abrir Mercado Pago
              </a>
            </Button>
          )}
        </SettingsCard>
      );

    case 'cancelada':
      return (
        <SettingsCard title="Plan cancelado" badge={<Badge variant="secondary">Cancelado</Badge>}>
          <p className="text-muted-foreground text-sm">
            {suscripcion.cancelar_en
              ? `Mantenés acceso hasta el ${formatDateAR(suscripcion.cancelar_en)}. Después perdés acceso a las features pagas.`
              : 'Tu suscripción fue cancelada.'}
          </p>
        </SettingsCard>
      );

    case 'expirada':
      return (
        <SettingsCard title="Trial vencido" badge={<Badge variant="destructive">Vencido</Badge>}>
          <p className="text-muted-foreground text-sm">
            Tu trial expiró. Suscribite para seguir usando ConsultoraDemo. Tus datos están
            protegidos por 30 días post-trial.
          </p>
          {isOwner && (
            <div>
              <SubscribeButton />
            </div>
          )}
        </SettingsCard>
      );

    case 'trial':
    default: {
      // Estado raro: fila en suscripciones con estado 'trial' (T-070 lo permite
      // pero el flow normal no inserta). Tratamos como trial puro.
      const days = trialDaysLeft(trialHasta);
      return (
        <SettingsCard title="Plan Trial" badge={<Badge variant="outline">Trial</Badge>}>
          <p className="text-muted-foreground text-sm">
            {days !== null && days > 0
              ? `Tenés ${days} ${days === 1 ? 'día' : 'días'} restantes en tu trial.`
              : 'Estás en período de prueba.'}
          </p>
          {isOwner && (
            <div>
              <SubscribeButton />
            </div>
          )}
        </SettingsCard>
      );
    }
  }
}

function SettingsCard({
  title,
  badge,
  children,
}: {
  title: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-semibold tracking-tight">{title}</h2>
          {badge}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

function InvoicesList({
  invoices,
  page,
  hasNext,
}: {
  invoices: FacturaRow[];
  page: number;
  hasNext: boolean;
}) {
  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div>
          <h2 className="text-base font-semibold tracking-tight">Historial de facturas</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Los recibos los emite Mercado Pago en cada cobro acreditado.
          </p>
        </div>

        {invoices.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <Receipt className="text-muted-foreground h-6 w-6" />
            <p className="text-foreground text-sm font-medium">Todavía no hay facturas</p>
            <p className="text-muted-foreground max-w-md text-sm">
              Aparecerán acá cuando se procese tu primer cobro.
            </p>
          </div>
        ) : (
          <>
            <ul className="divide-border divide-y rounded-md border" data-testid="invoices-list">
              <li className="text-muted-foreground bg-muted/30 grid grid-cols-[1fr_auto_auto_auto] gap-3 px-4 py-2 text-xs font-medium uppercase tracking-wide">
                <span>Fecha</span>
                <span className="text-right">Monto</span>
                <span className="text-right">Estado</span>
                <span className="text-right">Recibo</span>
              </li>
              {invoices.map((f) => (
                <li
                  key={f.id}
                  className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 px-4 py-3 text-sm"
                >
                  <span>{formatDateAR(f.created_at)}</span>
                  <span className="text-right font-medium">{formatARS(f.monto_centavos)}</span>
                  <span className="text-right">
                    <InvoiceStatusBadge estado={f.estado} />
                  </span>
                  <span className="text-right">
                    {f.recibo_url ? (
                      <a
                        href={f.recibo_url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="text-primary text-sm hover:underline"
                      >
                        Ver
                      </a>
                    ) : (
                      <span className="text-muted-foreground text-sm">—</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>

            <div className="flex items-center justify-between">
              <Button asChild variant="outline" size="sm" disabled={page <= 1}>
                <Link
                  href={page <= 1 ? '#' : `/settings/billing?page=${page - 1}`}
                  aria-disabled={page <= 1}
                  tabIndex={page <= 1 ? -1 : undefined}
                >
                  ← Anteriores
                </Link>
              </Button>
              <span className="text-muted-foreground text-xs">Página {page}</span>
              <Button asChild variant="outline" size="sm" disabled={!hasNext}>
                <Link
                  href={hasNext ? `/settings/billing?page=${page + 1}` : '#'}
                  aria-disabled={!hasNext}
                  tabIndex={hasNext ? undefined : -1}
                >
                  Siguientes →
                </Link>
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function InvoiceStatusBadge({ estado }: { estado: EstadoFactura }) {
  switch (estado) {
    case 'pagada':
      return (
        <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">Pagada</Badge>
      );
    case 'pendiente':
      return <Badge variant="outline">Pendiente</Badge>;
    case 'fallida':
      return <Badge variant="destructive">Fallida</Badge>;
    case 'reembolsada':
      return <Badge variant="secondary">Reembolsada</Badge>;
  }
}

function formatDateAR(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
