// Balance: compras y ventas apuntadas a mano (cajas, sobres, cartas sueltas). Se abre desde Colección.
// Movimiento: { id, at, kind: 'buy' | 'sell', label (producto) | card (id), foil, qty, price (por
// unidad), ownedBefore, inCollection }.
//
// Vender una carta la quita de la colección (y borrar la venta la devuelve). Comprar una carta no la
// añade: avisa hasta que las copias estén en la colección. Para eso se apunta cuántas había al comprar.

import { $, el, toast, cardImg, cardCode, baseName } from './ui.js';
import { store, newUuid } from './store.js';
import { unitPrice, eur } from './prices.js';

const SEARCH_LIMIT = 30;
const MAX_QTY = 999; // los mismos límites que la tabla ledger: pasarse atascaría la sincronización
const MAX_PRICE = 99_999_999.99;

let ctx;

const ownedOf = (id, foil) => store.collection[id]?.[foil ? 'f' : 'n'] ?? 0;
const amountOf = (m) => (m.kind === 'sell' ? 1 : -1) * m.qty * m.price;
const money = (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${eur(Math.abs(v))}`;
const round2 = (v) => Math.round(v * 100) / 100;
const dateText = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', year: 'numeric' });
const balanceDialog = () => $('#balance-dialog');

/** Copias de una carta comprada que aún no están en la colección. */
function missingCopies(m) {
  if (m.kind !== 'buy' || !m.card || m.inCollection) return 0;
  return Math.max(0, Math.min(m.qty, (m.ownedBefore ?? 0) + m.qty - ownedOf(m.card, m.foil)));
}

function saveEntry(m) {
  store.ledger.unshift(m);
  store.ledger.sort((a, b) => b.at - a.at);
  store.saveLedger();
}

function removeEntry(m) {
  const what = m.card ? ctx.byId.get(m.card)?.name ?? m.card : m.label;
  const backToCollection = m.kind === 'sell' && m.card;
  if (!confirm(`¿Borrar este movimiento (${what})?${backToCollection ? ' Las copias vendidas vuelven a tu colección.' : ''}`)) return;
  store.ledger = store.ledger.filter((x) => x.id !== m.id);
  store.saveLedger();
  if (!backToCollection) return;
  // La línea de la venta en el historial queda como recuperada; lo que no esté ahí se suma sin más.
  const line = store.history.find((h) => h.id === m.card && h.foil === m.foil && h.from === 'venta' && !h.undone);
  const undone = line ? Math.min(line.n, m.qty) : 0;
  if (line) store.undoRemoval(line, undone);
  if (m.qty > undone) store.add(m.card, m.qty - undone, m.foil);
}

function entryRow(m) {
  const card = m.card ? ctx.byId.get(m.card) : null;
  const missing = missingCopies(m);
  const title = `${m.qty}× ${card?.name ?? m.label ?? m.card}`;
  const sub = [
    dateText.format(m.at),
    card && cardCode(card),
    m.foil && 'foil',
    m.qty > 1 && `${eur(m.price)}/ud`,
  ].filter(Boolean).join(' · ');
  const thumb = card ? cardImg(card, 'thumb small') : el('div', { class: 'thumb small placeholder ledger-product', 'aria-hidden': 'true' }, '▣');
  if (card) thumb.addEventListener('click', () => ctx.openCard(card));
  return el('li', { class: 'ledger-entry' },
    el('div', { class: 'history-row ledger-row' },
      thumb,
      el('div', { class: 'grow' },
        el('strong', { text: title }),
        el('span', { class: 'muted small', text: `${m.kind === 'sell' ? 'Venta' : 'Compra'} · ${sub}` })),
      el('span', { class: `ledger-amount ${m.kind}`, text: money(amountOf(m)) }),
      el('button', { class: 'icon-btn small', title: 'Borrar', 'aria-label': `Borrar ${title}`, onclick: () => removeEntry(m) }, '✕')),
    missing > 0 && el('div', { class: 'ledger-warn' },
      el('span', { class: 'warn small grow', text: missing === m.qty ? 'No la has incluido en la colección' : `Faltan ${missing} copias por incluir en la colección` }),
      el('button', {
        class: 'btn ghost small',
        onclick: () => {
          m.inCollection = true;
          store.saveLedger();
          store.add(m.card, missing, m.foil);
          toast(`${card?.name ?? 'Carta'} añadida a tu colección`);
        },
      }, 'Añadir'),
      el('button', { class: 'link small', onclick: () => { m.inCollection = true; store.saveLedger(); } }, 'Ocultar')));
}

function drawBalance() {
  const dlg = balanceDialog();
  const bought = store.ledger.filter((m) => m.kind === 'buy').reduce((a, m) => a + m.qty * m.price, 0);
  const sold = store.ledger.filter((m) => m.kind === 'sell').reduce((a, m) => a + m.qty * m.price, 0);
  const total = round2(sold - bought);
  const top = dlg.scrollTop;
  dlg.replaceChildren(
    el('div', { class: 'dialog-head' },
      el('h2', { text: 'Balance' }),
      el('button', { class: 'icon-btn', title: 'Cerrar', 'aria-label': 'Cerrar', onclick: () => dlg.close() }, '✕')),
    el('div', { class: 'stats-big ledger-total' },
      el('strong', { text: money(total) }),
      el('span', { class: 'muted small', text: `Comprado ${eur(bought)} · Vendido ${eur(sold)}` })),
    el('div', { class: 'actions ledger-actions' },
      el('button', { class: 'btn primary small', onclick: () => openForm('buy') }, 'Añadir compra'),
      el('button', { class: 'btn primary small', onclick: () => openForm('sell') }, 'Añadir venta')),
    store.ledger.length
      ? el('ul', { class: 'ledger-list' }, store.ledger.map(entryRow))
      : el('p', { class: 'muted small', text: 'Apunta aquí lo que compras y vendes: cajas, sobres o cartas sueltas. Es solo para llevar la cuenta.' }),
  );
  dlg.scrollTop = top;
}

// ---------- Añadir ----------

function parsePrice(text) {
  const n = Number(text.trim().replace(/\s|€/g, '').replace(',', '.'));
  return text.trim() && Number.isFinite(n) && n >= 0 && n <= MAX_PRICE ? round2(n) : null;
}

/** Hoy → ahora mismo (para que quede el primero); otro día → ese día a mediodía. */
function dateToAt(value) {
  const [y, m, d] = value.split('-').map(Number);
  const at = new Date(y, m - 1, d, 12).getTime();
  return new Date(y, m - 1, d).toDateString() === new Date().toDateString() ? Date.now() : at;
}

const dateValue = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function segmented(options, get, set) {
  const box = el('div', { class: 'segmented', role: 'radiogroup' });
  const draw = () => box.replaceChildren(...options().map(([value, label]) => el('button', {
    type: 'button', role: 'radio', 'aria-checked': String(get() === value),
    onclick: () => { set(value); draw(); },
  }, label)));
  draw();
  return box;
}

const field = (label, ...children) => el('label', { class: 'match-field' }, el('span', { text: label }), ...children);

function openForm(kind) {
  const dlg = $('#picker-dialog');
  const selling = kind === 'sell';
  const f = { what: selling ? 'card' : 'product', card: null, foil: false, q: '' };

  const labels = [...new Set(store.ledger.map((m) => m.label).filter(Boolean))];
  const labelInput = el('input', { placeholder: selling ? 'Caja Radiance sin abrir' : 'Caja Vendetta', maxlength: 120, list: 'ledger-labels', oninput: update });
  const qtyInput = el('input', { inputmode: 'numeric', value: '1', oninput: update });
  const priceInput = el('input', { inputmode: 'decimal', placeholder: '0,00', oninput: update });
  const dateInput = el('input', { type: 'date', value: dateValue(new Date()), max: dateValue(new Date()), oninput: update });
  const searchInput = el('input', { type: 'search', placeholder: 'Buscar carta o código…', oninput: (e) => { f.q = e.target.value; drawCardZone(); } });
  const results = el('ul', { class: 'history-list ledger-results' });
  const cardZone = el('div', { class: 'ledger-card-zone' });
  const productZone = el('div', {}, field('Producto', labelInput, el('datalist', { id: 'ledger-labels' }, labels.map((l) => el('option', { value: l })))));
  const hint = el('p', { class: 'muted small ledger-hint' });
  const totalLine = el('strong', { class: 'ledger-form-total' });
  const saveBtn = el('button', { class: 'btn primary', type: 'button', onclick: save }, selling ? 'Guardar venta' : 'Guardar compra');

  const pool = () => (selling ? ctx.cards.filter((c) => store.owned(c.id) > 0) : ctx.cards);

  function chooseCard(card) {
    f.card = card;
    f.foil = selling ? ownedOf(card.id, false) === 0 : false;
    drawCardZone();
    update();
  }

  function drawCardZone() {
    if (f.card) {
      const c = f.card;
      const finishes = () => [[false, selling ? `Normal (${ownedOf(c.id, false)})` : 'Normal'], [true, selling ? `Foil (${ownedOf(c.id, true)})` : 'Foil']]
        .filter(([foil]) => !selling || ownedOf(c.id, foil) > 0);
      cardZone.replaceChildren(
        el('div', { class: 'history-row' },
          cardImg(c, 'thumb small'),
          el('div', { class: 'grow' },
            el('strong', { text: c.name }),
            el('span', { class: 'muted small', text: `${cardCode(c)} · tienes ${store.owned(c.id)}` })),
          el('button', { class: 'btn ghost small', type: 'button', onclick: () => { f.card = null; drawCardZone(); update(); } }, 'Cambiar')),
        segmented(finishes, () => f.foil, (v) => { f.foil = v; update(); }));
      return;
    }
    const text = f.q.trim().toLowerCase();
    const found = !text && !selling ? [] : pool()
      .filter((c) => !text || `${c.name} ${cardCode(c)}`.toLowerCase().includes(text))
      .sort((a, b) => baseName(a).localeCompare(baseName(b), 'es', { sensitivity: 'base' }));
    results.replaceChildren(...found.slice(0, SEARCH_LIMIT).map((c) => el('li', {},
      el('button', { class: 'history-row ledger-pick', type: 'button', onclick: () => chooseCard(c) },
        cardImg(c, 'thumb small'),
        el('span', { class: 'grow' },
          el('strong', { text: c.name }),
          el('span', { class: 'muted small', text: [cardCode(c), store.owned(c.id) ? `tienes ${store.owned(c.id)}` : null, unitPrice(c.id) != null ? eur(unitPrice(c.id)) : null].filter(Boolean).join(' · ') }))))));
    if (text && !found.length) results.append(el('li', { class: 'empty', text: selling ? 'No tienes ninguna carta con ese nombre.' : 'No hay cartas con ese nombre.' }));
    else if (found.length > SEARCH_LIMIT) results.append(el('li', { class: 'muted small trade-more', text: `Y ${found.length - SEARCH_LIMIT} más: escribe para afinar.` }));
    else if (!found.length && !text) results.append(el('li', { class: 'muted small trade-more', text: 'Escribe el nombre de la carta.' }));
    if (!cardZone.contains(searchInput)) cardZone.replaceChildren(searchInput, results);
  }

  function maxQty() {
    return selling && f.what === 'card' && f.card ? Math.min(ownedOf(f.card.id, f.foil), MAX_QTY) : MAX_QTY;
  }

  function values() {
    const qty = Number(qtyInput.value);
    return { qty: Number.isInteger(qty) && qty >= 1 ? qty : null, price: parsePrice(priceInput.value) };
  }

  function update() {
    const { qty, price } = values();
    const isCard = f.what === 'card';
    productZone.hidden = isCard;
    cardZone.hidden = !isCard;
    const hasSubject = isCard ? !!f.card : !!labelInput.value.trim();
    const tooMany = qty != null && qty > maxQty();
    const market = isCard && f.card ? unitPrice(f.card.id, f.foil) : null;
    hint.textContent = tooMany ? `Solo tienes ${maxQty()} en tu colección.` : market != null ? `En Cardmarket: ${eur(market)}` : '';
    hint.classList.toggle('warn', tooMany);
    totalLine.textContent = qty != null && price != null ? `Total ${money(round2((selling ? 1 : -1) * qty * price))}` : '';
    saveBtn.disabled = !hasSubject || qty == null || price == null || tooMany || !dateInput.value;
  }

  function save() {
    const { qty, price } = values();
    const isCard = f.what === 'card';
    const entry = {
      id: newUuid(),
      at: dateToAt(dateInput.value), kind,
      label: isCard ? null : labelInput.value.trim().slice(0, 120),
      card: isCard ? f.card.id : null,
      foil: isCard ? f.foil : false,
      qty, price,
      ownedBefore: isCard && !selling ? ownedOf(f.card.id, f.foil) : null,
      inCollection: false,
      updated: Date.now(),
    };
    saveEntry(entry);
    if (selling && isCard) store.add(entry.card, -qty, entry.foil, 'venta');
    dlg.close();
    toast(selling ? 'Venta apuntada' : 'Compra apuntada');
  }

  dlg.replaceChildren(
    el('div', { class: 'dialog-head' },
      el('h2', { text: selling ? 'Añadir venta' : 'Añadir compra' }),
      el('button', { class: 'icon-btn', title: 'Cerrar', 'aria-label': 'Cerrar', onclick: () => dlg.close() }, '✕')),
    el('div', { class: 'ledger-form' },
      segmented(() => [['product', 'Producto'], ['card', 'Carta']], () => f.what, (v) => { f.what = v; update(); }),
      productZone,
      cardZone,
      el('div', { class: 'ledger-form-row' },
        field('Cantidad', qtyInput),
        field('Precio por unidad (€)', priceInput),
        field('Fecha', dateInput)),
      hint,
      el('div', { class: 'ledger-form-end' }, totalLine, saveBtn)),
  );
  drawCardZone();
  update();
  dlg.showModal();
}

export function initLedger(context) {
  ctx = context;
  $('#btn-col-balance').addEventListener('click', () => {
    drawBalance();
    balanceDialog().showModal();
  });
  store.onChange((what) => {
    if ((what === 'ledger' || what === 'collection') && balanceDialog().open) drawBalance();
  });
}
