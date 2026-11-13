// Lo que comparten las pruebas: las cartas de verdad (web/data/cards.json) y un mazo válido de Jinx
// hecho con ellas, para que cada prueba cambie solo lo que quiere comprobar.

import { readFileSync } from 'node:fs';
import { banInfo } from '../web/js/bans.js';
import { MAIN_TYPES } from '../web/js/deckrules.js';
import { baseName } from '../web/js/ui.js';

export const cards = JSON.parse(readFileSync(new URL('../web/data/cards.json', import.meta.url), 'utf8'));
export const byId = new Map(cards.map((c) => [c.id, c]));

/** La carta con ese nombre exacto (la primera impresión). Falla si no existe: las pruebas dependen de ella. */
export function named(name) {
  const c = cards.find((x) => x.name === name);
  if (!c) throw new Error(`No hay ninguna carta llamada «${name}» en cards.json`);
  return c;
}

/** Día fijo para los baneos: antes de los de Radiance (23 de noviembre de 2026) y después de los demás. */
export const BEFORE_RADIANCE = new Date('2026-11-13T12:00:00');
export const AFTER_RADIANCE = new Date('2026-12-01T12:00:00');

const notBanned = (c) => !banInfo(c, AFTER_RADIANCE);

/**
 * Mazo válido: Leyenda «Jinx - Loose Cannon» (Furia / Caos), Campeón «Jinx - Demolitionist», 13 cartas
 * distintas ×3 de Furia o Caos (39 + el Campeón = 40), 6 + 6 runas básicas y 3 Campos distintos.
 * Ninguna está baneada, así que vale con cualquier fecha.
 */
export function jinxDeck() {
  const legend = named('Jinx - Loose Cannon');
  const champion = named('Jinx - Demolitionist');
  const seen = new Set();
  const main = {};
  for (const c of cards) {
    if (Object.keys(main).length === 13) break;
    const ds = c.domain.filter((d) => d !== 'Colorless');
    if (!MAIN_TYPES.has(c.type) || c.supertype || !ds.length || !ds.every((d) => legend.domain.includes(d))) continue;
    if (!notBanned(c) || seen.has(baseName(c)) || baseName(c).startsWith('Jinx')) continue;
    seen.add(baseName(c));
    main[c.id] = 3;
  }
  const rune = (d) => cards.find((c) => c.type === 'Rune' && c.supertype === 'Basic' && c.rarity === 'Common' && c.domain[0] === d);
  const fields = [];
  for (const c of cards) {
    if (fields.length === 3) break;
    if (c.type === 'Battlefield' && notBanned(c) && !fields.some((f) => baseName(f) === baseName(c))) fields.push(c);
  }
  return {
    id: 'test', name: 'Jinx de prueba', legend: legend.id, champion: champion.id, main,
    runes: { [rune('Fury').id]: 6, [rune('Chaos').id]: 6 },
    battlefields: fields.map((c) => c.id), sideboard: {}, updated: 0,
  };
}
