import { Recognizer } from './recognizer.js';
import { Scanner } from './scanner.js';
import { store } from './store.js';
import { initDecks } from './decks.js';
import { exportCsv, exportExcel, readableText } from './export.js';
import { initImport } from './import-ui.js';
import { initAccount } from './account-ui.js';
import { initMatches } from './matches.js';
import { loadPrices, pricesDate, priceInfo, unitPrice, entryValue, eur, usd, VALUABLE_EUR } from './prices.js';
import { $, el, toast, cardImg, cardCode, baseName, download, matchesType, DOMAIN_ES, TYPE_ES, RARITY_ES } from './ui.js';

const [cards] = await Promise.all([fetch('data/cards.json').then((r) => r.json()), loadPrices()]);
const byId = new Map(cards.map((c) => [c.id, c]));
const sets = [...new Map(cards.map((c) => [c.set, c.setName])).entries()];

// ---------- Navegación ----------

// La pestaña va en la dirección (#coleccion, #mazos…) para que al recargar se quede en la misma.
const VIEW_HASH = { scan: '', collection: 'coleccion', decks: 'mazos', matches: 'partidas' };

function showView(name) {
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
  document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  history.replaceState(null, '', VIEW_HASH[name] ? `#${VIEW_HASH[name]}` : location.pathname + location.search);
  if (name !== 'scan' && scanner.running) stopCamera();
  if (name === 'collection') renderCollection();
  window.scrollTo(0, 0);
}
document.querySelectorAll('.tabbar button').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));

function collectionValue() {
  let v = 0;
  for (const [id, e] of Object.entries(store.collection)) v += entryValue(id, e);
  return v;
}

function updateOwnedCount() {
  const total = store.totalOwned();
  const value = collectionValue();
  $('#owned-count').textContent = `${total} carta${total === 1 ? '' : 's'}${value ? ` · ${eur(value)}` : ''}`;
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

/**
 * Versión mucho más cara con la misma ilustración (p. ej. la Showcase firmada "*"): la cámara no
 * las distingue, así que conviene avisar para que se mire la carta.
 */
function pricierTwin(card) {
  if (!recognizer.meta) return null;
  const base = unitPrice(card.id) ?? 0;
  let best = null;
  for (const id of recognizer.sameArt(card.id)) {
    const p = unitPrice(id);
    if (id !== card.id && p >= VALUABLE_EUR && p > base * 3 && (!best || p > best.price)) best = { card: byId.get(id), price: p };
  }
  return best;
}

function priceBlock(card) {
  const p = priceInfo(card.id);
  const twin = pricierTwin(card);
  if (!p && !twin) return null;
  const trend = p?.eur7d ? ` (${p.eur7d > 0 ? '▲' : '▼'} ${eur(Math.abs(p.eur7d))} en 7 días)` : '';
  return el('div', { class: 'price-block' },
    p && el('p', {},
      el('strong', { text: 'Cardmarket: ' }),
      p.foilOnly ? `${eur(p.eurFoil ?? p.eur)} (solo existe en foil)` : `normal ${eur(p.eur)} · foil ${eur(p.eurFoil)}${trend}`),
    p && (p.usd || p.usdFoil) && el('p', { class: 'muted small', text: `TCGplayer: normal ${usd(p.usd)} · foil ${usd(p.usdFoil)}` }),
    twin && el('p', { class: 'warn small', text: `💰 Hay una versión con la misma ilustración que vale ${eur(twin.price)}: ${twin.card.name} (${cardCode(twin.card)}${twin.card.id.includes('*') ? ', firmada' : ''}). Mira si la tuya es esa.` }),
    el('p', { class: 'muted small' },
      el('a', {
        href: card.cardmarket
          ? `https://www.cardmarket.com/en/Riftbound/Products/Singles/${card.cardmarket}`
          : `https://www.cardmarket.com/en/Riftbound/Products/Search?searchString=${encodeURIComponent(baseName(card))}`,
        target: '_blank', rel: 'noopener',
      }, card.cardmarket ? 'Ver en Cardmarket' : 'Buscar en Cardmarket'),
      pricesDate() && ` · precios del ${new Date(pricesDate()).toLocaleDateString('es-ES')}`),
  );
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
          card.errata && el('p', { class: 'errata-note', text: '⚠ Errata: el texto oficial vigente difiere del impreso en la carta.' }),
          card.text && el('p', { class: 'card-text', text: readableText(card.text) }),
          card.printedText && el('details', { class: 'printed' }, el('summary', { text: 'Texto impreso (antiguo)' }), el('p', { class: 'card-text muted', text: readableText(card.printedText) })),
          (card.effect || card.mightBonus != null) && el('p', { class: 'card-text', text: `Unidad equipada: ${[readableText(card.effect), card.mightBonus != null ? `${card.mightBonus >= 0 ? '+' : ''}${card.mightBonus} Might` : ''].filter(Boolean).join(' · ')}` }),
          priceBlock(card),
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
// Cartas añadidas en esta sesión, la última primero: { card, n: copias normales, f: copias foil }.
// Volver a escanear una carta suma en su fila en vez de repetirla.
const session = [];
let lastAdd = null; // { entry, foil } de la última copia añadida, para poder corregirla

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

/** Suma una copia a la colección y a su fila de la sesión (que pasa arriba). */
function addCopy(card, foil) {
  store.add(card.id, 1, foil);
  let entry = session.find((e) => e.card.id === card.id);
  if (entry) session.splice(session.indexOf(entry), 1);
  else entry = { card, n: 0, f: 0 };
  entry[foil ? 'f' : 'n']++;
  session.unshift(entry);
  lastAdd = { entry, foil };
  return entry;
}

/** Quita una copia (normal o foil) de la colección y de su fila; con 0 copias la fila desaparece. */
function removeCopy(entry, foil) {
  const k = foil ? 'f' : 'n';
  if (!entry[k]) return;
  store.add(entry.card.id, -1, foil);
  entry[k]--;
  if (!entry.n && !entry.f) {
    session.splice(session.indexOf(entry), 1);
    if (lastAdd?.entry === entry) lastAdd = null;
  }
}

function addScanned(card) {
  const foil = $('#opt-foil').checked;
  addCopy(card, foil);
  feedback();
  renderRecent();
  const price = unitPrice(card.id, foil);
  const twin = pricierTwin(card);
  if (price >= VALUABLE_EUR) toast(`💰 ¡Carta valiosa! ${card.name}: ${eur(price)}`, 4500);
  else if (twin) toast(`💰 Mira bien esta carta: la versión ${cardCode(twin.card)} vale ${eur(twin.price)}`, 5000);
  else if (card.errata) toast(`⚠ ${card.name} tiene errata: su texto oficial ha cambiado`, 3500);
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
        if (state === 'locked' && lastAdd && scanner.locked === lastAdd.entry.card.id && r.id !== lastAdd.entry.card.id) replaceLast(r.card);
        else addScanned(r.card);
        scanner.markAdded(r.id);
      },
    }, cardImg(r.card), el('span', { class: 'cand-name', text: r.card.name }), el('span', { class: 'muted small', text: `${cardCode(r.card)} · ${Math.round(r.score * 100)}%` })))),
  );
}

function replaceLast(card) {
  const { entry, foil } = lastAdd;
  removeCopy(entry, foil);
  addCopy(card, foil);
  feedback();
  renderRecent();
  toast(`Corregido: ${card.name}`);
}

/** Cambia todas las copias de una fila a otra versión de la carta (misma ilustración u otra edición). */
function switchVariant(entry, v) {
  for (const foil of [false, true]) {
    const k = foil ? 'f' : 'n';
    store.add(entry.card.id, -entry[k], foil);
    store.add(v.id, entry[k], foil);
  }
  const other = session.find((e) => e !== entry && e.card.id === v.id);
  if (other) { // ya había una fila de esa versión: se juntan
    other.n += entry.n;
    other.f += entry.f;
    session.splice(session.indexOf(entry), 1);
    if (lastAdd?.entry === entry) lastAdd.entry = other;
    return other;
  }
  entry.card = v;
  return entry;
}

function versionSelect(entry, onChange) {
  const variants = variantsOf(entry.card);
  return variants.length > 1 && el('select', {
    class: 'small',
    onchange: (e) => onChange(switchVariant(entry, byId.get(e.target.value))),
  }, variants.map((v) => el('option', { value: v.id, selected: v.id === entry.card.id, text: `${cardCode(v)} · ${v.setName}${v.rarity === 'Showcase' ? ' (showcase)' : ''}` })));
}

/** Insignia foil: solo el número, en plateado. */
function foilBadge(n) {
  return n > 0 && el('span', { class: 'badge foil', title: `${n} foil`, 'aria-label': `${n} foil` }, n);
}

/** Hoja de una carta escaneada: normales y foil de esta sesión (como en la colección), versión y quitar. */
function openScanned(entry) {
  const dlg = $('#card-dialog');
  const refresh = () => { render(); renderRecent(); };
  const render = () => {
    if (!session.includes(entry)) return dlg.close();
    const { card } = entry;
    const price = unitPrice(card.id, entry.f > 0 && !entry.n);
    dlg.replaceChildren(
      el('div', { class: 'dialog-head' }, el('h2', { text: card.name }), el('button', { class: 'icon-btn', title: 'Cerrar', onclick: () => dlg.close() }, '✕')),
      el('div', { class: 'scan-sheet' },
        el('div', { class: 'scan-sheet-img' }, cardImg(card), foilBadge(entry.f)),
        el('div', { class: 'grow' },
          el('p', { class: 'muted', text: `${cardCode(card)} · tienes ${store.owned(card.id)} en tu colección` }),
          price != null && el('p', { class: price >= VALUABLE_EUR ? 'price-hot' : 'muted', text: eur(price) }),
          versionSelect(entry, (e) => { entry = e; refresh(); }),
          qtyRow('Normales', entry.n, (d) => { d > 0 ? addCopy(card, false) : removeCopy(entry, false); refresh(); }),
          qtyRow('Foil', entry.f, (d) => { d > 0 ? addCopy(card, true) : removeCopy(entry, true); refresh(); }),
          el('div', { class: 'actions' },
            el('button', { class: 'btn ghost small', onclick: () => { dlg.close(); openCard(card); } }, 'Ficha completa'),
            el('button', {
              class: 'btn danger small',
              onclick: () => {
                while (entry.n) removeCopy(entry, false);
                while (entry.f) removeCopy(entry, true);
                renderRecent();
                dlg.close();
                toast(`Quitada: ${card.name}`);
              },
            }, 'Quitar'),
          ),
        ),
      ),
    );
  };
  render();
  if (!dlg.open) dlg.showModal();
}

function renderRecent() {
  const copies = session.reduce((a, e) => a + e.n + e.f, 0);
  $('#session-count').textContent = copies ? `(${copies})` : '';
  const list = $('#recent');
  if (!session.length) {
    list.replaceChildren(el('li', { class: 'empty' }, 'Las cartas que escanees aparecerán aquí.'));
    return;
  }
  list.replaceChildren(...session.slice(0, 60).map((entry) => {
    const { card } = entry;
    const foilOnly = entry.f > 0 && !entry.n;
    const price = unitPrice(card.id, foilOnly);
    // El + suma del mismo tipo que la última copia de esta fila; el − quita primero ese tipo.
    const lastFoil = lastAdd?.entry === entry ? lastAdd.foil : foilOnly;
    const minus = () => removeCopy(entry, entry[lastFoil ? 'f' : 'n'] ? lastFoil : !lastFoil);
    return el('li', {},
      el('button', { class: 'tile-img', title: `Editar ${card.name}`, onclick: () => openScanned(entry) }, cardImg(card, 'thumb small'), foilBadge(entry.f)),
      el('div', { class: 'grow' },
        el('button', { class: 'link', onclick: () => openScanned(entry) }, el('strong', { text: card.name })),
        el('div', { class: 'muted small', text: `${cardCode(card)}${card.errata ? ' · ⚠ Errata' : ''} · tienes ${store.owned(card.id)}` }),
        price != null && el('div', { class: `small ${price >= VALUABLE_EUR ? 'price-hot' : 'muted'}`, text: eur(price) }),
        versionSelect(entry, () => renderRecent()),
      ),
      el('div', { class: 'tile-qty' },
        el('button', { class: 'icon-btn small', title: 'Quitar una copia', onclick: () => { minus(); renderRecent(); } }, '−'),
        el('span', { class: 'qty', text: entry.n + entry.f }),
        el('button', { class: 'icon-btn small', title: 'Añadir una copia', onclick: () => { addCopy(card, lastFoil); renderRecent(); } }, '+'),
      ),
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

const col = { q: '', set: '', type: '', domain: '', owned: true, errata: false, sort: 'set' };
$('#col-set').append(...sets.map(([id, name]) => el('option', { value: id, text: `${name} (${id})` })));
// En el orden de TYPE_ES ("Campeón" justo después de "Unidad"); los tipos desconocidos, al final.
const present = new Set([...cards.map((c) => c.type), 'Champion']);
const types = [...Object.keys(TYPE_ES).filter((t) => present.has(t)), ...[...present].filter((t) => !(t in TYPE_ES))];
$('#col-type').append(...types.map((t) => el('option', { value: t, text: TYPE_ES[t] || t })));
$('#col-domain').append(...Object.entries(DOMAIN_ES).map(([d, es]) => el('option', { value: d, text: es })));
for (const [key, sel, ev] of [['q', '#col-search', 'input'], ['set', '#col-set', 'change'], ['type', '#col-type', 'change'], ['domain', '#col-domain', 'change'], ['sort', '#col-sort', 'change']]) {
  $(sel).addEventListener(ev, (e) => { col[key] = e.target.value; renderCollection(); });
}
$('#col-owned').addEventListener('change', (e) => { col.owned = e.target.checked; renderCollection(); });
$('#col-errata').addEventListener('change', (e) => { col.errata = e.target.checked; renderCollection(); });

const COL_PAGE = 120;
let colLimit = COL_PAGE;

function renderCollection(keepLimit = false) {
  if (!keepLimit) colLimit = COL_PAGE;
  const q = col.q.trim().toLowerCase();
  let list = cards.filter((c) =>
    (!col.owned || store.owned(c.id) > 0) &&
    (!col.errata || c.errata) &&
    (!col.set || c.set === col.set) &&
    matchesType(c, col.type) &&
    (!col.domain || c.domain.includes(col.domain)) &&
    (!q || `${c.name} ${c.tags.join(' ')} ${c.text} ${cardCode(c)}`.toLowerCase().includes(q)));
  const sorters = {
    set: (a, b) => 0,
    name: (a, b) => a.name.localeCompare(b.name),
    qty: (a, b) => store.owned(b.id) - store.owned(a.id),
    energy: (a, b) => (a.energy ?? 99) - (b.energy ?? 99) || a.name.localeCompare(b.name),
    price: (a, b) => (unitPrice(b.id) ?? -1) - (unitPrice(a.id) ?? -1),
    value: (a, b) => entryValue(b.id, store.collection[b.id]) - entryValue(a.id, store.collection[a.id]) || (unitPrice(b.id) ?? -1) - (unitPrice(a.id) ?? -1),
  };
  list = [...list].sort(sorters[col.sort]);

  const copies = list.reduce((a, c) => a + store.owned(c.id), 0);
  const value = list.reduce((a, c) => a + entryValue(c.id, store.collection[c.id]), 0);
  $('#col-summary').textContent = (col.owned
    ? `${list.length} cartas distintas · ${copies} copias`
    : `${list.length} cartas · tienes ${list.filter((c) => store.owned(c.id)).length}`) + (value ? ` · valor ≈ ${eur(value)}` : '');

  const grid = $('#col-grid');
  grid.replaceChildren(...list.slice(0, colLimit).map((c) => {
    const e = store.collection[c.id];
    const n = e ? e.n + e.f : 0;
    return el('div', { class: `tile ${n ? '' : 'dim'}` },
      el('button', { class: 'tile-img', onclick: () => openCard(c) }, cardImg(c), n > 0 && el('span', { class: 'badge', text: `×${n}` }), foilBadge(e?.f), c.errata && el('span', { class: 'badge errata', title: 'Tiene errata', text: 'Errata' })),
      el('div', { class: 'tile-info' },
        el('span', { class: 'tile-name', title: c.name, text: c.name }),
        el('span', { class: 'tile-code muted small', text: cardCode(c) }),
        el('span', { class: `tile-price small ${unitPrice(c.id) >= VALUABLE_EUR ? 'price-hot' : 'muted'}`, text: unitPrice(c.id) != null ? eur(unitPrice(c.id)) : ' ' }),
        el('div', { class: 'tile-qty' },
          el('button', { class: 'icon-btn small', title: 'Quitar una', onclick: () => { store.add(c.id, -1, !e?.n && e?.f > 0); renderCollection(true); }, disabled: !n }, '−'),
          el('span', { class: 'qty', text: n }),
          el('button', { class: 'icon-btn small', title: 'Añadir una', onclick: () => { store.add(c.id, 1); renderCollection(true); } }, '+'),
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

$('#btn-export-excel').addEventListener('click', async (e) => {
  if (!store.totalOwned()) return toast('Tu colección está vacía.');
  e.target.disabled = true;
  try {
    await exportExcel(cards, store.collection);
  } catch (err) {
    toast(err.message);
  } finally {
    e.target.disabled = false;
  }
});
$('#btn-export-csv').addEventListener('click', () => {
  if (!store.totalOwned()) return toast('Tu colección está vacía.');
  exportCsv(cards, store.collection);
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
initImport({ cards, byId, openCard });
initMatches({ cards, byId, openCard });
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
const startView = Object.keys(VIEW_HASH).find((v) => VIEW_HASH[v] && `#${VIEW_HASH[v]}` === location.hash);
if (startView) showView(startView);
