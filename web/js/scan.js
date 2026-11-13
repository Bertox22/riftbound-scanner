// Escáner: la cámara, las candidatas, las cartas de esta sesión (con su hoja) y reconocer una foto.

import { Scanner } from './scanner.js';
import { store } from './store.js';
import { banInfo } from './bans.js';
import { unitPrice, eur, VALUABLE_EUR } from './prices.js';
import { openCard, variantsOf, pricierTwin } from './cardsheet.js';
import { $, el, toast, cardImg, cardCode, qtyRow, foilBadge } from './ui.js';

let byId, recognizer, scanner;
let modelReady; // promesa: el modelo del escáner cargado
let torch = false;

/** ¿Está la cámara encendida? */
export const scanning = () => !!scanner?.running;
/** Se cumple cuando el modelo está cargado (falla si no se pudo). */
export const modelLoaded = () => modelReady;

const status = (msg) => ($('#cam-status').textContent = msg);
// Cartas añadidas en esta sesión, la última primero: { card, n: copias normales, f: copias foil }.
// Volver a escanear una carta suma en su fila en vez de repetirla.
const session = [];
let lastAdd = null; // { entry, foil } de la última copia añadida, para poder corregirla

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
  store.add(entry.card.id, -1, foil, 'escáner');
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
  else if (banInfo(card)) toast(`⛔ ${card.name}: ${banInfo(card).text.replace(/^⛔ /, '').replace(/^B/, 'b')}`, 4000);
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

export function renderRecent() {
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
        el('div', { class: 'muted small', text: `${cardCode(card)}${banInfo(card) ? ` · ⛔ ${banInfo(card).label}` : ''}${card.errata ? ' · ⚠ Errata' : ''} · tienes ${store.owned(card.id)}` }),
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

export function stopCamera() {
  scanner.stop();
  $('#cam').classList.remove('live');
  $('#cam').dataset.state = '';
  $('#btn-stop').hidden = true;
  $('#btn-torch').hidden = true;
  $('#candidates').replaceChildren();
  status('Cámara parada.');
}

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

export function initScan(ctx) {
  ({ byId, recognizer } = ctx);
  scanner = new Scanner({
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

  renderRecent();

  $('#btn-clear-session').addEventListener('click', () => {
    session.length = 0; // solo vacía la lista; las cartas siguen en la colección
    renderRecent();
  });

  modelReady = recognizer.load((p) => status(`Descargando modelo… ${Math.round(p * 100)}%`))
    .then(() => status('Listo. Activa la cámara.'))
    .catch((err) => {
      console.error(err);
      status(`No se pudo cargar el modelo: ${err.message}`);
      throw err;
    });
  modelReady.catch(() => {}); // el error ya se muestra; startCamera lo vuelve a ver

  $('#btn-start').addEventListener('click', startCamera);
  $('#btn-stop').addEventListener('click', stopCamera);
  $('#btn-torch').addEventListener('click', async () => {
    torch = !torch;
    await scanner.setTorch(torch).catch(() => toast('La linterna no está disponible'));
  });
  document.addEventListener('visibilitychange', () => document.hidden && scanner.running && stopCamera());

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
}
