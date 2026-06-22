// ═══════════════════════════════════════════════════
//  Everton GPS PRO — Service Worker (Ajustado)
//  Responsável por deixar o app, o mapa (Leaflet) e os
//  tiles do OpenStreetMap disponíveis 100% offline.
// ═══════════════════════════════════════════════════

var CACHE_VERSION = 'v4';
var SHELL_CACHE   = 'gps-shell-' + CACHE_VERSION;
var RUNTIME_CACHE = 'gps-runtime-' + CACHE_VERSION;
var TILES_CACHE    = 'gps-tiles-v1'; // nome fixo: usado também pelo botão "cachear área"

// Arquivos essenciais para o app abrir mesmo sem internet (Ajustado para links CDN)
var SHELL_FILES = [
    './index.html',
    './manifest.json',
    './icons/icon-192.png',
    './icons/icon-512.png',
    './icons/icon-maskable-512.png',
    // Links externos do Leaflet e Firebase salvos direto no cache do celular
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
    'https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js',
    'https://www.gstatic.com/firebasejs/9.23.0/firebase-database-compat.js'
];

self.addEventListener('install', function(event) {
    event.waitUntil(
        caches.open(SHELL_CACHE)
            .then(function(cache) {
                return cache.addAll(SHELL_FILES);
            })
            .then(function() {
                return self.skipWaiting();
            })
    );
});

self.addEventListener('activate', function(event) {
    event.waitUntil(
        caches.keys().then(function(keys) {
            return Promise.all(
                keys.map(function(key) {
                    if (key !== SHELL_CACHE && key !== RUNTIME_CACHE && key !== TILES_CACHE) {
                        return caches.delete(key);
                    }
                })
            );
        }).then(function() {
            return self.clients.claim();
        })
    );
});

self.addEventListener('fetch', function(event) {
    var req = event.request;

    // Ignora requisições do Firebase Realtime Database (pois ele usa websockets/REST dinâmico)
    if (req.url.indexOf('firebaseio.com') !== -1 || req.url.indexOf('identitytoolkit') !== -1) {
        return;
    }

    // Intercepta Tiles do OpenStreetMap (Mapa)
    if (req.url.indexOf('tile.openstreetmap.org') !== -1) {
        event.respondWith(
            caches.open(TILES_CACHE).then(function(cache) {
                return cache.match(req).then(function(cached) {
                    // Cache-first com fallback de rede para os mapas carregados
                    return cached || fetch(req, {mode: 'no-cors'}).then(function(res) {
                        if (res) cache.put(req, res.clone());
                        return res;
                    }).catch(function() { return cached; });
                });
            })
        );
        return;
    }

    // Arquivos do app shell: cache-first
    var isShellFile = SHELL_FILES.some(function(f) {
        return req.url.indexOf(f.replace('./', '')) !== -1 || req.url === f;
    });
    
    if (isShellFile) {
        event.respondWith(
            caches.match(req).then(function(cached) {
                return cached || fetch(req).then(function(res) {
                    if (res && res.ok) {
                        caches.open(SHELL_CACHE).then(function(c) { c.put(req, res.clone()); });
                    }
                    return res;
                });
            })
        );
        return;
    }

    // Demais recursos: stale-while-revalidate
    event.respondWith(
        caches.open(RUNTIME_CACHE).then(function(cache) {
            return cache.match(req).then(function(cached) {
                var fetchPromise = fetch(req).then(function(res) {
                    if (res && res.ok) cache.put(req, res.clone());
                    return res;
                }).catch(function() { return cached; });
                return cached || fetchPromise;
            });
        })
    );
});
