// T-034 · Service Worker para Web Push.
//
// Static file, scope default '/'. NO PWA — sin install handler ni caching.
// Solo handlers de push + notificationclick.
//
// Registrado on-demand desde PushChannelRow al click "Activar notificaciones".
// Re-registro idempotente: si el browser ya tiene este SW activo en el mismo
// scope, no hace nada (no requiere skipWaiting).

self.addEventListener('push', (event) => {
  // userVisibleOnly: true en pushManager.subscribe garantiza que SIEMPRE hay
  // payload mostrable. Defensa: si llega push sin data o data malformada,
  // mostrar genérico antes que fallar silencioso.
  let data = {};
  try {
    if (event.data) {
      data = event.data.json();
    }
  } catch {
    data = { title: 'ConsultoraDemo', body: 'Tenés un vencimiento próximo.' };
  }

  const title = data.title || 'ConsultoraDemo';
  const options = {
    body: data.body || 'Tenés un vencimiento próximo.',
    icon: data.icon || '/favicon.ico',
    badge: '/favicon.ico',
    // tag dedupea notif por (sw, tag): si llega otro push con mismo tag,
    // REEMPLAZA la previa. Útil para reminders del mismo evento a 30d/7d/0d.
    tag: data.tag || 'consultora-demo-reminder',
    data: { url: data.url || '/calendario/agenda' },
    requireInteraction: false,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl =
    (event.notification.data && event.notification.data.url) || '/calendario/agenda';

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Si hay tab abierta de la app, focus + navegar dentro de esa tab.
        for (const client of clientList) {
          const isAppTab = client.url.indexOf(self.location.origin) === 0;
          if (isAppTab && 'focus' in client) {
            if ('navigate' in client) {
              client.navigate(targetUrl).catch(() => {
                // navigate puede rechazar si la URL es cross-origin (no es nuestro caso),
                // o si el client está siendo destruido. Tolerable — el focus alcanza.
              });
            }
            return client.focus();
          }
        }
        // No hay tab abierta → abrir nueva.
        return self.clients.openWindow(targetUrl);
      })
      .catch(() => {
        // matchAll/openWindow pueden rechazar en edge cases (browser cerrado
        // mientras se procesa, SW killed mid-task). Tolerable.
      }),
  );
});
