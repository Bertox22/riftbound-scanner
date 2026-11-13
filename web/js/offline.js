// Sin conexión: estado del service worker y de lo guardado, miniaturas y aviso de versión nueva.
//
// Sin conexión: el service worker guarda la app y los datos (ver sw.js). Lleva la misma versión que
// este archivo, así que al publicar con otra ?v= se instala solo el nuevo. En el PC (localhost) solo
// con ?sw en la dirección, para probarlo sin que estorbe al desarrollo.

import { $, el, toast } from './ui.js';

let APP_VERSION = 'dev';
let thumbUrls = [];

/**
 * Junto a la versión, si la app está lista para usarse sin conexión; al tocarlo, el detalle de lo que
 * hay guardado. Sirve para ver en el móvil qué falta antes de poner el modo avión.
 */
// Miniaturas sin conexión: se guardan según se ven (sw.js, caché rb-sw-thumbs); este botón baja de una
// vez las que faltan, a la misma caché, y el service worker las sirve de ahí.
const THUMBS = 'rb-sw-thumbs';
const THUMB_MB = 31; // todas juntas, más o menos
let thumbJob = null; // { done, total, stop } mientras se descargan

async function missingThumbs() {
  if (!(await caches.has(THUMBS))) return thumbUrls;
  const saved = new Set((await (await caches.open(THUMBS)).keys()).map((r) => r.url));
  return thumbUrls.filter((u) => !saved.has(u));
}

async function saveAllThumbs() {
  const todo = await missingThumbs();
  if (!todo.length) return offlineStatus();
  const mb = Math.max(1, Math.round((THUMB_MB * todo.length) / thumbUrls.length));
  if (!confirm(`Se descargarán ${todo.length} miniaturas (unos ${mb} MB). Mejor con wifi. ¿Seguir?`)) return;
  const cache = await caches.open(THUMBS);
  const job = thumbJob = { done: 0, total: todo.length, failed: 0, stop: false };
  offlineStatus();
  let next = 0;
  const worker = async () => {
    while (!job.stop && next < todo.length) {
      const url = todo[next++];
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(res.status);
        await cache.put(url, res);
      } catch { job.failed++; }
      job.done++;
      if (job.done % 25 === 0) offlineStatus();
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  thumbJob = null;
  if (job.stop) toast('Descarga de miniaturas parada. Lo guardado se queda.');
  else if (job.failed) toast(`Faltan ${job.failed} miniaturas (¿sin conexión?). Vuelve a probar más tarde.`, 5000);
  else toast('Miniaturas guardadas: ya se ven sin conexión.');
  offlineStatus();
}

let swError = null; // el error al registrar el service worker, si lo hubo: se muestra siempre
let statusRun = 0; // varias comprobaciones a la vez: solo escribe la última
async function offlineStatus() {
  const run = ++statusRun;
  const box = $('#app-version');
  const base = `Versión ${APP_VERSION}`;
  if (!('serviceWorker' in navigator) || !self.caches) return void (box.textContent = `${base} · este navegador no permite usarla sin conexión`);
  const names = await caches.keys().catch(() => []);
  const has = async (cache, path) => names.includes(cache) && !!(await (await caches.open(cache)).match(new URL(path, location.href).href).catch(() => null));
  const reg = await navigator.serviceWorker.getRegistration().catch(() => null);
  const checks = [
    ['Service worker', reg?.active ? `activo (${reg.active.scriptURL.split('?v=')[1] ?? '?'})` : reg?.installing || reg?.waiting ? 'instalándose' : 'no instalado'],
    ['Controla esta página', navigator.serviceWorker.controller ? 'sí' : reg?.active ? 'no (se abrió antes de instalarlo: ciérrala y vuelve a abrirla)' : 'no'],
    ['Página y código', names.includes(`rb-sw-shell-${APP_VERSION}`) ? 'guardados' : 'no'],
    ['Datos de cartas', (await has('rb-sw-data', 'data/cards.json')) ? 'guardados' : 'no'],
    ['Modelo del escáner', names.includes('rb-model') ? 'guardado' : 'no (se guarda al cargar el escáner)'],
    ['Motor del modelo', (await has('rb-sw-libs', 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/ort-wasm-simd-threaded.wasm')) ? 'guardado' : 'no'],
    ['Hilos del escáner', self.crossOriginIsolated ? 'varios' : '1'],
  ];
  const thumbsLeft = (await missingThumbs().catch(() => thumbUrls)).length;
  checks.push(['Miniaturas', `${thumbUrls.length - thumbsLeft} de ${thumbUrls.length} guardadas`]);
  if (swError) checks.unshift(['Error al instalar', swError]);
  const ready = !swError && !!navigator.serviceWorker.controller && checks.slice(2, 6).every(([, v]) => /^guardad/.test(v));
  if (run !== statusRun) return; // ya hay una comprobación más reciente
  box.replaceChildren(
    el('button', { class: 'app-version-btn', type: 'button', 'aria-expanded': 'false', onclick: (e) => {
      const open = box.querySelector('.app-version-detail').hidden;
      box.querySelector('.app-version-detail').hidden = !open;
      e.currentTarget.setAttribute('aria-expanded', String(open));
    } }, `${base} · ${ready ? 'lista sin conexión' : swError ? 'sin conexión no disponible (toca para ver)' : 'aún no lista sin conexión'}`),
    el('dl', { class: 'app-version-detail', hidden: box.querySelector('.app-version-detail')?.hidden ?? true }, ...checks.flatMap(([k, v]) => [el('dt', { text: k }), el('dd', { text: v })])),
    ...thumbsLine(thumbsLeft, !!navigator.serviceWorker.controller));
  box.querySelector('.app-version-btn').setAttribute('aria-expanded', String(!box.querySelector('.app-version-detail').hidden));
}

/** Debajo de la versión: guardar todas las miniaturas, el progreso o que ya están. */
function thumbsLine(left, controlled) {
  if (thumbJob) {
    return [el('div', { class: 'thumbs-line' },
      el('span', { text: `Guardando miniaturas… ${thumbJob.done}/${thumbJob.total}` }),
      el('button', { class: 'btn ghost small', type: 'button', onclick: () => { thumbJob.stop = true; } }, 'Parar'))];
  }
  if (!controlled) return []; // sin service worker no servirían de nada
  if (!left) return [el('div', { class: 'thumbs-line', text: 'Miniaturas guardadas ✓' })];
  const mb = Math.max(1, Math.round((THUMB_MB * left) / thumbUrls.length));
  return [el('div', { class: 'thumbs-line' },
    el('button', { class: 'btn ghost small', type: 'button', onclick: saveAllThumbs },
      left === thumbUrls.length ? `Guardar todas las miniaturas (${mb} MB)` : `Guardar las ${left} miniaturas que faltan (${mb} MB)`))];
}

// Versión nueva publicada con la app abierta (en el móvil se queda días en segundo plano): al volver a
// ella, como mucho cada 30 minutos, se mira la ?v= de index.html y, si es otra, se avisa. Nunca se
// recarga sola: se podría estar jugando en la Mesa o escribiendo algo.
let versionChecked = Date.now();
async function checkVersion() {
  if (Date.now() - versionChecked < 30 * 60 * 1000) return;
  versionChecked = Date.now();
  try {
    const html = await (await fetch('./', { cache: 'no-store' })).text();
    const live = html.match(/js\/app\.js\?v=([\w.]+)/)?.[1];
    if (!live || live === APP_VERSION) return;
    toast('Hay una versión nueva de la app', 15000, { label: 'Recargar', onclick: () => location.reload() });
  } catch { /* sin conexión: se mirará la próxima vez */ }
}

/** version: la ?v= de la app; modelReady: promesa del modelo del escáner (se guarda al cargarlo). */
export function initOffline({ cards, version, modelReady }) {
  APP_VERSION = version;
  thumbUrls = [...new Set(cards.map((c) => c.thumb).filter(Boolean))].map((t) => new URL(t, location.href).href);
  const localHost = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  if ('serviceWorker' in navigator && (!localHost || new URLSearchParams(location.search).has('sw'))) {
    navigator.serviceWorker.register(`sw.js?v=${APP_VERSION}`).then((reg) => {
      offlineStatus();
      // Al terminar de instalarse (o de cambiar de versión) se vuelve a mirar.
      const watch = (w) => w?.addEventListener('statechange', offlineStatus);
      watch(reg.installing || reg.waiting);
      reg.addEventListener('updatefound', () => watch(reg.installing));
    }).catch((err) => {
      console.warn('Sin modo sin conexión:', err);
      swError = err?.message || String(err);
      offlineStatus();
    });
    navigator.serviceWorker.addEventListener('controllerchange', offlineStatus);
    modelReady.then(offlineStatus, offlineStatus); // el modelo se guarda al cargar el escáner
  } else {
    $('#app-version').textContent = `Versión ${APP_VERSION}`;
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkVersion(); });
}
