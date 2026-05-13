# Email templates · Supabase Auth (T-079)

Templates HTML estáticos de los 6 emails de auth de Supabase, con branding ConsultoraDemo y copy en español rioplatense. Editables desde **Supabase Dashboard → Authentication → Email Templates**. NO viven en código del repo — este doc es la fuente de verdad versionada del wording + HTML.

**Cuándo evaluar migrar a Resend custom SMTP**: cuando los emails outbound de Supabase sean el cuello de botella (rate limit ~30/h por IP en free tier, fácil de saturar con uso real productivo). Hoy con trial single-user el default alcanza.

---

## Sección 1 · Diseño base unificado

### Paleta

Valores HEX porque `oklch()` (variables de `src/app/globals.css`) no es soportado por Outlook 2016/2019/365. Mantienen equivalencia con los tokens del theme:

| Rol | HEX | Equivalente theme |
|---|---|---|
| Brand (CTAs, wordmark) | `#4f46e5` | `--primary` (indigo-600) |
| Brand foreground | `#ffffff` | `--primary-foreground` |
| Texto body | `#18181b` | `--foreground` (zinc-950) |
| Texto muted (disclaimers, footer) | `#71717a` | `--muted-foreground` (zinc-500) |
| Border / separators | `#e4e4e7` | `--border` (zinc-200) |
| Background body | `#ffffff` | `--background` |
| Surface opcional (highlight box, OTP block) | `#fafafa` | shade de `--muted` |

### Tipografía

Stack system fonts. Outlook no soporta web fonts custom y Geist (via `@font-face`) rompe en clients mobile sin internet o con privacy mode.

```
font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
```

Tamaños:

| Elemento | Tamaño | Line-height | Weight |
|---|---|---|---|
| Wordmark header | 18px | 1.2 | 700 |
| Párrafo body | 15px | 1.55 | 400 |
| Highlight (trial, status) | 15px | 1.55 | 600 (strong) |
| CTA button | 15px | 1 | 600 |
| Disclaimer | 14px | 1.5 | 400 |
| Footer | 13px | 1.5 | 400 |
| Token OTP (reauth) | 28px | 1.2 | 600, monospace |

### Dimensiones

- **Container fijo `600px`** centrado horizontalmente (estándar email — evita reflow en clients mobile antiguos como BlackBerry y Outlook 2007).
- Padding interior del container: `32px 16px` arriba/abajo (outer cell wrap), `28px` separación vertical entre header/body/footer.
- Border-bottom `1px solid #e4e4e7` entre secciones (header→body, body→footer).

### HTML skeleton (esqueleto reusable)

Cada template hereda este skeleton + reemplaza el preheader y el contenido entre `<!-- BODY START -->` y `<!-- BODY END -->`.

```html
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <meta name="color-scheme" content="light"/>
  <meta name="supported-color-schemes" content="light"/>
  <title>ConsultoraDemo</title>
</head>
<body style="margin: 0; padding: 0; background-color: #ffffff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; color: #18181b;">
  <!-- Preheader: texto que Gmail/Apple Mail muestran en el inbox list debajo del subject.
       display:none lo oculta del body renderizado. mso-hide: all defensivo para Outlook. -->
  <div style="display: none; max-height: 0; overflow: hidden; mso-hide: all;">
    Preheader específico por template.
  </div>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #ffffff;">
    <tr>
      <td align="center" style="padding: 32px 16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width: 600px; width: 100%;">
          <!-- Header (wordmark) -->
          <tr>
            <td style="padding: 0 0 20px 0; border-bottom: 1px solid #e4e4e7;">
              <span style="font-size: 18px; font-weight: 700; color: #4f46e5; letter-spacing: -0.01em;">ConsultoraDemo</span>
            </td>
          </tr>
          <!-- BODY START -->
          <tr>
            <td style="padding: 28px 0 0 0; font-size: 15px; line-height: 1.55; color: #18181b;">
              <!-- Contenido específico del template -->
            </td>
          </tr>
          <!-- BODY END -->
          <!-- Footer -->
          <tr>
            <td style="padding: 28px 0 0 0; border-top: 1px solid #e4e4e7; font-size: 13px; line-height: 1.5; color: #71717a;">
              ConsultoraDemo · Hecho en Argentina<br/>
              <a href="https://consultora-demo.test-ia.cloud" style="color: #71717a; text-decoration: underline;">consultora-demo.test-ia.cloud</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
```

**Nice-to-haves del skeleton** (heredados por los 6 templates):

1. **Preheader text** dentro de `<div style="display: none; max-height: 0; overflow: hidden; mso-hide: all;">` justo después de `<body>`. Gmail / Apple Mail / iOS Mail muestran este texto en el listado del inbox debajo del subject — sin él, muestran las primeras palabras visibles del body (que típicamente es "Hola," + el saludo, feo). El `mso-hide: all` es defensa adicional para Outlook desktop.
2. **`<meta name="color-scheme" content="light">` + `<meta name="supported-color-schemes" content="light">`** en el `<head>`. Apple Mail iOS en dark mode invierte automáticamente los colores del email — el `#ffffff` body se vuelve negro, el `#4f46e5` indigo se desatura. Con estos metas, Apple Mail respeta el diseño original (forzamos light). Gmail Android tiene su propio dark mode que también los respeta.

### CSS inline conventions

- **100% inline via atributo `style="..."`**. Outlook strippea `<style>` external, Gmail web los respeta pero móvil no garantiza. La regla del repo es: si una propiedad afecta visual del email, va inline.
- **Margins/paddings en pixels, no em/rem**: clients antiguos no resuelven unidades relativas consistente.
- **`role="presentation"`** en cada `<table>` de layout para que screen readers no las anuncien como data tables.
- **`cellpadding="0" cellspacing="0" border="0"`** explícito en cada `<table>` (defensa contra Outlook 2007 que ignora el reset moderno).

### Patrón CTA button reusable

Botón centrado, padding generoso, brand bg con border-radius. Funciona en Gmail/Apple Mail/iOS Mail nativo. En Outlook 2016+ renderea como rectángulo recto (sin border-radius — limitación conocida del engine Word, aceptable tradeoff sin VML).

```html
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 24px 0;">
  <tr>
    <td align="center" bgcolor="#4f46e5" style="border-radius: 6px;">
      <a href="{{ .ConfirmationURL }}" target="_blank" style="display: inline-block; padding: 12px 28px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 15px; font-weight: 600; color: #ffffff; text-decoration: none; line-height: 1;">Texto del CTA</a>
    </td>
  </tr>
</table>
```

### Patrón fallback URL plana

Debajo del CTA, para clients que bloquean botones / usuarios que copian el link:

```html
<p style="margin: 0 0 8px 0; font-size: 14px; line-height: 1.5; color: #71717a;">
  Si no podés clickear, copiá esta URL en tu navegador:
</p>
<p style="margin: 0 0 24px 0; font-size: 14px; line-height: 1.5;">
  <a href="{{ .ConfirmationURL }}" style="color: #4f46e5; text-decoration: underline; word-break: break-all;">{{ .ConfirmationURL }}</a>
</p>
```

### Patrón disclaimer

Bloque muted post-separator:

```html
<p style="margin: 0; font-size: 14px; line-height: 1.5; color: #71717a;">
  Si no creaste esta cuenta, ignorá este mail.
</p>
```

### Patrón highlight box (trial info, status changes)

Surface con bg distinto para destacar info accionable sin romper el flow del email:

```html
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 20px 0; background-color: #fafafa; border-radius: 6px;">
  <tr>
    <td style="padding: 16px; font-size: 15px; line-height: 1.55; color: #18181b;">
      <strong style="font-weight: 600;">Texto destacado.</strong> Texto complementario.
    </td>
  </tr>
</table>
```

### Patrón OTP code block (solo Reauthentication)

Token grande monospace centrado, para que el usuario lo lea y tipee en la app. Sin CTA link.

```html
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 24px 0; background-color: #fafafa; border-radius: 6px;">
  <tr>
    <td align="center" style="padding: 24px 16px; font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace; font-size: 28px; font-weight: 600; letter-spacing: 0.15em; color: #18181b;">
      {{ .Token }}
    </td>
  </tr>
</table>
```

### Compat matrix

Validado conceptualmente contra:

| Client | Engine | Notas |
|---|---|---|
| Gmail web | Webkit | CSS inline 100% OK. Strippea `<style>` external. Preheader visible. |
| Gmail mobile (iOS/Android) | Webkit | Idem. Imágenes externas bloqueadas por default (de ahí logo tipográfico, no `<img>`). |
| Outlook 2016+ desktop (Windows) | Word | Sin border-radius en tablas. Sin web fonts. Padding en `<td>` OK. CTA recto pero clickable. `mso-hide: all` activo en preheader. |
| Outlook 365 web | EdgeHTML/Webkit | Bastante moderno, soporta border-radius. |
| Apple Mail macOS | Webkit | Renderea idéntico a Gmail web. Respeta `color-scheme: light` en dark mode del sistema. |
| iOS Mail | Webkit | Idem Apple Mail desktop. Sin `color-scheme` el dark mode invertiría colores — con los meta no lo hace. |
| Android Gmail / Outlook for Android | Webkit | Renderea OK. |

**Validación sugerida**: pegar el HTML en https://www.htmlemailcheck.com/check/ o https://htmlemail.io/inline/ para revisar compat antes de aplicar en dashboard. NO requiere cuenta para preview básica.

### Variables de Supabase

Disponibles según template (extraídas de https://supabase.com/docs/guides/auth/auth-email-templates):

| Variable | Disponible en | Significado |
|---|---|---|
| `{{ .ConfirmationURL }}` | confirm signup, magic link, reset password, invite, change email | URL canónica para el flow |
| `{{ .Token }}` | todos (también reauth) | Código OTP 6 dígitos |
| `{{ .TokenHash }}` | confirm signup, magic link, reset, invite, change email | Hash si querés construir URL custom |
| `{{ .SiteURL }}` | confirm signup, magic link, reset, invite, change email | Base URL configurada en Auth settings |
| `{{ .RedirectTo }}` | confirm signup, magic link, reset, invite, change email | Redirect post-confirm |
| `{{ .Data }}` | todos | Metadata custom pasada al signUp/invite call |
| `{{ .Email }}` | todos | Email del usuario (en change email = email viejo) |
| `{{ .NewEmail }}` | **solo change email** | Email nuevo destino |

**Espacios obligatorios** alrededor del `.Var` — `{{ .ConfirmationURL }}` con espacios, no `{{.ConfirmationURL}}`. Si te equivocás, Supabase no interpola.

**Reauthentication es la excepción**: no tiene `ConfirmationURL` ni `SiteURL`. Solo `.Token`, `.Data`, `.Email`. Se diseña como OTP code, no como link.

---

## Sección 2 · Los 6 templates

### 2.1 · Confirm signup

**Cuándo se dispara**: usuario completa `/signup`, Supabase crea fila en `auth.users` con `email_confirmed_at: null`, y dispara este email.

**Subject**:

```
Confirmá tu cuenta en ConsultoraDemo
```

⚠️ **Default actual a corregir en dashboard**: el subject hoy es `Confirm Your Signup` (default inglés Supabase). Cambiar al subject de arriba.

**Preheader**: `Confirmá tu cuenta para arrancar tu prueba de 7 días en ConsultoraDemo.`

**Variables usadas**: `{{ .ConfirmationURL }}`.

**HTML completo** (listo para copy-paste en dashboard):

```html
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <meta name="color-scheme" content="light"/>
  <meta name="supported-color-schemes" content="light"/>
  <title>ConsultoraDemo · Confirmá tu cuenta</title>
</head>
<body style="margin: 0; padding: 0; background-color: #ffffff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; color: #18181b;">
  <div style="display: none; max-height: 0; overflow: hidden; mso-hide: all;">
    Confirmá tu cuenta para arrancar tu prueba de 7 días en ConsultoraDemo.
  </div>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #ffffff;">
    <tr>
      <td align="center" style="padding: 32px 16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width: 600px; width: 100%;">
          <tr>
            <td style="padding: 0 0 20px 0; border-bottom: 1px solid #e4e4e7;">
              <span style="font-size: 18px; font-weight: 700; color: #4f46e5; letter-spacing: -0.01em;">ConsultoraDemo</span>
            </td>
          </tr>
          <tr>
            <td style="padding: 28px 0 0 0; font-size: 15px; line-height: 1.55; color: #18181b;">
              <p style="margin: 0 0 16px 0;">Hola,</p>
              <p style="margin: 0 0 16px 0;">Gracias por crear tu cuenta en <strong style="font-weight: 600;">ConsultoraDemo</strong>.</p>
              <p style="margin: 0 0 16px 0;">Para activarla, hacé click en el siguiente link:</p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 24px 0;">
                <tr>
                  <td align="center" bgcolor="#4f46e5" style="border-radius: 6px;">
                    <a href="{{ .ConfirmationURL }}" target="_blank" style="display: inline-block; padding: 12px 28px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 15px; font-weight: 600; color: #ffffff; text-decoration: none; line-height: 1;">Confirmar mi cuenta</a>
                  </td>
                </tr>
              </table>
              <p style="margin: 0 0 8px 0; font-size: 14px; line-height: 1.5; color: #71717a;">
                El link expira en 24 horas. Si no podés clickear, copiá esta URL en tu navegador:
              </p>
              <p style="margin: 0 0 24px 0; font-size: 14px; line-height: 1.5;">
                <a href="{{ .ConfirmationURL }}" style="color: #4f46e5; text-decoration: underline; word-break: break-all;">{{ .ConfirmationURL }}</a>
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 4px 0 20px 0; background-color: #fafafa; border-radius: 6px;">
                <tr>
                  <td style="padding: 16px; font-size: 15px; line-height: 1.55; color: #18181b;">
                    <strong style="font-weight: 600;">Tu prueba de 7 días empieza apenas confirmes el email.</strong> Después decidís si seguir con el plan Pro (USD 30/mes) o cancelar — sin tarjeta cargada.
                  </td>
                </tr>
              </table>
              <p style="margin: 0; font-size: 14px; line-height: 1.5; color: #71717a;">
                Si no creaste esta cuenta, ignorá este mail.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding: 28px 0 0 0; border-top: 1px solid #e4e4e7; font-size: 13px; line-height: 1.5; color: #71717a;">
              ConsultoraDemo · Hecho en Argentina<br/>
              <a href="https://consultora-demo.test-ia.cloud" style="color: #71717a; text-decoration: underline;">consultora-demo.test-ia.cloud</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
```

**Notas operativas**:

- El link `{{ .ConfirmationURL }}` lo construye Supabase apuntando a `{{ .SiteURL }}/auth/callback?code=...` (PKCE flow) o `?token_hash=...&type=signup` (token_hash flow, soportado por nuestro callback handler desde T-014). El callback redirect a `/login?confirmed=1` post-éxito.
- Expiry 24h es el default de Supabase para `email_confirmation` — configurable en `Authentication → Sessions → Email confirmation` si querés cambiarlo.
- El highlight box del trial usa `#fafafa` background. En Outlook desktop renderea recto (sin border-radius) — funcional pero menos prolijo. Aceptable.

### 2.2 · Magic Link

**Cuándo se dispara**: usuario clickea "Iniciar sesión con magic link" en `/login` y completa email. Supabase dispara este email (validez 1h default).

**Subject**:

```
Tu link de acceso a ConsultoraDemo
```

**Preheader**: `Tu link de acceso a ConsultoraDemo está listo.`

**Variables usadas**: `{{ .ConfirmationURL }}`.

**HTML completo**:

```html
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <meta name="color-scheme" content="light"/>
  <meta name="supported-color-schemes" content="light"/>
  <title>ConsultoraDemo · Tu link de acceso</title>
</head>
<body style="margin: 0; padding: 0; background-color: #ffffff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; color: #18181b;">
  <div style="display: none; max-height: 0; overflow: hidden; mso-hide: all;">
    Tu link de acceso a ConsultoraDemo está listo.
  </div>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #ffffff;">
    <tr>
      <td align="center" style="padding: 32px 16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width: 600px; width: 100%;">
          <tr>
            <td style="padding: 0 0 20px 0; border-bottom: 1px solid #e4e4e7;">
              <span style="font-size: 18px; font-weight: 700; color: #4f46e5; letter-spacing: -0.01em;">ConsultoraDemo</span>
            </td>
          </tr>
          <tr>
            <td style="padding: 28px 0 0 0; font-size: 15px; line-height: 1.55; color: #18181b;">
              <p style="margin: 0 0 16px 0;">Hola,</p>
              <p style="margin: 0 0 16px 0;">Pediste un <strong style="font-weight: 600;">magic link</strong> para entrar a <a href="https://consultora-demo.test-ia.cloud" style="color: #4f46e5; text-decoration: underline;">ConsultoraDemo</a>.</p>
              <p style="margin: 0 0 16px 0;">Hacé click acá para iniciar sesión:</p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 24px 0;">
                <tr>
                  <td align="center" bgcolor="#4f46e5" style="border-radius: 6px;">
                    <a href="{{ .ConfirmationURL }}" target="_blank" style="display: inline-block; padding: 12px 28px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 15px; font-weight: 600; color: #ffffff; text-decoration: none; line-height: 1;">Iniciar sesión</a>
                  </td>
                </tr>
              </table>
              <p style="margin: 0 0 8px 0; font-size: 14px; line-height: 1.5; color: #71717a;">
                El link expira en 1 hora y solo funciona una vez. Si no podés clickear, copiá esta URL en tu navegador:
              </p>
              <p style="margin: 0 0 24px 0; font-size: 14px; line-height: 1.5;">
                <a href="{{ .ConfirmationURL }}" style="color: #4f46e5; text-decoration: underline; word-break: break-all;">{{ .ConfirmationURL }}</a>
              </p>
              <p style="margin: 0; font-size: 14px; line-height: 1.5; color: #71717a;">
                Si no pediste este link, ignorá este mail — no se inició ninguna sesión.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding: 28px 0 0 0; border-top: 1px solid #e4e4e7; font-size: 13px; line-height: 1.5; color: #71717a;">
              ConsultoraDemo · Hecho en Argentina<br/>
              <a href="https://consultora-demo.test-ia.cloud" style="color: #71717a; text-decoration: underline;">consultora-demo.test-ia.cloud</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
```

**Notas operativas**:

- Validez del magic link: 1h default de Supabase. Configurable en `Authentication → Email Auth → Email OTP expiration` si querés acortarlo (mejora postura de seguridad).
- `magicLinkAction` (en `src/app/(auth)/login/actions.ts`) usa `shouldCreateUser: false` — magic link NO crea usuarios huérfanos sin consultora. El flow de creación es exclusivamente `/signup`.

### 2.3 · Reset Password

**Cuándo se dispara**: usuario completa `/recuperar-password` con email. Supabase dispara este email (validez 1h default).

**Subject**:

```
Restablecé tu contraseña en ConsultoraDemo
```

**Preheader**: `Restablecé tu contraseña en un click.`

**Variables usadas**: `{{ .ConfirmationURL }}`.

**HTML completo**:

```html
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <meta name="color-scheme" content="light"/>
  <meta name="supported-color-schemes" content="light"/>
  <title>ConsultoraDemo · Restablecé tu contraseña</title>
</head>
<body style="margin: 0; padding: 0; background-color: #ffffff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; color: #18181b;">
  <div style="display: none; max-height: 0; overflow: hidden; mso-hide: all;">
    Restablecé tu contraseña en un click.
  </div>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #ffffff;">
    <tr>
      <td align="center" style="padding: 32px 16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width: 600px; width: 100%;">
          <tr>
            <td style="padding: 0 0 20px 0; border-bottom: 1px solid #e4e4e7;">
              <span style="font-size: 18px; font-weight: 700; color: #4f46e5; letter-spacing: -0.01em;">ConsultoraDemo</span>
            </td>
          </tr>
          <tr>
            <td style="padding: 28px 0 0 0; font-size: 15px; line-height: 1.55; color: #18181b;">
              <p style="margin: 0 0 16px 0;">Hola,</p>
              <p style="margin: 0 0 16px 0;">Pediste resetear tu contraseña en <a href="https://consultora-demo.test-ia.cloud" style="color: #4f46e5; text-decoration: underline;">ConsultoraDemo</a>.</p>
              <p style="margin: 0 0 16px 0;">Hacé click acá para definir una contraseña nueva:</p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 24px 0;">
                <tr>
                  <td align="center" bgcolor="#4f46e5" style="border-radius: 6px;">
                    <a href="{{ .ConfirmationURL }}" target="_blank" style="display: inline-block; padding: 12px 28px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 15px; font-weight: 600; color: #ffffff; text-decoration: none; line-height: 1;">Cambiar mi contraseña</a>
                  </td>
                </tr>
              </table>
              <p style="margin: 0 0 8px 0; font-size: 14px; line-height: 1.5; color: #71717a;">
                El link expira en 1 hora y solo funciona una vez. Si no podés clickear, copiá esta URL en tu navegador:
              </p>
              <p style="margin: 0 0 24px 0; font-size: 14px; line-height: 1.5;">
                <a href="{{ .ConfirmationURL }}" style="color: #4f46e5; text-decoration: underline; word-break: break-all;">{{ .ConfirmationURL }}</a>
              </p>
              <p style="margin: 0; font-size: 14px; line-height: 1.5; color: #71717a;">
                Si no pediste resetear tu contraseña, ignorá este mail — tu cuenta sigue intacta.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding: 28px 0 0 0; border-top: 1px solid #e4e4e7; font-size: 13px; line-height: 1.5; color: #71717a;">
              ConsultoraDemo · Hecho en Argentina<br/>
              <a href="https://consultora-demo.test-ia.cloud" style="color: #71717a; text-decoration: underline;">consultora-demo.test-ia.cloud</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
```

**Notas operativas**:

- El `{{ .ConfirmationURL }}` por config Supabase apunta a `{{ .SiteURL }}/auth/callback?token_hash=...&type=recovery&next=/cambiar-password&from=recovery`. El callback handler de T-014 valida con `verifyOtp` y redirect a `/cambiar-password`.
- Si llegado el flow `from=recovery` no aparece en `searchParams`, el `LoginForm` lo trata como callback ambiguo (defensa T-013).

### 2.4 · Invite User

**Cuándo se dispara**: admin invoca `auth.admin.inviteUserByEmail(email, { redirectTo, data })` desde server-side (Plan Team — Fase 2). Supabase crea fila en `auth.users` con `email_confirmed_at: null` y dispara este email.

**Subject**:

```
Te invitaron a colaborar en ConsultoraDemo
```

**Preheader**: `Te invitaron a colaborar en ConsultoraDemo.`

**Variables usadas**: `{{ .ConfirmationURL }}`.

**HTML completo**:

```html
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <meta name="color-scheme" content="light"/>
  <meta name="supported-color-schemes" content="light"/>
  <title>ConsultoraDemo · Te invitaron a colaborar</title>
</head>
<body style="margin: 0; padding: 0; background-color: #ffffff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; color: #18181b;">
  <div style="display: none; max-height: 0; overflow: hidden; mso-hide: all;">
    Te invitaron a colaborar en ConsultoraDemo.
  </div>
  <!--
    NOTA workaround "quién invitó": Supabase no expone variable nativa.
    Cuando se active Plan Team (Fase 2), el `inviteUserByEmail` puede pasar
    `{ data: { invitedByName: 'Lautaro Roveda' } }` y acá usar
    `{{ .Data.invitedByName }}` (con fallback). Por ahora texto base.
  -->
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #ffffff;">
    <tr>
      <td align="center" style="padding: 32px 16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width: 600px; width: 100%;">
          <tr>
            <td style="padding: 0 0 20px 0; border-bottom: 1px solid #e4e4e7;">
              <span style="font-size: 18px; font-weight: 700; color: #4f46e5; letter-spacing: -0.01em;">ConsultoraDemo</span>
            </td>
          </tr>
          <tr>
            <td style="padding: 28px 0 0 0; font-size: 15px; line-height: 1.55; color: #18181b;">
              <p style="margin: 0 0 16px 0;">Hola,</p>
              <p style="margin: 0 0 16px 0;">Te invitaron a colaborar en <strong style="font-weight: 600;">ConsultoraDemo</strong>, la plataforma para consultores de Higiene y Seguridad Laboral en Argentina.</p>
              <p style="margin: 0 0 16px 0;">Aceptá la invitación para crear tu cuenta y empezar:</p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 24px 0;">
                <tr>
                  <td align="center" bgcolor="#4f46e5" style="border-radius: 6px;">
                    <a href="{{ .ConfirmationURL }}" target="_blank" style="display: inline-block; padding: 12px 28px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 15px; font-weight: 600; color: #ffffff; text-decoration: none; line-height: 1;">Aceptar invitación</a>
                  </td>
                </tr>
              </table>
              <p style="margin: 0 0 8px 0; font-size: 14px; line-height: 1.5; color: #71717a;">
                El link expira en 24 horas y solo funciona una vez. Si no podés clickear, copiá esta URL en tu navegador:
              </p>
              <p style="margin: 0 0 24px 0; font-size: 14px; line-height: 1.5;">
                <a href="{{ .ConfirmationURL }}" style="color: #4f46e5; text-decoration: underline; word-break: break-all;">{{ .ConfirmationURL }}</a>
              </p>
              <p style="margin: 0; font-size: 14px; line-height: 1.5; color: #71717a;">
                Si no esperabas esta invitación, ignorá este mail.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding: 28px 0 0 0; border-top: 1px solid #e4e4e7; font-size: 13px; line-height: 1.5; color: #71717a;">
              ConsultoraDemo · Hecho en Argentina<br/>
              <a href="https://consultora-demo.test-ia.cloud" style="color: #71717a; text-decoration: underline;">consultora-demo.test-ia.cloud</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
```

**Notas operativas**:

- **No se usa en trial single-user** (Fase 1). Template queda listo para activar en Fase 2 Plan Team.
- **Workaround "quién invitó"**: Supabase no expone variable nativa. Path documented inline en comment HTML: cuando el flow de invite se construya, el admin pasa `{ data: { invitedByName: 'Nombre' } }` al `auth.admin.inviteUserByEmail` y se accede como `{{ .Data.invitedByName }}` (con fallback `{{ or .Data.invitedByName "alguien" }}` por si la metadata viene null).
- El `{{ .ConfirmationURL }}` apunta al `/auth/callback?token_hash=...&type=invite&next=/onboarding` o similar — el flow exacto se define en Fase 2.

### 2.5 · Change Email Address

**Cuándo se dispara**: usuario logueado invoca `auth.updateUser({ email: 'nuevo@...' })`. Supabase dispara este email al NUEVO email para confirmar. El email viejo recibe una notificación security (Email Changed notification, configurable aparte en Authentication → Notifications).

**Subject**:

```
Confirmá tu nuevo email en ConsultoraDemo
```

**Preheader**: `Confirmá tu nuevo email para terminar el cambio.`

**Variables usadas**: `{{ .ConfirmationURL }}`, `{{ .Email }}` (viejo), `{{ .NewEmail }}` (nuevo).

**HTML completo**:

```html
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <meta name="color-scheme" content="light"/>
  <meta name="supported-color-schemes" content="light"/>
  <title>ConsultoraDemo · Confirmá tu nuevo email</title>
</head>
<body style="margin: 0; padding: 0; background-color: #ffffff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; color: #18181b;">
  <div style="display: none; max-height: 0; overflow: hidden; mso-hide: all;">
    Confirmá tu nuevo email para terminar el cambio.
  </div>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #ffffff;">
    <tr>
      <td align="center" style="padding: 32px 16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width: 600px; width: 100%;">
          <tr>
            <td style="padding: 0 0 20px 0; border-bottom: 1px solid #e4e4e7;">
              <span style="font-size: 18px; font-weight: 700; color: #4f46e5; letter-spacing: -0.01em;">ConsultoraDemo</span>
            </td>
          </tr>
          <tr>
            <td style="padding: 28px 0 0 0; font-size: 15px; line-height: 1.55; color: #18181b;">
              <p style="margin: 0 0 16px 0;">Hola,</p>
              <p style="margin: 0 0 16px 0;">Pediste cambiar el email de tu cuenta en <strong style="font-weight: 600;">ConsultoraDemo</strong>.</p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 16px 0 24px 0; background-color: #fafafa; border-radius: 6px;">
                <tr>
                  <td style="padding: 16px; font-size: 14px; line-height: 1.6; color: #18181b;">
                    <span style="color: #71717a;">Email actual:</span> <strong style="font-weight: 600;">{{ .Email }}</strong><br/>
                    <span style="color: #71717a;">Email nuevo:</span> <strong style="font-weight: 600;">{{ .NewEmail }}</strong>
                  </td>
                </tr>
              </table>
              <p style="margin: 0 0 16px 0;">Confirmá el cambio haciendo click acá:</p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 24px 0;">
                <tr>
                  <td align="center" bgcolor="#4f46e5" style="border-radius: 6px;">
                    <a href="{{ .ConfirmationURL }}" target="_blank" style="display: inline-block; padding: 12px 28px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; font-size: 15px; font-weight: 600; color: #ffffff; text-decoration: none; line-height: 1;">Confirmar cambio de email</a>
                  </td>
                </tr>
              </table>
              <p style="margin: 0 0 8px 0; font-size: 14px; line-height: 1.5; color: #71717a;">
                El link expira en 24 horas y solo funciona una vez. Si no podés clickear, copiá esta URL en tu navegador:
              </p>
              <p style="margin: 0 0 24px 0; font-size: 14px; line-height: 1.5;">
                <a href="{{ .ConfirmationURL }}" style="color: #4f46e5; text-decoration: underline; word-break: break-all;">{{ .ConfirmationURL }}</a>
              </p>
              <p style="margin: 0; font-size: 14px; line-height: 1.5; color: #71717a;">
                Si no pediste cambiar tu email, ignorá este mail — tu cuenta sigue con <strong style="font-weight: 600; color: #71717a;">{{ .Email }}</strong>.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding: 28px 0 0 0; border-top: 1px solid #e4e4e7; font-size: 13px; line-height: 1.5; color: #71717a;">
              ConsultoraDemo · Hecho en Argentina<br/>
              <a href="https://consultora-demo.test-ia.cloud" style="color: #71717a; text-decoration: underline;">consultora-demo.test-ia.cloud</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
```

**Notas operativas**:

- Este email se envía al **`{{ .NewEmail }}`** (no al viejo). Eso es propio del flow Supabase: confirma que el usuario tiene acceso al email nuevo antes de hacer swap.
- El email viejo recibe una notificación security separada ("Email Changed notification") si está habilitada en `Authentication → Notifications`. Esa notificación tiene su propio template y variables (`{{ .OldEmail }}`, `{{ .Email }}`) — fuera de scope T-079 hasta que activemos las notificaciones security.
- UI del flow change email **no existe todavía en el repo** — template queda listo para cuando se construya la página `/configuracion/cuenta` o similar.

### 2.6 · Reauthentication

**Cuándo se dispara**: usuario invoca `auth.reauthenticate()` para confirmar identidad antes de acciones sensibles (cambio de password sin recovery, eliminación de cuenta, MFA setup). Supabase envía un código OTP de 6 dígitos al email del usuario.

**Subject**:

```
Confirmá que sos vos
```

**Preheader**: `Confirmá tu identidad con el código recibido.`

**Variables usadas**: `{{ .Token }}`.

⚠️ **Importante**: Reauthentication NO tiene `{{ .ConfirmationURL }}` — solo `.Token`. El usuario lee el código del email y lo tipea en la UI. **Sin CTA link.**

**HTML completo**:

```html
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <meta name="color-scheme" content="light"/>
  <meta name="supported-color-schemes" content="light"/>
  <title>ConsultoraDemo · Confirmá que sos vos</title>
</head>
<body style="margin: 0; padding: 0; background-color: #ffffff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; color: #18181b;">
  <div style="display: none; max-height: 0; overflow: hidden; mso-hide: all;">
    Confirmá tu identidad con el código recibido.
  </div>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #ffffff;">
    <tr>
      <td align="center" style="padding: 32px 16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width: 600px; width: 100%;">
          <tr>
            <td style="padding: 0 0 20px 0; border-bottom: 1px solid #e4e4e7;">
              <span style="font-size: 18px; font-weight: 700; color: #4f46e5; letter-spacing: -0.01em;">ConsultoraDemo</span>
            </td>
          </tr>
          <tr>
            <td style="padding: 28px 0 0 0; font-size: 15px; line-height: 1.55; color: #18181b;">
              <p style="margin: 0 0 16px 0;">Hola,</p>
              <p style="margin: 0 0 16px 0;">Para confirmar la acción que iniciaste en <strong style="font-weight: 600;">ConsultoraDemo</strong>, ingresá este código en la aplicación:</p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 24px 0; background-color: #fafafa; border-radius: 6px;">
                <tr>
                  <td align="center" style="padding: 24px 16px; font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace; font-size: 28px; font-weight: 600; letter-spacing: 0.15em; color: #18181b;">
                    {{ .Token }}
                  </td>
                </tr>
              </table>
              <p style="margin: 0 0 24px 0; font-size: 14px; line-height: 1.5; color: #71717a;">
                El código tiene validez limitada y solo funciona una vez. Si expiró, pedí uno nuevo.
              </p>
              <p style="margin: 0; font-size: 14px; line-height: 1.5; color: #71717a;">
                Si no iniciaste ninguna acción que requiera confirmación, ignorá este mail.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding: 28px 0 0 0; border-top: 1px solid #e4e4e7; font-size: 13px; line-height: 1.5; color: #71717a;">
              ConsultoraDemo · Hecho en Argentina<br/>
              <a href="https://consultora-demo.test-ia.cloud" style="color: #71717a; text-decoration: underline;">consultora-demo.test-ia.cloud</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
```

**Notas operativas**:

- **Feature opt-in en Supabase**: por default reauthentication NO está habilitada. Activar en `Authentication → Multi-Factor Authentication → Reauthentication` cuando construyas el flow MFA / acciones sensibles.
- **No existe UI en el repo** todavía. Template queda preparado para Fase 4 (MFA + acciones sensibles).
- El `letter-spacing: 0.15em` en el código OTP da espacio visual entre dígitos sin perder el copy-paste como un solo string (Apple Mail / Gmail respetan letter-spacing en monospace).

---

## Sección 3 · Instrucciones operativas

### 3.1 · Aplicar templates en Supabase Dashboard

Por cada uno de los 6 templates:

1. Entrar al proyecto productivo: <https://supabase.com/dashboard/project/_/auth/templates>.
2. Seleccionar el template del sidebar (Confirm signup / Magic Link / Reset Password / Invite user / Change Email Address / Reauthentication).
3. **Subject**: pegar el subject de la sección correspondiente de este doc (e.g. `Confirmá tu cuenta en ConsultoraDemo`).
4. **Message (HTML)**: vaciar el contenido actual del editor y pegar el HTML completo del template (entre los bloques ```` ```html ```` y ```` ``` ````).
5. **Save changes** (botón verde abajo a la derecha).
6. Repetir para los 6 templates.

⚠️ **Default que hay que corregir explícitamente**: el subject de Confirm signup hoy es `Confirm Your Signup` (inglés Supabase). Asegurate de overridearlo al subject de español.

### 3.2 · Test plan manual

Templates que tienen flow real implementado hoy (Sprint 1 cerrado):

| Template | Cómo disparar | Esperado |
|---|---|---|
| Confirm signup | `/signup` con email nuevo `test-emails-<timestamp>@<tu-dominio>.com` | Email recibido con subject `Confirmá tu cuenta en ConsultoraDemo`, CTA indigo, trial highlight box, link funcional → `/login?confirmed=1` |
| Magic Link | `/login` → botón "Recibir magic link" con email confirmado | Email recibido con subject `Tu link de acceso a ConsultoraDemo`, CTA `Iniciar sesión`, link funcional → `/dashboard` |
| Reset Password | `/recuperar-password` con email confirmado | Email recibido con subject `Restablecé tu contraseña en ConsultoraDemo`, CTA `Cambiar mi contraseña`, link funcional → `/cambiar-password` |

Templates **sin flow UI implementado** (skip test, solo verificar render visual con dummy data desde el dashboard):

| Template | Por qué no se puede testear hoy |
|---|---|
| Invite User | Requiere flow UI Plan Team — Fase 2. Activable manualmente via `auth.admin.inviteUserByEmail` desde `scripts/dev-*.ts` si querés smoke una vez. |
| Change Email Address | Requiere página `/configuracion/cuenta` no implementada. Activable via Supabase dashboard manualmente (`Authentication → Users → ... → Send invitation` no aplica, hay que usar SQL/CLI). |
| Reauthentication | Feature opt-in del Supabase, requiere activación + flow MFA UI (Fase 4). |

### 3.3 · Clients a verificar

Por cada template testeable, abrir el email recibido en:

- **Gmail web** (browser desktop)
- **Gmail mobile** (Android o iOS)
- **iOS Mail** (app nativa iOS — tiene comportamiento distinto a Gmail iOS especialmente en dark mode)
- *(Bonus si tenés cuenta)* Outlook web / Outlook for Android

Verificar:

- Subject correcto en inbox list.
- **Preheader visible** debajo del subject en el inbox (Gmail web/mobile y iOS Mail lo muestran). En Outlook desktop puede no verse — esperado.
- **Render visual**: wordmark indigo, separators OK, CTA pill indigo (en Outlook desktop el CTA renderea recto — esperado), highlight box / OTP block con bg `#fafafa`, footer muted.
- **Dark mode**: forzar dark mode del sistema (Settings → Display → Dark en iOS / `chrome://flags` `enable-force-dark` en Gmail web) y confirmar que los colores NO se invierten (el `color-scheme: light` debería forzar light incluso en dark mode).
- **CTA clickeable**: tap/click → abre `{{ .ConfirmationURL }}` real en browser.
- **Fallback URL plana**: copy-paste manual debería funcionar idéntico al CTA.

### 3.4 · Workarounds para variables no testables sin trigger real

- `{{ .Token }}` (Reauthentication / OTP en general): solo aparece al disparar el flow real. NO se puede previsualizar desde el dashboard. Dummy text en el preview de Supabase muestra literal `{{ .Token }}`.
- `{{ .NewEmail }}` (Change Email): idem, solo en flow real.
- `{{ .Data.invitedByName }}` (Invite, workaround Fase 2): solo si el admin pasa metadata en `auth.admin.inviteUserByEmail(email, { data: { invitedByName: '...' } })`.

Cuando estés implementando el flow real correspondiente, hacer smoke E2E vía la UI (no solo unit tests del action) para verificar que las variables interpolan correctamente.

### 3.5 · Rollback

Si algún template emitido tiene un bug visual o de copy detectado en producción:

1. Volver a `Supabase Dashboard → Authentication → Email Templates → seleccionar el template afectado`.
2. Reemplazar el HTML con la versión previa (que tendrías idealmente en `git log -p docs/operations/email-templates.md` si revertis este doc).
3. Save. Cambio efectivo inmediato — los emails nuevos usan el template nuevo, los ya emitidos quedan como estaban.

Sin migración, sin downtime, sin redeploy.

### 3.6 · Migration path a Resend custom SMTP (futuro)

Si en algún momento los emails default de Supabase no escalan (rate limit `~30 emails/h` por proyecto en free tier, deliverability inferior, falta de tracking), opciones:

1. **Resend SMTP con dominio propio** (`emails.consultora-demo.test-ia.cloud` o similar): configurar registros DNS (SPF, DKIM, DMARC), crear sender en Resend, pegar las credenciales en `Supabase Dashboard → Authentication → SMTP Settings → Custom SMTP`. Supabase sigue manejando los templates (no se mueven al repo).
2. **Resend API directa via Edge Function**: mover los templates a archivos `.tsx` en `src/shared/email/templates/`, renderear con `react-email` o `@react-email/components`, enviar via `resend.emails.send()`. Más control + tests automáticos, pero más código a mantener.

Recomendación: opción 1 cuando el cuello de botella sea SMTP/deliverability. Opción 2 solo si necesitamos tracking analytics, AB testing de copy, o lógica dinámica por usuario que no se pueda hacer con variables Supabase.
