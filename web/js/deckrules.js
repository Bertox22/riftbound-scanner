// Reglas de construcción de mazos, sin nada de la interfaz (se prueban en tests/deckrules.test.js).
//
//   - 1 Leyenda: define los dominios del mazo y el campeón.
//   - Mazo principal de al menos 40 cartas, incluido el Campeón elegido (una unidad Campeón
//     con la etiqueta de la Leyenda). Máximo 3 copias por nombre.
//   - Cartas de firma (Signature): máximo 3 y solo las del campeón de la Leyenda.
//   - 12 Runas de los dominios de la Leyenda.
//   - 3 Campos de batalla con nombres distintos.
//   - Sideboard de hasta 10 cartas válidas para el mazo principal (no Runas, Leyenda ni Campos).
//     El máximo de copias por nombre cuenta mazo + sideboard. Entre partidas se cambian 1 por 1.
//     (Reglas de torneo, 601.1.c y 403.4.)
//   - Sin cartas baneadas (bans.js).

import { baseName, cardCode } from './ui.js';
import { banInfo } from './bans.js';

export const MAIN_TYPES = new Set(['Unit', 'Spell', 'Gear']);
export const MAIN_SIZE = 40, RUNES = 12, BATTLEFIELDS = 3, MAX_COPIES = 3, MAX_SIGNATURE = 3, SIDEBOARD = 10;
export const isToken = (c) => c.supertype === 'Token';
export const champTag = (legend) => legend?.champion ?? legend?.tags?.[0];
/** ¿Es esta carta (Campeón o de firma) del campeón de la Leyenda? */
export const ofChampion = (card, legend) => (card.champion ?? null) === champTag(legend) || card.tags.includes(champTag(legend));

export function legalDomain(card, legend) {
  if (!legend) return true;
  const ds = card.domain.filter((d) => d !== 'Colorless');
  return ds.every((d) => legend.domain.includes(d));
}

export function section(card) {
  if (card.type === 'Legend') return 'legend';
  if (card.type === 'Rune') return 'runes';
  if (card.type === 'Battlefield') return 'battlefields';
  return 'main';
}

export function sum(obj) {
  return Object.values(obj ?? {}).reduce((a, b) => a + b, 0);
}

/** Sideboard del mazo (los mazos antiguos no lo tienen). */
export const side = (deck) => deck.sideboard ?? {};

/** Copias de cada id usadas en el mazo (para compararlas con la colección). */
export function usage(deck) {
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

/**
 * Comprueba un mazo. byId: Map id → carta; owned(id): copias que tienes (para «te faltan»);
 * now: fecha con la que se decide si un baneo ya ha entrado (por defecto, hoy).
 * Devuelve { issues, missing, mainCount, runeCount, sideCount, banned, soon, warnings }.
 */
export function validate(deck, { byId, owned = () => 0, now = new Date() }) {
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
    const b = c && banInfo(c, now);
    if (!b || seenBans.has(baseName(c))) continue;
    seenBans.add(baseName(c));
    if (b.only) warnings.push(`${c.name}: baneada en ${b.only}${b.upcoming ? ` a partir del ${b.dateText}` : ''}. En Standard se puede usar.`);
    else if (b.upcoming) { soon.push(c); warnings.push(`${c.name}: baneada a partir del ${b.dateText}. Hasta entonces se puede usar.`); }
    else banned.push(c);
  }
  issues.unshift(...banned.map((c) => `⛔ ${c.name}: carta baneada desde el ${banInfo(c, now).dateText}.`));

  const missing = [];
  for (const [id, n] of Object.entries(usage(deck))) {
    const lack = n - owned(id);
    if (lack > 0) missing.push([byId.get(id), lack]);
  }
  return { issues, missing, mainCount, runeCount, sideCount, banned, soon, warnings };
}

/** Lista del mazo en texto (la que se copia, se descarga y se vuelve a importar). */
export function exportText(deck, byId) {
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

// ---------- ¿Qué mazos puedo montar? ----------

/** La misma Leyenda en todas sus impresiones («(Metal)», « - Starter»…) da la misma clave. */
export const legendKey = (legend) => baseName(legend).replace(/\s*-\s*Starter$/i, '');

/** ¿Tiene el mazo todo lo que pide el formato? (Leyenda, Campeón, 40 en el principal, 12 runas y 3 campos.) */
const isComplete = (deck, v) => !!deck.legend && !!deck.champion && v.mainCount >= MAIN_SIZE && v.runeCount === RUNES && deck.battlefields.length === BATTLEFIELDS;

/**
 * Cuánto tienes de un mazo: el «¿Cuánto me falta?», contando cada copia (sideboard incluido).
 * price(id): lo que cuesta una copia, o null si no tiene precio.
 * Devuelve { total, have, pct, missing: [[carta, n]], count, cost, banned, complete }. pct se redondea
 * hacia abajo: solo es 100 si no falta nada.
 */
export function deckProgress(deck, { byId, owned = () => 0, price = () => null, now = new Date() }) {
  const v = validate(deck, { byId, owned, now });
  const total = sum(usage(deck));
  const count = v.missing.reduce((a, [, n]) => a + n, 0);
  return {
    total, have: total - count, pct: total ? Math.floor((100 * (total - count)) / total) : 0,
    missing: v.missing, count, cost: v.missing.reduce((a, [c, n]) => a + (price(c.id) ?? 0) * n, 0),
    banned: v.banned, complete: isComplete(deck, v),
  };
}

/**
 * El mejor mazo de cada Leyenda entre los que conoces (tuyos y de otros): el que más tienes y, si
 * empatan, el más barato de completar. Solo cuentan los mazos completos y con cartas que existen aquí.
 * entries: [{ deck, owner }] (owner: null si es tuyo).
 * Devuelve [{ legend, deck, owner, progress, others }] de más a menos completo; others: cuántos mazos más
 * había de esa Leyenda.
 */
export function bestDeckPerLegend(entries, { byId, owned, price, now }) {
  const best = new Map();
  for (const entry of entries) {
    const legend = byId.get(entry.deck.legend);
    if (!legend || !Object.keys(usage(entry.deck)).every((id) => byId.has(id))) continue;
    const progress = deckProgress(entry.deck, { byId, owned, price, now });
    if (!progress.complete) continue;
    const key = legendKey(legend);
    const cur = best.get(key);
    if (!cur) { best.set(key, { legend, ...entry, progress, others: 0 }); continue; }
    const better = progress.pct > cur.progress.pct || (progress.pct === cur.progress.pct && progress.cost < cur.progress.cost);
    best.set(key, better ? { legend, ...entry, progress, others: cur.others + 1 } : { ...cur, others: cur.others + 1 });
  }
  return [...best.values()].sort((a, b) => b.progress.pct - a.progress.pct || a.progress.cost - b.progress.cost);
}

/**
 * Para las Leyendas sin mazo conocido: cuántas cartas tuyas del mazo principal encajan con cada una
 * (de sus dominios y, las de firma, de su campeón), hasta 3 copias por nombre.
 * Devuelve una función legend → número.
 */
export function fitCounter(cards, owned) {
  const mine = new Map(); // nombre → [carta de ejemplo, copias (hasta 3)]
  for (const c of cards) {
    if (!MAIN_TYPES.has(c.type) || isToken(c) || !owned(c.id)) continue;
    const [, n] = mine.get(baseName(c)) ?? [c, 0];
    mine.set(baseName(c), [c, Math.min(MAX_COPIES, n + owned(c.id))]);
  }
  return (legend) => {
    let fit = 0;
    for (const [c, n] of mine.values()) {
      if (legalDomain(c, legend) && !(c.supertype === 'Signature' && !ofChampion(c, legend))) fit += n;
    }
    return fit;
  };
}
