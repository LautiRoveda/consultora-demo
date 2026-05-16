import 'server-only';

import { randomBytes } from 'node:crypto';

/**
 * T-033 · Generador de link_code para vinculación Telegram.
 *
 * 8 chars del alfabeto sin caracteres ambiguos. La entropía es
 * log2(32^8) ≈ 40 bits — sobra para anti-bruteforce con TTL 15 min
 * (sería necesario adivinar ~5.5 × 10^11 códigos en 15 min, imposible
 * sin acceso al DB).
 *
 * Alfabeto:
 *   A B C D E F G H J K L M N P Q R S T U V W X Y Z (24 letras, sin I/O)
 *   2 3 4 5 6 7 8 9 (8 dígitos, sin 0/1)
 *   Total: 32 caracteres = exactamente 5 bits per char.
 *
 * Excluidos:
 *   - 0/O: ambiguos visualmente
 *   - 1/I/l: ambiguos en sans-serif (l es lowercase, no aplica acá pero)
 *   - Lowercase: forzamos uppercase para evitar dudas al user al copiar
 *     el código a mano en Telegram.
 *
 * Implementación: usa crypto.randomBytes (CSPRNG, no Math.random) y
 * descarta bytes que caigan fuera del rango uniforme (256 mod 32 = 0,
 * así que todos los bytes 0-255 mapean uniforme a un índice 0-31).
 */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;

export function generateLinkCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    // bytes[i] siempre 0-255. 256 / 32 = 8 exacto → módulo 32 da distribución uniforme.
    const byte = bytes[i] as number;
    code += ALPHABET[byte % ALPHABET.length];
  }
  return code;
}

export { ALPHABET as LINK_CODE_ALPHABET, CODE_LENGTH as LINK_CODE_LENGTH };
