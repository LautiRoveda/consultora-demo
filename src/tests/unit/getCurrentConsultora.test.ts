import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getCurrentConsultora } from '@/shared/auth/getCurrentConsultora';

// `getCurrentConsultora` empieza con `import 'server-only'`. Neutralizamos
// el guard en Node (Vitest unit) — `server-only` tira si lo importa código
// que no corre en server.
vi.mock('server-only', () => ({}));

// Mock del logger: queremos assertear sobre warn/error sin involucrar Sentry.
// `vi.hoisted` evita el ReferenceError que tira vitest cuando hoistea el
// `vi.mock` antes de la declaración del objeto.
const loggerMock = vi.hoisted(() => ({
  trace: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
}));
vi.mock('@/shared/observability/logger', () => ({ logger: loggerMock }));

type ConsultoraRow = {
  id: string;
  name: string;
  slug: string;
  plan_tier: string;
  trial_ends_at: string | null;
};

type DbResult<T> = { data: T | null; error: { message: string } | null };

const CONSULTORA: ConsultoraRow = {
  id: 'c-1',
  name: 'Acme Consultores',
  slug: 'acme',
  plan_tier: 'trial',
  trial_ends_at: '2026-05-18T00:00:00Z',
};

/**
 * Construye un JWT mock (header.payload.signature) cuyo payload trae los
 * claims del Auth Hook (T-016). No firma — el helper sólo decodifica el
 * segmento del medio.
 */
function makeJwt(appMetadata: Record<string, string>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ app_metadata: appMetadata })).toString('base64url');
  return `${header}.${payload}.signature`;
}

function makeSupabase({
  accessToken,
  consultorasResult,
  membersResult,
}: {
  accessToken: string | null;
  consultorasResult?: DbResult<ConsultoraRow>;
  membersResult?: DbResult<{ role: string; consultoras: ConsultoraRow | null }>;
}) {
  const session = accessToken ? { session: { access_token: accessToken } } : { session: null };

  const consultorasMaybeSingle = vi
    .fn()
    .mockResolvedValue(consultorasResult ?? { data: null, error: null });
  const membersMaybeSingle = vi
    .fn()
    .mockResolvedValue(membersResult ?? { data: null, error: null });

  const fromMock = vi.fn().mockImplementation((table: string) => {
    if (table === 'consultoras') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({ maybeSingle: consultorasMaybeSingle }),
        }),
      };
    }
    if (table === 'consultora_members') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({ maybeSingle: membersMaybeSingle }),
        }),
      };
    }
    throw new Error(`Unexpected table: ${table}`);
  });

  return {
    auth: { getSession: vi.fn().mockResolvedValue({ data: session }) },
    from: fromMock,
  } as unknown as Parameters<typeof getCurrentConsultora>[0];
}

describe('getCurrentConsultora', () => {
  beforeEach(() => {
    for (const fn of Object.values(loggerMock)) fn.mockClear();
  });

  it('claim válido + consultora existe → CurrentConsultora con role del claim', async () => {
    const supabase = makeSupabase({
      accessToken: makeJwt({ consultora_id: 'c-1', consultora_role: 'owner' }),
      consultorasResult: { data: CONSULTORA, error: null },
    });

    const result = await getCurrentConsultora(supabase, 'user-1');

    expect(result).toEqual({
      id: 'c-1',
      name: 'Acme Consultores',
      slug: 'acme',
      planTier: 'trial',
      trialEndsAt: '2026-05-18T00:00:00Z',
      role: 'owner',
    });
    expect(loggerMock.warn).not.toHaveBeenCalled();
    expect(loggerMock.error).not.toHaveBeenCalled();
  });

  it('claim válido + consultora archivada → fallback resuelve con la real', async () => {
    const supabase = makeSupabase({
      accessToken: makeJwt({ consultora_id: 'c-old', consultora_role: 'owner' }),
      consultorasResult: { data: null, error: null },
      membersResult: { data: { role: 'member', consultoras: CONSULTORA }, error: null },
    });

    const result = await getCurrentConsultora(supabase, 'user-1');

    expect(result?.id).toBe('c-1');
    // Role viene del membership, NO del claim — la consultora del claim ya no existe.
    expect(result?.role).toBe('member');
    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.objectContaining({ claimConsultoraId: 'c-old', userId: 'user-1' }),
      expect.stringContaining('claim apunta a consultora inexistente'),
    );
  });

  it('claim válido + archivada + sin membership → null + dos warns', async () => {
    const supabase = makeSupabase({
      accessToken: makeJwt({ consultora_id: 'c-old', consultora_role: 'owner' }),
      consultorasResult: { data: null, error: null },
      membersResult: { data: null, error: null },
    });

    const result = await getCurrentConsultora(supabase, 'user-1');

    expect(result).toBeNull();
    expect(loggerMock.warn).toHaveBeenCalledTimes(2);
  });

  it('claim ausente (sin access_token) + membership existe → fallback resuelve con role del membership', async () => {
    const supabase = makeSupabase({
      accessToken: null,
      membersResult: { data: { role: 'owner', consultoras: CONSULTORA }, error: null },
    });

    const result = await getCurrentConsultora(supabase, 'user-1');

    expect(result?.id).toBe('c-1');
    expect(result?.role).toBe('owner');
    expect(loggerMock.warn).not.toHaveBeenCalled();
  });

  it('claim ausente + sin membership → null + warn "user sin membership"', async () => {
    const supabase = makeSupabase({
      accessToken: null,
      membersResult: { data: null, error: null },
    });

    const result = await getCurrentConsultora(supabase, 'user-1');

    expect(result).toBeNull();
    expect(loggerMock.warn).toHaveBeenCalledWith(
      { userId: 'user-1' },
      'getCurrentConsultora: user sin membership',
    );
  });

  it('error de DB en claim path → null + error a Sentry', async () => {
    const supabase = makeSupabase({
      accessToken: makeJwt({ consultora_id: 'c-1', consultora_role: 'owner' }),
      consultorasResult: { data: null, error: { message: 'boom' } },
    });

    const result = await getCurrentConsultora(supabase, 'user-1');

    expect(result).toBeNull();
    expect(loggerMock.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: { message: 'boom' }, claimConsultoraId: 'c-1' }),
      'getCurrentConsultora: claim path query failed',
    );
  });

  it('error de DB en fallback path → null + error a Sentry', async () => {
    const supabase = makeSupabase({
      accessToken: null,
      membersResult: { data: null, error: { message: 'kaboom' } },
    });

    const result = await getCurrentConsultora(supabase, 'user-1');

    expect(result).toBeNull();
    expect(loggerMock.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: { message: 'kaboom' }, userId: 'user-1' }),
      'getCurrentConsultora: fallback query failed',
    );
  });

  it('JWT malformado (no 3 segmentos) → cae al fallback sin tirar', async () => {
    const supabase = makeSupabase({
      accessToken: 'not-a-jwt',
      membersResult: { data: { role: 'owner', consultoras: CONSULTORA }, error: null },
    });

    const result = await getCurrentConsultora(supabase, 'user-1');

    expect(result?.id).toBe('c-1');
    expect(result?.role).toBe('owner');
  });
});
