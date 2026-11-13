// Lo que se ve de la colección por encima: el contador de arriba y su resumen, las cartas quitadas,
// el progreso por set y la evolución del valor.

import { store } from './store.js';
import { cloud, fetchRemovedCards } from './cloud.js';
import { wantButton } from './trades.js';
import { showSetInCollection } from './collection.js';
import { loadHistory, collectionSeries, rangeStart, movers, lineChart, dayText, changeText, pctText } from './pricehistory.js';
import { pricesDate, unitPrice, entryValue, eur } from './prices.js';
import { $, el, toast, cardImg, cardCode, RARITY_ES } from './ui.js';

let byId, openCard, showView;
let setInfo; // cada set con sus cartas y su set base (se calcula en initCollectionStats)

// ---------- Contador de arriba y resumen ----------

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

// ---------- Progreso por set ----------

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
        el('button', { class: 'btn ghost small', onclick: () => { showView('collection'); showSetInCollection(s.id); } }, 'Ver en la colección'), // también desde el resumen, abierto en otra pestaña
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

export function initCollectionStats(ctx) {
  const { cards, sets } = ctx;
  ({ byId, openCard, showView } = ctx);
  // ---------- Progreso por set ----------

  // Set base = las cartas numeradas del 1 al total impreso ("sfd-001-221" … "sfd-221-221"); las
  // variantes ("007a"), las que pasan del total, las runas y los tokens cuentan solo "con variantes".
  // Los sets de promos no tienen base: solo "tienes X de Y".
  setInfo = sets.map(([id, name]) => {
    const all = cards.filter((c) => c.set === id);
    const promo = all.every((c) => c.rarity === 'Promo');
    const totals = new Map();
    for (const c of all) { const t = c.id.split('-').at(-1); totals.set(t, (totals.get(t) ?? 0) + 1); }
    const total = [...totals].sort((a, b) => b[1] - a[1])[0][0];
    const re = new RegExp(`^[a-z]+-(\\d+)-${total}$`);
    const base = promo ? [] : all.filter((c) => { const m = re.exec(c.id); return m && +m[1] <= +total; });
    return { id, name, all, base: base.length ? base : null };
  }).sort((a, b) => !a.base - !b.base); // los de promos, al final

  store.onChange((what) => {
    if (what !== 'collection') return;
    updateOwnedCount();
    if (summaryOpen()) openSummary();
  });
  updateOwnedCount();
  $('#owned-count').addEventListener('click', openSummary);
  $('#picker-dialog').addEventListener('close', (e) => delete e.currentTarget.dataset.view);
  $('#btn-col-history').addEventListener('click', openHistory);
  $('#btn-col-sets').addEventListener('click', () => openSets());
  $('#btn-col-value').addEventListener('click', openValue);
}
