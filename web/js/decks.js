// Constructor de mazos a partir de la colección.
//
// Reglas (formato construido):
//   - 1 Leyenda: define los dominios del mazo y el campeón.
//   - Mazo principal de al menos 40 cartas, incluido el Campeón elegido (una unidad Campeón
//     con la etiqueta de la Leyenda). Máximo 3 copias por nombre.
//   - Cartas de firma (Signature): máximo 3 y solo las del campeón de la Leyenda.
//   - 12 Runas de los dominios de la Leyenda.
//   - 3 Campos de batalla con nombres distintos.
//   - Sideboard de hasta 10 cartas válidas para el mazo principal (no Runas, Leyenda ni Campos).
//     El máximo de copias por nombre cuenta mazo + sideboard. Entre partidas se cambian 1 por 1.
//     (Reglas de torneo, 601.1.c y 403.4.)

import { store } from './store.js';
import { $, el, toast, cardImg, cardCode, baseName, download, matchesType, DOMAIN_ES, TYPE_ES } from './ui.js';
import { exportDeckExcel, exportDeckCsv, exportAllDecksExcel, exportAllDecksCsv, exportAllDecksText } from './export.js';
import { unitPrice, eur } from './prices.js';

const MAIN_TYPES = new Set(['Unit', 'Spell', 'Gear']);
const MAIN_SIZE = 40, RUNES = 12, BATTLEFIELDS = 3, MAX_COPIES = 3, MAX_SIGNATURE = 3, SIDEBOARD = 10;

let ctx; // { cards, byId, openCard }
let current = null; // mazo en edición
let pool = { q: '', type: '', owned: true };

const isToken = (c) => c.supertype === 'Token';
const champTag = (legend) => legend?.champion ?? legend?.tags?.[0];
/** ¿Es esta carta (Campeón o de firma) del campeón de la Leyenda? */
const ofChampion = (card, legend) => (card.champion ?? null) === champTag(legend) || card.tags.includes(champTag(legend));

function legalDomain(card, legend) {
  if (!legend) return true;
  const ds = card.domain.filter((d) => d !== 'Colorless');
  return ds.every((d) => legend.domain.includes(d));
}

function section(card) {
  if (card.type === 'Legend') return 'legend';
  if (card.type === 'Rune') return 'runes';
  if (card.type === 'Battlefield') return 'battlefields';
  return 'main';
}

function sum(obj) {
  return Object.values(obj ?? {}).reduce((a, b) => a + b, 0);
}

/** Sideboard del mazo (los mazos antiguos no lo tienen). */
const side = (deck) => deck.sideboard ?? {};

/** Copias de cada id usadas en el mazo (para compararlas con la colección). */
function usage(deck) {
  const u = {};
  const bump = (id, n = 1) => (u[id] = (u[id] || 0) + n);
  if (deck.legend) bump(deck.legend);
  if (deck.champion) bump(deck.champion);
  for (const [id, n] of Object.entries(deck.main)) bump(id, n);
  for (const [id, n] of Object.entries(deck.runes)) bump(id, n);
  for (const [id, n] of Object.entries(side(deck))) bump(id, n);
  deck.battlefields.forEach((id) => bump(id));
  return u;
}

export function validate(deck) {
  const { byId } = ctx;
  const issues = [];
  const legend = byId.get(deck.legend);
  const champion = byId.get(deck.champion);
  const mainCount = sum(deck.main) + (champion ? 1 : 0);
  const runeCount = sum(deck.runes);

  if (!legend) issues.push('Elige una Leyenda.');
  if (!champion) issues.push('Elige el Campeón (una unidad Campeón de tu Leyenda).');
  else if (legend && !ofChampion(champion, legend)) issues.push(`El Campeón debe ser de ${champTag(legend)}.`);
  if (mainCount < MAIN_SIZE) issues.push(`Mazo principal: ${mainCount}/${MAIN_SIZE} (faltan ${MAIN_SIZE - mainCount}).`);
  if (runeCount !== RUNES) issues.push(`Runas: ${runeCount}/${RUNES}.`);
  if (deck.battlefields.length !== BATTLEFIELDS) issues.push(`Campos de batalla: ${deck.battlefields.length}/${BATTLEFIELDS}.`);

  const bfNames = deck.battlefields.map((id) => baseName(byId.get(id)));
  if (new Set(bfNames).size !== bfNames.length) issues.push('Los Campos de batalla deben tener nombres distintos.');

  const copies = {};
  let signatures = 0;
  const all = Object.entries(deck.main);
  if (champion) all.push([champion.id, 1]);
  for (const [id, n] of all) {
    const c = byId.get(id);
    copies[baseName(c)] = (copies[baseName(c)] || 0) + n;
    if (c.supertype === 'Signature') {
      signatures += n;
      if (legend && !ofChampion(c, legend)) issues.push(`${c.name}: es una carta de firma de otro campeón.`);
    }
    if (!legalDomain(c, legend)) issues.push(`${c.name}: no es de los dominios de tu Leyenda.`);
  }
  const sideCount = sum(side(deck));
  if (sideCount > SIDEBOARD) issues.push(`Sideboard: ${sideCount} cartas (máximo ${SIDEBOARD}).`);
  for (const [id, n] of Object.entries(side(deck))) {
    const c = byId.get(id);
    copies[baseName(c)] = (copies[baseName(c)] || 0) + n; // el límite cuenta mazo + sideboard
    if (!MAIN_TYPES.has(c.type)) issues.push(`${c.name}: el sideboard solo admite cartas del mazo principal.`);
    else if (!legalDomain(c, legend)) issues.push(`${c.name} (sideboard): no es de los dominios de tu Leyenda.`);
    else if (c.supertype === 'Signature' && legend && !ofChampion(c, legend)) issues.push(`${c.name} (sideboard): es una carta de firma de otro campeón.`);
  }
  for (const [name, n] of Object.entries(copies)) if (n > MAX_COPIES) issues.push(`${name}: ${n} copias entre mazo y sideboard (máximo ${MAX_COPIES}).`);
  if (signatures > MAX_SIGNATURE) issues.push(`Cartas de firma: ${signatures} (máximo ${MAX_SIGNATURE}).`);
  for (const [id, n] of Object.entries(deck.runes)) {
    if (!legalDomain(byId.get(id), legend)) issues.push(`${byId.get(id).name}: no es de los dominios de tu Leyenda.`);
  }

  const missing = [];
  for (const [id, n] of Object.entries(usage(deck))) {
    const lack = n - store.owned(id);
    if (lack > 0) missing.push([byId.get(id), lack]);
  }
  return { issues, missing, mainCount, runeCount, sideCount };
}

function newDeck() {
  return { id: crypto.randomUUID?.() ?? String(Date.now()), name: 'Mazo nuevo', legend: null, champion: null, main: {}, runes: {}, battlefields: [], sideboard: {}, updated: Date.now() };
}

function save() {
  current.updated = Date.now();
  const i = store.decks.findIndex((d) => d.id === current.id);
  if (i >= 0) store.decks[i] = current;
  else store.decks.unshift(current);
  store.saveDecks();
}

/** Añade (o quita) una copia en el sideboard. */
function addToSide(card, delta = 1) {
  if (!MAIN_TYPES.has(card.type)) return toast('El sideboard solo admite unidades, hechizos y equipos.');
  const bag = (current.sideboard ??= {});
  if (delta > 0 && sum(bag) >= SIDEBOARD) return toast(`El sideboard ya tiene ${SIDEBOARD} cartas.`);
  bag[card.id] = (bag[card.id] || 0) + delta;
  if (bag[card.id] <= 0) delete bag[card.id];
  save();
  renderEditor();
}

/** Pasa una copia entre mazo principal y sideboard (como el cambio 1 por 1 entre partidas). */
function moveCard(card, to) {
  const from = to === 'sideboard' ? current.main : (current.sideboard ??= {});
  const dest = to === 'sideboard' ? (current.sideboard ??= {}) : current.main;
  if (!from[card.id]) return;
  if (to === 'sideboard' && sum(dest) >= SIDEBOARD) return toast(`El sideboard ya tiene ${SIDEBOARD} cartas.`);
  from[card.id] -= 1;
  if (!from[card.id]) delete from[card.id];
  dest[card.id] = (dest[card.id] || 0) + 1;
  save();
  renderEditor();
}

/** Añade una carta al mazo en la sección que le corresponde. */
function addToDeck(card, delta = 1) {
  const sec = section(card);
  if (sec === 'legend') {
    current.legend = delta > 0 ? card.id : null;
    const champ = ctx.byId.get(current.champion);
    if (champ && !ofChampion(champ, card)) current.champion = null;
  } else if (sec === 'battlefields') {
    if (delta > 0) {
      if (current.battlefields.length >= BATTLEFIELDS) return toast(`Ya tienes ${BATTLEFIELDS} Campos de batalla.`);
      current.battlefields.push(card.id);
    } else {
      const i = current.battlefields.indexOf(card.id);
      if (i >= 0) current.battlefields.splice(i, 1);
    }
  } else {
    const bag = current[sec];
    bag[card.id] = (bag[card.id] || 0) + delta;
    if (bag[card.id] <= 0) delete bag[card.id];
  }
  save();
  renderEditor();
}

export function exportText(deck) {
  const { byId } = ctx;
  const line = (n, c) => `${n} ${c.name} (${cardCode(c)})`;
  const out = [`# ${deck.name}`];
  if (deck.legend) out.push('', 'Leyenda:', line(1, byId.get(deck.legend)));
  if (deck.champion) out.push('', 'Campeón:', line(1, byId.get(deck.champion)));
  const group = (bag) => Object.entries(bag).map(([id, n]) => [byId.get(id), n]).sort((a, b) => (a[0].energy ?? 99) - (b[0].energy ?? 99) || a[0].name.localeCompare(b[0].name));
  out.push('', `Mazo principal (${sum(deck.main) + (deck.champion ? 1 : 0)}):`, ...group(deck.main).map(([c, n]) => line(n, c)));
  out.push('', `Runas (${sum(deck.runes)}):`, ...group(deck.runes).map(([c, n]) => line(n, c)));
  out.push('', 'Campos de batalla:', ...deck.battlefields.map((id) => line(1, byId.get(id))));
  if (sum(side(deck))) out.push('', `Sideboard (${sum(side(deck))}):`, ...group(side(deck)).map(([c, n]) => line(n, c)));
  return out.join('\n');
}

// ---------- Vistas ----------

/** Datos que necesita el exportador: cartas, cuántas tienes de cada una y la validación. */
const exportCtx = () => ({ byId: ctx.byId, owned: (id) => store.owned(id), validate });

async function runExport(button, fn) {
  button.disabled = true;
  try {
    await fn();
  } catch (err) {
    toast(err.message);
  } finally {
    button.disabled = false;
  }
}

function renderList() {
  const list = $('#deck-list');
  list.replaceChildren();
  $('#deck-export-all').hidden = !store.decks.length;
  if (!store.decks.length) {
    list.append(el('li', { class: 'empty' }, 'Aún no tienes mazos. Escanea tus cartas y crea uno.'));
    return;
  }
  for (const deck of store.decks) {
    const legend = ctx.byId.get(deck.legend);
    const { issues, missing, sideCount } = validate(deck);
    list.append(
      el('li', { class: 'deck-row', onclick: () => openEditor(deck) },
        legend ? cardImg(legend, 'thumb small') : el('div', { class: 'thumb small placeholder' }, '?'),
        el('div', { class: 'grow' },
          el('strong', { text: deck.name }),
          el('div', { class: 'muted', text: (legend ? `${champTag(legend)} · ${legend.domain.map((d) => DOMAIN_ES[d] || d).join(' / ')}` : 'Sin leyenda') + (sideCount ? ` · sideboard ${sideCount}` : '') }),
          el('div', { class: issues.length ? 'warn' : 'ok', text: issues.length ? `${issues.length} pendiente(s)` : 'Mazo válido' + (missing.length ? ` · faltan ${missing.reduce((a, [, n]) => a + n, 0)} cartas` : '') }),
        ),
      ),
    );
  }
}

export function openEditor(deck) {
  current = structuredClone(deck);
  $('#deck-list-view').hidden = true;
  $('#deck-editor').hidden = false;
  renderEditor();
  window.scrollTo(0, 0);
}

function closeEditor() {
  current = null;
  $('#deck-list-view').hidden = false;
  $('#deck-editor').hidden = true;
  renderList();
}

const ICONS = {
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
  down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
};
function icon(name) {
  const span = el('span', { class: 'icon', 'aria-hidden': 'true' });
  span.innerHTML = `<svg viewBox="0 0 24 24">${ICONS[name]}</svg>`;
  return span;
}

/**
 * Una casilla del tablero del mazo. La primera de cada grupo lleva el nombre del grupo (y, con
 * `sep`, la línea que lo separa del anterior); las demás dejan el hueco para que todo alinee.
 */
function deckTile({ label = '', sep = false, card, actions = [], below }) {
  return el('div', { class: `dt${sep ? ' dt-sep' : ''}` },
    el('span', { class: 'dt-label', text: label }),
    el('div', { class: 'dt-img' }, el('button', { class: 'tile-img', title: card.name, onclick: () => ctx.openCard(card) }, cardImg(card)), actions),
    el('span', { class: 'dt-name', title: card.name, text: card.name }),
    below,
  );
}

/** Casilla vacía con la forma de una carta (para elegir algo o avisar de que el grupo está vacío). */
function emptyTile({ label = '', sep = false, text, onclick }) {
  return el('div', { class: `dt${sep ? ' dt-sep' : ''}` },
    el('span', { class: 'dt-label', text: label }),
    onclick ? el('button', { class: 'dt-empty', onclick }, text) : el('div', { class: 'dt-empty' }, text),
  );
}

const overlayBtn = (name, title, onclick) => el('button', { class: 'dt-act', title, 'aria-label': title, onclick }, icon(name));
const lackBadge = (lack) => lack > 0 && el('span', { class: 'dt-lack', title: `Te faltan ${lack} copias` }, `-${lack}`);
const qtyPill = (n, onMinus, onPlus) => el('div', { class: 'tile-qty' },
  el('button', { class: 'icon-btn small', title: 'Quitar una', onclick: onMinus }, '−'),
  el('span', { class: 'qty', text: n }),
  el('button', { class: 'icon-btn small', title: 'Añadir una', onclick: onPlus }, '+'),
);

/** Leyenda o Campeón: la carta con "Cambiar" debajo y la ✕ sobre la imagen, o la casilla para elegirla. */
function slotTile(label, cardId, onPick, onClear, sep = false) {
  const card = ctx.byId.get(cardId);
  if (!card) return emptyTile({ label, sep, text: `Elegir ${label.toLowerCase()}`, onclick: onPick });
  return deckTile({
    label, sep, card,
    actions: [onClear && overlayBtn('x', `Quitar ${label.toLowerCase()}`, onClear)],
    below: el('button', { class: 'btn ghost small dt-change', onclick: onPick }, 'Cambiar'),
  });
}

/** kind: "main" (botón para pasar al sideboard), "sideboard" (para volver al mazo) o null. */
function deckGroup(bag, label, kind = null, sep = false) {
  const entries = Object.entries(bag).map(([id, n]) => [ctx.byId.get(id), n]);
  entries.sort((a, b) => (a[0].energy ?? 99) - (b[0].energy ?? 99) || a[0].name.localeCompare(b[0].name));
  if (!entries.length) {
    return [emptyTile({ label, sep, text: kind === 'sideboard' ? 'Vacío. Usa «+ side» abajo o ↓ en una carta.' : 'Vacío. Añade cartas desde abajo.' })];
  }
  const add = (c, d) => (kind === 'sideboard' ? addToSide(c, d) : addToDeck(c, d));
  return entries.map(([c, n], i) => deckTile({
    label: i === 0 ? label : '', sep: i === 0 && sep, card: c,
    actions: [
      kind === 'main' && MAIN_TYPES.has(c.type) && overlayBtn('down', 'Pasar una copia al sideboard', () => moveCard(c, 'sideboard')),
      kind === 'sideboard' && overlayBtn('up', 'Pasar una copia al mazo principal', () => moveCard(c, 'main')),
      lackBadge(n - store.owned(c.id)),
    ],
    below: qtyPill(n, () => add(c, -1), () => add(c, 1)),
  }));
}

function battlefieldGroup(label, sep) {
  if (!current.battlefields.length) return [emptyTile({ label, sep, text: 'Vacío. Añade campos desde abajo.' })];
  return current.battlefields.map((id, i) => {
    const c = ctx.byId.get(id);
    return deckTile({ label: i === 0 ? label : '', sep: i === 0 && sep, card: c, actions: [overlayBtn('x', 'Quitar campo de batalla', () => addToDeck(c, -1))] });
  });
}

function renderEditor() {
  const root = $('#deck-editor');
  const { byId } = ctx;
  const legend = byId.get(current.legend);
  const v = validate(current);
  const used = usage(current);

  const pickLegend = () => picker('Leyenda', ctx.cards.filter((c) => c.type === 'Legend' && !isToken(c)), (c) => addToDeck(c, 1));
  const pickChampion = () => {
    if (!legend) return toast('Elige primero la Leyenda.');
    picker('Campeón', ctx.cards.filter((c) => c.type === 'Unit' && c.supertype === 'Champion' && ofChampion(c, legend)), (c) => {
      current.champion = c.id;
      save();
      renderEditor();
    });
  };

  root.replaceChildren(
    el('div', { class: 'section-head' },
      el('button', { class: 'btn ghost small', onclick: closeEditor }, '← Mazos'),
      el('div', { class: 'actions' },
        el('button', { class: 'btn ghost small', onclick: () => { navigator.clipboard?.writeText(exportText(current)).then(() => toast('Lista copiada')); } }, 'Copiar lista'),
        el('button', { class: 'btn ghost small', title: 'Lista en texto (.txt)', onclick: () => download(`${current.name}.txt`, exportText(current)) }, 'Texto'),
        el('button', { class: 'btn ghost small', title: 'Excel con todas las columnas y un resumen del mazo', onclick: (e) => runExport(e.target, () => exportDeckExcel(current, exportCtx())) }, 'Excel'),
        el('button', { class: 'btn ghost small', title: 'CSV con todas las columnas', onclick: (e) => runExport(e.target, () => exportDeckCsv(current, exportCtx())) }, 'CSV'),
        el('button', { class: 'btn danger small icon-only', title: 'Borrar mazo', 'aria-label': 'Borrar mazo', onclick: () => {
          if (!confirm(`¿Borrar el mazo "${current.name}"?`)) return;
          store.decks = store.decks.filter((d) => d.id !== current.id);
          store.saveDecks();
          closeEditor();
        } }, icon('trash')),
      ),
    ),
    el('input', { class: 'deck-name', value: current.name, oninput: (e) => { current.name = e.target.value || 'Mazo'; save(); } }),
    el('div', { class: 'deck-stats' },
      stat('Principal', v.mainCount, MAIN_SIZE),
      stat('Runas', v.runeCount, RUNES),
      stat('Campos', current.battlefields.length, BATTLEFIELDS),
      stat('Sideboard', v.sideCount, SIDEBOARD),
    ),
    v.issues.length
      ? el('ul', { class: 'issues' }, v.issues.map((i) => el('li', { text: i })))
      : el('p', { class: 'ok', text: '✓ El mazo cumple las reglas de construcción.' }),
    // replaceChildren no ignora `false` (lo pintaría como texto), así que sin cartas que falten va ''.
    v.missing.length > 0 ? el('details', { class: 'missing' },
      el('summary', { text: `Te faltan ${v.missing.reduce((a, [, n]) => a + n, 0)} cartas de tu colección${missingCost(v.missing) ? ` (≈ ${eur(missingCost(v.missing))} en Cardmarket)` : ''}` }),
      el('ul', {}, v.missing.map(([c, n]) => el('li', { text: `${n}× ${c.name} (${cardCode(c)})${unitPrice(c.id) != null ? ` · ${eur(unitPrice(c.id) * n)}` : ''}` }))),
    ) : '',
    // Tablero: Leyenda y Campeón | mazo principal; debajo, Runas | Campos | Sideboard.
    el('div', { class: 'deck-board' },
      slotTile('Leyenda', current.legend, pickLegend, current.legend && (() => { current.legend = null; current.champion = null; save(); renderEditor(); })),
      slotTile('Campeón', current.champion, pickChampion, current.champion && (() => { current.champion = null; save(); renderEditor(); })),
      deckGroup(current.main, `Principal ${sum(current.main)}/${MAIN_SIZE - (current.champion ? 1 : 0)}`, 'main', true),
    ),
    el('div', { class: 'deck-board' },
      deckGroup(current.runes, `Runas ${sum(current.runes)}/${RUNES}`),
      battlefieldGroup(`Campos ${current.battlefields.length}/${BATTLEFIELDS}`, true),
    ),
    // El sideboard no forma parte del mazo: va en su propia fila, tras otra línea.
    el('div', { class: 'deck-board' },
      deckGroup(side(current), `Sideboard ${sum(side(current))}/${SIDEBOARD}`, 'sideboard'),
    ),
    renderPool(legend, used),
  );
}

/** Lo que costaría comprar en Cardmarket las cartas que faltan (las que tienen precio). */
function missingCost(missing) {
  return missing.reduce((a, [c, n]) => a + (unitPrice(c.id) ?? 0) * n, 0);
}

function stat(label, n, target) {
  // Principal: al menos 40. Sideboard: hasta 10 (vacío también vale). El resto: exacto.
  const ok = label === 'Principal' ? n >= target : label === 'Sideboard' ? n <= target : n === target;
  return el('div', { class: `stat ${ok ? 'ok' : 'bad-stat'}` }, el('strong', { text: `${n}/${target}` }), el('span', { text: label }));
}

function renderPool(legend, used) {
  const wrap = el('div', { class: 'pool' });
  const grid = el('div', { class: 'grid' });
  const draw = () => {
    const q = pool.q.trim().toLowerCase();
    const list = ctx.cards.filter((c) => {
      if (isToken(c) || c.type === 'Legend' || c.type === 'Other') return false;
      if (pool.owned && store.owned(c.id) === 0) return false;
      if (!matchesType(c, pool.type)) return false;
      if (legend && !legalDomain(c, legend)) return false;
      if (legend && c.supertype === 'Signature' && !ofChampion(c, legend)) return false;
      if (q && !`${c.name} ${c.tags.join(' ')} ${c.text}`.toLowerCase().includes(q)) return false;
      return true;
    });
    list.sort((a, b) => (a.energy ?? 99) - (b.energy ?? 99) || a.name.localeCompare(b.name));
    grid.replaceChildren(...list.slice(0, 300).map((c) => {
      const owned = store.owned(c.id), u = used[c.id] || 0;
      return el('div', { class: 'tile' + (owned && u >= owned ? ' dim' : '') },
        el('button', { class: 'tile-img', title: 'Añadir al mazo', onclick: () => addToDeck(c, 1) }, cardImg(c)),
        el('div', { class: 'tile-info' },
          el('span', { class: 'tile-name', text: c.name }),
          el('span', { class: 'muted small', text: `${u}/${owned} usadas` }),
          el('span', { class: 'tile-links' },
            el('button', { class: 'link small', onclick: () => ctx.openCard(c) }, 'ver'),
            MAIN_TYPES.has(c.type) && el('button', { class: 'link small', title: 'Añadir al sideboard', onclick: () => addToSide(c, 1) }, '+ side')),
        ),
      );
    }));
    if (list.length > 300) grid.append(el('p', { class: 'muted', text: `…y ${list.length - 300} más. Usa el buscador.` }));
    if (!list.length) grid.append(el('p', { class: 'muted', text: pool.owned ? 'No tienes cartas que encajen con este filtro.' : 'Sin resultados.' }));
  };
  const typeSel = el('select', { onchange: (e) => { pool.type = e.target.value; draw(); } },
    el('option', { value: '', text: 'Todos los tipos' }),
    ['Unit', 'Champion', 'Spell', 'Gear', 'Rune', 'Battlefield'].map((t) => el('option', { value: t, text: TYPE_ES[t], selected: pool.type === t })),
  );
  wrap.append(
    el('h3', { text: legend ? `Añadir cartas (${legend.domain.map((d) => DOMAIN_ES[d] || d).join(' / ')})` : 'Añadir cartas' }),
    el('div', { class: 'filter-row' },
      el('input', { type: 'search', placeholder: 'Buscar…', value: pool.q, oninput: (e) => { pool.q = e.target.value; draw(); } }),
      typeSel,
    ),
    el('label', { class: 'toggle' }, el('input', { type: 'checkbox', checked: pool.owned, onchange: (e) => { pool.owned = e.target.checked; draw(); } }), el('span', { text: 'Solo las que tengo' })),
    grid,
  );
  draw();
  return wrap;
}

function picker(title, cards, onPick) {
  const dlg = $('#picker-dialog');
  let onlyOwned = cards.some((c) => store.owned(c.id) > 0);
  const grid = el('div', { class: 'grid' });
  const draw = () => {
    const list = cards.filter((c) => !onlyOwned || store.owned(c.id) > 0);
    grid.replaceChildren(...list.map((c) => el('button', { class: 'tile tile-img', onclick: () => { dlg.close(); onPick(c); } },
      cardImg(c), el('span', { class: 'tile-name', text: `${c.name}${c.tags[0] && !c.name.includes(c.tags[0]) ? ` (${c.tags[0]})` : ''}` }), el('span', { class: 'muted small', text: `Tienes ${store.owned(c.id)}` }))));
    if (!list.length) grid.append(el('p', { class: 'muted', text: 'No hay cartas disponibles.' }));
  };
  dlg.replaceChildren(
    el('div', { class: 'dialog-head' }, el('h2', { text: `Elegir ${title.toLowerCase()}` }), el('button', { class: 'icon-btn', onclick: () => dlg.close() }, '✕')),
    el('label', { class: 'toggle' }, el('input', { type: 'checkbox', checked: onlyOwned, onchange: (e) => { onlyOwned = e.target.checked; draw(); } }), el('span', { text: 'Solo las que tengo' })),
    grid,
  );
  draw();
  dlg.showModal();
}

export function initDecks(context) {
  ctx = context;
  $('#btn-new-deck').addEventListener('click', () => openEditor(newDeck()));
  $('#btn-decks-excel').addEventListener('click', (e) => runExport(e.target, () => exportAllDecksExcel(store.decks, exportCtx())));
  $('#btn-decks-csv').addEventListener('click', (e) => runExport(e.target, () => exportAllDecksCsv(store.decks, exportCtx())));
  $('#btn-decks-txt').addEventListener('click', () => exportAllDecksText(store.decks, exportText));
  store.onChange((what) => {
    if (what === 'collection' && current) renderEditor();
    if (!current) renderList();
  });
  renderList();
}
