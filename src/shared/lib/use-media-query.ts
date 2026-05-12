'use client';

import { useSyncExternalStore } from 'react';

/**
 * T-021 · Hook SSR-safe para matchMedia.
 *
 * Implementado con `useSyncExternalStore` (no `useState` + `useEffect`):
 * - Server-side / pre-hidratacion → snapshot = `false` (mobile-first).
 * - Browser → snapshot = `window.matchMedia(query).matches`, reactivo a
 *   los listeners del MediaQueryList. Single source of truth, sin sync
 *   intermedio de setState (que el lint `react-hooks/set-state-in-effect`
 *   prohibe).
 *
 * Uso tipico:
 *   const isDesktop = useMediaQuery('(min-width: 768px)');
 *   <Collapsible defaultOpen={isDesktop || !dataPoblada}>...</Collapsible>
 *
 * @param query CSS media query (ej. `'(min-width: 768px)'`).
 * @returns boolean reactivo al match.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = (onChange: () => void) => {
    if (typeof window === 'undefined') return () => {};
    const mql = window.matchMedia(query);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  };

  const getSnapshot = () => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(query).matches;
  };

  // SSR snapshot: mobile-first false.
  const getServerSnapshot = () => false;

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
