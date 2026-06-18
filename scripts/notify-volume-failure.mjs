// T-158 · Alerta RUIDOSA del nightly E2E `@volume`. Condición no negociable del
// ticket: un nightly que falla en silencio no sirve (founder solo, nadie mira el
// tablero). Este script dispara DOS canales independientes ante un fallo:
//   1. Email vía Resend (SDK directo — NO el wrapper `sendEmail` de la app, que
//      importa `server-only` + valida TODO el env.ts y no carga fuera de Next).
//   2. Evento a Sentry vía HTTP al endpoint de ingestión derivado del DSN (sin
//      SDK → sin dependencia extra ni init pesado en CI).
//
// Best-effort: cada canal se intenta por separado; un canal caído NO tumba al
// otro. Sale 0 siempre (el step E2E ya pintó el job rojo; este step solo NOTIFICA).
//
// Env (provistos por el workflow desde secrets reales, sólo en este step):
//   RESEND_API_KEY, RESEND_FROM_ADDRESS, ALERT_EMAIL_TO  → email
//   SENTRY_DSN (o NEXT_PUBLIC_SENTRY_DSN)                 → Sentry
//   RUN_URL                                               → link al run (ambos)
import { Resend } from 'resend';

const RUN_URL = process.env.RUN_URL ?? '(run URL no provista)';
const SUBJECT = '❌ Nightly E2E @volume falló — ConsultoraDemo';
const BODY_TEXT = `El suite E2E a volumen (@volume) falló en el run nightly.\n\nRevisá: ${RUN_URL}\n\n— Alerta automática T-158`;
const BODY_HTML = `<p>El suite <strong>E2E a volumen (@volume)</strong> falló en el run nightly.</p><p>Revisá: <a href="${RUN_URL}">${RUN_URL}</a></p><p>— Alerta automática T-158</p>`;

async function notifyEmail() {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_ADDRESS;
  const to = process.env.ALERT_EMAIL_TO;
  if (!apiKey || !from || !to) {
    console.error(
      '[notify] email SKIP: faltan RESEND_API_KEY / RESEND_FROM_ADDRESS / ALERT_EMAIL_TO',
    );
    return;
  }
  try {
    const resend = new Resend(apiKey);
    const result = await resend.emails.send({
      from,
      to,
      subject: SUBJECT,
      text: BODY_TEXT,
      html: BODY_HTML,
    });
    if (result.error) {
      console.error(`[notify] email ERROR: ${JSON.stringify(result.error)}`);
    } else {
      console.log(`[notify] email OK: id=${result.data?.id}`);
    }
  } catch (err) {
    console.error(`[notify] email THREW: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function notifySentry() {
  const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) {
    console.error('[notify] sentry SKIP: falta SENTRY_DSN / NEXT_PUBLIC_SENTRY_DSN');
    return;
  }
  // DSN: https://<publicKey>@<host>/<projectId>  → store endpoint + auth header.
  let parsed;
  try {
    parsed = new URL(dsn);
  } catch {
    console.error('[notify] sentry SKIP: DSN inválido');
    return;
  }
  const publicKey = parsed.username;
  const projectId = parsed.pathname.replace(/^\//, '');
  if (!publicKey || !projectId) {
    console.error('[notify] sentry SKIP: DSN sin publicKey o projectId');
    return;
  }
  const endpoint = `${parsed.protocol}//${parsed.host}/api/${projectId}/store/`;
  const event = {
    level: 'error',
    platform: 'node',
    logger: 'e2e-volume-nightly',
    message: `Nightly E2E @volume falló — ${RUN_URL}`,
    tags: { ticket: 'T-158', suite: 'volume', source: 'ci-nightly' },
  };
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Sentry-Auth': `Sentry sentry_version=7, sentry_client=notify-volume-failure/1.0, sentry_key=${publicKey}`,
      },
      body: JSON.stringify(event),
    });
    if (res.ok) {
      console.log('[notify] sentry OK');
    } else {
      console.error(`[notify] sentry ERROR: HTTP ${res.status}`);
    }
  } catch (err) {
    console.error(`[notify] sentry THREW: ${err instanceof Error ? err.message : String(err)}`);
  }
}

await Promise.all([notifyEmail(), notifySentry()]);
console.log('[notify] alerta enviada (best-effort). RUN_URL:', RUN_URL);
