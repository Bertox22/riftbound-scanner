import { Recognizer } from './recognizer.js';
import { Scanner } from './scanner.js';
import { store } from './store.js';
import { initDecks } from './decks.js';
import { exportCsv, exportExcel, readableText } from './export.js';
import { initImport } from './import-ui.js';
import { initAccount } from './account-ui.js';
import { initMatches } from './matches.js';
import { initProfile, routeProfile } from './profile.js';
import { initTable } from './table.js';
import { initTrades, showTrades, tradeBlock, wantButton } from './trades.js';
import { initLedger } from './ledger.js';
import { importBackup } from './backup.js';
import { loadHistory, cardSeries, collectionSeries, rangeStart, movers, lineChart, dayText, changeText, pctText } from './pricehistory.js';
import { initBack } from './back.js';
import { banInfo } from './bans.js';
import { cloud, fetchRemovedCards } from './cloud.js';
import { loadPrices, pricesDate, priceInfo, unitPrice, entryValue, eur, usd, VALUABLE_EUR } from './prices.js';
import { $, el, toast, cardImg, cardCode, baseName, download, matchesType, DOMAIN_ES, TYPE_ES, RARITY_ES } from './ui.js';

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
  if (name !== 'scan' && scanner.running) stopCamera();
  if (name === 'collection') renderCollection();
  if (name === 'trades') showTrades();
  window.scrollTo(0, 0);
}
document.querySelectorAll('.tabbar button, .col-tabs button').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));

function collectionValue() {
  let v = 0;
  for (const [id, e] of Object.entries(store.collection)) v += entryValue(id, e);
  return v;
}

function updateOwnedCount() {
  const total = store.totalOwned();
  const value = collectionValue();
  // En el móvil la palabra «cartas» se oculta (CSS) para que el valor se vea entero: «364 · 97,48 €».
  const word = ` carta${total === 1 ? '' : 's'}`;
  const pill = $('#owned-count');
  pill.replaceChildren(String(total), el('span', { class: 'pill-word', text: word }), ...(value ? [` · ${eur(value)}`] : []));
  pill.title = `${total}${word}${value ? ` · valor ≈ ${eur(value)}` : ''} · ver resumen`;
}
store.onChange((what) => {
  if (what !== 'collection') return;
  updateOwnedCount();
  if (summaryOpen()) openSummary();
});
updateOwnedCount();

// ---------- Resumen de la colección (al pulsar el contador de arriba) ----------

const summaryOpen = () => $('#picker-dialog').open && $('#picker-dialog').dataset.view === 'summary';

function collectionSummary() {
  const s = { normal: 0, foil: 0, distinct: 0, valueNormal: 0, valueFoil: 0, unpriced: 0 };
  for (const [id, e] of Object.entries(store.collection)) {
    if (e.n + e.f === 0) continue;
    s.distinct++;
    s.normal += e.n;
    s.foil += e.f;
    const pn = unitPrice(id, false), pf = unitPrice(id, true);
    s.valueNormal += (pn ?? 0) * e.n;
    s.valueFoil += (pf ?? 0) * e.f;
    if ((e.n && pn == null) || (e.f && pf == null)) s.unpriced++;
  }
  return s;
}

function openSummary() {
  const dlg = $('#picker-dialog');
  const s = collectionSummary();
  const total = s.normal + s.foil;
  const value = s.valueNormal + s.valueFoil;
  const plural = (n, one, many) => `${n.toLocaleString('es-ES')} ${n === 1 ? one : many}`;
  const cell = (label, big, sub) => el('div', { class: 'ov-cell' },
    el('span', { class: 'ov-label', text: label }),
    el('strong', { text: big }),
    sub && el('span', { class: 'ov-sub', text: sub }));
  const go = (fn) => () => { dlg.close(); fn(); };

  dlg.dataset.view = 'summary';
  dlg.replaceChildren(...[
    el('div', { class: 'dialog-head' },
      el('h2', { text: 'Tu colección' }),
      el('button', { class: 'icon-btn', title: 'Cerrar', 'aria-label': 'Cerrar', onclick: () => dlg.close() }, '✕')),
    el('div', { class: 'summary-lead' },
      el('span', { class: 'ov-label', text: 'Valor aproximado' }),
      el('strong', { text: eur(value) }),
      el('span', { class: 'ov-sub', text: [
        plural(total, 'carta', 'cartas'),
        pricesDate() && `precios de Cardmarket del ${new Date(pricesDate()).toLocaleDateString('es-ES')}`,
      ].filter(Boolean).join(' · ') })),
    el('div', { class: 'ov-strip summary-strip' },
      cell('Cartas', total.toLocaleString('es-ES'), plural(s.distinct, 'distinta', 'distintas')),
      cell('Foil', s.foil.toLocaleString('es-ES'), total ? `${Math.round((100 * s.foil) / total)} % del total` : null),
      cell('Valor normales', eur(s.valueNormal), plural(s.normal, 'copia', 'copias')),
      cell('Valor foil', eur(s.valueFoil), plural(s.foil, 'copia', 'copias'))),
    s.unpriced > 0 && el('p', { class: 'muted small', text: `${plural(s.unpriced, 'carta no tiene', 'cartas no tienen')} precio y no ${s.unpriced === 1 ? 'cuenta' : 'cuentan'} en el valor.` }),
    el('div', { class: 'actions summary-actions' },
      el('button', { class: 'btn primary small', onclick: go(() => showView('collection')) }, 'Ver mis cartas'),
      el('button', { class: 'btn ghost small', onclick: () => { delete dlg.dataset.view; openValue(); } }, 'Evolución del valor'),
      el('button', { class: 'btn ghost small', onclick: () => { delete dlg.dataset.view; openSets(); } }, 'Progreso por set')),
  ].filter(Boolean));
  if (!dlg.open) dlg.showModal();
}

$('#owned-count').addEventListener('click', openSummary);
$('#picker-dialog').addEventListener('close', (e) => delete e.currentTarget.dataset.view);

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
    p && priceChart(card),
  );
}

/** En la ficha: cómo ha ido el precio normal en Cardmarket (se rellena al llegar el historial). */
function priceChart(card) {
  const box = el('div', { class: 'card-chart' });
  loadHistory().then((h) => {
    const s = h && cardSeries(h, card.id);
    if (!s || s.length < 2) return;
    const start = rangeStart(h, 30);
    const label = el('span', { class: 'muted small' });
    const idle = () => { label.textContent = `${start > 0 ? '30 días' : `Desde el ${dayText(h.dates[0])}`}: ${changeText(s[start], s.at(-1))}`; };
    idle();
    box.replaceChildren(
      el('div', { class: 'card-chart-head' }, el('strong', { class: 'small', text: priceInfo(card.id)?.foilOnly ? 'Precio (solo foil)' : 'Precio normal' }), label),
      lineChart(h.dates, s, { height: 56, onPoint: (i) => (i == null ? idle() : (label.textContent = `${dayText(h.dates[i])} · ${eur(s[i])}`)) }));
  });
  return box;
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
          banInfo(card) && el('p', { class: 'ban-note', text: banInfo(card).text }),
          card.errata && el('p', { class: 'errata-note', text: '⚠ Errata: el texto oficial vigente difiere del impreso en la carta.' }),
          card.text && el('p', { class: 'card-text', text: readableText(card.text) }),
          card.printedText && el('details', { class: 'printed' }, el('summary', { text: 'Texto impreso (antiguo)' }), el('p', { class: 'card-text muted', text: readableText(card.printedText) })),
          (card.effect || card.mightBonus != null) && el('p', { class: 'card-text', text: `Unidad equipada: ${[readableText(card.effect), card.mightBonus != null ? `${card.mightBonus >= 0 ? '+' : ''}${card.mightBonus} Might` : ''].filter(Boolean).join(' · ')}` }),
          priceBlock(card),
          qtyRow('Normales', e.n, (d) => { store.add(card.id, d, false, 'ficha'); render(); }),
          qtyRow('Foil', e.f, (d) => { store.add(card.id, d, true, 'ficha'); render(); }),
          tradeBlock(card, render),
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

/** Insignia foil: solo el número, en plateado. */
function banBadge(card) {
  const b = banInfo(card);
  return b && el('span', { class: `badge banned${card.errata ? ' below' : ''}`, title: b.text.replace(/^⛔ /, ''), text: b.label });
}

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

const col = { q: '', set: '', type: '', domain: '', rarity: '', owned: true, errata: false, banned: false, sort: 'set' };
$('#col-set').append(...sets.map(([id, name]) => el('option', { value: id, text: `${name} (${id})` })));
// En el orden de TYPE_ES ("Campeón" justo después de "Unidad"); los tipos desconocidos, al final.
const present = new Set([...cards.map((c) => c.type), 'Champion']);
const types = [...Object.keys(TYPE_ES).filter((t) => present.has(t)), ...[...present].filter((t) => !(t in TYPE_ES))];
$('#col-type').append(...types.map((t) => el('option', { value: t, text: TYPE_ES[t] || t })));
$('#col-domain').append(...Object.entries(DOMAIN_ES).map(([d, es]) => el('option', { value: d, text: es })));
const rarities = new Set(cards.map((c) => c.rarity));
$('#col-rarity').append(...[...Object.keys(RARITY_ES).filter((r) => rarities.has(r)), ...[...rarities].filter((r) => !(r in RARITY_ES))]
  .map((r) => el('option', { value: r, text: RARITY_ES[r] || r })));
for (const [key, sel, ev] of [['q', '#col-search', 'input'], ['set', '#col-set', 'change'], ['type', '#col-type', 'change'], ['domain', '#col-domain', 'change'], ['rarity', '#col-rarity', 'change'], ['sort', '#col-sort', 'change']]) {
  $(sel).addEventListener(ev, (e) => { col[key] = e.target.value; renderCollection(); });
}
$('#col-owned').addEventListener('change', (e) => { col.owned = e.target.checked; renderCollection(); });
$('#col-errata').addEventListener('change', (e) => { col.errata = e.target.checked; renderCollection(); });
$('#col-banned').addEventListener('change', (e) => { col.banned = e.target.checked; renderCollection(); });

// ---------- Filtros en el móvil ----------
// En pantallas estrechas los filtros no caben en una fila: van en una hoja que se abre con «Filtros (n)»
// y los activos se ven bajo el buscador como etiquetas que se quitan con la ✕. La hoja usa los mismos
// controles (se mueven dentro al abrirla y vuelven al cerrarla), así que no hay nada que sincronizar.
const FILTER_DEFAULTS = { set: '', type: '', domain: '', rarity: '', owned: true, errata: false, banned: false };
const FILTER_CONTROLS = { set: '#col-set', type: '#col-type', domain: '#col-domain', rarity: '#col-rarity', owned: '#col-owned', errata: '#col-errata', banned: '#col-banned' };
let colCount = 0; // cartas que salen con los filtros de ahora (para el botón de la hoja)

/** [clave, texto] de cada filtro que no está como al principio. El orden no cuenta: no quita cartas. */
function activeFilters() {
  const out = ['set', 'type', 'domain', 'rarity'].filter((k) => col[k]).map((k) => [k, $(FILTER_CONTROLS[k]).selectedOptions[0]?.text ?? col[k]]);
  if (!col.owned) out.push(['owned', 'Todas las cartas']);
  if (col.errata) out.push(['errata', 'Con errata']);
  if (col.banned) out.push(['banned', 'Baneadas']);
  return out;
}

function setFilter(key, value) {
  col[key] = value;
  const ctl = $(FILTER_CONTROLS[key]);
  if (ctl.type === 'checkbox') ctl.checked = value;
  else ctl.value = value;
}

function clearFilters() {
  for (const [k, v] of Object.entries(FILTER_DEFAULTS)) setFilter(k, v);
  renderCollection();
}

function renderFilterBar() {
  const active = activeFilters();
  const badge = $('#col-filters-btn .filters-count');
  badge.hidden = !active.length;
  badge.textContent = active.length;
  $('#col-filters-btn').setAttribute('aria-label', active.length ? `Filtros: ${active.length} activos` : 'Filtros');
  $('#col-chips').replaceChildren(...active.map(([key, label]) => el('button', {
    class: 'filter-chip', type: 'button', title: `Quitar «${label}»`, 'aria-label': `Quitar el filtro ${label}`,
    onclick: () => { setFilter(key, FILTER_DEFAULTS[key]); renderCollection(); },
  }, label, el('span', { class: 'x', 'aria-hidden': 'true', text: '✕' }))));
  const dlg = $('#filters-dialog');
  if (!dlg.open) return;
  dlg.querySelector('.filters-apply').textContent = colCount === 1 ? 'Ver 1 carta' : `Ver ${colCount} cartas`;
  dlg.querySelector('.filters-clear').hidden = !active.length;
}

function openFilters() {
  const dlg = $('#filters-dialog');
  dlg.replaceChildren(
    el('div', { class: 'dialog-head' },
      el('h2', { id: 'filters-title', text: 'Filtros' }),
      el('button', { class: 'link filters-clear', type: 'button', onclick: clearFilters }, 'Quitar todos')),
    $('#col-filter-panel'),
    el('button', { class: 'btn primary filters-apply', type: 'button', onclick: () => dlg.close() }),
  );
  dlg.showModal();
  renderFilterBar();
}
$('#col-filters-btn').addEventListener('click', openFilters);
// Al cerrar, los controles vuelven a su sitio (en el ordenador se ven en la página).
$('#filters-dialog').addEventListener('close', () => $('#view-collection .filters').append($('#col-filter-panel')));
// Si la ventana se ensancha con la hoja abierta, se cierra: ya caben en la página.
matchMedia('(min-width: 640px)').addEventListener('change', (e) => { if (e.matches && $('#filters-dialog').open) $('#filters-dialog').close(); });

const COL_PAGE = 120;
let colLimit = COL_PAGE;
// Cartas que se acaban de quitar del todo con "−": siguen en la cuadrícula (en gris) aunque esté
// "Solo las que tengo", para que no desaparezcan bajo el dedo. Se olvidan al cambiar el filtro.
const justEmptied = new Set();

/** "−" en la cuadrícula: quita una copia (la normal antes que la foil) y deja deshacerlo. */
function removeFromGrid(c, e) {
  const foil = !e?.n && e?.f > 0;
  store.add(c.id, -1, foil, 'colección');
  if (!store.owned(c.id)) justEmptied.add(c.id);
  renderCollection(true);
  toast(store.owned(c.id) ? `Quitada una copia de ${c.name}` : `Quitada: ${c.name}`, 5000, {
    label: 'Deshacer',
    onclick: () => {
      const entry = store.history.find((h) => h.id === c.id && h.foil === foil && !h.undone);
      if (entry) store.undoRemoval(entry, 1); // solo la copia de este "−"
      else store.add(c.id, 1, foil);
      renderCollection(true);
    },
  });
}

// ---------- Historial de cartas quitadas ----------

const relTime = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });
function ago(t) {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'ahora mismo';
  if (s < 3600) return relTime.format(-Math.round(s / 60), 'minute');
  if (s < 86400) return relTime.format(-Math.round(s / 3600), 'hour');
  if (s < 7 * 86400) return relTime.format(-Math.round(s / 86400), 'day');
  return new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', year: 'numeric' }).format(t);
}

let removedInCloud = null; // null: sin mirar · [] · [{ id, at }]

function historyRow(card, sub, action) {
  const img = cardImg(card, 'thumb small');
  img.addEventListener('click', () => openCard(card));
  return el('li', { class: `history-row${action ? '' : ' undone'}` },
    img,
    el('div', { class: 'grow' },
      el('strong', { text: card.name }),
      el('span', { class: 'muted small', text: sub })),
    action || el('span', { class: 'history-done', text: 'Recuperada ✓' }));
}

function openHistory() {
  const dlg = $('#picker-dialog');
  const draw = () => {
    const local = store.history.filter((h) => byId.has(h.id));
    // En la nube, las que quedaron a 0 y no están ya en el historial de aquí ni en la colección.
    const known = new Set(local.map((h) => h.id));
    const cloudOnly = (removedInCloud ?? []).filter((r) => byId.has(r.id) && !known.has(r.id) && !store.owned(r.id));
    dlg.replaceChildren(...[
      el('div', { class: 'dialog-head' },
        el('h2', { text: 'Cartas quitadas' }),
        el('button', { class: 'icon-btn', title: 'Cerrar', 'aria-label': 'Cerrar', onclick: () => dlg.close() }, '✕')),
      local.length
        ? el('ul', { class: 'history-list' }, ...local.map((h) => {
          const card = byId.get(h.id);
          return historyRow(card, `${h.n}×${h.foil ? ' foil' : ''} · ${cardCode(card)} · ${ago(h.at)} · desde ${h.from}`,
            !h.undone && el('button', { class: 'btn ghost small', onclick: () => { store.undoRemoval(h); toast(`${card.name} vuelve a tu colección`); draw(); } }, 'Deshacer'));
        }))
        : el('p', { class: 'muted small', text: 'Aún no has quitado ninguna carta en este dispositivo.' }),
      cloud.username && el('h3', { class: 'stats-title', text: 'Quitadas del todo (según la nube)' }),
      cloud.username && el('p', { class: 'muted small', text: 'Cartas de las que te quedaste sin copias, también en otros dispositivos o antes de que existiera el historial. No se sabe cuántas tenías: «Recuperar» añade una.' }),
      cloud.username && (removedInCloud == null
        ? el('p', { class: 'muted small', text: 'Mirando en la nube…' })
        : cloudOnly.length
          ? el('ul', { class: 'history-list' }, ...cloudOnly.map((r) => {
            const card = byId.get(r.id);
            return historyRow(card, `${cardCode(card)} · ${ago(r.at)}`,
              el('button', { class: 'btn ghost small', onclick: () => { store.add(r.id, 1); toast(`${card.name} vuelve a tu colección`); draw(); } }, 'Recuperar'));
          }))
          : el('p', { class: 'muted small', text: 'Ninguna.' })),
    ].filter(Boolean));
  };
  removedInCloud = null;
  draw();
  dlg.showModal();
  if (cloud.username) {
    fetchRemovedCards().then((rows) => { removedInCloud = rows; }, () => { removedInCloud = []; }).then(() => dlg.open && draw());
  }
}
$('#btn-col-history').addEventListener('click', openHistory);

// ---------- Progreso por set ----------

// Set base = las cartas numeradas del 1 al total impreso ("sfd-001-221" … "sfd-221-221"); las
// variantes ("007a"), las que pasan del total, las runas y los tokens cuentan solo "con variantes".
// Los sets de promos no tienen base: solo "tienes X de Y".
const setInfo = sets.map(([id, name]) => {
  const all = cards.filter((c) => c.set === id);
  const promo = all.every((c) => c.rarity === 'Promo');
  const totals = new Map();
  for (const c of all) { const t = c.id.split('-').at(-1); totals.set(t, (totals.get(t) ?? 0) + 1); }
  const total = [...totals].sort((a, b) => b[1] - a[1])[0][0];
  const re = new RegExp(`^[a-z]+-(\\d+)-${total}$`);
  const base = promo ? [] : all.filter((c) => { const m = re.exec(c.id); return m && +m[1] <= +total; });
  return { id, name, all, base: base.length ? base : null };
}).sort((a, b) => !a.base - !b.base); // los de promos, al final

const SET_PAGE = 60;
const pct = (have, of) => `${Math.floor((100 * have) / of)} %`;
const missingOf = (list) => list.filter((c) => !store.owned(c.id))
  .sort((a, b) => (unitPrice(b.id) ?? -1) - (unitPrice(a.id) ?? -1));
const costOf = (list) => list.reduce((a, c) => a + (unitPrice(c.id) ?? 0), 0);
const haveOf = (list) => list.filter((c) => store.owned(c.id)).length;

function progressBar(have, of) {
  return el('div', { class: 'rate-bar' }, el('span', { style: `width:${(100 * have) / of}%` }));
}

function openSets(start = null) {
  const dlg = $('#picker-dialog');
  let open = start; // null: la lista de sets · { set, variants, limit }
  const close = el('button', { class: 'icon-btn', title: 'Cerrar', 'aria-label': 'Cerrar', onclick: () => dlg.close() }, '✕');

  const listView = () => [
    el('div', { class: 'dialog-head' }, el('h2', { text: 'Progreso por set' }), close),
    el('p', { class: 'muted small', text: 'Cuenta las cartas numeradas del set (del 1 al total), con al menos una copia normal o foil. Las variantes y showcase van aparte.' }),
    el('ul', { class: 'set-list' }, ...setInfo.map((s) => {
      const main = s.base ?? s.all;
      const have = haveOf(main);
      return el('li', {},
        el('button', { class: 'set-row', onclick: () => { open = { set: s, variants: !s.base, limit: SET_PAGE }; draw(); } },
          el('div', { class: 'set-row-head' },
            el('strong', { text: s.name }),
            el('span', { class: 'set-count', text: s.base ? `${have}/${main.length} · ${pct(have, main.length)}` : `${have}/${main.length}` })),
          s.base && progressBar(have, main.length),
          el('span', { class: 'muted small', text: s.base ? `Con variantes y showcase: ${haveOf(s.all)}/${s.all.length}` : 'Promos: sin set base' })));
    })),
  ];

  const detailView = () => {
    const { set: s, variants } = open;
    const list = variants || !s.base ? s.all : s.base;
    const missing = missingOf(list);
    const have = list.length - missing.length;
    const cost = costOf(missing);
    return [
      el('div', { class: 'dialog-head' },
        el('button', { class: 'icon-btn', title: 'Volver', 'aria-label': 'Volver', onclick: () => { open = null; draw(); } }, '‹'),
        el('h2', { class: 'grow', text: s.name }), close),
      el('p', { class: 'set-big', text: `${have}/${list.length} · ${pct(have, list.length)}` }),
      progressBar(have, list.length),
      s.base && el('div', { class: 'segmented set-scope' },
        el('button', { 'aria-checked': String(!variants), onclick: () => { open = { ...open, variants: false, limit: SET_PAGE }; draw(); } }, `Set base (${s.base.length})`),
        el('button', { 'aria-checked': String(variants), onclick: () => { open = { ...open, variants: true, limit: SET_PAGE }; draw(); } }, `Con variantes (${s.all.length})`)),
      el('p', { text: missing.length
        ? `Te faltan ${missing.length} carta${missing.length === 1 ? '' : 's'}${cost ? ` · ≈ ${eur(cost)} en Cardmarket` : ''}`
        : '✓ Lo tienes completo.' }),
      el('div', { class: 'actions' },
        el('button', { class: 'btn ghost small', onclick: () => showSetInCollection(s.id) }, 'Ver en la colección'),
        wantButton(missing.map((c) => [c.id, 1]), 'btn primary small')),
      missing.length > 0 && el('ul', { class: 'history-list' }, ...missing.slice(0, open.limit).map((c) =>
        historyRow(c, [cardCode(c), RARITY_ES[c.rarity] || c.rarity, unitPrice(c.id) != null && eur(unitPrice(c.id))].filter(Boolean).join(' · '),
          el('span')))),
      missing.length > open.limit && el('button', { class: 'btn ghost small more', onclick: () => { open.limit += SET_PAGE; draw(); } }, `Mostrar más (${missing.length - open.limit})`),
    ];
  };

  const draw = () => dlg.replaceChildren(...(open ? detailView() : listView()).filter(Boolean));
  draw();
  if (!dlg.open) dlg.showModal();
}

function showSetInCollection(id) {
  Object.assign(col, { set: id, owned: false });
  $('#col-set').value = id;
  $('#col-owned').checked = false;
  $('#picker-dialog').close();
  renderCollection();
  $('#col-grid').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

$('#btn-col-sets').addEventListener('click', () => openSets());

// ---------- Valor de la colección ----------

const VALUE_RANGES = [[7, '7 días'], [30, '30 días'], [0, 'Todo']];
let valueRange = 30;

async function openValue() {
  const dlg = $('#picker-dialog');
  const head = el('div', { class: 'dialog-head' },
    el('h2', { text: 'Valor de la colección' }),
    el('button', { class: 'icon-btn', title: 'Cerrar', 'aria-label': 'Cerrar', onclick: () => dlg.close() }, '✕'));
  dlg.replaceChildren(head, el('p', { class: 'muted small', text: 'Cargando el historial de precios…' }));
  if (!dlg.open) dlg.showModal();
  const h = await loadHistory();
  if (!dlg.open) return;
  if (!h) return dlg.replaceChildren(head, el('p', { class: 'muted', text: 'No se pudo cargar el historial de precios (¿sin conexión?).' }));

  const draw = () => {
    const series = collectionSeries(h, store.collection);
    const start = rangeStart(h, valueRange);
    const dates = h.dates.slice(start);
    const values = series.slice(start);
    const now = values.at(-1);
    const diff = now - values[0];
    const point = el('p', { class: 'muted small value-point' });
    const idle = () => { point.textContent = `Desde el ${dayText(dates[0])}`; };
    idle();
    const moves = movers(h, store.collection, start);
    const up = moves.filter((m) => m.diff > 0).sort((a, b) => b.diff - a.diff).slice(0, 5);
    const down = moves.filter((m) => m.diff < 0).sort((a, b) => a.diff - b.diff).slice(0, 5);
    const moverRow = (m) => {
      const card = byId.get(m.id);
      return card && historyRow(card, `${m.copies}×${m.foil ? ' foil' : ''} · ${eur(m.from)} → ${eur(m.to)}${m.pct != null ? ` (${pctText(m.pct)})` : ''}`,
        el('span', { class: `value-diff ${m.diff > 0 ? 'up' : 'down'}`, text: `${m.diff > 0 ? '+' : '−'}${eur(Math.abs(m.diff))}` }));
    };
    dlg.replaceChildren(...[
      head,
      el('p', { class: 'set-big', text: eur(now) }),
      el('p', { class: `value-change ${diff > 0.005 ? 'up' : diff < -0.005 ? 'down' : ''}`, text: values.length > 1 ? changeText(values[0], now) : 'Aún no hay días anteriores' }),
      point,
      el('div', { class: 'segmented cols-3 value-range' }, ...VALUE_RANGES.map(([d, label]) =>
        el('button', { 'aria-checked': String(valueRange === d), onclick: () => { valueRange = d; draw(); } }, label))),
      values.length > 1 && lineChart(dates, values, { onPoint: (i) => (i == null ? idle() : (point.textContent = `${dayText(dates[i])} · ${eur(values[i])}`)) }),
      el('p', { class: 'muted small', text: `Con las cartas que tienes hoy y el precio de Cardmarket de cada día (normal o foil, según la copia). Hay precios desde el ${dayText(h.dates[0])}; los de hace más de 90 días, uno por semana.` }),
      up.length > 0 && el('h3', { class: 'stats-title', text: 'Lo que más sube' }),
      up.length > 0 && el('ul', { class: 'history-list' }, ...up.map(moverRow).filter(Boolean)),
      down.length > 0 && el('h3', { class: 'stats-title', text: 'Lo que más baja' }),
      down.length > 0 && el('ul', { class: 'history-list' }, ...down.map(moverRow).filter(Boolean)),
      !up.length && !down.length && el('p', { class: 'muted small', text: 'Ninguna de tus cartas ha cambiado de precio en este periodo.' }),
    ].filter(Boolean));
  };
  draw();
}
$('#btn-col-value').addEventListener('click', openValue);

function renderCollection(keepLimit = false) {
  if (!keepLimit) { colLimit = COL_PAGE; justEmptied.clear(); }
  const q = col.q.trim().toLowerCase();
  let list = cards.filter((c) =>
    (!col.owned || store.owned(c.id) > 0 || justEmptied.has(c.id)) &&
    (!col.errata || c.errata) &&
    (!col.banned || banInfo(c)) &&
    (!col.set || c.set === col.set) &&
    matchesType(c, col.type) &&
    (!col.domain || c.domain.includes(col.domain)) &&
    (!col.rarity || c.rarity === col.rarity) &&
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

  colCount = list.length;
  renderFilterBar();
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
      el('button', { class: 'tile-img', onclick: () => openCard(c) }, cardImg(c), n > 0 && el('span', { class: 'badge', text: `×${n}` }), foilBadge(e?.f), c.errata && el('span', { class: 'badge errata', title: 'Tiene errata', text: 'Errata' }), banBadge(c)),
      el('div', { class: 'tile-info' },
        el('span', { class: 'tile-name', title: c.name, text: c.name }),
        el('span', { class: 'tile-code muted small', text: cardCode(c) }),
        el('span', { class: `tile-price small ${unitPrice(c.id) >= VALUABLE_EUR ? 'price-hot' : 'muted'}`, text: unitPrice(c.id) != null ? eur(unitPrice(c.id)) : ' ' }),
        el('div', { class: 'tile-qty' },
          el('button', { class: 'icon-btn small', title: 'Quitar una', onclick: () => removeFromGrid(c, e), disabled: !n }, '−'),
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
  e.target.value = ''; // para poder elegir otra vez el mismo archivo
  if (file) await importBackup(file);
});

// ---------- Mazos ----------

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

// Sin conexión: el service worker guarda la app y los datos (ver sw.js). Lleva la misma versión que
// este archivo, así que al publicar con otra ?v= se instala solo el nuevo. En el PC (localhost) solo
// con ?sw en la dirección, para probarlo sin que estorbe al desarrollo.
const APP_VERSION = new URL(import.meta.url).searchParams.get('v') ?? 'dev';

/**
 * Junto a la versión, si la app está lista para usarse sin conexión; al tocarlo, el detalle de lo que
 * hay guardado. Sirve para ver en el móvil qué falta antes de poner el modo avión.
 */
// Miniaturas sin conexión: se guardan según se ven (sw.js, caché rb-sw-thumbs); este botón baja de una
// vez las que faltan, a la misma caché, y el service worker las sirve de ahí.
const THUMBS = 'rb-sw-thumbs';
const THUMB_MB = 31; // todas juntas, más o menos
const thumbUrls = [...new Set(cards.map((c) => c.thumb).filter(Boolean))].map((t) => new URL(t, location.href).href);
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
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkVersion(); });
