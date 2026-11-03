// Intercambios con amigos, en su propia vista (#intercambios) dentro de Colección: las listas de lo
// que ofreces y lo que buscas. Las listas viven solo en la nube (hace falta cuenta para cambiar con
// nadie): se leen al iniciar sesión, aquí se guarda una copia en memoria y cada cambio se sube poco
// después.

import { $, el, toast, cardImg, cardCode, baseName } from './ui.js';
import { store } from './store.js';
import { cloud, onCloudChange, fetchTradeLists, setTradeListItems } from './cloud.js';
import { unitPrice, eur } from './prices.js';

const WRITE_DELAY = 500;
const PICK_LIMIT = 40;
const KEEP_COPIES = 3; // «Ofrecer repetidas»: las que pasan de lo que cabe en un mazo
const LABEL = { offer: 'Ofrezco', want: 'Busco' };

let ctx;
let listsOwner = null; // el usuario cuyas listas están cargadas
let listsState = 'off'; // off · loading · ready · error
let signedIn = false;
const lists = { offer: new Map(), want: new Map() }; // "id|foil" → copias
const pendingWrites = new Map(); // "lista|id|foil" → temporizador
let fichaOpen = false; // el desplegable de la ficha se queda abierto al repintarla

const keyOf = (id, foil) => `${id}|${foil ? 1 : 0}`;
const parseKey = (key) => { const [id, f] = key.split('|'); return { id, foil: f === '1' }; };
const qtyOf = (list, id, foil) => lists[list].get(keyOf(id, foil)) ?? 0;
const ownedOf = (id, foil) => store.collection[id]?.[foil ? 'f' : 'n'] ?? 0;

async function loadLists(owner) {
  listsOwner = owner;
  listsState = 'loading';
  try {
    const { offer, want } = await fetchTradeLists();
    if (listsOwner !== owner) return;
    for (const [name, rows] of [['offer', offer], ['want', want]]) {
      lists[name] = new Map(rows.map((r) => [keyOf(r.card_id, r.foil), r.quantity]));
    }
    listsState = 'ready';
  } catch (err) {
    console.error(err);
    if (listsOwner === owner) listsState = 'error';
  }
  refresh();
}

function setQty(list, id, foil, qty) {
  const key = keyOf(id, foil);
  if (qty > 0) lists[list].set(key, qty);
  else lists[list].delete(key);
  const write = `${list}|${key}`;
  clearTimeout(pendingWrites.get(write));
  pendingWrites.set(write, setTimeout(() => {
    pendingWrites.delete(write);
    setTradeListItems(list, [{ card_id: id, foil, quantity: lists[list].get(key) ?? 0 }]).catch(writeFailed);
  }, WRITE_DELAY));
  refresh();
}

function writeFailed(err) {
  console.error(err);
  toast(`No se pudo guardar la lista: ${err.message}`, 4000);
  if (listsOwner) loadLists(listsOwner);
}

function refresh() {
  if ($('#view-trades').classList.contains('active')) renderTrades();
}

// ---------- En la ficha de la carta ----------

function fichaRow(label, n, max, change) {
  return el('div', { class: 'qty-row' },
    el('span', { class: 'grow', text: label }),
    el('button', { class: 'icon-btn', onclick: () => change(n - 1), disabled: n === 0 }, '−'),
    el('span', { class: 'qty', text: n }),
    el('button', { class: 'icon-btn', onclick: () => change(n + 1), disabled: n >= max }, '+'));
}

/** Desplegable de la ficha para ofrecer o buscar esta carta. Solo con sesión. */
export function tradeBlock(card, rerender) {
  if (!cloud.username || listsState !== 'ready') return null;
  const row = (list, foil, label, max) => fichaRow(label, qtyOf(list, card.id, foil), max, (n) => { setQty(list, card.id, foil, n); rerender(); });
  const offered = qtyOf('offer', card.id, false) + qtyOf('offer', card.id, true);
  const wanted = qtyOf('want', card.id, false) + qtyOf('want', card.id, true);
  const sub = [offered && `ofreces ${offered}`, wanted && `buscas ${wanted}`].filter(Boolean).join(' · ');
  return el('details', { class: 'trade-box', open: fichaOpen, ontoggle: (e) => { fichaOpen = e.target.open; } },
    el('summary', { text: sub ? `Intercambio: ${sub}` : 'Intercambio' }),
    row('offer', false, 'Ofrezco normales', ownedOf(card.id, false)),
    row('offer', true, 'Ofrezco foil', ownedOf(card.id, true)),
    row('want', false, 'Busco (me vale cualquiera)', 99),
    row('want', true, 'Busco solo foil', 99));
}

// ---------- Elegir cartas ----------

/**
 * Hoja para añadir cartas de una en una: un buscador y, en cada carta, un botón por acabado.
 * options(card) → [{ label, foil, disabled }]. onPick(card, foil) puede llamarse varias veces.
 */
function pickCards({ title, hint, pool, options, onPick }) {
  const dlg = $('#picker-dialog');
  let q = '';
  const list = el('ul', { class: 'history-list' });
  const draw = () => {
    const text = q.trim().toLowerCase();
    const found = pool().filter((c) => !text || `${c.name} ${cardCode(c)}`.toLowerCase().includes(text));
    list.replaceChildren(...found.slice(0, PICK_LIMIT).map((c) => el('li', { class: 'history-row trade-row' },
      cardImg(c, 'thumb small'),
      el('div', { class: 'grow' },
        el('strong', { text: c.name }),
        el('span', { class: 'muted small', text: [cardCode(c), store.owned(c.id) ? `tienes ${store.owned(c.id)}` : null, unitPrice(c.id) != null ? eur(unitPrice(c.id)) : null].filter(Boolean).join(' · ') })),
      el('div', { class: 'trade-pick' }, options(c).map((o) => el('button', {
        class: 'btn ghost small',
        disabled: o.disabled,
        onclick: () => { onPick(c, o.foil); draw(); },
      }, o.label))))));
    if (!found.length) list.append(el('li', { class: 'empty', text: 'No hay cartas con ese nombre.' }));
    else if (found.length > PICK_LIMIT) list.append(el('li', { class: 'muted small trade-more', text: `Y ${found.length - PICK_LIMIT} más: escribe para afinar.` }));
  };
  dlg.replaceChildren(...[
    el('div', { class: 'dialog-head' },
      el('h2', { text: title }),
      el('button', { class: 'icon-btn', title: 'Cerrar', 'aria-label': 'Cerrar', onclick: () => dlg.close() }, '✕')),
    hint && el('p', { class: 'muted small', text: hint }),
    el('input', { type: 'search', class: 'trade-search', placeholder: 'Buscar carta o código…', oninput: (e) => { q = e.target.value; draw(); } }),
    list,
  ].filter(Boolean));
  draw();
  if (!dlg.open) dlg.showModal();
}

const byName = (a, b) => baseName(a).localeCompare(baseName(b), 'es', { sensitivity: 'base' }) || a.id.localeCompare(b.id);

function addOffer() {
  pickCards({
    title: 'Añadir a «Ofrezco»',
    hint: 'De las cartas de tu colección.',
    pool: () => ctx.cards.filter((c) => store.owned(c.id) > 0).sort(byName),
    options: (c) => [false, true].filter((foil) => ownedOf(c.id, foil) > 0).map((foil) => {
      const n = qtyOf('offer', c.id, foil);
      return { foil, label: `+ ${foil ? 'Foil' : 'Normal'}${n ? ` (${n})` : ''}`, disabled: n >= ownedOf(c.id, foil) };
    }),
    onPick: (c, foil) => setQty('offer', c.id, foil, qtyOf('offer', c.id, foil) + 1),
  });
}

function addWant() {
  pickCards({
    title: 'Añadir a «Busco»',
    pool: () => [...ctx.cards].sort(byName),
    options: (c) => [false, true].map((foil) => {
      const n = qtyOf('want', c.id, foil);
      return { foil, label: `+ ${foil ? 'Solo foil' : 'Busco'}${n ? ` (${n})` : ''}`, disabled: n >= 99 };
    }),
    onPick: (c, foil) => setQty('want', c.id, foil, qtyOf('want', c.id, foil) + 1),
  });
}

/** Copias de más de cada carta: primero las normales. Las runas no cuentan (un mazo lleva muchas). */
function surplus() {
  const out = [];
  for (const [id, e] of Object.entries(store.collection)) {
    const card = ctx.byId.get(id);
    if (!card || card.type === 'Rune') continue;
    const extra = e.n + e.f - KEEP_COPIES;
    if (extra <= 0) continue;
    const n = Math.min(e.n, extra, 99);
    const f = Math.min(extra - n, 99);
    if (n > qtyOf('offer', id, false)) out.push({ id, foil: false, quantity: n });
    if (f > qtyOf('offer', id, true)) out.push({ id, foil: true, quantity: f });
  }
  return out;
}

async function offerSurplus(btn) {
  const items = surplus();
  if (!items.length) return toast(`No tienes más de ${KEEP_COPIES} copias de ninguna carta (sin contar runas), o ya las ofreces.`, 3500);
  const copies = items.reduce((a, i) => a + i.quantity, 0);
  if (!confirm(`¿Añadir a «Ofrezco» ${copies} copia${copies === 1 ? '' : 's'} de ${new Set(items.map((i) => i.id)).size} carta(s)? Son las que pasan de ${KEEP_COPIES}, sin contar runas.`)) return;
  btn.disabled = true;
  try {
    await setTradeListItems('offer', items.map((i) => ({ card_id: i.id, foil: i.foil, quantity: i.quantity })));
    for (const i of items) lists.offer.set(keyOf(i.id, i.foil), i.quantity);
    toast('Repetidas añadidas a «Ofrezco»');
    refresh();
  } catch (err) {
    writeFailed(err);
    btn.disabled = false;
  }
}

// ---------- Vista ----------

function listRow(list, key, qty) {
  const { id, foil } = parseKey(key);
  const card = ctx.byId.get(id);
  if (!card) return null;
  const img = cardImg(card, 'thumb small');
  img.addEventListener('click', () => ctx.openCard(card));
  const have = ownedOf(id, foil);
  const price = unitPrice(id, foil);
  return el('li', { class: 'history-row trade-row' },
    img,
    el('div', { class: 'grow' },
      el('strong', { text: card.name }),
      el('span', { class: 'muted small', text: [cardCode(card), foil && (list === 'want' ? 'solo foil' : 'foil'), price != null && eur(price)].filter(Boolean).join(' · ') }),
      list === 'offer' && qty > have && el('span', { class: 'warn small', text: have ? `Solo tienes ${have}` : 'Ya no la tienes' })),
    el('div', { class: 'tile-qty' },
      el('button', { class: 'icon-btn small', title: 'Una menos', onclick: () => setQty(list, id, foil, qty - 1) }, '−'),
      el('span', { class: 'qty', text: qty }),
      el('button', { class: 'icon-btn small', title: 'Una más', disabled: list === 'offer' ? qty >= have : qty >= 99, onclick: () => setQty(list, id, foil, qty + 1) }, '+')));
}

function listSection(list, empty, ...buttons) {
  const nameOf = (key) => ctx.byId.get(parseKey(key).id)?.name ?? '';
  const rows = [...lists[list].entries()].sort(([a], [b]) => nameOf(a).localeCompare(nameOf(b), 'es'));
  const copies = rows.reduce((a, [, n]) => a + n, 0);
  return [
    el('div', { class: 'section-head' },
      el('h2', {}, LABEL[list], copies > 0 && el('span', { class: 'muted', text: ` (${copies})` })),
      el('div', { class: 'actions' }, buttons)),
    rows.length
      ? el('ul', { class: 'history-list' }, rows.map(([key, n]) => listRow(list, key, n)))
      : el('p', { class: 'muted small', text: empty }),
  ];
}

export function renderTrades() {
  const root = $('#trades-view');
  if (!cloud.username) {
    return root.replaceChildren(el('div', { class: 'profile-empty' },
      el('p', { text: 'Los intercambios son entre amigos y necesitan una cuenta.' }),
      el('button', { class: 'btn primary small', onclick: () => $('#btn-account').click() }, 'Entrar o crear cuenta')));
  }
  if (listsState === 'error') {
    return root.replaceChildren(el('div', { class: 'profile-empty' },
      el('p', { text: 'No se han podido cargar tus listas.' }),
      el('button', { class: 'btn ghost small', onclick: () => loadLists(listsOwner) }, 'Reintentar')));
  }
  if (listsState !== 'ready') return root.replaceChildren(el('div', { class: 'profile-empty' }, el('p', { class: 'muted', text: 'Cargando…' })));
  root.replaceChildren(
    el('p', { class: 'muted small trade-intro', text: 'Tus amigos ven lo que ofreces y lo que buscas. Añadir una carta aquí no la quita de tu colección.' }),
    ...listSection('offer', 'Aún no ofreces ninguna carta.',
      el('button', { class: 'btn ghost small', onclick: (e) => offerSurplus(e.currentTarget) }, 'Ofrecer repetidas'),
      el('button', { class: 'btn primary small', onclick: addOffer }, 'Añadir')),
    ...listSection('want', 'Aún no buscas ninguna carta.',
      el('button', { class: 'btn primary small', onclick: addWant }, 'Añadir')),
  );
}

export function initTrades(context) {
  ctx = context;
  store.onChange((what) => what === 'collection' && refresh());
  onCloudChange(() => {
    const owner = cloud.profile?.username ?? null;
    if (owner && owner !== listsOwner) loadLists(owner);
    if (!cloud.username && listsOwner) {
      listsOwner = null;
      listsState = 'off';
      lists.offer.clear();
      lists.want.clear();
    }
    if (signedIn !== !!cloud.username) {
      signedIn = !!cloud.username;
      refresh();
    }
  });
}
