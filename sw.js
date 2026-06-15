/**
 * IndiCare — Service Worker v1
 * Estratégia: cache da "casca" do app (HTML/ícones) para abrir offline.
 * NUNCA cacheia chamadas à API (/api/*) — dados clínicos são sempre ao vivo.
 */

const CACHE = 'indicare-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png'
];

// Instala: pré-cacheia a casca
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE).then(function(cache) {
      return cache.addAll(ASSETS).catch(function() {
        // Se algum asset falhar, instala o que conseguir
        return Promise.all(ASSETS.map(function(a) {
          return cache.add(a).catch(function() {});
        }));
      });
    }).then(function() { return self.skipWaiting(); })
  );
});

// Ativa: limpa caches antigos
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(nomes) {
      return Promise.all(nomes.map(function(n) {
        if (n !== CACHE) return caches.delete(n);
      }));
    }).then(function() { return self.clients.claim(); })
  );
});

// Fetch: rede primeiro para API, cache primeiro para a casca
self.addEventListener('fetch', function(event) {
  var url = new URL(event.request.url);

  // NUNCA cacheia API nem POSTs — sempre rede ao vivo
  if (url.pathname.indexOf('/api/') === 0 || event.request.method !== 'GET') {
    return; // deixa o navegador tratar normalmente (rede)
  }

  // Outras origens (fontes, CDNs) — passa direto
  if (url.origin !== self.location.origin) {
    return;
  }

  // Casca do app: cache primeiro, com atualização em segundo plano
  event.respondWith(
    caches.match(event.request).then(function(cached) {
      var rede = fetch(event.request).then(function(resp) {
        if (resp && resp.status === 200) {
          var clone = resp.clone();
          caches.open(CACHE).then(function(c) { c.put(event.request, clone); });
        }
        return resp;
      }).catch(function() {
        // Offline: se for navegação, devolve o index cacheado
        if (event.request.mode === 'navigate') return caches.match('/index.html');
        return cached;
      });
      return cached || rede;
    })
  );
});
