/*
 * Everton GPS PRO - Service Worker
 * ---------------------------------
 * Responsável por:
 *  1) Cache do "app shell" para o aplicativo abrir mesmo sem internet.
 *  2) Sincronização em segundo plano (Background Sync) da fila de pontos
 *     gravados offline, mesmo que o app esteja minimizado.
 *
 * IMPORTANTE - LIMITAÇÃO REAL DO NAVEGADOR:
 * Nenhum site ou PWA consegue capturar novas coordenadas de GPS enquanto
 * a tela do aparelho está apagada — a API de Geolocalização não funciona
 * dentro do Service Worker, e o sistema operacional suspende o JavaScript
 * da página nesse cenário. O recurso abaixo sincroniza dados que JÁ FORAM
 * capturados e ficaram na fila offline; ele não gera novas posições.
 * Para captura 100% contínua com a tela apagada por longos períodos, a
 * solução robusta é um aplicativo nativo com serviço em primeiro plano.
 */

var CACHE_NAME = 'gps-pro-shell-v1';
var DATABASE_URL = 'https://everton-gps-default-rtdb.firebaseio.com';

var APP_SHELL = [
    './',
    './index.html',
    './manifest.json',
    './icons/icon-192.png',
    './icons/icon-512.png'
];

self.addEventListener('install', function(event) {
    event.waitUntil(
        caches.open(CACHE_NAME).then(function(cache) {
            return cache.addAll(APP_SHELL);
        }).then(function() { return self.skipWaiting(); })
    );
});

self.addEventListener('activate', function(event) {
    event.waitUntil(
        caches.keys().then(function(keys) {
            return Promise.all(keys.filter(function(k) { return k !== CACHE_NAME; }).map(function(k) { return caches.delete(k); }));
        }).then(function() { return self.clients.claim(); })
    );
});

// Estratégia: cache-first para o app shell, network-first com fallback para o resto.
self.addEventListener('fetch', function(event) {
    var req = event.request;
    if (req.method !== 'GET') return;

    event.respondWith(
        caches.match(req).then(function(cached) {
            if (cached) return cached;
            return fetch(req).then(function(resp) {
                if (resp && resp.status === 200 && (req.url.startsWith(self.location.origin))) {
                    var copia = resp.clone();
                    caches.open(CACHE_NAME).then(function(cache) { cache.put(req, copia); });
                }
                return resp;
            }).catch(function() { return cached; });
        })
    );
});

/* =========================================================
   BACKGROUND SYNC — envia a fila offline para o Firebase
   mesmo com o app minimizado (suportado no Chrome/Android)
   ========================================================= */
self.addEventListener('sync', function(event) {
    if (event.tag === 'sync-fila-offline') {
        event.waitUntil(processarFilaOffline());
    }
});

// Tenta também o Periodic Background Sync, quando disponível,
// como reforço para reenviar pendências.
self.addEventListener('periodicsync', function(event) {
    if (event.tag === 'sync-fila-offline-periodico') {
        event.waitUntil(processarFilaOffline());
    }
});

function abrirIDB() {
    return new Promise(function(resolve, reject) {
        var req = indexedDB.open('gps_local', 1);
        req.onupgradeneeded = function(e) {
            if (!e.target.result.objectStoreNames.contains('fila')) {
                e.target.result.createObjectStore('fila', { autoIncrement: true });
            }
        };
        req.onsuccess = function(e) { resolve(e.target.result); };
        req.onerror = function(e) { reject(e); };
    });
}

function processarFilaOffline() {
    return abrirIDB().then(function(idb) {
        return new Promise(function(resolve) {
            var tx = idb.transaction('fila', 'readwrite');
            var store = tx.objectStore('fila');
            var cursorReq = store.openCursor();
            var pendentes = [];

            cursorReq.onsuccess = function(e) {
                var cursor = e.target.result;
                if (cursor) {
                    pendentes.push({ key: cursor.key, item: cursor.value });
                    cursor.continue();
                } else {
                    enviarSequencial(pendentes, store).then(resolve);
                }
            };
            cursorReq.onerror = function() { resolve(); };
        });
    }).catch(function() { /* sem fila pendente ou IDB indisponível */ });
}

function enviarSequencial(pendentes, store) {
    var promessa = Promise.resolve();
    pendentes.forEach(function(p) {
        promessa = promessa.then(function() {
            var url = DATABASE_URL + '/veiculos/' + encodeURIComponent(p.item.vID) + '/historico.json';
            return fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(p.item.dados)
            }).then(function(resp) {
                if (resp.ok) {
                    return new Promise(function(res) {
                        var del = store.delete(p.key);
                        del.onsuccess = function() { res(); };
                        del.onerror = function() { res(); };
                    });
                }
            }).catch(function() { /* mantém na fila para tentar depois */ });
        });
    });
    return promessa;
}
