import { Recognizer } from './recognizer.js';
import { Scanner } from './scanner.js';
import { store } from './store.js';
import { initDecks } from './decks.js';
import { $, el, toast, cardImg, cardCode, baseName, download, DOMAIN_ES, TYPE_ES, RARITY_ES } from './ui.js';

const cards = await (await fetch('data/cards.json')).json();
const byId = new Map(cards.map((c) => [c.id, c]));
const sets = [...new Map(cards.map((c) => [c.set, c.setName])).entries()];

// ---------- Navegación ----------

function showView(name) {
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
  document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  if (name !== 'scan' && scanner.running) stopCamera();
  if (name === 'collection') renderCollection();
  window.scrollTo(0, 0);
}
document.querySelectorAll('.tabbar button').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));

function updateOwnedCount() {
  const total = store.totalOwned();
  $('#owned-count').textContent = `${total} carta${total === 1 ? '' : 's'}`;
}
store.onChange((what) => what === 'collection' && updateOwnedCount());
updateOwnedCount();

// ---------- Ficha de carta ----------

/** Otras impresiones de la misma carta: mismo nombre o misma ilustración. */
function variantsOf(card) {
  const ids = new Set(recognizer.meta ? recognizer.sameArt(card.id) : [card.id]);
  for (const c of cards) if (baseName(c) === baseName(card)) ids.add(c.id);
  return [...ids].map((id) => byId.get(id));
}

function openCard(card) {
  const dlg = $('#card-dialog');
  const render = () => {
    const e = store.collection[card.id] || { n: 0, f: 0 };
    const variants = variantsOf(card).filter((c) => c.id !== card.id);
    const stats = [
      card.energy != null && `Coste ${card.energy}`,
      card.power != null && `Poder ${card.power}`,
      card.might != null && `Fuerza ${card.might}`,
    ].filter(Boolean).join(' · ');
    dlg.replaceChildren(
      el('div', { class: 'dialog-head' }, el('h2', { text: card.name }), el('button', { class: 'icon-btn', onclick: () => dlg.close() }, '✕')),
      el('div', { class: 'card-detail' },
        el('img', { class: 'card-full', src: card.image, alt: card.name, dataset: { orient: card.orientation } }),
        el('div', {},
          el('p', { class: 'muted', text: `${card.setName} · ${cardCode(card)} · ${RARITY_ES[card.rarity] || card.rarity}` }),
          el('p', { text: [TYPE_ES[card.type] || card.type, card.supertype].filter(Boolean).join(' · ') + (card.domain.length ? ` · ${card.domain.map((d) => DOMAIN_ES[d] || d).join(' / ')}` : '') }),
          stats && el('p', { text: stats }),
          card.tags.length > 0 && el('p', { class: 'muted', text: card.tags.join(', ') }),
          card.text && el('p', { class: 'card-text', text: card.text }),
          qtyRow('Normales', e.n, (d) => { store.add(card.id, d, false); render(); }),
          qtyRow('Foil', e.f, (d) => { store.add(card.id, d, true); render(); }),
          variants.length > 0 && el('div', {},
            el('h3', { text: 'Otras versiones' }),
            el('div', { class: 'variants' }, variants.map((v) => el('button', { class: 'variant', onclick: () => { card = v; render(); } },
              cardImg(v, 'thumb small'), el('span', { class: 'small', text: `${cardCode(v)}${store.owned(v.id) ? ` · ${store.owned(v.id)}` : ''}` })))),
          ),
        ),
      ),
    );
  };
  render();
  if (!dlg.open) dlg.showModal();
}

function qtyRow(label, n, change) {
  return el('div', { class: 'qty-row' },
    el('span', { class: 'grow', text: label }),
    el('button', { class: 'icon-btn', onclick: () => change(-1), disabled: n === 0 }, '−'),
    el('span', { class: 'qty', text: n }),
    el('button', { class: 'icon-btn', onclick: () => change(1) }, '+'),
  );
}

for (const dlg of document.querySelectorAll('dialog')) {
  dlg.addEventListener('click', (e) => e.target === dlg && dlg.close()); // cerrar tocando fuera
}

// ---------- Escáner ----------

const recognizer = new Recognizer(cards);
const status = (msg) => ($('#cam-status').textContent = msg);
const session = []; // { card, foil } añadidas en esta sesión, la última primero

const scanner = new Scanner({
  video: $('#video'),
  guide: $('#guide'),
  recognizer,
  onStatus: status,
  onAccept: (card) => addScanned(card),
  onResult: ({ results, state, ms }) => {
    $('#cam').dataset.state = state;
    const top = results[0];
    const label = { locked: `✓ ${top.card.name}`, confident: `Reconociendo… ${top.card.name}`, unsure: '¿Cuál es? Toca la correcta ↓', empty: 'Coloca una carta en el recuadro' }[state];
    status(`${label}  ·  ${Math.round(ms)} ms`);
    renderCandidates(state === 'empty' ? [] : results.slice(0, 4), state);
  },
});

const settings = store.settings;
if (settings.thresholds) Object.assign(scanner.thresholds, settings.thresholds);
$('#opt-auto').checked = scanner.auto = settings.auto ?? true;
$('#opt-auto').addEventListener('change', (e) => { scanner.auto = settings.auto = e.target.checked; store.saveSettings(); });

let audio;
function feedback() {
  navigator.vibrate?.(60);
  try {
    audio ??= new AudioContext();
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.15, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.15);
    o.connect(g).connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + 0.15);
  } catch { /* sin audio */ }
  const f = $('#flash');
  f.classList.remove('on');
  void f.offsetWidth;
  f.classList.add('on');
}

function addScanned(card) {
  const foil = $('#opt-foil').checked;
  store.add(card.id, 1, foil);
  session.unshift({ card, foil });
  feedback();
  renderRecent();
}

function renderCandidates(results, state) {
  const box = $('#candidates');
  if (!results.length) return box.replaceChildren();
  box.replaceChildren(
    el('p', { class: 'muted small', text: state === 'locked' ? '¿No era esta? Toca la correcta:' : scanner.auto ? 'Candidatas (toca para añadir):' : 'Toca para añadir:' }),
    el('div', { class: 'cand-row' }, results.map((r, i) => el('button', {
      class: `cand ${i === 0 && state !== 'unsure' ? 'best' : ''}`,
      onclick: () => {
        // Si la carta ya se había añadido sola y el usuario elige otra, se corrige en vez de sumar.
        if (state === 'locked' && session[0] && scanner.locked === session[0].card.id && r.id !== session[0].card.id) replaceLast(r.card);
        else addScanned(r.card);
        scanner.markAdded(r.id);
      },
    }, cardImg(r.card), el('span', { class: 'cand-name', text: r.card.name }), el('span', { class: 'muted small', text: `${cardCode(r.card)} · ${Math.round(r.score * 100)}%` })))),
  );
}

function replaceLast(card) {
  const last = session[0];
  store.add(last.card.id, -1, last.foil);
  store.add(card.id, 1, last.foil);
  last.card = card;
  feedback();
  renderRecent();
  toast(`Corregido: ${card.name}`);
}

function renderRecent() {
  $('#session-count').textContent = session.length ? `(${session.length})` : '';
  const list = $('#recent');
  if (!session.length) {
    list.replaceChildren(el('li', { class: 'empty' }, 'Las cartas que escanees aparecerán aquí.'));
    return;
  }
  list.replaceChildren(...session.slice(0, 60).map((entry) => {
    const { card, foil } = entry;
    const variants = variantsOf(card);
    return el('li', {},
      el('button', { class: 'tile-img', onclick: () => openCard(card) }, cardImg(card, 'thumb small')),
      el('div', { class: 'grow' },
        el('strong', { text: card.name }),
        el('div', { class: 'muted small', text: `${cardCode(card)}${foil ? ' · Foil' : ''} · tienes ${store.owned(card.id)}` }),
        variants.length > 1 && el('select', {
          class: 'small',
          onchange: (e) => {
            const v = byId.get(e.target.value);
            store.add(card.id, -1, foil);
            store.add(v.id, 1, foil);
            entry.card = v;
            renderRecent();
          },
        }, variants.map((v) => el('option', { value: v.id, selected: v.id === card.id, text: `${cardCode(v)} · ${v.setName}${v.rarity === 'Showcase' ? ' (showcase)' : ''}` }))),
      ),
      el('button', {
        class: 'icon-btn', title: 'Quitar',
        onclick: () => {
          store.add(card.id, -1, foil);
          session.splice(session.indexOf(entry), 1);
          renderRecent();
        },
      }, '✕'),
    );
  }));
}
renderRecent();

$('#btn-clear-session').addEventListener('click', () => {
  session.length = 0; // solo vacía la lista; las cartas siguen en la colección
  renderRecent();
});

let modelReady = recognizer.load((p) => status(`Descargando modelo… ${Math.round(p * 100)}%`))
  .then(() => status('Listo. Activa la cámara.'))
  .catch((err) => {
    console.error(err);
    status(`No se pudo cargar el modelo: ${err.message}`);
    throw err;
  });
modelReady.catch(() => {}); // el error ya se muestra; startCamera lo vuelve a ver

async function startCamera() {
  try {
    $('#btn-start').disabled = true;
    status('Cargando modelo…');
    await modelReady;
    await scanner.start();
    $('#cam').classList.add('live');
    $('#btn-stop').hidden = false;
    $('#btn-torch').hidden = !scanner.torchSupported;
  } catch (err) {
    status(err.name === 'NotAllowedError' ? 'Permiso de cámara denegado.' : err.message);
  } finally {
    $('#btn-start').disabled = false;
  }
}

function stopCamera() {
  scanner.stop();
  $('#cam').classList.remove('live');
  $('#cam').dataset.state = '';
  $('#btn-stop').hidden = true;
  $('#btn-torch').hidden = true;
  $('#candidates').replaceChildren();
  status('Cámara parada.');
}

$('#btn-start').addEventListener('click', startCamera);
$('#btn-stop').addEventListener('click', stopCamera);
let torch = false;
$('#btn-torch').addEventListener('click', async () => {
  torch = !torch;
  await scanner.setTorch(torch).catch(() => toast('La linterna no está disponible'));
});
document.addEventListener('visibilitychange', () => document.hidden && scanner.running && stopCamera());

/** Reconoce una foto (archivo o URL). La carta debe ocupar casi toda la imagen. */
async function recognizeImage(src) {
  await modelReady;
  const img = new Image();
  img.src = src;
  await img.decode();
  // Si la foto es más ancha que una carta, se recorta al centro con la proporción de la carta.
  const ratio = recognizer.meta.width / recognizer.meta.height;
  let w = img.naturalWidth, h = img.naturalHeight;
  if (w > h * ratio) w = h * ratio; else h = w / ratio;
  const v = await recognizer.embed(img, (img.naturalWidth - w) / 2, (img.naturalHeight - h) / 2, w, h);
  return recognizer.search(v, 5);
}
window.__rbRecognize = recognizeImage; // para pruebas desde la consola

$('#photo-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const url = URL.createObjectURL(file);
  try {
    status('Analizando foto…');
    const results = await recognizeImage(url);
    status(`¿Es ${results[0].card.name}? Toca la correcta ↓`);
    renderCandidates(results.slice(0, 4), 'unsure');
  } finally {
    URL.revokeObjectURL(url);
    e.target.value = '';
  }
});

// ---------- Colección ----------

const col = { q: '', set: '', type: '', domain: '', owned: true, sort: 'set' };
$('#col-set').append(...sets.map(([id, name]) => el('option', { value: id, text: `${name} (${id})` })));
$('#col-type').append(...[...new Set(cards.map((c) => c.type))].map((t) => el('option', { value: t, text: TYPE_ES[t] || t })));
$('#col-domain').append(...Object.entries(DOMAIN_ES).map(([d, es]) => el('option', { value: d, text: es })));
for (const [key, sel, ev] of [['q', '#col-search', 'input'], ['set', '#col-set', 'change'], ['type', '#col-type', 'change'], ['domain', '#col-domain', 'change'], ['sort', '#col-sort', 'change']]) {
  $(sel).addEventListener(ev, (e) => { col[key] = e.target.value; renderCollection(); });
}
$('#col-owned').addEventListener('change', (e) => { col.owned = e.target.checked; renderCollection(); });

const COL_PAGE = 120;
let colLimit = COL_PAGE;

function renderCollection(keepLimit = false) {
  if (!keepLimit) colLimit = COL_PAGE;
  const q = col.q.trim().toLowerCase();
  let list = cards.filter((c) =>
    (!col.owned || store.owned(c.id) > 0) &&
    (!col.set || c.set === col.set) &&
    (!col.type || c.type === col.type) &&
    (!col.domain || c.domain.includes(col.domain)) &&
    (!q || `${c.name} ${c.tags.join(' ')} ${c.text} ${cardCode(c)}`.toLowerCase().includes(q)));
  const sorters = {
    set: (a, b) => 0,
    name: (a, b) => a.name.localeCompare(b.name),
    qty: (a, b) => store.owned(b.id) - store.owned(a.id),
    energy: (a, b) => (a.energy ?? 99) - (b.energy ?? 99) || a.name.localeCompare(b.name),
  };
  list = [...list].sort(sorters[col.sort]);

  const copies = list.reduce((a, c) => a + store.owned(c.id), 0);
  $('#col-summary').textContent = col.owned
    ? `${list.length} cartas distintas · ${copies} copias`
    : `${list.length} cartas · tienes ${list.filter((c) => store.owned(c.id)).length}`;

  const grid = $('#col-grid');
  grid.replaceChildren(...list.slice(0, colLimit).map((c) => {
    const e = store.collection[c.id];
    const n = e ? e.n + e.f : 0;
    return el('div', { class: `tile ${n ? '' : 'dim'}` },
      el('button', { class: 'tile-img', onclick: () => openCard(c) }, cardImg(c), n > 0 && el('span', { class: 'badge', text: `×${n}` }), e?.f > 0 && el('span', { class: 'badge foil', text: `${e.f} foil` })),
      el('div', { class: 'tile-info' },
        el('span', { class: 'tile-name', text: c.name }),
        el('div', { class: 'tile-qty' },
          el('button', { class: 'icon-btn small', onclick: () => { store.add(c.id, -1, !e?.n && e?.f > 0); renderCollection(true); }, disabled: !n }, '−'),
          el('span', { class: 'muted small', text: cardCode(c) }),
          el('button', { class: 'icon-btn small', onclick: () => { store.add(c.id, 1); renderCollection(true); } }, '+'),
        ),
      ),
    );
  }));
  if (list.length > colLimit) {
    grid.append(el('button', { class: 'btn ghost more', onclick: () => { colLimit += COL_PAGE; renderCollection(true); } }, `Mostrar más (${list.length - colLimit})`));
  }
  if (!list.length) {
    grid.append(el('p', { class: 'muted', text: col.owned && !store.totalOwned() ? 'Tu colección está vacía. Ve a Escanear para empezar.' : 'No hay cartas con estos filtros.' }));
  }
}

$('#btn-export-csv').addEventListener('click', () => {
  const rows = [['set', 'codigo', 'nombre', 'tipo', 'rareza', 'normales', 'foil']];
  for (const c of cards) {
    const e = store.collection[c.id];
    if (e) rows.push([c.set, cardCode(c), c.name, c.type, c.rarity, e.n, e.f]);
  }
  const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  download('coleccion-riftbound.csv', '﻿' + csv, 'text/csv');
});
$('#btn-export-json').addEventListener('click', () => {
  download(`riftbound-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(store.exportData(), null, 1), 'application/json');
});
$('#import-json').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const merge = store.totalOwned() > 0 && confirm('¿Sumar la copia a tu colección actual?\n\nAceptar = sumar · Cancelar = reemplazar');
    store.importData(data, merge ? 'merge' : 'replace');
    toast('Copia importada');
    renderCollection();
  } catch (err) {
    toast(err.message);
  } finally {
    e.target.value = '';
  }
});

// ---------- Mazos ----------

initDecks({ cards, byId, openCard });
