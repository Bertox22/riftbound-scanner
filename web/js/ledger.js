// Balance: compras, ventas e intercambios apuntados a mano (cajas, sobres, cartas sueltas). Se abre
// desde Colección.
// Movimiento: { id, at, kind: 'buy' | 'sell', label (producto) | card (id), foil, qty, price (por
// unidad), ownedBefore, inCollection }.
// Intercambio: { id, at, kind: 'trade', label ('Intercambio con …'), cash (+ recibido, − pagado),
// price (|cash|), valueMode ('day' | 'manual'), give / get: [{ card, foil, qty, value (€ por copia) }]
// (en get, también ownedBefore), inCollection }.
//
// Vender una carta la quita de la colección (y borrar la venta la devuelve). Comprar una carta no la
// añade: avisa hasta que las copias estén en la colección. Para eso se apunta cuántas había al comprar.
// Un intercambio hace las dos cosas: lo que das sale de la colección y lo que recibes se avisa.
// Al total del balance solo suma el dinero del intercambio; el valor de las cartas se muestra aparte.

import { $, el, toast, cardImg, cardCode, baseName } from './ui.js';
import { store, newUuid } from './store.js';
import { unitPrice, eur } from './prices.js';
import { loadHistory, cardSeries, dayText } from './pricehistory.js';

const SEARCH_LIMIT = 30;
const MAX_QTY = 999; // los mismos límites que la tabla ledger: pasarse atascaría la sincronización
const MAX_PRICE = 99_999_999.99;
const MAX_TRADE_CARDS = 30; // por lado, como en ledger.details

let ctx;

const ownedOf = (id, foil) => store.collection[id]?.[foil ? 'f' : 'n'] ?? 0;
const isTrade = (m) => m.kind === 'trade';
const amountOf = (m) => (isTrade(m) ? m.cash ?? 0 : (m.kind === 'sell' ? 1 : -1) * m.qty * m.price);
const money = (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${eur(Math.abs(v))}`;
const round2 = (v) => Math.round(v * 100) / 100;
const dateText = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', year: 'numeric' });
const balanceDialog = () => $('#balance-dialog');

const itemsValue = (items) => round2((items ?? []).reduce((a, it) => a + it.qty * (it.value ?? 0), 0));

/** Copias compradas o recibidas ({ card, foil, qty, ownedBefore }) que aún no están en la colección. */
const missingOf = (it) => Math.max(0, Math.min(it.qty, (it.ownedBefore ?? 0) + it.qty - ownedOf(it.card, it.foil)));

function missingCopies(m) {
  if (m.inCollection) return 0;
  if (isTrade(m)) return (m.get ?? []).reduce((a, it) => a + missingOf(it), 0);
  return m.kind === 'buy' && m.card ? missingOf(m) : 0;
}

/** Devuelve copias quitadas con `from`: su línea del historial queda como recuperada; lo que no esté ahí se suma sin más. */
function giveBack(card, foil, qty, from) {
  const line = store.history.find((h) => h.id === card && h.foil === foil && h.from === from && !h.undone);
  const undone = line ? Math.min(line.n, qty) : 0;
  if (line) store.undoRemoval(line, undone);
  if (qty > undone) store.add(card, qty - undone, foil);
}

function saveEntry(m) {
  store.ledger.unshift(m);
  store.ledger.sort((a, b) => b.at - a.at);
  store.saveLedger();
}

function removeEntry(m) {
  if (isTrade(m)) {
    const back = m.give?.length ? ' Las cartas que diste vuelven a tu colección; las que recibiste se quedan.' : '';
    if (!confirm(`¿Borrar este intercambio?${back}`)) return;
    store.ledger = store.ledger.filter((x) => x.id !== m.id);
    store.saveLedger();
    for (const it of m.give ?? []) giveBack(it.card, it.foil, it.qty, 'intercambio');
    return;
  }
  const what = m.card ? ctx.byId.get(m.card)?.name ?? m.card : m.label;
  const backToCollection = m.kind === 'sell' && m.card;
  if (!confirm(`¿Borrar este movimiento (${what})?${backToCollection ? ' Las copias vendidas vuelven a tu colección.' : ''}`)) return;
  store.ledger = store.ledger.filter((x) => x.id !== m.id);
  store.saveLedger();
  if (backToCollection) giveBack(m.card, m.foil, m.qty, 'venta');
}

/** Aviso de copias compradas o recibidas que faltan en la colección, con «Añadir» y «Ocultar». */
function missingWarn(m, missing, total, name) {
  const all = missing === total;
  return el('div', { class: 'ledger-warn' },
    el('span', { class: 'warn small grow', text: all ? (isTrade(m) ? 'No has incluido lo que recibiste en la colección' : 'No la has incluido en la colección') : `Faltan ${missing} copias por incluir en la colección` }),
    el('button', {
      class: 'btn ghost small',
      onclick: () => {
        const adds = (isTrade(m) ? m.get : [m]).map((it) => [it, missingOf(it)]).filter(([, n]) => n > 0);
        m.inCollection = true;
        store.saveLedger();
        for (const [it, n] of adds) store.add(it.card, n, it.foil);
        toast(`${name} en tu colección`);
      },
    }, 'Añadir'),
    el('button', { class: 'link small', onclick: () => { m.inCollection = true; store.saveLedger(); } }, 'Ocultar'));
}

function tradeRow(m) {
  const give = m.give ?? [];
  const get = m.get ?? [];
  const cash = m.cash ?? 0;
  const first = [...get, ...give].map((it) => ctx.byId.get(it.card)).find(Boolean);
  const thumb = first ? cardImg(first, 'thumb small') : el('div', { class: 'thumb small placeholder ledger-product', 'aria-hidden': 'true' }, '⇄');
  if (first) thumb.addEventListener('click', () => ctx.openCard(first));
  const given = round2(itemsValue(give) + Math.max(0, -cash));
  const got = round2(itemsValue(get) + Math.max(0, cash));
  const diff = round2(got - given);
  const line = (it) => {
    const card = ctx.byId.get(it.card);
    return el('li', {},
      el('button', { class: 'link small ledger-trade-card', type: 'button', onclick: () => card && ctx.openCard(card) },
        `${it.qty}× ${card?.name ?? it.card}${it.foil ? ' (foil)' : ''}`),
      el('span', { class: 'muted small', text: eur(it.qty * (it.value ?? 0)) }));
  };
  const cashLine = () => el('li', {}, el('span', { class: 'small', text: 'Dinero' }), el('span', { class: 'muted small', text: eur(Math.abs(cash)) }));
  const side = (title, items, withCash) => el('div', { class: 'ledger-trade-side' },
    el('span', { class: 'muted small', text: title }),
    el('ul', {}, items.map(line), withCash && cashLine()));
  const missing = missingCopies(m);
  const received = get.reduce((a, it) => a + it.qty, 0);
  return el('li', { class: 'ledger-entry' },
    el('div', { class: 'history-row ledger-row' },
      thumb,
      el('div', { class: 'grow' },
        el('strong', { text: m.label || 'Intercambio' }),
        el('span', { class: 'muted small', text: `Intercambio · ${dateText.format(m.at)} · ${m.valueMode === 'manual' ? 'valor manual' : 'precio de ese día'}` })),
      el('span', { class: `ledger-amount ${cash > 0 ? 'sell' : 'buy'}`, text: money(cash) }),
      el('button', { class: 'icon-btn small', title: 'Borrar', 'aria-label': `Borrar ${m.label || 'intercambio'}`, onclick: () => removeEntry(m) }, '✕')),
    el('div', { class: 'ledger-trade' },
      side(`Das · ${eur(given)}`, give, cash < 0),
      side(`Recibes · ${eur(got)}`, get, cash > 0),
      el('span', { class: `small ledger-trade-diff${diff > 0 ? ' up' : diff < 0 ? ' down' : ''}`, text: `Diferencia de valor ${money(diff)}` })),
    missing > 0 && missingWarn(m, missing, received, get.length === 1 ? `${ctx.byId.get(get[0].card)?.name ?? 'Carta'}:` : 'Cartas recibidas'));
}

function entryRow(m) {
  if (isTrade(m)) return tradeRow(m);
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
    missing > 0 && missingWarn(m, missing, m.qty, `${card?.name ?? 'Carta'}:`));
}

function drawBalance() {
  const dlg = balanceDialog();
  const bought = store.ledger.filter((m) => m.kind === 'buy').reduce((a, m) => a + m.qty * m.price, 0);
  const sold = store.ledger.filter((m) => m.kind === 'sell').reduce((a, m) => a + m.qty * m.price, 0);
  const trades = store.ledger.filter(isTrade);
  const traded = round2(trades.reduce((a, m) => a + (m.cash ?? 0), 0));
  const total = round2(sold - bought + traded);
  const top = dlg.scrollTop;
  dlg.replaceChildren(
    el('div', { class: 'dialog-head' },
      el('h2', { text: 'Balance' }),
      el('button', { class: 'icon-btn', title: 'Cerrar', 'aria-label': 'Cerrar', onclick: () => dlg.close() }, '✕')),
    el('div', { class: 'ledger-head' },
      el('div', { class: 'stats-big ledger-total' },
        el('strong', { text: money(total) }),
        el('span', { class: 'muted small', text: `Comprado ${eur(bought)} · Vendido ${eur(sold)}${trades.length ? ` · Intercambios ${money(traded)}` : ''}` })),
      el('div', { class: 'actions ledger-actions' },
        el('button', { class: 'btn ghost small', onclick: openTradeForm }, 'Añadir intercambio'),
        el('button', { class: 'btn ghost small', onclick: () => openForm('sell') }, 'Añadir venta'),
        el('button', { class: 'btn primary small', onclick: () => openForm('buy') }, 'Añadir compra'))),
    store.ledger.length
      ? el('ul', { class: 'ledger-list' }, store.ledger.map(entryRow))
      : el('p', { class: 'muted small', text: 'Apunta aquí lo que compras, vendes e intercambias: cajas, sobres o cartas sueltas. Es solo para llevar la cuenta.' }),
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

  const labels = [...new Set(store.ledger.filter((m) => !isTrade(m)).map((m) => m.label).filter(Boolean))];
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

// ---------- Intercambio ----------

function openTradeForm() {
  const dlg = $('#picker-dialog');
  const f = { mode: 'day', cashIn: true, give: [], get: [] };
  let hist = null; // historial de precios, cuando llegue

  const cashInput = el('input', { inputmode: 'decimal', placeholder: '0,00', oninput: update });
  const dateInput = el('input', { type: 'date', value: dateValue(new Date()), max: dateValue(new Date()), oninput: () => { refreshDayValues(); update(); } });
  const whoInput = el('input', { placeholder: 'Opcional', maxlength: 60, oninput: update });
  const modeHint = el('p', { class: 'muted small ledger-hint' });
  const hint = el('p', { class: 'muted small ledger-hint' });
  const totalLine = el('strong', { class: 'ledger-form-total' });
  const saveBtn = el('button', { class: 'btn primary', type: 'button', onclick: save }, 'Guardar intercambio');

  /** Precio de Cardmarket de una copia el día elegido (el último guardado hasta ese día); sin historial, el de hoy. */
  function dayPrice(id, foil) {
    const series = hist && cardSeries(hist, id, foil);
    if (series) {
      const end = new Date(`${dateInput.value}T23:59:59`).getTime();
      const i = Math.max(0, hist.dates.findLastIndex((d) => d.getTime() <= end));
      return { value: series[i], date: hist.dates[i] };
    }
    return { value: unitPrice(id, foil), date: null };
  }

  const priceText = (v) => (v == null ? '' : v.toFixed(2).replace('.', ','));
  const valueOf = (it) => (f.mode === 'day' ? dayPrice(it.card.id, it.foil).value : parsePrice(it.valueInput.value));

  function refreshDayValues() {
    for (const it of [...f.give, ...f.get]) {
      it.valueInput.disabled = f.mode === 'day';
      if (f.mode === 'day') it.valueInput.value = priceText(dayPrice(it.card.id, it.foil).value);
    }
    const dates = [...f.give, ...f.get].map((it) => dayPrice(it.card.id, it.foil).date).filter(Boolean);
    modeHint.textContent = f.mode === 'manual'
      ? 'Escribe lo que valía cada carta en el intercambio.'
      : dates.length ? `Precio de Cardmarket del ${dayText(dates[0])}.` : 'Precio de Cardmarket de ese día.';
  }

  function sideZone(side) {
    const giving = side === 'give';
    const list = el('ul', { class: 'ledger-trade-items' });
    const results = el('ul', { class: 'history-list ledger-results' });
    const search = el('input', { type: 'search', placeholder: giving ? 'Buscar entre tus cartas…' : 'Buscar carta o código…', oninput: drawResults });

    function add(card) {
      const foil = giving ? ownedOf(card.id, false) === 0 : false;
      const same = f[side].find((it) => it.card.id === card.id && it.foil === foil);
      if (same) same.qtyInput.value = String((Number(same.qtyInput.value) || 0) + 1);
      else if (f[side].length < MAX_TRADE_CARDS) f[side].push(item(card, foil));
      search.value = '';
      drawResults();
      drawList();
      refreshDayValues();
      update();
    }

    function item(card, foil) {
      const it = { card, foil };
      it.qtyInput = el('input', { inputmode: 'numeric', value: '1', 'aria-label': 'Cantidad', oninput: update });
      it.valueInput = el('input', { inputmode: 'decimal', placeholder: '0,00', 'aria-label': 'Valor por copia (€)', oninput: update });
      if (f.mode === 'manual') it.valueInput.value = priceText(dayPrice(card.id, foil).value);
      return it;
    }

    function drawList() {
      list.replaceChildren(...f[side].map((it) => {
        const c = it.card;
        const finishes = () => [[false, giving ? `Normal (${ownedOf(c.id, false)})` : 'Normal'], [true, giving ? `Foil (${ownedOf(c.id, true)})` : 'Foil']]
          .filter(([foil]) => !giving || ownedOf(c.id, foil) > 0);
        return el('li', { class: 'ledger-trade-item' },
          el('div', { class: 'history-row' },
            cardImg(c, 'thumb small'),
            el('div', { class: 'grow' },
              el('strong', { text: c.name }),
              el('span', { class: 'muted small', text: [cardCode(c), store.owned(c.id) ? `tienes ${store.owned(c.id)}` : null].filter(Boolean).join(' · ') })),
            el('button', {
              class: 'icon-btn small', type: 'button', title: 'Quitar', 'aria-label': `Quitar ${c.name}`,
              onclick: () => { f[side] = f[side].filter((x) => x !== it); drawList(); refreshDayValues(); update(); },
            }, '✕')),
          el('div', { class: 'ledger-trade-fields' },
            finishes().length > 1 ? segmented(finishes, () => it.foil, (v) => {
              it.foil = v;
              if (f.mode === 'manual') it.valueInput.value = priceText(dayPrice(c.id, v).value);
              refreshDayValues();
              update();
            }) : el('span', { class: 'muted small', text: it.foil ? 'Foil' : 'Normal' }),
            field('Cantidad', it.qtyInput),
            field('€ por copia', it.valueInput)));
      }));
    }

    function drawResults() {
      const text = search.value.trim().toLowerCase();
      if (!text) { results.replaceChildren(); return; }
      const found = ctx.cards
        .filter((c) => (!giving || store.owned(c.id) > 0) && `${c.name} ${cardCode(c)}`.toLowerCase().includes(text))
        .sort((a, b) => baseName(a).localeCompare(baseName(b), 'es', { sensitivity: 'base' }));
      results.replaceChildren(...found.slice(0, SEARCH_LIMIT).map((c) => el('li', {},
        el('button', { class: 'history-row ledger-pick', type: 'button', onclick: () => add(c) },
          cardImg(c, 'thumb small'),
          el('span', { class: 'grow' },
            el('strong', { text: c.name }),
            el('span', { class: 'muted small', text: [cardCode(c), store.owned(c.id) ? `tienes ${store.owned(c.id)}` : null, unitPrice(c.id) != null ? eur(unitPrice(c.id)) : null].filter(Boolean).join(' · ') }))))));
      if (!found.length) results.append(el('li', { class: 'empty', text: giving ? 'No tienes ninguna carta con ese nombre.' : 'No hay cartas con ese nombre.' }));
      else if (found.length > SEARCH_LIMIT) results.append(el('li', { class: 'muted small trade-more', text: `Y ${found.length - SEARCH_LIMIT} más: escribe para afinar.` }));
    }

    return el('section', { class: 'ledger-trade-zone' },
      el('h3', { text: giving ? 'Das' : 'Recibes' }),
      list, search, results);
  }

  function values() {
    const read = (it) => {
      const qty = Number(it.qtyInput.value);
      return { it, qty: Number.isInteger(qty) && qty >= 1 && qty <= MAX_QTY ? qty : null, value: valueOf(it) };
    };
    const cashText = cashInput.value.trim();
    const cashAbs = cashText ? parsePrice(cashText) : 0;
    return { give: f.give.map(read), get: f.get.map(read), cash: cashAbs == null ? null : round2((f.cashIn ? 1 : -1) * cashAbs) };
  }

  function update() {
    const v = values();
    const rows = [...v.give, ...v.get];
    // Lo que das no puede pasar de lo que tienes (sumando las líneas de la misma carta y acabado).
    const giving = new Map();
    for (const r of v.give) giving.set(`${r.it.card.id}|${r.it.foil}`, (giving.get(`${r.it.card.id}|${r.it.foil}`) ?? 0) + (r.qty ?? 0));
    const tooMany = v.give.find((r) => giving.get(`${r.it.card.id}|${r.it.foil}`) > ownedOf(r.it.card.id, r.it.foil));
    const badQty = rows.some((r) => r.qty == null);
    const badValue = f.mode === 'manual' && rows.some((r) => r.value == null);
    const noPrice = f.mode === 'day' && rows.filter((r) => r.value == null).map((r) => r.it.card.name);
    hint.textContent = tooMany ? `Solo tienes ${ownedOf(tooMany.it.card.id, tooMany.it.foil)} ${tooMany.it.card.name}${tooMany.it.foil ? ' foil' : ''}.`
      : v.cash == null ? 'El dinero no es un importe válido.'
      : badQty ? 'Revisa las cantidades.'
      : badValue ? 'Pon el valor de cada carta.'
      : noPrice?.length ? `Sin precio guardado (cuenta como 0 €): ${noPrice.join(', ')}.` : '';
    hint.classList.toggle('warn', !!(tooMany || v.cash == null || badQty || badValue));
    if (!badQty && !badValue && v.cash != null) {
      const sum = (list) => list.reduce((a, r) => a + r.qty * (r.value ?? 0), 0);
      const given = round2(sum(v.give) + Math.max(0, -v.cash));
      const got = round2(sum(v.get) + Math.max(0, v.cash));
      totalLine.textContent = rows.length ? `Das ${eur(given)} · Recibes ${eur(got)} · ${money(round2(got - given))}` : '';
    } else totalLine.textContent = '';
    saveBtn.disabled = !rows.length || !!tooMany || badQty || badValue || v.cash == null || !dateInput.value;
  }

  function save() {
    const v = values();
    const who = whoInput.value.trim();
    const entry = {
      id: newUuid(),
      at: dateToAt(dateInput.value), kind: 'trade',
      label: (who ? `Intercambio con ${who}` : 'Intercambio').slice(0, 120),
      card: null, foil: false, qty: 1,
      price: Math.abs(v.cash), cash: v.cash,
      valueMode: f.mode,
      give: v.give.map((r) => ({ card: r.it.card.id, foil: r.it.foil, qty: r.qty, value: round2(r.value ?? 0) })),
      get: v.get.map((r) => ({ card: r.it.card.id, foil: r.it.foil, qty: r.qty, value: round2(r.value ?? 0), ownedBefore: ownedOf(r.it.card.id, r.it.foil) })),
      ownedBefore: null,
      inCollection: false,
      updated: Date.now(),
    };
    saveEntry(entry);
    for (const it of entry.give) store.add(it.card, -it.qty, it.foil, 'intercambio');
    dlg.close();
    toast('Intercambio apuntado');
  }

  dlg.replaceChildren(
    el('div', { class: 'dialog-head' },
      el('h2', { text: 'Añadir intercambio' }),
      el('button', { class: 'icon-btn', title: 'Cerrar', 'aria-label': 'Cerrar', onclick: () => dlg.close() }, '✕')),
    el('div', { class: 'ledger-form' },
      sideZone('give'),
      sideZone('get'),
      el('section', { class: 'ledger-trade-zone' },
        el('h3', { text: 'Dinero' }),
        el('div', { class: 'ledger-pair' },
          segmented(() => [[true, 'Recibo'], [false, 'Pago']], () => f.cashIn, (v) => { f.cashIn = v; update(); }),
          field('Importe (€)', cashInput))),
      el('section', { class: 'ledger-trade-zone' },
        el('h3', { text: 'Valor de las cartas' }),
        segmented(() => [['day', 'Precio de ese día'], ['manual', 'Manual']], () => f.mode, (v) => {
          f.mode = v;
          for (const it of [...f.give, ...f.get]) it.valueInput.disabled = v === 'day';
          refreshDayValues();
          update();
        }),
        modeHint),
      el('div', { class: 'ledger-pair' },
        field('Con quién', whoInput),
        field('Fecha', dateInput)),
      hint,
      el('div', { class: 'ledger-form-end' }, totalLine, saveBtn)),
  );
  refreshDayValues();
  update();
  dlg.showModal();
  loadHistory().then((h) => {
    hist = h;
    if (dlg.open) { refreshDayValues(); update(); }
  });
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
