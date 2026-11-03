// Intercambios con amigos, en su propia vista (#intercambios) dentro de Colección: las listas de lo
// que ofreces y lo que buscas, y la propuesta a un amigo (desde su perfil). Las listas viven solo en
// la nube (hace falta cuenta para cambiar con nadie): se leen al iniciar sesión, aquí se guarda una
// copia en memoria y cada cambio se sube poco después.

import { $, el, toast, cardImg, cardCode, baseName } from './ui.js';
import { store } from './store.js';
import { cloud, onCloudChange, fetchTradeLists, setTradeListItems, proposeTrade } from './cloud.js';
import { unitPrice, eur } from './prices.js';

const WRITE_DELAY = 500;
const PICK_LIMIT = 40;
const KEEP_COPIES = 3; // «Ofrecer repetidas»: las que pasan de lo que cabe en un mazo
const LABEL = { offer: 'Ofrezco', want: 'Busco' };

let ctx;
let listsOwner = null; // el usuario cuyas listas están cargadas
let listsState = 'off'; // off · loading · ready · error
let listsLoaded = Promise.resolve(); // termina cuando se han leído las listas
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
 * tag(card), opcional: un dato que resaltar en la carta (lo que ofrece o busca un amigo).
 */
function pickCards({ title, hint, pool, options, onPick, tag = () => null }) {
  const dlg = $('#picker-dialog');
  let q = '';
  const list = el('ul', { class: 'history-list' });
  const cards = pool();
  const draw = () => {
    const text = q.trim().toLowerCase();
    const found = cards.filter((c) => !text || `${c.name} ${cardCode(c)}`.toLowerCase().includes(text));
    list.replaceChildren(...found.slice(0, PICK_LIMIT).map((c) => el('li', { class: 'history-row trade-row' },
      cardImg(c, 'thumb small'),
      el('div', { class: 'grow' },
        el('strong', { text: c.name }),
        el('span', { class: 'muted small', text: [cardCode(c), store.owned(c.id) ? `tienes ${store.owned(c.id)}` : null, unitPrice(c.id) != null ? eur(unitPrice(c.id)) : null].filter(Boolean).join(' · ') }),
        tag(c) && el('span', { class: 'trade-tag small', text: tag(c) })),
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

// ---------- Las listas de un amigo ----------

const FRIEND_CACHE = 60_000;
const friendCache = new Map(); // id → { at, lists: promesa de { offer: Map, want: Map } }
const toMap = (rows) => new Map(rows.map((r) => [keyOf(r.card_id, r.foil), r.quantity]));

function friendLists(id) {
  const hit = friendCache.get(id);
  if (hit && Date.now() - hit.at < FRIEND_CACHE) return hit.lists;
  const promise = fetchTradeLists(id).then(({ offer, want }) => ({ offer: toMap(offer), want: toMap(want) }));
  promise.catch(() => friendCache.delete(id));
  friendCache.set(id, { at: Date.now(), lists: promise });
  return promise;
}

/** Ids de las cartas que encajan: alguien las ofrece y otro las busca (quien busca foil, solo foil). */
function matching(offer, want) {
  const ids = new Set();
  for (const key of want.keys()) {
    const { id, foil } = parseKey(key);
    if (offer.has(keyOf(id, true)) || (!foil && offer.has(keyOf(id, false)))) ids.add(id);
  }
  return ids;
}

const shownName = (p) => p.display_name || p.username;

/** Recuadro del perfil de un amigo: qué encaja entre vuestras listas y el botón de proponer. */
export function tradeBox(friend) {
  const text = el('p', { class: 'muted small' });
  Promise.all([friendLists(friend.id), listsLoaded]).then(([theirs]) => {
    const have = matching(theirs.offer, lists.want).size;
    const want = matching(lists.offer, theirs.want).size;
    text.textContent = have || want
      ? `Tiene ${have} carta${have === 1 ? '' : 's'} que buscas · busca ${want} que ofreces`
      : 'Vuestras listas de Ofrezco y Busco aún no coinciden.';
  }, (err) => console.error(err));
  return el('div', { class: 'trade-friend' },
    text,
    el('button', { class: 'btn primary small', onclick: () => openProposal(friend) }, 'Proponer intercambio'));
}

// ---------- Proponer ----------

let draft = null; // { other, give: Map, take: Map, message, counterOf, theirs, sending }

const proposalDialog = () => $('#trade-dialog');

/** Valor de un lado de la propuesta en Cardmarket; null si no se sabe el precio de ninguna carta. */
function sideValue(side) {
  let total = null;
  for (const [key, n] of side) {
    const { id, foil } = parseKey(key);
    const price = unitPrice(id, foil);
    if (price != null) total = (total ?? 0) + price * n;
  }
  return total;
}

function changeDraft(side, id, foil, n) {
  const key = keyOf(id, foil);
  if (n > 0) draft[side].set(key, n);
  else draft[side].delete(key);
  drawProposal();
}

const giveMax = (id, foil) => Math.min(ownedOf(id, foil), 99);

function draftRow(side, key, n) {
  const { id, foil } = parseKey(key);
  const card = ctx.byId.get(id);
  if (!card) return null;
  const img = cardImg(card, 'thumb small');
  img.addEventListener('click', () => ctx.openCard(card));
  const price = unitPrice(id, foil);
  const max = side === 'give' ? giveMax(id, foil) : 99;
  return el('li', { class: 'history-row trade-row' },
    img,
    el('div', { class: 'grow' },
      el('strong', { text: card.name }),
      el('span', { class: 'muted small', text: [cardCode(card), foil && 'foil', price != null && eur(price)].filter(Boolean).join(' · ') }),
      side === 'give' && n > max && el('span', { class: 'warn small', text: max ? `Solo tienes ${max}` : 'No la tienes' })),
    el('div', { class: 'tile-qty' },
      el('button', { class: 'icon-btn small', title: 'Una menos', onclick: () => changeDraft(side, id, foil, n - 1) }, '−'),
      el('span', { class: 'qty', text: n }),
      el('button', { class: 'icon-btn small', title: 'Una más', disabled: n >= max, onclick: () => changeDraft(side, id, foil, n + 1) }, '+')));
}

function pickGive() {
  const theirWant = draft.theirs?.want ?? new Map();
  const wanted = matching(lists.offer, theirWant);
  const asked = (id) => theirWant.has(keyOf(id, false)) || theirWant.has(keyOf(id, true));
  const offered = (id) => lists.offer.has(keyOf(id, false)) || lists.offer.has(keyOf(id, true));
  const score = (id) => (wanted.has(id) ? 0 : asked(id) ? 1 : offered(id) ? 2 : 3);
  pickCards({
    title: 'Doy',
    hint: 'De tu colección. Primero lo que busca y lo que ofreces.',
    pool: () => ctx.cards.filter((c) => store.owned(c.id) > 0).sort((a, b) => score(a.id) - score(b.id) || byName(a, b)),
    tag: (c) => (asked(c.id) ? 'La busca' : null),
    options: (c) => [false, true].filter((foil) => ownedOf(c.id, foil) > 0).map((foil) => {
      const n = draft.give.get(keyOf(c.id, foil)) ?? 0;
      return { foil, label: `+ ${foil ? 'Foil' : 'Normal'}${n ? ` (${n})` : ''}`, disabled: n >= giveMax(c.id, foil) };
    }),
    onPick: (c, foil) => changeDraft('give', c.id, foil, (draft.give.get(keyOf(c.id, foil)) ?? 0) + 1),
  });
}

function pickTake() {
  const theirOffer = draft.theirs?.offer ?? new Map();
  const wanted = matching(theirOffer, lists.want);
  const offers = (id) => (theirOffer.get(keyOf(id, false)) ?? 0) + (theirOffer.get(keyOf(id, true)) ?? 0);
  const score = (id) => (wanted.has(id) ? 0 : offers(id) ? 1 : 2);
  pickCards({
    title: 'Pido',
    hint: 'Primero lo que ofrece y buscas. Puedes pedir cualquier carta, aunque no la ofrezca.',
    pool: () => [...ctx.cards].sort((a, b) => score(a.id) - score(b.id) || byName(a, b)),
    tag: (c) => (offers(c.id) ? `Ofrece ${offers(c.id)}` : null),
    options: (c) => [false, true].map((foil) => {
      const n = draft.take.get(keyOf(c.id, foil)) ?? 0;
      return { foil, label: `+ ${foil ? 'Foil' : 'Normal'}${n ? ` (${n})` : ''}`, disabled: n >= 99 };
    }),
    onPick: (c, foil) => changeDraft('take', c.id, foil, (draft.take.get(keyOf(c.id, foil)) ?? 0) + 1),
  });
}

function draftSection(side, title, empty, pick) {
  const rows = [...draft[side].entries()];
  const value = sideValue(draft[side]);
  return [
    el('div', { class: 'section-head trade-side' },
      el('h3', {}, title, value != null && el('span', { class: 'muted', text: ` ≈ ${eur(value)}` })),
      el('button', { class: 'btn ghost small', onclick: pick }, 'Añadir')),
    rows.length
      ? el('ul', { class: 'history-list' }, rows.map(([key, n]) => draftRow(side, key, n)))
      : el('p', { class: 'muted small', text: empty }),
  ];
}

async function sendProposal() {
  const d = draft;
  const items = [
    ...[...d.give].map(([key, quantity]) => ({ mine: true, card_id: parseKey(key).id, foil: parseKey(key).foil, quantity })),
    ...[...d.take].map(([key, quantity]) => ({ mine: false, card_id: parseKey(key).id, foil: parseKey(key).foil, quantity })),
  ];
  d.sending = true;
  drawProposal();
  try {
    await proposeTrade({ receiver: d.other.id, items, message: d.message, counterOf: d.counterOf });
    draft = null;
    proposalDialog().close();
    toast(`Propuesta enviada a ${shownName(d.other)}`);
    refresh();
  } catch (err) {
    console.error(err);
    d.sending = false;
    drawProposal();
    toast(err.message, 4000);
  }
}

function drawProposal() {
  const d = draft;
  const dlg = proposalDialog();
  const name = shownName(d.other);
  const over = [...d.give].some(([key, n]) => { const { id, foil } = parseKey(key); return n > giveMax(id, foil); });
  const empty = !d.give.size && !d.take.size;
  dlg.replaceChildren(...[
    el('div', { class: 'dialog-head' },
      el('h2', { text: d.counterOf ? `Contraoferta a ${name}` : `Intercambio con ${name}` }),
      el('button', { class: 'icon-btn', title: 'Cerrar', 'aria-label': 'Cerrar', onclick: () => dlg.close() }, '✕')),
    ...draftSection('give', 'Doy', d.take.size ? 'Nada: le pides sin dar nada a cambio.' : 'Nada todavía.', pickGive),
    ...draftSection('take', 'Pido', d.give.size ? 'Nada: se lo regalas.' : 'Nada todavía.', pickTake),
    el('label', { class: 'match-field trade-message' },
      el('span', { text: 'Mensaje (opcional)' }),
      el('textarea', { rows: 2, maxlength: 500, oninput: (e) => { d.message = e.target.value; } }, d.message)),
    over && el('p', { class: 'warn small', text: 'Das más copias de las que tienes.' }),
    el('div', { class: 'actions' },
      el('button', { class: 'btn primary', disabled: empty || over || d.sending, onclick: sendProposal }, d.sending ? 'Enviando…' : 'Enviar propuesta'),
      el('button', { class: 'btn ghost', onclick: () => { draft = null; dlg.close(); } }, 'Descartar')),
  ].filter(Boolean));
}

/**
 * Abre la propuesta a un amigo. Si se cerró sin enviar y es para el mismo, sigue donde estaba.
 * Con `start` ({ give, take, counterOf, message }) empieza desde ahí (contraoferta).
 */
export function openProposal(other, start = null) {
  if (start || draft?.other.id !== other.id) {
    draft = { other, give: new Map(start?.give), take: new Map(start?.take), message: start?.message ?? '', counterOf: start?.counterOf ?? null, theirs: null, sending: false };
  }
  const d = draft;
  friendLists(other.id).then((theirs) => { d.theirs = theirs; }, (err) => console.error(err));
  drawProposal();
  if (!proposalDialog().open) proposalDialog().showModal();
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
    if (owner && owner !== listsOwner) listsLoaded = loadLists(owner);
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
