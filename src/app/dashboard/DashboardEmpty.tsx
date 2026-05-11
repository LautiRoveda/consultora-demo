import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';

import { signOutAction } from './actions';

/**
 * Edge case: user logueado pero sin consultora asociada. Post-T-012 (signup
 * atómico vía RPC) esto NO debería pasar — la transacción que crea el user
 * en auth.users también inserta consultora + consultora_members en una sola
 * operación. Si llegamos acá, hay un error que ya se loggeó a Sentry desde
 * `dashboard/page.tsx`.
 *
 * UX: informativo + opción de cerrar sesión. NO redirect automático ni
 * logout forzado.
 */
export function DashboardEmpty({
  email,
  showResetSuccess,
}: {
  email: string;
  showResetSuccess?: boolean;
}) {
  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-12">
      {showResetSuccess && (
        <Alert>
          <AlertTitle>Contraseña actualizada</AlertTitle>
          <AlertDescription>Tu nueva contraseña ya está activa.</AlertDescription>
        </Alert>
      )}
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Hola, {email}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>
            Tu cuenta existe pero no encontramos consultora asociada. Esto no debería pasar — ya nos
            llegó el aviso y lo estamos revisando.
          </p>
          <p className="text-muted-foreground">
            Si querés contactarnos para acelerar el fix, escribinos respondiendo al email de
            confirmación de tu cuenta.
          </p>
          <form action={signOutAction} className="pt-2">
            <Button type="submit" variant="outline">
              Cerrar sesión
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
