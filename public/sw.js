// Service Worker para notificações em background do FilaPro

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Escuta o evento push enviado pelos servidores da Google/Apple
self.addEventListener('push', (event) => {
  if (!event.data) return;

  try {
    const payload = event.data.json();
    
    const options = {
      body: payload.body,
      icon: '/images/paodequeijo.png', // Fallback ícone
      badge: '/images/paodequeijo.png',
      vibrate: [500, 250, 500, 250, 800, 250, 800], // Vibração forte intermitente
      data: {
        url: payload.url || '/'
      },
      tag: 'filapro-chamada',
      renotify: true,
      requireInteraction: true // Deixa a notificação na tela até que o usuário clique
    };

    event.waitUntil(
      self.registration.showNotification(payload.title, options)
    );
  } catch (err) {
    console.error('Erro ao processar dados de Push:', err);
  }
});

// Ao clicar na notificação, abre ou foca a aba da fila
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const urlToOpen = event.notification.data.url;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // Tenta focar em uma aba que já esteja aberta no FilaPro
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i];
        if (client.url.includes(urlToOpen) && 'focus' in client) {
          return client.focus();
        }
      }
      // Se não achar nenhuma aba aberta, abre uma nova
      if (self.clients.openWindow) {
        return self.clients.openWindow(urlToOpen);
      }
    })
  );
});
