import { redirect } from 'next/navigation';

/**
 * T-101 · Landing del módulo EPP. Sin padrón propio aún (T-106), redirige
 * directo al catálogo. El sidebar apunta a `/epp` para que cuando T-106 traiga
 * la landing real, no haya que volver a tocar `nav-items.ts`.
 */
export default function EppIndex() {
  redirect('/epp/catalogo');
}
