// Validación de mazos (web/js/deckrules.js): cada regla de construcción y los baneos.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate, usage } from '../web/js/deckrules.js';
import { byId, cards, named, jinxDeck, BEFORE_RADIANCE, AFTER_RADIANCE } from './helpers.js';

const check = (deck, extra = {}) => validate(deck, { byId, now: BEFORE_RADIANCE, ...extra });
/** ¿Algún aviso contiene este texto? */
const has = (v, text) => v.issues.some((i) => i.includes(text));

test('el mazo de Jinx de prueba es válido', () => {
  const v = check(jinxDeck());
  assert.deepEqual(v.issues, []);
  assert.equal(v.mainCount, 40);
  assert.equal(v.runeCount, 12);
  assert.equal(v.sideCount, 0);
  assert.deepEqual(v.warnings, []);
});

test('sin Leyenda ni Campeón lo pide', () => {
  const v = check({ ...jinxDeck(), legend: null, champion: null });
  assert.ok(has(v, 'Elige una Leyenda'));
  assert.ok(has(v, 'Elige el Campeón'));
  assert.equal(v.mainCount, 39, 'sin Campeón el principal cuenta una menos');
});

test('el Campeón tiene que ser del campeón de la Leyenda', () => {
  const v = check({ ...jinxDeck(), champion: named('Volibear - Imposing').id });
  assert.ok(has(v, 'El Campeón debe ser de Jinx'));
});

test('el principal necesita 40 cartas', () => {
  const deck = jinxDeck();
  const first = Object.keys(deck.main)[0];
  deck.main[first] = 1;
  const v = check(deck);
  assert.equal(v.mainCount, 38);
  assert.ok(has(v, 'Mazo principal: 38/40 (faltan 2)'));
});

test('más de 40 cartas en el principal sí vale', () => {
  const deck = jinxDeck();
  const extra = cards.find((c) => c.type === 'Spell' && !c.supertype && c.domain.length === 1 && c.domain[0] === 'Fury' && !deck.main[c.id]
    && !Object.keys(deck.main).some((id) => byId.get(id).name === c.name));
  deck.main[extra.id] = 2;
  const v = check(deck);
  assert.equal(v.mainCount, 42);
  assert.ok(!has(v, 'Mazo principal'));
});

test('hacen falta exactamente 12 runas', () => {
  const deck = jinxDeck();
  const [fury] = Object.keys(deck.runes);
  deck.runes[fury] = 7;
  assert.ok(has(check(deck), 'Runas: 13/12'));
});

test('3 Campos de batalla con nombres distintos', () => {
  const deck = jinxDeck();
  assert.ok(has(check({ ...deck, battlefields: deck.battlefields.slice(0, 2) }), 'Campos de batalla: 2/3'));
  const twice = [deck.battlefields[0], deck.battlefields[0], deck.battlefields[1]];
  assert.ok(has(check({ ...deck, battlefields: twice }), 'nombres distintos'));
});

test('como máximo 3 copias por nombre, contando todas las versiones', () => {
  const deck = jinxDeck();
  const [id] = Object.keys(deck.main);
  const card = byId.get(id);
  const other = cards.find((c) => c.id !== id && c.name === card.name);
  if (other) deck.main[other.id] = 1; // otra impresión de la misma carta
  else deck.main[id] = 4;
  assert.ok(has(check(deck), `${card.name}: 4 copias`));
});

test('el límite de copias cuenta mazo y sideboard juntos', () => {
  const deck = jinxDeck();
  const [id] = Object.keys(deck.main);
  deck.sideboard = { [id]: 1 };
  const v = check(deck);
  assert.equal(v.sideCount, 1);
  assert.ok(has(v, '4 copias entre mazo y sideboard'));
});

test('el sideboard admite hasta 10 cartas y solo del mazo principal', () => {
  const deck = jinxDeck();
  const spells = cards.filter((c) => c.type === 'Spell' && !c.supertype && c.domain.length === 1 && c.domain[0] === 'Chaos' && !deck.main[c.id]);
  const names = new Set();
  for (const c of spells) {
    if (names.size === 4 || names.has(c.name)) continue;
    names.add(c.name);
    deck.sideboard[c.id] = 3;
  }
  assert.ok(has(check(deck), 'Sideboard: 12 cartas (máximo 10)'));
  const rune = Object.keys(deck.runes)[0];
  assert.ok(has(check({ ...jinxDeck(), sideboard: { [rune]: 1 } }), 'el sideboard solo admite cartas del mazo principal'));
});

test('las cartas tienen que ser de los dominios de la Leyenda', () => {
  const deck = jinxDeck();
  const calm = cards.find((c) => c.type === 'Unit' && !c.supertype && c.domain.length === 1 && c.domain[0] === 'Calm');
  deck.main[calm.id] = 1;
  assert.ok(has(check(deck), `${calm.name}: no es de los dominios de tu Leyenda`));
});

test('cartas de firma: solo las del campeón de la Leyenda y como máximo 3', () => {
  const deck = jinxDeck();
  const rocket = named('Super Mega Death Rocket! (Jinx)');
  deck.main[rocket.id] = 3;
  assert.ok(!has(check(deck), 'carta de firma'), 'las de Jinx valen');
  const other = { ...jinxDeck(), main: { ...jinxDeck().main, [named('Icathian Rain (Kai\'Sa)').id]: 1 } };
  assert.ok(has(check(other), 'es una carta de firma de otro campeón'));
});

test('te faltan: las copias del mazo que no tienes', () => {
  const deck = jinxDeck();
  const [id] = Object.keys(deck.main);
  const owned = (x) => (x === id ? 1 : 99);
  const v = check(deck, { owned });
  assert.deepEqual(v.missing.map(([c, n]) => [c.id, n]), [[id, 2]]);
  assert.equal(check(deck).missing.length, Object.keys(usage(deck)).length, 'sin colección te falta todo');
});

test('una carta baneada hace el mazo no legal', () => {
  const deck = jinxDeck();
  const shot = named('Called Shot'); // baneada desde el 31 de marzo de 2026
  deck.main[shot.id] = 1;
  const v = check(deck);
  assert.deepEqual(v.banned.map((c) => c.name), ['Called Shot']);
  assert.match(v.issues[0], /^⛔ Called Shot: carta baneada desde el 31 de marzo de 2026\.$/, 'el baneo va el primero');
});

test('un baneo que aún no ha entrado es solo un aviso, y cuenta a partir de su fecha', () => {
  const deck = jinxDeck();
  const riven = named('Riven - Broken Blade'); // baneada desde el 23 de noviembre de 2026
  deck.main[riven.id] = 1;
  const before = check(deck);
  assert.deepEqual(before.banned, []);
  assert.deepEqual(before.soon.map((c) => c.name), ['Riven - Broken Blade']);
  assert.ok(before.warnings.some((w) => w.includes('a partir del 23 de noviembre de 2026')));
  const after = check(deck, { now: AFTER_RADIANCE });
  assert.deepEqual(after.banned.map((c) => c.name), ['Riven - Broken Blade']);
  assert.deepEqual(after.soon, []);
});

test('un baneo solo de 2v2 no hace el mazo no legal', () => {
  const deck = jinxDeck();
  const yi = named('Master Yi - Wuju Bladesman');
  const v = check({ ...deck, legend: yi.id });
  assert.deepEqual(v.banned, []);
  assert.ok(v.warnings.some((w) => w.includes('baneada en 2v2')));
});

test('el baneo vale para todas las versiones de la carta y se avisa una vez', () => {
  const deck = jinxDeck();
  const versions = cards.filter((c) => c.name.startsWith('Called Shot'));
  for (const c of versions) deck.main[c.id] = 1;
  const v = check(deck);
  assert.equal(v.banned.length, 1);
  assert.equal(v.issues.filter((i) => i.startsWith('⛔')).length, 1);
});
