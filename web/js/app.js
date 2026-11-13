// Arranque: carga las cartas y los precios, prepara cada pestaña y vuelve a la que estaba abierta.
// Cada parte vive en su módulo: escáner (scan.js), colección (collection.js y colstats.js), ficha de
// carta (cardsheet.js), sin conexión (offline.js), mazos, partidas…

import { Recognizer } from './recognizer.js';
import { store } from './store.js';
import { initDecks } from './decks.js';
import { initImport } from './import-ui.js';
import { initAccount } from './account-ui.js';
import { initMatches } from './matches.js';
import { initProfile, routeProfile } from './profile.js';
import { initTable } from './table.js';
import { initTrades, showTrades } from './trades.js';
import { initLedger } from './ledger.js';
import { initBack } from './back.js';
import { loadPrices } from './prices.js';
import { initCardSheet, openCard } from './cardsheet.js';
import { initScan, scanning, stopCamera, renderRecent, modelLoaded } from './scan.js';
import { initCollection, renderCollection } from './collection.js';
import { initCollectionStats } from './colstats.js';
import { initOffline } from './offline.js';
import { $ } from './ui.js';

const [cards] = await Promise.all([fetch('data/cards.json').then((r) => r.json()), loadPrices()]);
const byId = new Map(cards.map((c) => [c.id, c]));
const sets = [...new Map(cards.map((c) => [c.set, c.setName])).entries()];

// ---------- Navegación ----------

// La pestaña va en la dirección (#coleccion, #mazos…) para que al recargar se quede en la misma.
const VIEW_HASH = { scan: '', collection: 'coleccion', decks: 'mazos', matches: 'partidas', trades: 'intercambios' };

/**
 * Historial de las pestañas, para que «atrás» en el móvil vuelva a Escanear en vez de salir de la app.
 * Escanear es el paso de abajo ({ base }); la primera pestaña que se abre encima añade un paso
 * ({ tab, overBase }) y las demás lo sustituyen. Volver a Escanear desde ahí deshace ese paso.
 */
function rememberView(name) {
  const url = VIEW_HASH[name] ? `#${VIEW_HASH[name]}` : location.pathname + location.search;
  const state = history.state;
  if (state?.tab) {
    if (name === 'scan' && state.overBase) history.back();
    else history.replaceState(state, '', url);
  } else if (name === 'scan' && state?.base) {
    history.replaceState(state, '', url);
  } else {
    history.pushState({ tab: true, overBase: !!state?.base }, '', url);
  }
}

/** La pestaña de la dirección actual, al ir atrás o adelante. El perfil y la Mesa se pintan solos. */
function routeView() {
  const view = Object.keys(VIEW_HASH).find((v) => VIEW_HASH[v] && `#${VIEW_HASH[v]}` === location.hash);
  if (view) showView(view, true);
  else if (!location.hash) showView('scan', true);
}

function showView(name, fromHistory = false) {
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
  document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.view === (name === 'trades' ? 'collection' : name))); // Intercambios va dentro de Colección
  // El perfil (#@usuario) no es una pestaña: deja su dirección tal cual.
  if (name in VIEW_HASH && !fromHistory) rememberView(name);
  if (name !== 'scan' && scanning()) stopCamera();
  if (name === 'collection') renderCollection();
  if (name === 'trades') showTrades();
  window.scrollTo(0, 0);
}
document.querySelectorAll('.tabbar button, .col-tabs button').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));

const recognizer = new Recognizer(cards);
initCardSheet({ cards, byId, recognizer });
initScan({ byId, recognizer });
initCollection({ cards, sets, openCard });
initCollectionStats({ cards, byId, sets, openCard, showView });

for (const dlg of document.querySelectorAll('dialog')) {
  dlg.addEventListener('click', (e) => e.target === dlg && dlg.close()); // cerrar tocando fuera
}

// ---------- Las demás pestañas ----------

initDecks({ cards, byId, openCard });
initImport({ cards, byId, openCard });
initMatches({ cards, byId, openCard });
initProfile({ cards, byId, openCard, showView });
initTable({ byId, showView });
initTrades({ cards, byId, openCard });
initLedger({ cards, byId, openCard });
initAccount();

// Lo que hay detrás de la ficha (colección, escaneadas) se actualiza en cuanto cambian copias o
// foil, así que al cerrarla ya está al día sin recargar. Varios cambios seguidos, un solo repintado.
let refreshQueued = false;
store.onChange((what) => {
  if (what !== 'collection' || refreshQueued) return;
  refreshQueued = true;
  queueMicrotask(() => {
    refreshQueued = false;
    if ($('#view-collection').classList.contains('active')) renderCollection(true);
    renderRecent();
  });
});

// Al recargar, vuelve a la pestaña que estaba abierta.
// Escanear queda debajo como primer paso del historial, para que «atrás» vuelva a ella. Con otra
// dirección (un perfil, la Mesa, un enlace de la cuenta) el historial no se toca.
initBack(routeView);
const startView = Object.keys(VIEW_HASH).find((v) => VIEW_HASH[v] && `#${VIEW_HASH[v]}` === location.hash);
if (startView || !location.hash) history.replaceState({ base: true }, '', location.pathname + location.search);
if (startView) showView(startView);
else routeProfile();

initOffline({ cards, version: new URL(import.meta.url).searchParams.get('v') ?? 'dev', modelReady: modelLoaded() });
