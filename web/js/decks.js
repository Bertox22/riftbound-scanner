// Constructor de mazos a partir de la colección.
//
// Reglas (formato construido):
//   - 1 Leyenda: define los dominios del mazo y el campeón.
//   - Mazo principal de al menos 40 cartas, incluido el Campeón elegido (una unidad Campeón
//     con la etiqueta de la Leyenda). Máximo 3 copias por nombre.
//   - Cartas de firma (Signature): máximo 3 y solo las del campeón de la Leyenda.
//   - 12 Runas de los dominios de la Leyenda.
//   - 3 Campos de batalla con nombres distintos.

import { store } from './store.js';
import { $, el, toast, cardImg, cardCode, baseName, download, DOMAIN_ES, TYPE_ES } from './ui.js';

const MAIN_TYPES = new Set(['Unit', 'Spell', 'Gear']);
const MAIN_SIZE = 40, RUNES = 12, BATTLEFIELDS = 3, MAX_COPIES = 3, MAX_SIGNATURE = 3;

let ctx; // { cards, byId, openCard }
let current = null; // mazo en edición
let pool = { q: '', type: '', owned: true };

const isToken = (c) => c.supertype === 'Token';
const champTag = (legend) => legend?.tags?.[0];

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
  return Object.values(obj).reduce((a, b) => a + b, 0);
}

/** Copias de cada id usadas en el mazo (para compararlas con la colección). */
function usage(deck) {
  const u = {};
  const bump = (id, n = 1) => (u[id] = (u[id] || 0) + n);
  if (deck.legend) bump(deck.legend);
  if (deck.champion) bump(deck.champion);
  for (const [id, n] of Object.entries(deck.main)) bump(id, n);
  for (const [id, n] of Object.entries(deck.runes)) bump(id, n);
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
  else if (legend && !champion.tags.includes(champTag(legend))) issues.push(`El Campeón debe ser de ${champTag(legend)}.`);
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
      if (legend && !c.tags.includes(champTag(legend))) issues.push(`${c.name}: es una carta de firma de otro campeón.`);
    }
    if (!legalDomain(c, legend)) issues.push(`${c.name}: no es de los dominios de tu Leyenda.`);
  }
  for (const [name, n] of Object.entries(copies)) if (n > MAX_COPIES) issues.push(`${name}: ${n} copias (máximo ${MAX_COPIES}).`);
  if (signatures > MAX_SIGNATURE) issues.push(`Cartas de firma: ${signatures} (máximo ${MAX_SIGNATURE}).`);
  for (const [id, n] of Object.entries(deck.runes)) {
    if (!legalDomain(byId.get(id), legend)) issues.push(`${byId.get(id).name}: no es de los dominios de tu Leyenda.`);
  }

  const missing = [];
  for (const [id, n] of Object.entries(usage(deck))) {
    const lack = n - store.owned(id);
    if (lack > 0) missing.push([byId.get(id), lack]);
  }
  return { issues, missing, mainCount, runeCount };
}

function newDeck() {
  return { id: crypto.randomUUID?.() ?? String(Date.now()), name: 'Mazo nuevo', legend: null, champion: null, main: {}, runes: {}, battlefields: [], updated: Date.now() };
}

function save() {
  current.updated = Date.now();
  const i = store.decks.findIndex((d) => d.id === current.id);
  if (i >= 0) store.decks[i] = current;
  else store.decks.unshift(current);
  store.saveDecks();
}

/** Añade una carta al mazo en la sección que le corresponde. */
function addToDeck(card, delta = 1) {
  const sec = section(card);
  if (sec === 'legend') {
    current.legend = delta > 0 ? card.id : null;
    const champ = ctx.byId.get(current.champion);
    if (champ && !champ.tags.includes(champTag(card))) current.champion = null;
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

function exportText(deck) {
  const { byId } = ctx;
  const line = (n, c) => `${n} ${c.name} (${cardCode(c)})`;
  const out = [`# ${deck.name}`];
  if (deck.legend) out.push('', 'Leyenda:', line(1, byId.get(deck.legend)));
  if (deck.champion) out.push('', 'Campeón:', line(1, byId.get(deck.champion)));
  const group = (bag) => Object.entries(bag).map(([id, n]) => [byId.get(id), n]).sort((a, b) => (a[0].energy ?? 99) - (b[0].energy ?? 99) || a[0].name.localeCompare(b[0].name));
  out.push('', `Mazo principal (${sum(deck.main) + (deck.champion ? 1 : 0)}):`, ...group(deck.main).map(([c, n]) => line(n, c)));
  out.push('', `Runas (${sum(deck.runes)}):`, ...group(deck.runes).map(([c, n]) => line(n, c)));
  out.push('', 'Campos de batalla:', ...deck.battlefields.map((id) => line(1, byId.get(id))));
  return out.join('\n');
}

// ---------- Vistas ----------

function renderList() {
  const list = $('#deck-list');
  list.replaceChildren();
  if (!store.decks.length) {
    list.append(el('li', { class: 'empty' }, 'Aún no tienes mazos. Escanea tus cartas y crea uno.'));
    return;
  }
  for (const deck of store.decks) {
    const legend = ctx.byId.get(deck.legend);
    const { issues, missing } = validate(deck);
    list.append(
      el('li', { class: 'deck-row', onclick: () => openEditor(deck) },
        legend ? cardImg(legend, 'thumb small') : el('div', { class: 'thumb small placeholder' }, '?'),
        el('div', { class: 'grow' },
          el('strong', { text: deck.name }),
          el('div', { class: 'muted', text: legend ? `${champTag(legend)} · ${legend.domain.map((d) => DOMAIN_ES[d] || d).join(' / ')}` : 'Sin leyenda' }),
          el('div', { class: issues.length ? 'warn' : 'ok', text: issues.length ? `${issues.length} pendiente(s)` : 'Mazo válido' + (missing.length ? ` · faltan ${missing.reduce((a, [, n]) => a + n, 0)} cartas` : '') }),
        ),
      ),
    );
  }
}

function openEditor(deck) {
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

function slot(label, cardId, onPick, onClear) {
  const card = ctx.byId.get(cardId);
  return el('div', { class: 'slot' },
    el('div', { class: 'slot-label', text: label }),
    card
      ? el('div', { class: 'slot-card' }, cardImg(card, 'thumb small'), el('span', { class: 'grow', text: card.name }), el('button', { class: 'btn ghost small', onclick: onPick }, 'Cambiar'), onClear && el('button', { class: 'icon-btn', title: 'Quitar', onclick: onClear }, '✕'))
      : el('button', { class: 'btn ghost', onclick: onPick }, `Elegir ${label.toLowerCase()}`),
  );
}

function deckRows(bag, title, target) {
  const entries = Object.entries(bag).map(([id, n]) => [ctx.byId.get(id), n]);
  entries.sort((a, b) => (a[0].energy ?? 99) - (b[0].energy ?? 99) || a[0].name.localeCompare(b[0].name));
  return el('div', { class: 'deck-section' },
    el('h3', {}, title, ' ', el('span', { class: 'muted', text: `(${sum(bag)}${target ? `/${target}` : ''})` })),
    entries.length ? el('ul', { class: 'deck-cards' }, entries.map(([c, n]) => {
      const lack = n - store.owned(c.id);
      return el('li', {},
        el('span', { class: 'cost', text: c.energy ?? '–' }),
        el('button', { class: 'link grow', onclick: () => ctx.openCard(c) }, c.name),
        lack > 0 && el('span', { class: 'warn small', title: 'Te faltan copias', text: `-${lack}` }),
        el('button', { class: 'icon-btn', onclick: () => addToDeck(c, -1) }, '−'),
        el('span', { class: 'qty', text: n }),
        el('button', { class: 'icon-btn', onclick: () => addToDeck(c, 1) }, '+'),
      );
    })) : el('p', { class: 'muted', text: 'Vacío. Añade cartas desde la lista de abajo.' }),
  );
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
    picker('Campeón', ctx.cards.filter((c) => c.type === 'Unit' && c.supertype === 'Champion' && c.tags.includes(champTag(legend))), (c) => {
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
        el('button', { class: 'btn ghost small', onclick: () => download(`${current.name}.txt`, exportText(current)) }, 'Descargar'),
        el('button', { class: 'btn danger small', onclick: () => {
          if (!confirm(`¿Borrar el mazo "${current.name}"?`)) return;
          store.decks = store.decks.filter((d) => d.id !== current.id);
          store.saveDecks();
          closeEditor();
        } }, 'Borrar'),
      ),
    ),
    el('input', { class: 'deck-name', value: current.name, oninput: (e) => { current.name = e.target.value || 'Mazo'; save(); } }),
    el('div', { class: 'deck-stats' },
      stat('Principal', v.mainCount, MAIN_SIZE),
      stat('Runas', v.runeCount, RUNES),
      stat('Campos', current.battlefields.length, BATTLEFIELDS),
    ),
    v.issues.length
      ? el('ul', { class: 'issues' }, v.issues.map((i) => el('li', { text: i })))
      : el('p', { class: 'ok', text: '✓ El mazo cumple las reglas de construcción.' }),
    v.missing.length > 0 && el('details', { class: 'missing' },
      el('summary', { text: `Te faltan ${v.missing.reduce((a, [, n]) => a + n, 0)} cartas de tu colección` }),
      el('ul', {}, v.missing.map(([c, n]) => el('li', { text: `${n}× ${c.name} (${cardCode(c)})` }))),
    ),
    slot('Leyenda', current.legend, pickLegend, current.legend && (() => { current.legend = null; current.champion = null; save(); renderEditor(); })),
    slot('Campeón', current.champion, pickChampion, current.champion && (() => { current.champion = null; save(); renderEditor(); })),
    deckRows(current.main, 'Mazo principal', MAIN_SIZE - (current.champion ? 1 : 0)),
    deckRows(current.runes, 'Runas', RUNES),
    el('div', { class: 'deck-section' },
      el('h3', {}, 'Campos de batalla ', el('span', { class: 'muted', text: `(${current.battlefields.length}/${BATTLEFIELDS})` })),
      el('ul', { class: 'deck-cards' }, current.battlefields.map((id) => {
        const c = byId.get(id);
        return el('li', {}, el('button', { class: 'link grow', onclick: () => ctx.openCard(c) }, c.name), el('button', { class: 'icon-btn', onclick: () => addToDeck(c, -1) }, '✕'));
      })),
    ),
    renderPool(legend, used),
  );
}

function stat(label, n, target) {
  return el('div', { class: `stat ${n === target || (label === 'Principal' && n >= target) ? 'ok' : ''}` }, el('strong', { text: `${n}/${target}` }), el('span', { text: label }));
}

function renderPool(legend, used) {
  const wrap = el('div', { class: 'pool' });
  const grid = el('div', { class: 'grid' });
  const draw = () => {
    const q = pool.q.trim().toLowerCase();
    const list = ctx.cards.filter((c) => {
      if (isToken(c) || c.type === 'Legend' || c.type === 'Other') return false;
      if (pool.owned && store.owned(c.id) === 0) return false;
      if (pool.type && c.type !== pool.type) return false;
      if (legend && !legalDomain(c, legend)) return false;
      if (legend && c.supertype === 'Signature' && !c.tags.includes(champTag(legend))) return false;
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
          el('button', { class: 'link small', onclick: () => ctx.openCard(c) }, 'ver'),
        ),
      );
    }));
    if (list.length > 300) grid.append(el('p', { class: 'muted', text: `…y ${list.length - 300} más. Usa el buscador.` }));
    if (!list.length) grid.append(el('p', { class: 'muted', text: pool.owned ? 'No tienes cartas que encajen con este filtro.' : 'Sin resultados.' }));
  };
  const typeSel = el('select', { onchange: (e) => { pool.type = e.target.value; draw(); } },
    el('option', { value: '', text: 'Todos los tipos' }),
    ['Unit', 'Spell', 'Gear', 'Rune', 'Battlefield'].map((t) => el('option', { value: t, text: TYPE_ES[t], selected: pool.type === t })),
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
  store.onChange((what) => {
    if (what === 'collection' && current) renderEditor();
    if (!current) renderList();
  });
  renderList();
}
