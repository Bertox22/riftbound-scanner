// Copias de seguridad y primera sincronización (web/js/merge.js): leer el archivo y juntar sus datos con
// los de aquí según lo que se elija, sin perder ni duplicar nada.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readBackup, mergeBackup, joinCollection, joinById, countCards, sameCollection, sameById, autoPlan } from '../web/js/merge.js';

const here = () => ({
  collection: { a: { n: 2, f: 0 }, b: { n: 1, f: 1 } },
  decks: [{ id: 'd1', name: 'Mío' }, { id: 'd2', name: 'Compartido (versión de aquí)' }],
  matches: [{ id: 'm1', at: 100 }, { id: 'm2', at: 300 }],
  ledger: [{ id: 'l1', at: 50 }],
});
const file = () => ({
  collection: { a: { n: 1, f: 2 }, c: { n: 4, f: 0 } },
  decks: [{ id: 'd2', name: 'Compartido (versión de la copia)' }, { id: 'd3', name: 'De la copia' }],
  matches: [{ id: 'm2', at: 300 }, { id: 'm3', at: 200 }],
  ledger: [{ id: 'l2', at: 80 }],
});

test('leer una copia: limpia cantidades raras y descarta lo que no sirve', () => {
  const b = readBackup({
    collection: { a: { n: '2', f: 1.7 }, z: { n: 0, f: 0 }, neg: { n: -3, f: 0 }, junk: null },
    decks: [{ id: 'd1' }, null, { name: 'sin id' }, 'texto'],
    matches: 'no es una lista',
  });
  assert.deepEqual(b.collection, { a: { n: 2, f: 1 } });
  assert.deepEqual(b.decks, [{ id: 'd1' }]);
  assert.deepEqual(b.matches, []);
  assert.equal(b.ledger, null, 'las copias antiguas no traen balance');
});

test('un archivo que no es una copia de la app da un error claro', () => {
  for (const bad of [null, {}, { collection: [] }, { collection: 'x' }]) {
    assert.throws(() => readBackup(bad), /no es una copia de Riftbound Scanner/);
  }
});

test('cartas: la cantidad mayor, sumar, solo la copia o dejar las mías', () => {
  const [l, r] = [here().collection, file().collection];
  assert.deepEqual(joinCollection(l, r, 'max'), { a: { n: 2, f: 2 }, b: { n: 1, f: 1 }, c: { n: 4, f: 0 } });
  assert.deepEqual(joinCollection(l, r, 'sum'), { a: { n: 3, f: 2 }, b: { n: 1, f: 1 }, c: { n: 4, f: 0 } });
  assert.deepEqual(joinCollection(l, r, 'cloud'), r);
  assert.deepEqual(joinCollection(l, r, 'device'), l);
  assert.equal(countCards(joinCollection(l, r, 'sum')), 11);
});

test('juntar no modifica lo que había (para poder deshacer)', () => {
  const h = here(), f = file();
  const before = structuredClone(h);
  mergeBackup(h, f, { cards: 'sum', decks: 'merge', matches: 'merge', ledger: 'merge' });
  assert.deepEqual(h, before);
  assert.deepEqual(f, file());
});

test('mazos y partidas: juntar sin repetir; si un id está en los dos, se queda el de aquí', () => {
  const decks = joinById(here().decks, file().decks, 'merge');
  assert.deepEqual(decks.map((d) => d.id), ['d1', 'd2', 'd3']);
  assert.equal(decks[1].name, 'Compartido (versión de aquí)');
});

test('importar una copia: cada cosa según lo elegido, partidas de la más nueva a la más vieja', () => {
  const out = mergeBackup(here(), file(), { cards: 'max', decks: 'cloud', matches: 'merge', ledger: 'merge' });
  assert.deepEqual(out.collection, { a: { n: 2, f: 2 }, b: { n: 1, f: 1 }, c: { n: 4, f: 0 } });
  assert.deepEqual(out.decks.map((d) => d.id), ['d2', 'd3']);
  assert.deepEqual(out.matches.map((m) => m.id), ['m2', 'm3', 'm1']);
  assert.deepEqual(out.ledger.map((x) => x.id), ['l2', 'l1']);
});

test('lo que no se elige se deja como está, y sin balance en la copia no se toca', () => {
  const f = { ...file(), ledger: null };
  const out = mergeBackup(here(), f, {});
  assert.deepEqual(out.collection, here().collection);
  assert.deepEqual(out.decks, here().decks);
  assert.deepEqual(out.ledger, here().ledger);
});

test('importar dos veces la misma copia no duplica nada', () => {
  const picks = { cards: 'max', decks: 'merge', matches: 'merge', ledger: 'merge' };
  const once = mergeBackup(here(), file(), picks);
  const twice = mergeBackup(once, file(), picks);
  assert.deepEqual(twice, once);
});

test('cuándo no hace falta preguntar', () => {
  assert.equal(autoPlan(false, false, true), 'same');
  assert.equal(autoPlan(true, false, false), 'cloud');
  assert.equal(autoPlan(false, true, false), 'device');
  assert.equal(autoPlan(false, false, false), null);
  assert.ok(sameCollection({ a: { n: 1, f: 0 } }, { a: { n: 1, f: 0 }, b: { n: 0, f: 0 } }), 'una carta con 0 copias es como no tenerla');
  assert.ok(!sameCollection({ a: { n: 1, f: 0 } }, { a: { n: 1, f: 1 } }));
  const key = (x) => JSON.stringify(x);
  assert.ok(sameById([{ id: 1, v: 'a' }, { id: 2, v: 'b' }], [{ id: 2, v: 'b' }, { id: 1, v: 'a' }], key), 'el orden no cuenta');
  assert.ok(!sameById([{ id: 1, v: 'a' }], [{ id: 1, v: 'b' }], key));
});
