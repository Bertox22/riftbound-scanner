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
import { deckRecord, newMatch, record, recordText, rateText, countText } from './matches.js';
import { cloud } from './cloud.js';
import { copyProfileLink } from './profile.js';
import { wantButton } from './trades.js';
import { openTestHand } from './testhand.js';
import { shareDeckImage } from './deckimage.js';
import { banInfo } from './bans.js';

const MAIN_TYPES = new Set(['Unit', 'Spell', 'Gear']);
const MAIN_SIZE = 40, RUNES = 12, BATTLEFIELDS = 3, MAX_COPIES = 3, MAX_SIGNATURE = 3, SIDEBOARD = 10;
/** Mazos por cuenta (la base de datos tampoco admite más: supabase/05_limite_mazos.sql). */
export const MAX_DECKS = 15;

/** ¿Cabe otro mazo? Si no, avisa. */
export function canAddDeck() {
  if (store.decks.length < MAX_DECKS) return true;
  toast(`Como máximo ${MAX_DECKS} mazos. Borra uno para crear otro.`, 3500);
  return false;
}

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

  // Baneos: los que ya están en vigor hacen que el mazo no sea legal; los que entran más adelante
  // y los que solo cuentan en 2v2 son avisos (el mazo se sigue pudiendo usar en Standard).
  const banned = [], soon = [], warnings = [];
  const seenBans = new Set();
  for (const id of Object.keys(usage(deck))) {
    const c = byId.get(id);
    const b = c && banInfo(c);
    if (!b || seenBans.has(baseName(c))) continue;
    seenBans.add(baseName(c));
    if (b.only) warnings.push(`${c.name}: baneada en ${b.only}${b.upcoming ? ` a partir del ${b.dateText}` : ''}. En Standard se puede usar.`);
    else if (b.upcoming) { soon.push(c); warnings.push(`${c.name}: baneada a partir del ${b.dateText}. Hasta entonces se puede usar.`); }
    else banned.push(c);
  }
  issues.unshift(...banned.map((c) => `⛔ ${c.name}: carta baneada desde el ${banInfo(c).dateText}.`));

  const missing = [];
  for (const [id, n] of Object.entries(usage(deck))) {
    const lack = n - store.owned(id);
    if (lack > 0) missing.push([byId.get(id), lack]);
  }
  return { issues, missing, mainCount, runeCount, sideCount, banned, soon, warnings };
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
  if (delta > 0 && bag[card.id] === 1) warnBan(card);
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
  const had = sec === 'legend' ? current.legend === card.id : sec === 'battlefields' ? current.battlefields.includes(card.id) : !!current[sec][card.id];
  if (delta > 0 && !had) warnBan(card);
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

/** Hoja con los formatos para exportar un mazo suelto (también desde la lista de mazos). */
function exportSheet(deck) {
  const dlg = $('#picker-dialog');
  const option = (label, hint, fn) => el('button', {
    class: 'export-option',
    onclick: async (e) => { await runExport(e.currentTarget, fn); dlg.close(); },
  }, el('strong', { text: label }), el('span', { class: 'muted small', text: hint }));
  dlg.replaceChildren(
    el('div', { class: 'dialog-head' }, el('h2', { text: `Exportar «${deck.name}»` }), el('button', { class: 'icon-btn', title: 'Cerrar', onclick: () => dlg.close() }, '✕')),
    el('div', { class: 'export-options' },
      option('Texto (.txt)', 'La lista del mazo; se puede volver a importar.', () => download(`${deck.name}.txt`, exportText(deck))),
      option('Excel (.xlsx)', 'El mazo completo por secciones, resumen y detalle.', () => exportDeckExcel(deck, exportCtx())),
      option('CSV (.csv)', 'Tabla con todas las columnas de cada carta.', () => exportDeckCsv(deck, exportCtx())),
      option('Copiar lista', 'Copia el texto para pegarlo donde quieras.', async () => {
        await navigator.clipboard.writeText(exportText(deck));
        toast('Lista copiada');
      }),
    ),
  );
  dlg.showModal();
}

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

// ---------- Sin mazos: «empieza aquí» ----------

/** La versión de una carta que tienes (o la primera que haya) entre las que comparten nombre. */
const pickVersion = (versions) => versions.find((c) => store.owned(c.id) > 0) ?? versions[0];

/**
 * Leyendas para empezar un mazo: las tres con las que más cartas tuyas encajan (contando hasta 3 copias
 * por nombre). Sin colección, las cuatro de la caja de inicio (Proving Grounds).
 */
function starterLegends() {
  const byName = new Map();
  for (const c of ctx.cards) {
    if (c.type !== 'Legend' || isToken(c)) continue;
    const b = banInfo(c);
    if (b && !b.upcoming && !b.only) continue; // una Leyenda baneada no sirve para empezar
    const k = baseName(c).replace(/\s*-\s*Starter$/i, '');
    byName.set(k, [...(byName.get(k) ?? []), c]);
  }
  const legends = [...byName.values()].map(pickVersion);
  if (!store.totalOwned()) return legends.filter((c) => c.set === 'OGS').map((legend) => ({ legend, fit: 0 }));
  const owned = new Map(); // nombre → copias (hasta 3) de cartas del mazo principal que tienes
  for (const c of ctx.cards) {
    if (!MAIN_TYPES.has(c.type) || isToken(c) || !store.owned(c.id)) continue;
    owned.set(c, Math.min(MAX_COPIES, (owned.get(c) ?? 0) + store.owned(c.id)));
  }
  const fitFor = (legend) => {
    const seen = new Map();
    for (const [c, n] of owned) {
      if (!legalDomain(c, legend) || (c.supertype === 'Signature' && !ofChampion(c, legend))) continue;
      seen.set(baseName(c), Math.min(MAX_COPIES, (seen.get(baseName(c)) ?? 0) + n));
    }
    return [...seen.values()].reduce((a, b) => a + b, 0);
  };
  return legends.map((legend) => ({ legend, fit: fitFor(legend), mine: store.owned(legend.id) > 0 }))
    .sort((a, b) => b.mine - a.mine || b.fit - a.fit)
    .slice(0, 3);
}

/** Crea un mazo con la Leyenda, su Campeón y 6 + 6 runas básicas de sus dominios, y lo abre. */
function startFromLegend(legend) {
  if (!canAddDeck()) return;
  const deck = newDeck();
  deck.name = champTag(legend) ?? baseName(legend);
  deck.legend = legend.id;
  const champs = ctx.cards.filter((c) => c.type === 'Unit' && c.supertype === 'Champion' && ofChampion(c, legend) && !banInfo(c));
  const champ = champs.find((c) => store.owned(c.id) > 0) ?? champs[0];
  if (champ) deck.champion = champ.id;
  const domains = legend.domain.filter((d) => d !== 'Colorless');
  domains.forEach((d, i) => {
    const runes = ctx.cards.filter((c) => c.type === 'Rune' && c.supertype === 'Basic' && c.domain.length === 1 && c.domain[0] === d);
    const rune = runes.find((c) => store.owned(c.id) > 0) ?? runes.find((c) => c.rarity === 'Common') ?? runes[0];
    if (rune) deck.runes[rune.id] = domains.length === 1 ? RUNES : i === 0 ? Math.ceil(RUNES / 2) : Math.floor(RUNES / 2);
  });
  openEditor(deck);
  save();
  toast('Mazo creado con su Leyenda, Campeón y runas. Ahora añade cartas.', 3500);
}

function emptyDecks() {
  const starters = starterLegends();
  const fresh = !store.totalOwned();
  return el('li', { class: 'empty-state' },
    el('div', { class: 'empty-icon', 'aria-hidden': 'true' }, icon('cards')),
    el('h3', { text: 'Monta tu primer mazo' }),
    el('p', { class: 'muted', text: fresh
      ? 'Elige una Leyenda y la app te dice qué cartas tienes y cuáles te faltan. Si escaneas tu colección primero, te propone las Leyendas que mejor encajan.'
      : 'Elige una Leyenda y la app te dice qué cartas tienes y cuáles te faltan.' }),
    el('div', { class: 'actions empty-actions' },
      el('button', { class: 'btn primary', onclick: () => canAddDeck() && openEditor(newDeck()) }, 'Crear mazo'),
      el('button', { class: 'btn ghost', onclick: () => $('#btn-import-deck').click() }, 'Importar una lista')),
    starters.length > 0 && el('p', { class: 'empty-sub', text: fresh ? 'O empieza con una Leyenda de la caja de inicio' : 'O empieza con la Leyenda que mejor encaja con tus cartas' }),
    starters.length > 0 && el('ul', { class: 'starter-list' }, starters.map(({ legend, fit, mine }) =>
      el('li', {},
        el('button', { class: 'starter-row', onclick: () => startFromLegend(legend) },
          cardImg(legend, 'thumb small'),
          el('span', { class: 'grow' },
            el('strong', { text: champTag(legend) ?? baseName(legend) }),
            el('span', { class: 'muted small', text: legend.domain.map((d) => DOMAIN_ES[d] || d).join(' / ')
              + (fresh ? '' : ` · tienes ${fit} ${fit === 1 ? 'carta que encaja' : 'cartas que encajan'}`) + (mine ? ' · tienes la Leyenda' : '') })),
          el('span', { class: 'chev', 'aria-hidden': 'true', text: '›' }))))),
  );
}

const names = (cards) => cards.map((c) => c.name).join(', ');

/**
 * Estado de un mazo en la lista. Con cartas baneadas: «No legal» y cuáles, y los demás avisos de reglas
 * en su propia línea (para que no se mezclen con el baneo). Si no, lo de siempre.
 */
function deckStatus({ issues, missing, banned, soon }) {
  const lack = missing.reduce((a, [, n]) => a + n, 0);
  const rest = issues.length - banned.length;
  const lines = banned.length
    ? [
      el('div', { class: 'deck-status danger', title: names(banned) },
        el('span', { class: 'illegal-tag', text: 'No legal' }),
        ` ${banned.length === 1 ? 'Carta baneada' : 'Cartas baneadas'}: ${names(banned)}`),
      rest > 0 && el('div', { class: 'warn small', text: rest === 1 ? '1 aviso más' : `${rest} avisos más` }),
    ]
    : [el('div', { class: issues.length ? 'warn' : 'ok', text: issues.length ? `${issues.length} pendiente(s)` : 'Mazo válido' + (lack ? ` · faltan ${lack} cartas` : '') })];
  if (soon.length) {
    const when = banInfo(soon[0]).dateText.replace(/ de \d{4}$/, '');
    lines.push(el('div', { class: 'warn small', title: names(soon), text: `⚠️ Deja de ser legal el ${when}: ${names(soon)}` }));
  }
  return lines;
}

function renderList() {
  const list = $('#deck-list');
  list.replaceChildren();
  $('#deck-count').textContent = `${store.decks.length}/${MAX_DECKS}`;
  $('#deck-export-all').hidden = !store.decks.length;
  if (!store.decks.length) {
    list.append(emptyDecks());
    return;
  }
  for (const deck of store.decks) {
    const legend = ctx.byId.get(deck.legend);
    const v = validate(deck);
    const { sideCount } = v;
    const rec = deckRecord(deck.id);
    list.append(
      el('li', { class: 'deck-row', onclick: () => openEditor(deck) },
        legend ? cardImg(legend, 'thumb small') : el('div', { class: 'thumb small placeholder' }, '?'),
        el('div', { class: 'grow' },
          el('strong', { text: deck.name }),
          el('div', { class: 'muted', text: (legend ? `${champTag(legend)} · ${legend.domain.map((d) => DOMAIN_ES[d] || d).join(' / ')}` : 'Sin leyenda') + (sideCount ? ` · sideboard ${sideCount}` : '') }),
          deckStatus(v),
          rec && el('div', { class: 'deck-record', title: rec.title, text: rec.text }),
        ),
        el('button', {
          class: 'icon-btn deck-export', title: 'Apuntar partida con este mazo', 'aria-label': `Apuntar partida con ${deck.name}`,
          onclick: (e) => { e.stopPropagation(); newMatch(deck.id); },
        }, icon('trophy')),
        el('button', {
          class: 'icon-btn deck-export', title: 'Exportar este mazo', 'aria-label': `Exportar ${deck.name}`,
          onclick: (e) => { e.stopPropagation(); exportSheet(deck); },
        }, icon('download')),
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
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  cards: '<rect x="8" y="3" width="11" height="15" rx="2"/><path d="M5 6.5v12A2.5 2.5 0 0 0 7.5 21H15"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5.5v1.5A2.5 2.5 0 0 0 8 10M16 6h2.5v1.5A2.5 2.5 0 0 1 16 10M12 13v4M8.5 20h7M10 17h4v3h-4z"/>',
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
    el('div', { class: 'dt-img' }, el('button', { class: 'tile-img', title: card.name, onclick: () => ctx.openCard(card) }, cardImg(card)), banMark(card), actions),
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

/** Marca «Baneada» (o «Ban 2v2») sobre la imagen; en gris si el baneo aún no ha entrado. */
function banMark(card) {
  const b = banInfo(card);
  return b && el('span', { class: `dt-ban${b.upcoming || b.only ? ' soft' : ''}`, title: b.text.replace(/^⛔ /, ''),
    text: b.upcoming ? `Ban ${new Date(`${b.date}T12:00:00`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}` : b.label });
}

/** Al meter una carta baneada en el mazo, se avisa (pero se deja: puede ser para casual o para antes del baneo). */
function warnBan(card) {
  const b = banInfo(card);
  if (b) toast(`⛔ ${card.name}: ${b.text.replace(/^⛔ /, '').replace(/^B/, 'b')}`, 4000);
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

/** Dominios de las runas que ya hay en el mazo. */
const runeDomains = () => new Set(Object.keys(current.runes).flatMap((id) => ctx.byId.get(id).domain));
/** Cuántos dominios de runa admite el mazo: los de la Leyenda (o 2 si aún no hay Leyenda). */
const runeDomainLimit = () => ctx.byId.get(current.legend)?.domain.filter((d) => d !== 'Colorless').length || 2;

/**
 * Qué añade cada hoja de "Añadir…" y cómo se cuenta en el mazo.
 * canAdd(c): si se puede sumar otra copia de esa carta; open(): si el grupo admite otra carta distinta.
 */
const ADDERS = {
  main: {
    title: 'Añadir cartas', empty: 'Añadir cartas', match: (c) => MAIN_TYPES.has(c.type),
    count: () => sum(current.main), target: () => MAIN_SIZE - (current.champion ? 1 : 0), copies: (c) => current.main[c.id] || 0,
  },
  runes: {
    title: 'Añadir runas', empty: 'Añadir runas', match: (c) => c.type === 'Rune',
    count: () => sum(current.runes), target: () => RUNES, copies: (c) => current.runes[c.id] || 0,
    // Solo runas de tantos dominios como la Leyenda: con los dos ya puestos, se suman copias de esas.
    canAdd: (c) => c.domain.some((d) => runeDomains().has(d)) || runeDomains().size < runeDomainLimit(),
    open: () => runeDomains().size < runeDomainLimit(),
  },
  battlefields: {
    title: 'Añadir campos', empty: 'Añadir campos', match: (c) => c.type === 'Battlefield',
    count: () => current.battlefields.length, target: () => BATTLEFIELDS, copies: (c) => current.battlefields.filter((id) => id === c.id).length,
    canAdd: () => current.battlefields.length < BATTLEFIELDS,
  },
};

/**
 * Hoja para añadir varias cartas de un grupo seguidas, sin cerrarla ni tocar el filtro de
 * "Añadir cartas". Sus propios "Solo las que tengo" y buscador se cambian a mano.
 */
function adder(kind) {
  const a = ADDERS[kind];
  const dlg = $('#picker-dialog');
  const legend = ctx.byId.get(current.legend);
  let onlyOwned = pool.owned, q = '';
  const cards = ctx.cards.filter((c) => !isToken(c) && a.match(c) && legalDomain(c, legend)
    && !(legend && c.supertype === 'Signature' && !ofChampion(c, legend)));
  cards.sort((x, y) => (x.energy ?? 99) - (y.energy ?? 99) || x.name.localeCompare(y.name));

  const title = el('h2');
  const grid = el('div', { class: 'grid' });
  const change = (c, d) => { addToDeck(c, d); draw(); };
  const draw = () => {
    title.replaceChildren(a.title, ' ', el('span', { class: 'muted', text: `${a.count()}/${a.target()}` }));
    const list = cards.filter((c) => (!onlyOwned || store.owned(c.id) > 0)
      && (!q || `${c.name} ${c.tags.join(' ')} ${c.text}`.toLowerCase().includes(q)));
    grid.replaceChildren(...list.slice(0, 300).map((c) => {
      const n = a.copies(c);
      const blocked = a.canAdd ? !a.canAdd(c) : false;
      return el('div', { class: `tile${blocked && !n ? ' dim' : ''}` },
        el('button', { class: 'tile-img', title: `Añadir ${c.name}`, disabled: blocked, onclick: () => change(c, 1) },
          cardImg(c), n > 0 && el('span', { class: 'badge', text: `×${n}` })),
        el('div', { class: 'tile-info' },
          el('span', { class: 'tile-name', title: c.name, text: c.name }),
          el('span', { class: 'muted small', text: `Tienes ${store.owned(c.id)}` }),
          el('div', { class: 'tile-qty' },
            el('button', { class: 'icon-btn small', title: 'Quitar una', disabled: !n, onclick: () => change(c, -1) }, '−'),
            el('span', { class: 'qty', text: n }),
            el('button', { class: 'icon-btn small', title: 'Añadir una', disabled: blocked, onclick: () => change(c, 1) }, '+'),
          ),
        ),
      );
    }));
    if (list.length > 300) grid.append(el('p', { class: 'muted', text: `…y ${list.length - 300} más. Usa el buscador.` }));
    if (!list.length) grid.append(el('p', { class: 'muted', text: onlyOwned ? 'No tienes ninguna. Desactiva «Solo las que tengo» para verlas todas.' : 'Sin resultados.' }));
  };
  dlg.replaceChildren(
    el('div', { class: 'dialog-head' }, title, el('button', { class: 'btn primary small', onclick: () => dlg.close() }, 'Listo')),
    el('div', { class: 'adder-filters' },
      kind === 'main' && el('input', { type: 'search', placeholder: 'Buscar…', oninput: (e) => { q = e.target.value.trim().toLowerCase(); draw(); } }),
      el('label', { class: 'toggle' }, el('input', { type: 'checkbox', checked: onlyOwned, onchange: (e) => { onlyOwned = e.target.checked; draw(); } }), el('span', { text: 'Solo las que tengo' })),
    ),
    grid,
  );
  draw();
  dlg.showModal();
}

/** Casilla "+ Añadir…" al final de un grupo que aún no llega a su número (o en su lugar, si está vacío). */
function addTile(kind, label = '', sep = false) {
  return emptyTile({ label, sep, text: ADDERS[kind].empty, onclick: () => adder(kind) });
}

/**
 * kind: "main" (botón para pasar al sideboard), "sideboard" (para volver al mazo) o null.
 * addKind: grupo de ADDERS; si se indica, el grupo acaba en "+ Añadir…" mientras no esté completo.
 */
function deckGroup(bag, label, kind = null, sep = false, addKind) {
  const entries = Object.entries(bag).map(([id, n]) => [ctx.byId.get(id), n]);
  entries.sort((a, b) => (a[0].energy ?? 99) - (b[0].energy ?? 99) || a[0].name.localeCompare(b[0].name));
  if (!entries.length) {
    if (addKind) return [addTile(addKind, label, sep)];
    return [emptyTile({ label, sep, text: 'Vacío. Usa «+ side» abajo o ↓ en una carta.' })];
  }
  const add = (c, d) => (kind === 'sideboard' ? addToSide(c, d) : addToDeck(c, d));
  const tiles = entries.map(([c, n], i) => deckTile({
    label: i === 0 ? label : '', sep: i === 0 && sep, card: c,
    actions: [
      kind === 'main' && MAIN_TYPES.has(c.type) && overlayBtn('down', 'Pasar una copia al sideboard', () => moveCard(c, 'sideboard')),
      kind === 'sideboard' && overlayBtn('up', 'Pasar una copia al mazo principal', () => moveCard(c, 'main')),
      lackBadge(n - store.owned(c.id)),
    ],
    below: qtyPill(n, () => add(c, -1), () => add(c, 1)),
  }));
  const spec = addKind && ADDERS[addKind];
  if (spec && spec.count() < spec.target() && (spec.open?.() ?? true)) tiles.push(addTile(addKind));
  return tiles;
}

function battlefieldGroup(label, sep) {
  if (!current.battlefields.length) return [addTile('battlefields', label, sep)];
  const tiles = current.battlefields.map((id, i) => {
    const c = ctx.byId.get(id);
    const used = current.battlefields.filter((b) => b === id).length; // por si se repite (el aviso de reglas ya lo marca)
    return deckTile({
      label: i === 0 ? label : '', sep: i === 0 && sep, card: c,
      actions: [overlayBtn('x', 'Quitar campo de batalla', () => addToDeck(c, -1)), lackBadge(used - store.owned(id))],
    });
  });
  if (current.battlefields.length < BATTLEFIELDS) tiles.push(addTile('battlefields'));
  return tiles;
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
      warnBan(c);
      save();
      renderEditor();
    });
  };

  root.replaceChildren(
    el('div', { class: 'section-head' },
      el('button', { class: 'btn ghost small', onclick: closeEditor }, '← Mazos'),
      el('div', { class: 'actions' },
        el('button', { class: 'btn ghost small', onclick: () => { navigator.clipboard?.writeText(exportText(current)).then(() => toast('Lista copiada')); } }, 'Copiar lista'),
        // Los tres formatos de descarga van juntos en una sola pastilla; borrar, aparte.
        el('div', { class: 'btn-group', role: 'group', 'aria-label': 'Descargar el mazo' },
          el('button', { class: 'btn ghost small', title: 'Lista en texto (.txt)', onclick: () => download(`${current.name}.txt`, exportText(current)) }, 'Texto'),
          el('button', { class: 'btn ghost small', title: 'Excel con todas las columnas y un resumen del mazo', onclick: (e) => runExport(e.target, () => exportDeckExcel(current, exportCtx())) }, 'Excel'),
          el('button', { class: 'btn ghost small', title: 'CSV con todas las columnas', onclick: (e) => runExport(e.target, () => exportDeckCsv(current, exportCtx())) }, 'CSV')),
        el('button', { class: 'btn danger small icon-only deck-delete', title: 'Borrar mazo', 'aria-label': 'Borrar mazo', onclick: () => {
          if (!confirm(`¿Borrar el mazo "${current.name}"?`)) return;
          store.decks = store.decks.filter((d) => d.id !== current.id);
          store.saveDecks();
          closeEditor();
        } }, icon('trash')),
      ),
    ),
    el('input', { class: 'deck-name', value: current.name, oninput: (e) => { current.name = e.target.value || 'Mazo'; save(); } }),
    // Compartir solo tiene sentido con cuenta: el mazo se ve desde la nube.
    cloud.username ? el('label', { class: 'toggle deck-share' },
      el('input', { type: 'checkbox', checked: !!current.shared, onchange: (e) => { current.shared = e.target.checked; save(); toast(current.shared ? 'Mazo compartido' : 'El mazo ya no se comparte'); } }),
      el('span', { text: 'Compartir este mazo' }),
      el('span', { class: 'muted small', text: current.shared ? 'Lo ve cualquiera con el enlace.' : 'Solo lo ves tú (salvo con el perfil público).' }),
      current.shared && el('button', { class: 'link small', type: 'button', onclick: (e) => { e.preventDefault(); copyProfileLink(cloud.username, current.id); } }, 'Copiar enlace')) : '',
    el('div', { class: 'deck-stats' },
      stat('Principal', v.mainCount, MAIN_SIZE),
      stat('Runas', v.runeCount, RUNES),
      stat('Campos', current.battlefields.length, BATTLEFIELDS),
      stat('Sideboard', v.sideCount, SIDEBOARD),
    ),
    curveBox(current),
    el('div', { class: 'actions deck-tools' },
      el('button', { class: 'btn ghost small', disabled: sum(current.main) < 6, onclick: () => openTestHand(current, ctx.byId) }, 'Mano de prueba'),
      el('button', { class: 'btn ghost small', disabled: !current.legend && !sum(current.main), onclick: (e) => runExport(e.target, () => shareDeckImage(current, ctx.byId, cloud.username ?? '')) }, 'Compartir imagen')),
    versionsBox(current),
    v.issues.length
      ? el('ul', { class: 'issues' }, v.issues.map((i) => el('li', { class: i.startsWith('⛔') ? 'banned' : null, text: i })))
      : el('p', { class: 'ok', text: '✓ El mazo cumple las reglas de construcción.' }),
    v.warnings.length > 0 ? el('ul', { class: 'issues ban-warnings' }, v.warnings.map((w) => el('li', { text: `⚠️ ${w}` }))) : '',
    // replaceChildren no ignora `false` (lo pintaría como texto), así que sin cartas que falten va ''.
    v.missing.length > 0 ? el('details', { class: 'missing' },
      el('summary', { text: `Te faltan ${v.missing.reduce((a, [, n]) => a + n, 0)} cartas de tu colección${missingCost(v.missing) ? ` (≈ ${eur(missingCost(v.missing))} en Cardmarket)` : ''}` }),
      el('ul', {}, v.missing.map(([c, n]) => el('li', { text: `${n}× ${c.name} (${cardCode(c)})${unitPrice(c.id) != null ? ` · ${eur(unitPrice(c.id) * n)}` : ''}` }))),
      el('div', { class: 'actions' }, wantButton(v.missing.map(([c, n]) => [c.id, n]))),
    ) : '',
    // Tablero: Leyenda y Campeón | mazo principal; debajo, Runas | Campos | Sideboard.
    el('div', { class: 'deck-board' },
      slotTile('Leyenda', current.legend, pickLegend, current.legend && (() => { current.legend = null; current.champion = null; save(); renderEditor(); })),
      slotTile('Campeón', current.champion, pickChampion, current.champion && (() => { current.champion = null; save(); renderEditor(); })),
      deckGroup(current.main, `Principal ${sum(current.main)}/${MAIN_SIZE - (current.champion ? 1 : 0)}`, 'main', true, 'main'),
    ),
    el('div', { class: 'deck-board' },
      deckGroup(current.runes, `Runas ${sum(current.runes)}/${RUNES}`, null, false, 'runes'),
      battlefieldGroup(`Campos ${current.battlefields.length}/${BATTLEFIELDS}`, true),
    ),
    // El sideboard no forma parte del mazo: va en su propia fila, tras otra línea.
    el('div', { class: 'deck-board' },
      deckGroup(side(current), `Sideboard ${sum(side(current))}/${SIDEBOARD}`, 'sideboard'),
    ),
    renderPool(legend, used),
  );
}

// ---------- Curva y dominios ----------

const CURVE_MAX = 7; // de 7 en adelante, una sola barra "7+"
let curveOpen = false; // el plegable se queda como estaba al repintar el editor

/**
 * Curva de energía, tipos y dominios del mazo principal (con el Campeón): { curve: [n por coste 0..7+],
 * avg, total, types: [[nombre, n]], domains: [{ id, cards, power, runes }] } con los dominios de la
 * Leyenda primero (y los de cartas o runas que no son suyos, después).
 */
export function deckCurve(deck) {
  const { byId } = ctx;
  const legend = byId.get(deck.legend);
  const entries = Object.entries(deck.main).map(([id, n]) => [byId.get(id), n]).filter(([c]) => c);
  const champion = byId.get(deck.champion);
  if (champion) entries.push([champion, 1]);
  const curve = Array(CURVE_MAX + 1).fill(0);
  const types = {};
  const domains = new Map((legend?.domain ?? []).map((d) => [d, { id: d, cards: 0, power: 0, runes: 0 }]));
  const dom = (d) => (domains.has(d) ? domains : domains.set(d, { id: d, cards: 0, power: 0, runes: 0 })).get(d);
  let total = 0, energy = 0;
  for (const [c, n] of entries) {
    const cost = c.energy ?? 0;
    curve[Math.min(cost, CURVE_MAX)] += n;
    total += n;
    energy += cost * n;
    const type = TYPE_ES[c.type] || c.type;
    types[type] = (types[type] || 0) + n;
    for (const d of c.domain.length ? c.domain : ['Colorless']) {
      dom(d).cards += n;
      dom(d).power += (c.power ?? 0) * n;
    }
  }
  for (const [id, n] of Object.entries(deck.runes)) {
    const c = byId.get(id);
    for (const d of c?.domain ?? []) dom(d).runes += n;
  }
  return {
    curve, total, avg: total ? energy / total : null,
    types: Object.entries(types).sort((a, b) => b[1] - a[1]),
    domains: [...domains.values()].filter((d) => d.cards || d.runes || legend?.domain.includes(d.id)),
  };
}

function curveBox(deck) {
  const k = deckCurve(deck);
  if (!k.total) return '';
  const top = Math.max(...k.curve, 1);
  const fmt = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 });
  return el('details', { class: 'curve-box', open: curveOpen, ontoggle: (e) => { curveOpen = e.target.open; } },
    el('summary', {},
      el('span', { text: 'Curva y dominios' }),
      el('span', { class: 'muted small', text: `coste medio ${fmt.format(k.avg)} · ${k.domains.filter((d) => d.cards).map((d) => `${DOMAIN_ES[d.id] || d.id} ${d.cards}`).join(' / ')}` })),
    el('div', { class: 'curve', role: 'img', 'aria-label': `Curva de energía: ${k.curve.map((n, i) => `${n} de coste ${i === CURVE_MAX ? `${i} o más` : i}`).join(', ')}` },
      ...k.curve.map((n, i) => el('div', { class: 'curve-col' },
        el('span', { class: 'curve-n small', text: n || '' }),
        el('div', { class: 'curve-bar', style: `height:${(100 * n) / top}%` }),
        el('span', { class: 'curve-cost small muted', text: i === CURVE_MAX ? `${i}+` : String(i) })))),
    el('p', { class: 'muted small curve-caption', text: `Coste de energía del principal y el Campeón (${k.total} cartas). ${k.types.map(([t, n]) => `${t}: ${n}`).join(' · ')}` }),
    el('table', { class: 'domain-table' },
      el('thead', {}, el('tr', {}, el('th', { text: 'Dominio' }), el('th', { text: 'Cartas' }), el('th', { text: 'Poder', title: 'Símbolos de poder (runas de ese dominio) que piden las cartas, sumados' }), el('th', { text: 'Runas' }))),
      el('tbody', {}, ...k.domains.map((d) => el('tr', {},
        el('td', { text: DOMAIN_ES[d.id] || d.id }),
        el('td', { text: d.cards }),
        el('td', { text: d.power || '—' }),
        el('td', { text: d.id === 'Colorless' ? '—' : d.runes }))))));
}

// ---------- Notas y versiones ----------
// Una versión es una foto del mazo que guarda el usuario («Guardar versión»), con una nota opcional.
// Los cambios se calculan comparando cada foto con la anterior, y las partidas caen en la versión
// que estaba vigente en su fecha: así se ve «desde que quité X, 7–2».

const MAX_VERSIONS = 20;
let versionsOpen = false;

const snapshotOf = (d) => structuredClone({
  legend: d.legend ?? null, champion: d.champion ?? null, main: d.main ?? {}, runes: d.runes ?? {},
  battlefields: d.battlefields ?? [], sideboard: d.sideboard ?? {},
});

/** Cambios entre dos fotos del mazo: ["+2 Shuriken Flip", "−1 Brawl (sideboard)", …]. */
export function deckDiff(a, b) {
  const { byId } = ctx;
  const name = (id) => (byId.get(id) ? baseName(byId.get(id)) : id);
  const out = [];
  const bag = (d, where) => {
    const m = { ...(d?.[where] ?? {}) };
    if (where === 'main' && d?.champion) m[d.champion] = (m[d.champion] || 0) + 1;
    if (where === 'battlefields') return Object.fromEntries((d?.battlefields ?? []).map((id) => [id, 1]));
    return m;
  };
  if ((a?.legend ?? null) !== (b?.legend ?? null)) out.push(`Leyenda: ${b?.legend ? name(b.legend) : '—'}`);
  for (const [where, tag] of [['main', ''], ['sideboard', ' (sideboard)'], ['runes', ' (runas)'], ['battlefields', ' (Campo)']]) {
    const x = bag(a, where), y = bag(b, where);
    // Por nombre: cambiar una carta por otra versión de la misma no es un cambio del mazo.
    const byName = new Map();
    for (const [id, n] of Object.entries(x)) byName.set(name(id), (byName.get(name(id)) ?? 0) - n);
    for (const [id, n] of Object.entries(y)) byName.set(name(id), (byName.get(name(id)) ?? 0) + n);
    const changes = [...byName].filter(([, d]) => d).sort((p, q) => q[1] - p[1] || p[0].localeCompare(q[0]));
    for (const [n, d] of changes) out.push(`${d > 0 ? '+' : '−'}${Math.abs(d)} ${n}${tag}`);
  }
  return out;
}

/** Las partidas de este mazo repartidas por versión: [{ version, index, from, to, matches }], la más nueva primero. */
function matchesByVersion(deck) {
  const versions = deck.versions ?? [];
  const list = store.matches.filter((m) => m.deck === deck.id);
  const spans = versions.map((v, i) => ({ version: v, index: i + 1, from: v.at, to: versions[i + 1]?.at ?? Infinity }));
  if (versions.length) spans.unshift({ version: null, index: 0, from: -Infinity, to: versions[0].at });
  for (const s of spans) s.matches = list.filter((m) => m.at >= s.from && m.at < s.to);
  return spans.reverse();
}

const dayFmt = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' });
const recordLine = (list) => {
  if (!list.length) return 'Sin partidas';
  const r = record(list);
  return `${recordText(r)}${r.rate == null ? '' : ` · ${rateText(r)}`} · ${countText(r)}`;
};

function versionsBox(deck) {
  const versions = deck.versions ?? [];
  const last = versions.at(-1);
  const pending = last ? deckDiff(last.deck, snapshotOf(deck)) : null;
  const spans = matchesByVersion(deck);
  const noteInput = el('input', { class: 'version-note', maxlength: 120, placeholder: 'Nota (opcional)', title: 'Nota de esta versión, por ejemplo «−2 Brawl, +2 Shuriken Flip»' });
  const saveVersion = () => {
    deck.versions = [...versions, { id: crypto.randomUUID?.() ?? String(Date.now()), at: Date.now(), note: noteInput.value.trim(), deck: snapshotOf(deck) }];
    if (deck.versions.length > MAX_VERSIONS) {
      deck.versions = deck.versions.slice(-MAX_VERSIONS);
      toast(`Solo se guardan las ${MAX_VERSIONS} últimas versiones: se ha quitado la más antigua.`);
    }
    save();
    renderEditor();
    toast(`Guardada la versión ${deck.versions.length}`);
  };
  const removeVersion = (v) => {
    if (!confirm(`¿Quitar la versión del ${dayFmt.format(v.at)}? Sus partidas pasan a la versión anterior.`)) return;
    deck.versions = versions.filter((x) => x.id !== v.id);
    save();
    renderEditor();
  };
  const now = spans[0];
  return el('details', { class: 'versions-box', open: versionsOpen, ontoggle: (e) => { versionsOpen = e.target.open; } },
    el('summary', {},
      el('span', { text: 'Notas y versiones' }),
      el('span', { class: 'muted small', text: versions.length
        ? `v${versions.length} · ${recordLine(now.matches).split(' · ').slice(0, 2).join(' · ')}`
        : deck.notes ? 'con notas' : 'sin versiones' })),
    el('textarea', {
      class: 'deck-notes', rows: 3, maxlength: 4000, placeholder: 'Notas del mazo: plan de juego, mulligan, cambios contra cada Leyenda…',
      oninput: (e) => { deck.notes = e.target.value; save(); },
    }, deck.notes ?? ''),
    pending?.length > 0 && el('p', { class: 'small version-pending', text: `Cambios desde la v${versions.length}: ${pending.join(', ')}` }),
    el('div', { class: 'version-save' }, noteInput,
      el('button', { class: 'btn primary small', disabled: !!last && !pending.length, onclick: saveVersion },
        versions.length ? 'Guardar versión' : 'Guardar la primera versión')),
    !versions.length && el('p', { class: 'muted small', text: 'Guarda una versión cada vez que cambies cartas: las partidas se reparten por versión según su fecha, para ver cómo le va a cada una.' }),
    versions.length > 0 && el('ul', { class: 'version-list' }, ...spans.map((s) => {
      const v = s.version;
      if (!v) return s.matches.length ? el('li', { class: 'version-row' },
        el('div', { class: 'grow' }, el('strong', { text: 'Antes de la v1' }), el('div', { class: 'muted small', text: recordLine(s.matches) }))) : null;
      const prev = versions[s.index - 2];
      const changes = prev ? deckDiff(prev.deck, v.deck) : [];
      return el('li', { class: `version-row${s.index === versions.length ? ' current' : ''}` },
        el('div', { class: 'grow' },
          el('strong', { text: `v${s.index} · desde el ${dayFmt.format(v.at)}${s.index === versions.length ? ' (la actual)' : ''}` }),
          v.note && el('div', { class: 'small', text: `«${v.note}»` }),
          el('div', { class: 'muted small', text: prev ? (changes.length ? changes.join(', ') : 'Sin cambios de cartas') : 'Primera versión' }),
          el('div', { class: 'version-record small', text: recordLine(s.matches) })),
        el('button', { class: 'icon-btn small', title: 'Quitar esta versión', 'aria-label': 'Quitar esta versión', onclick: () => removeVersion(v) }, '✕'));
    }).filter(Boolean)));
}

/** Lo que costaría comprar en Cardmarket las cartas que faltan (las que tienen precio). */
function missingCost(missing) {
  return missing.reduce((a, [c, n]) => a + (unitPrice(c.id) ?? 0) * n, 0);
}

/** Lo que te falta de tu colección para un mazo (también de otro jugador): { missing: [[carta, n]], count, cost }. */
export function missingFor(deck) {
  const { missing } = validate(deck);
  return { missing, count: missing.reduce((a, [, n]) => a + n, 0), cost: missingCost(missing) };
}

/** Copia el mazo de otro jugador a tus mazos y lo abre en el editor. Devuelve false si no cabe. */
export function copyToMyDecks(deck, owner) {
  if (!canAddDeck()) return false;
  const copy = {
    ...newDeck(), name: `${deck.name} (de ${owner})`.slice(0, 80), legend: deck.legend, champion: deck.champion,
    main: structuredClone(deck.main), runes: structuredClone(deck.runes), battlefields: [...deck.battlefields], sideboard: structuredClone(deck.sideboard ?? {}),
  };
  store.decks.unshift(copy);
  store.saveDecks();
  openEditor(copy);
  return true;
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
  let onlyOwned = true; // se quita a mano si se quiere ver todas
  const grid = el('div', { class: 'grid' });
  const draw = () => {
    const list = cards.filter((c) => !onlyOwned || store.owned(c.id) > 0);
    grid.replaceChildren(...list.map((c) => el('button', { class: 'tile tile-img', onclick: () => { dlg.close(); onPick(c); } },
      cardImg(c), el('span', { class: 'tile-name', text: `${c.name}${c.tags[0] && !c.name.includes(c.tags[0]) ? ` (${c.tags[0]})` : ''}` }), el('span', { class: 'muted small', text: `Tienes ${store.owned(c.id)}` }))));
    if (!list.length) grid.append(el('p', { class: 'muted', text: onlyOwned ? 'No tienes ninguna. Desactiva «Solo las que tengo» para verlas todas.' : 'No hay cartas disponibles.' }));
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
  $('#btn-new-deck').addEventListener('click', () => canAddDeck() && openEditor(newDeck()));
  $('#btn-decks-excel').addEventListener('click', (e) => runExport(e.target, () => exportAllDecksExcel(store.decks, exportCtx())));
  $('#btn-decks-csv').addEventListener('click', (e) => runExport(e.target, () => exportAllDecksCsv(store.decks, exportCtx())));
  $('#btn-decks-txt').addEventListener('click', () => exportAllDecksText(store.decks, exportText));
  store.onChange((what) => {
    if (what === 'collection' && current) renderEditor();
    if (!current) renderList();
  });
  renderList();
}
