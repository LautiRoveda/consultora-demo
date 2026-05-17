/**
 * T-034 · Tests unit de urlBase64ToUint8Array.
 *
 * VAPID public key viene como base64url. pushManager.subscribe necesita Uint8Array.
 */
import { describe, expect, it } from 'vitest';

import { urlBase64ToUint8Array } from '@/shared/push/url-base64';

describe('urlBase64ToUint8Array', () => {
  it('1. roundtrip simple: "Hello" base64 sin padding', () => {
    // "Hello" en base64 = "SGVsbG8="
    // base64url version (sin padding) = "SGVsbG8"
    const result = urlBase64ToUint8Array('SGVsbG8');
    expect(Array.from(result)).toEqual([72, 101, 108, 108, 111]);
  });

  it('2. añade padding correcto cuando length % 4 === 2 (2 chars padding)', () => {
    // "Hi" en base64 = "SGk=" (1 char padding)
    // base64url = "SGk"
    const result = urlBase64ToUint8Array('SGk');
    expect(Array.from(result)).toEqual([72, 105]);
  });

  it('3. traduce `-` a `+` (alfabeto base64url)', () => {
    // Bytes [251, 255] → b64 = "+/8=" → b64url = "-_8"
    const result = urlBase64ToUint8Array('-_8');
    expect(Array.from(result)).toEqual([251, 255]);
  });

  it('4. traduce `_` a `/` (alfabeto base64url)', () => {
    // Mix: bytes [255, 255, 255] → b64 = "////" → b64url = "____"
    const result = urlBase64ToUint8Array('____');
    expect(Array.from(result)).toEqual([255, 255, 255]);
  });

  it('5. input vacío produce Uint8Array vacío', () => {
    const result = urlBase64ToUint8Array('');
    expect(result.length).toBe(0);
  });

  it('6. VAPID public key típica (~88 chars b64url) parsea OK', () => {
    // VAPID public key real generada por web-push, escapada a 65 bytes raw.
    // Solo verificamos que no throwea y devuelve un buffer con length esperado.
    const fakeVapidPublicKey =
      'BNc1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-_0123456789abcdef';
    const result = urlBase64ToUint8Array(fakeVapidPublicKey);
    // 84 base64url chars → 63 bytes (4 chars b64 = 3 bytes raw; sin padding ajusta).
    expect(result.length).toBeGreaterThan(50);
    expect(result.length).toBeLessThan(100);
  });

  it('7. input con chars inválidos throwea (atob lanza DOMException)', () => {
    expect(() => urlBase64ToUint8Array('not!valid!chars')).toThrow();
  });
});
