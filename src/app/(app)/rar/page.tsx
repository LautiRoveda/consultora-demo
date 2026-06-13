import { redirect } from 'next/navigation';

// T-143 · RAR es un vertical propio (catálogo de agentes + exposición ahora;
// planilla de expuestos + vencimiento en fases siguientes). La landing redirige
// al catálogo de agentes, que es el punto de entrada de la Fase 1.
export default function RarIndexPage() {
  redirect('/rar/agentes');
}
