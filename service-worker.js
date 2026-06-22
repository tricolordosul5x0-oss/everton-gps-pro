// ═══════════════════════════════════════════════════
//  Everton GPS PRO — Service Worker
//  Responsavel por deixar o app, o mapa (Leaflet) e os
//  tiles do OpenStreetMap disponiveis 100% offline.
// ═══════════════════════════════════════════════════

var CACHE_VERSION = 'v3';
var SHELL_CACHE   = 'gps-shell-' + CACHE_VERSION;
var RUNTIME_CACHE = 'gps-runtime-' + CACHE_VERSION;
var TILES_CACHE    = 'gps-tiles-v1'; // nome fixo: usado tambem pelo botao "cachear area"

// Arquivos essenciais para o app abrir mesmo sem internet
var SHELL_FILES = [
    './index.html',
    './manifest.json',
    './vendor/leaflet/leaflet.css',
    './vendor/leaflet/leaflet.js',
    './vendor/leaflet/images/marker-icon.png',
    './vendor/leaflet/images/marker-icon-2x.png',
    './vendor/leaflet/images/marker-shadow.png',
    './vendor/leaflet/images/layers.png',
    './vendor/leaflet/images/layers-2x.png',
    './icons/icon-192.png',
    './icons/icon-512.png',
    './icons/icon-maskable-512.png'
];

self.addEventListener('install', function(event) {
    event.waitUntil(
        caches.open(SHELL_CACHE)
            .then(function(cache) { return cache.addAll(SHELL_FILES); })
            .then(function() { return self.skipWaiting(); })
    );
});

self.addEventListener('activate', function(event) {
    event.waitUntil(
        caches.keys().then(function(keys) {
            return Promise.all(keys.map(function(key) {
                if (key !== SHELL_CACHE && key !== RUNTIME_CACHE && key !== TILES_CACHE) {
                    return caches.delete(key);
                }
            }));
        }).then(function() { return self.clients.claim(); })
    );
});

function isTileRequest(url) {
    return url.indexOf('tile.openstreetmap.org') !== -1;
}

self.addEventListener('fetch', function(event) {
    var req = event.request;
    if (req.method !== 'GET') return;

    // Navegacao direta na URL do app (abrir o app / instalado) -> sempre serve o index do cache
    if (req.mode === 'navigate') {
        event.respondWith(
            caches.match('./index.html').then(function(cached) {
                return cached || fetch(req).catch(function() {
                    return caches.match('./index.html');
                });
            })
        );
        return;
    }

    // Tiles do mapa: cache-first, e guarda qualquer tile novo visto durante o uso
    if (isTileRequest(req.url)) {
        event.respondWith(
            caches.open(TILES_CACHE).then(function(cache) {
                return cache.match(req).then(function(cached) {
                    if (cached) return cached;
                    // no-cors: os servidores de tile do OSM nao enviam cabecalhos CORS.
                    // A resposta vem "opaca" (sem status legivel), mas exibe normalmente.
                    return fetch(req.url, {mode: 'no-cors'}).then(function(res) {
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
        return req.url.indexOf(f.replace('./', '')) !== -1;
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

    // Demais recursos (ex.: SDK do Firebase via CDN): stale-while-revalidate
    // -> usa do cache na hora, atualiza em segundo plano quando online
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
