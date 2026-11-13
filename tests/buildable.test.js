// «¿Qué mazos puedo montar?» (web/js/deckrules.js): cuánto tienes de cada mazo, el mejor de cada
// Leyenda y, para las Leyendas sin mazo, cuántas cartas tuyas encajan.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deckProgress, bestDeckPerLegend, fitCounter, legendKey, usage } from '../web/js/deckrules.js';
import { cards, byId, named, jinxDeck, BEFORE_RADIANCE } from './helpers.js';

const all = (deck) => (id) => usage(deck)[id] ?? 0; // tienes justo lo que pide el mazo
const none = () => 0;
const opts = (owned, price = () => 1) => ({ byId, owned, price, now: BEFORE_RADIANCE });

test('con todas las cartas: 100 % y no falta nada', () => {
  const deck = jinxDeck();
  const p = deckProgress(deck, opts(all(deck)));
  assert.equal(p.total, 56, 'Leyenda + Campeón + 39 + 12 runas + 3 campos');
  assert.equal(p.pct, 100);
  assert.equal(p.count, 0);
  assert.equal(p.cost, 0);
  assert.ok(p.complete);
});

test('sin ninguna: 0 % y el coste es el de todas las copias', () => {
  const deck = jinxDeck();
  const p = deckProgress(deck, opts(none, () => 0.5));
  assert.equal(p.pct, 0);
  assert.equal(p.count, 56);
  assert.equal(p.cost, 28);
});

test('el porcentaje solo llega a 100 si no falta nada; lo que no tiene precio no suma', () => {
  const deck = jinxDeck();
  const [id] = Object.keys(deck.main);
  const owned = (x) => (x === id ? 2 : all(deck)(x)); // falta 1 copia de 56
  const p = deckProgress(deck, opts(owned, () => null));
  assert.equal(p.count, 1);
  assert.equal(p.pct, 98);
  assert.equal(p.cost, 0);
});

test('un mazo a medio hacer no está completo', () => {
  const deck = { ...jinxDeck(), battlefields: [] };
  assert.equal(deckProgress(deck, opts(all(deck))).complete, false);
});

/** Otra carta de Furia que el mazo de Jinx no lleva (para cambiar una por otra y seguir en 40). */
function spare(deck) {
  return cards.find((c) => c.type === 'Spell' && !c.supertype && c.domain.length === 1 && c.domain[0] === 'Fury' && !deck.main[c.id]
    && !Object.keys(deck.main).some((x) => byId.get(x).name === c.name));
}
/** El mismo mazo cambiando las 3 copias de una carta por 3 de otra. */
function swap(deck, out, inn, id) {
  const main = { ...deck.main };
  delete main[out];
  main[inn] = 3;
  return { ...deck, id, main };
}

test('mejor mazo por Leyenda: el que más tienes, y las versiones de la Leyenda cuentan juntas', () => {
  const a = jinxDeck();
  const [id] = Object.keys(a.main);
  const extra = spare(a).id;
  const b = { ...swap(a, extra, extra, 'b'), legend: named('Jinx - Loose Cannon (Metal)').id }; // = a con otra Leyenda
  const mine = swap(a, id, extra, 'mío');
  const owned = (x) => (x === id ? 0 : 99); // de a y b faltan 3 copias de id; el mío no la lleva
  const rows = bestDeckPerLegend([{ deck: b, owner: { username: 'otra' } }, { deck: mine, owner: null }], opts(owned));
  assert.equal(rows.length, 1, 'Jinx y Jinx (Metal) son la misma Leyenda');
  assert.equal(rows[0].deck, mine);
  assert.equal(rows[0].owner, null);
  assert.equal(rows[0].others, 1);
  assert.equal(rows[0].progress.pct, 100);
});

test('a igual porcentaje, el más barato de completar', () => {
  const a = jinxDeck();
  const [id] = Object.keys(a.main);
  const extra = spare(a).id;
  const b = swap(a, id, extra, 'b');
  const owned = (x) => (x === id || x === extra ? 0 : 99); // a y b: faltan 3 copias cada uno
  const price = (x) => (x === id ? 10 : 1); // las de a cuestan 30 €; las de b, 3 €
  const rows = bestDeckPerLegend([{ deck: a, owner: null }, { deck: b, owner: { username: 'x' } }], opts(owned, price));
  assert.equal(rows[0].deck, b);
  assert.equal(rows[0].progress.count, 3);
  assert.equal(rows[0].progress.cost, 3);
});

test('se ignoran los mazos incompletos y los que llevan cartas que aquí no existen', () => {
  const half = { ...jinxDeck(), battlefields: [] };
  const unknown = { ...jinxDeck(), id: 'u', main: { ...jinxDeck().main, 'zzz-999-999': 1 } };
  assert.deepEqual(bestDeckPerLegend([{ deck: half, owner: null }, { deck: unknown, owner: null }], opts(() => 3)), []);
});

test('de más a menos completo', () => {
  const jinx = jinxDeck();
  const other = { ...jinxDeck(), id: 'o', legend: named('Kai\'Sa - Daughter of the Void').id };
  // Para el orden basta con el porcentaje: Kai'Sa no cumple dominios, pero sigue completo en número.
  const owned = (x) => (x === other.legend ? 0 : 99);
  const rows = bestDeckPerLegend([{ deck: other, owner: null }, { deck: jinx, owner: null }], opts(owned));
  assert.deepEqual(rows.map((r) => legendKey(r.legend)), ['Jinx - Loose Cannon', "Kai'Sa - Daughter of the Void"]);
});

test('cartas que encajan con una Leyenda: sus dominios, su firma y hasta 3 copias por nombre', () => {
  const shot = named('Called Shot'); // Caos
  const rocket = named('Super Mega Death Rocket! (Jinx)'); // firma de Jinx
  const rain = named('Icathian Rain (Kai\'Sa)'); // firma de Kai'Sa
  const owned = (id) => ({ [shot.id]: 5, [rocket.id]: 1, [rain.id]: 1 })[id] ?? 0;
  const fit = fitCounter(cards, owned);
  assert.equal(fit(named('Jinx - Loose Cannon')), 3 + 1, 'Called Shot (máximo 3) y el cohete de Jinx');
  assert.equal(fit(named('Kai\'Sa - Daughter of the Void')), 1, 'Furia / Mente: solo la lluvia de Kai\'Sa (Called Shot es de Caos)');
  assert.equal(fit(named('Lux - Lady of Luminosity')), 0, 'Mente / Orden: nada');
});
