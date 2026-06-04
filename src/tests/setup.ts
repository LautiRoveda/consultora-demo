import '@testing-library/jest-dom/vitest';

import { configure } from '@testing-library/react';

// T-116 · CI corre 95 archivos en paralelo → la contención de CPU vence el waitFor
// default (1000ms) en cadenas RHF+Zod async (p.ej. ClienteForm DUPLICATE_CUIT).
// Sube el techo de espera de TODOS los async utils (waitFor/findBy); solo afecta a
// los que estaban al borde — los que ya pasan resuelven al primer intento.
configure({ asyncUtilTimeout: 5000 });
