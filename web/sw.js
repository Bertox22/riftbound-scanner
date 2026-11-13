// Service worker: que la app abra y funcione sin conexión (en una tienda o un torneo sin cobertura).
//
// Se registra como sw.js?v=67, con la misma versión que index.html (app.js la saca de su propia
// dirección): al publicar con otra ?v= el navegador instala este archivo de nuevo, sin tener que
// tocarlo. La lista de archivos de la app se saca de index.html al instalar.
//
// Cómo se sirve cada cosa:
//   - La página: primero internet (como siempre); si no contesta en 3 s, la guardada al instalar.
//   - CSS y módulos JS con ?v=: los guardados al instalar (cada versión es un archivo distinto).
//   - Datos (cartas, precios, índice del reconocimiento): primero internet; sin él, lo último bajado.
//   - Librerías de jsdelivr (versión fija), la fuente y las miniaturas: lo guardado; si no está, se
//     baja y se guarda.
//   - Lo demás (Supabase, imágenes grandes de Riot, el modelo, que ya se guarda aparte) no se toca.
//
// Escáner con varios hilos: a la página se le añaden las cabeceras que la «aíslan» (COOP + COEP), que
// GitHub Pages no deja poner. Con ellas recognizer.js usa hasta 4 hilos (~2,8 veces más rápido en un
// PC, mismo resultado). COEP va en modo credentialless: con require-corp se bloquearían las imágenes de
// Riot, que no traen Cross-Origin-Resource-Policy. Safari no lo admite y se queda con 1 hilo, como antes.
// La primera visita aún no pasa por aquí: los hilos llegan desde la segunda.
//
// Freno de emergencia: si una versión de este archivo diera problemas, publicar uno que solo haga
// self.registration.unregister() y borre las cachés rb-sw-*; cada móvil lo quita en su siguiente visita.

const VERSION = new URL(location.href).searchParams.get('v') || 'dev';
const SHELL = `rb-sw-shell-${VERSION}`; // página, CSS y JS de esta versión
const DATA = 'rb-sw-data'; // cards.json, prices.json, index.json, index.bin
const LIBS = 'rb-sw-libs'; // jsdelivr y la fuente: versiones fijas, no caducan
const IMAGES = 'rb-sw-thumbs'; // miniaturas, según se ven
const OURS = (name) => name.startsWith('rb-sw-'); // 'rb-model' (el modelo) es de recognizer.js

const ORT = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/';
const LIB_FILES = [`${ORT}ort.wasm.min.js`, `${ORT}ort-wasm-simd-threaded.mjs`, `${ORT}ort-wasm-simd-threaded.wasm`,
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap'];
const DATA_FILES = ['data/cards.json', 'data/prices.json', 'data/index.json'];
const PAGE_TIMEOUT = 3000;
const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);

const abs = (path) => new URL(path, self.registration.scope).href;

/** La misma respuesta de la página, con las cabeceras que la aíslan (para los hilos del escáner). */
function isolated(res) {
  if (!res || res.status !== 200 || (res.type !== 'basic' && res.type !== 'default')) return res;
  const headers = new Headers(res.headers);
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Embedder-Policy', 'credentialless');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
const fresh = (url) => new Request(url, { cache: 'reload' }); // sin la caché HTTP del navegador

/** Los archivos con ?v= que pide index.html: styles.css, app.js y los del import map. */
function shellFiles(html) {
  const found = new Set(['./', 'manifest.webmanifest', 'icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
    'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png']);
  for (const m of html.matchAll(/["']\.?\/?((?:js\/)?[\w-]+\.(?:js|css)\?v=[\w.]+)["']/g)) found.add(m[1]);
  return [...found];
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const res = await fetch(fresh(abs('./')));
    if (!res.ok) throw new Error(`index.html: HTTP ${res.status}`);
    const html = await res.clone().text();
    const shell = await caches.open(SHELL);
    await shell.put(abs('./'), res);
    await shell.addAll(shellFiles(html).filter((f) => f !== './').map((f) => fresh(abs(f))));
    // Datos y librerías: si alguno falla no se para la instalación, se guardará al usarse.
    const data = await caches.open(DATA);
    await Promise.allSettled(DATA_FILES.map((f) => data.add(fresh(abs(f)))));
    try {
      const meta = await (await caches.match(abs('data/index.json'))).json();
      await data.add(fresh(abs(`data/index.bin?v=${meta.version}`)));
    } catch { /* se baja al usar el escáner */ }
    const libs = await caches.open(LIBS);
    await Promise.allSettled(LIB_FILES.map(async (u) => { if (!(await libs.match(u))) await libs.add(u); }));
    await self.skipWaiting(); // la página ya es de esta versión: no hay que esperar a cerrarla
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (OURS(name) && name.startsWith('rb-sw-shell-') && name !== SHELL) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

/** Primero internet; si falla o tarda más de `ms`, lo guardado. */
async function networkFirst(request, cacheName, { ms = 0, key = request, store = true } = {}) {
  const cache = await caches.open(cacheName);
  const network = fetch(request).then(async (res) => {
    if (res.ok && store) {
      await cache.put(key, res.clone());
      if (cacheName === DATA) await dropOlder(cache, key);
    }
    return res;
  });
  const cached = () => cache.match(key);
  if (!ms) {
    try { return await network; } catch (err) { return (await cached()) ?? Promise.reject(err); }
  }
  // Con tiempo límite: si internet no contesta a tiempo, lo guardado; si no hay nada guardado, se espera.
  const timeout = new Promise((resolve) => setTimeout(resolve, ms, 'timeout'));
  try {
    const first = await Promise.race([network, timeout]);
    if (first !== 'timeout') return first;
    return (await cached()) ?? await network;
  } catch (err) {
    return (await cached()) ?? Promise.reject(err);
  }
}

/** De los datos se guarda solo la última versión de cada archivo (index.bin cambia de ?v=). */
async function dropOlder(cache, key) {
  const url = new URL(typeof key === 'string' ? key : key.url);
  for (const req of await cache.keys()) {
    const other = new URL(req.url);
    if (other.pathname === url.pathname && other.href !== url.href) await cache.delete(req);
  }
}

/** Lo guardado; si no está, se baja y se guarda. */
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok || res.type === 'opaque') await cache.put(request, res.clone());
  return res;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const scope = new URL(self.registration.scope);

  if (url.origin === scope.origin && url.pathname.startsWith(scope.pathname)) {
    const path = url.pathname.slice(scope.pathname.length);
    // La página (con cualquier #pestaña o ?parámetro): la guardada es la de esta versión.
    if (request.mode === 'navigate') {
      event.respondWith(networkFirst(request, SHELL, { ms: PAGE_TIMEOUT, key: abs('./'), store: false }).then(isolated));
    } else if (url.searchParams.has('v') && /\.(js|css)$/.test(path)) {
      // En el PC se edita sin cambiar la ?v=: allí primero internet, para ver siempre lo último.
      event.respondWith(LOCAL ? networkFirst(request, SHELL, { store: false })
        : caches.match(request).then((hit) => hit ?? fetch(request)));
    } else if (path.startsWith('data/')) {
      event.respondWith(networkFirst(request, DATA));
    } else if (path.startsWith('thumbs/')) {
      event.respondWith(cacheFirst(request, IMAGES));
    } else if (path === 'manifest.webmanifest' || path === 'icon.svg' || path.startsWith('icons/')) {
      event.respondWith(networkFirst(request, SHELL));
    }
    return; // models/ y lo demás, como siempre
  }
  if (url.hostname === 'cdn.jsdelivr.net' && /@\d/.test(url.pathname)) {
    event.respondWith(cacheFirst(request, LIBS));
  } else if (url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(request, LIBS));
  } else if (url.hostname === 'fonts.googleapis.com') {
    event.respondWith(networkFirst(request, LIBS));
  }
});
