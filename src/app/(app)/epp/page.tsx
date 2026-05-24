import { redirect } from 'next/navigation';

/**
 * T-101 / T-106 · Landing del módulo EPP → padrón empleados.
 *
 * El padrón es la vista de mayor frecuencia operativa (mirar quién está al día
 * con EPP). El sidebar apunta a `/epp` por estabilidad de URL — el redirect
 * absorbe el cambio sin tocar `nav-items.ts`.
 */
export default function EppIndex() {
  redirect('/epp/padron');
}
