/**
 * T-034 · Conversión base64url → Uint8Array.
 *
 * VAPID public key viene como base64url (variante de base64 sin padding,
 * con `-` y `_` en lugar de `+` y `/`). El método pushManager.subscribe()
 * requiere un Uint8Array como applicationServerKey, no un string.
 *
 * Isomorphic (server + client) — sin `server-only` ni `'use client'`. Lo
 * consume el Client Component PushChannelRow para subscribir.
 *
 * Implementación basada en MDN PushManager docs.
 */

export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  // 1. Padding: base64url no tiene `=` al final. Calculamos cuántos faltan.
  //    Length módulo 4 nos dice 0/2/3 chars de padding necesarios (NO 1 — eso
  //    indica input inválido en base64 estándar).
  const padLen = (4 - (base64String.length % 4)) % 4;
  const padded = base64String + '='.repeat(padLen);

  // 2. Traducir alfabeto base64url → base64 estándar.
  const base64 = padded.replace(/-/g, '+').replace(/_/g, '/');

  // 3. Decode + conversion. Usamos atob (isomorphic: existe en browser y
  //    en Node 18+).
  const raw = atob(base64);
  const buffer = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    buffer[i] = raw.charCodeAt(i);
  }
  return buffer;
}
