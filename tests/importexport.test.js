// Importar y exportar (web/js/importer.js, export.js y la lista de mazo de deckrules.js): lo que la app
// exporta se tiene que poder volver a importar tal cual, y las listas que se pegan a mano se entienden.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseList, parseDeckText, deckSection, splitHeader, guessMapping, buildIndex, matchRows, assembleDeck, readFile } from '../web/js/importer.js';
import { collectionCsv, toCsv } from '../web/js/export.js';
import { exportText } from '../web/js/deckrules.js';
import { cards, byId, named, jinxDeck } from './helpers.js';

const idx = buildIndex(cards);

/** Lo que hace la hoja de importar: cabecera, columnas, emparejar y marcar las filas encontradas. */
function match(sheet) {
  const { header, data } = splitHeader(sheet.rows);
  const rows = matchRows(data, guessMapping(header, data, idx), idx);
  rows.forEach((r) => { r.include = !!r.card; });
  return rows;
}

const deckParts = (d) => ({ legend: d.legend, champion: d.champion, main: d.main, runes: d.runes, battlefields: d.battlefields, sideboard: d.sideboard });

test('un mazo exportado en texto se vuelve a importar igual', () => {
  const deck = jinxDeck();
  const [spare] = cards.filter((c) => c.type === 'Spell' && !c.supertype && c.domain[0] === 'Chaos' && !deck.main[c.id]);
  deck.sideboard = { [spare.id]: 2 };
  const text = exportText(deck, byId);
  const [sheet] = parseDeckText(text);
  assert.equal(sheet.deckName, 'Jinx de prueba');
  const rows = match(sheet);
  assert.deepEqual(rows.filter((r) => r.status !== 'exact').map((r) => r.label), [], 'todas por código exacto');
  const { deck: back, notes } = assembleDeck(rows);
  assert.deepEqual(notes, []);
  assert.deepEqual(deckParts(back), deckParts(deck));
});

test('una lista de mazo de otra web, sin códigos ni Campeón marcado', () => {
  const text = [
    'Legend:', '1 Jinx - Loose Cannon',
    'Main Deck:', '3 Jinx - Demolitionist', '3x Called Shot',
    'Runes:', '6 Fury Rune', '6 Chaos Rune',
    'Battlefields:', '1 Back-Alley Bar',
  ].join('\n');
  const { deck, notes } = assembleDeck(match(parseDeckText(text)[0]));
  assert.equal(byId.get(deck.legend).name, 'Jinx - Loose Cannon');
  assert.equal(byId.get(deck.champion).name, 'Jinx - Demolitionist', 'el Campeón sale del mazo');
  assert.ok(notes.some((n) => n.startsWith('Campeón elegido automáticamente')));
  const main = Object.entries(deck.main).map(([id, n]) => [byId.get(id).name, n]);
  assert.deepEqual(main.sort(), [['Called Shot', 3], ['Jinx - Demolitionist', 2]]);
  assert.equal(Object.values(deck.runes).reduce((a, b) => a + b, 0), 12);
  assert.equal(deck.battlefields.length, 1);
});

test('secciones en español, inglés y con números', () => {
  assert.equal(deckSection('Mazo principal (40):'), 'main');
  assert.equal(deckSection('Runes - 12'), 'runes');
  assert.equal(deckSection('## Battlefields'), 'battlefields');
  assert.equal(deckSection('Campeón elegido'), 'champion');
  assert.equal(deckSection('Banquillo'), 'sideboard');
  assert.equal(deckSection('Brawl'), null);
});

test('lista suelta: «3x Nombre», «Nombre x3», «2 Nombre (CÓDIGO)»', () => {
  const [{ rows }] = parseList('# comentario\n3x Called Shot\nCalled Shot x2\n2 Back-Alley Bar (OGN-277)\nRunas:\n');
  assert.deepEqual(rows.slice(1), [['3', 'Called Shot', ''], ['2', 'Called Shot', ''], ['2', 'Back-Alley Bar', 'OGN-277']]);
});

test('emparejar: por código, por nombre, con faltas y cuando código y nombre no cuadran', () => {
  const rows = match({ rows: [['Copias', 'Nombre', 'Código'],
    ['1', 'Back-Alley Bar', 'OGN-277'],
    ['1', 'Called Shot', ''],
    ['1', 'Caled Shot', ''], // una falta; con dos («Caled Shoot») ya no llega al 82 % que se pide
    ['1', 'Called Shot', 'OGN-277'],
    ['1', 'Esto no es ninguna carta', ''],
  ] });
  assert.deepEqual(rows.map((r) => r.status), ['exact', 'name', 'fuzzy', 'check', 'missing']);
  assert.equal(rows[2].card.name, 'Called Shot');
});

test('la colección exportada en CSV se vuelve a importar con las mismas copias', async () => {
  const collection = {
    [named('Called Shot').id]: { n: 2, f: 0 },
    [named('Jinx - Demolitionist').id]: { n: 1, f: 1 }, // el CSV junta normales y foil en «Copias»
    [named('Back-Alley Bar').id]: { n: 3, f: 0 },
    [named('Jinx - Loose Cannon').id]: { n: 1, f: 0 },
  };
  const file = new File([collectionCsv(cards, collection)], 'coleccion_riftbound.csv', { type: 'text/csv' });
  const rows = match((await readFile(file))[0]);
  assert.deepEqual(rows.filter((r) => r.status !== 'exact').map((r) => r.label), []);
  const back = Object.fromEntries(rows.map((r) => [r.card.id, r.qty + r.foilQty]));
  const total = Object.fromEntries(Object.entries(collection).map(([id, e]) => [id, e.n + e.f]));
  assert.deepEqual(back, total);
});

test('CSV: comillas, comas y saltos de línea dentro de una celda', async () => {
  const csv = toCsv(['Nombre', 'Copias', 'Nota'], [['Called Shot', 2, 'dice "hola", y\nsigue'], ['Back-Alley Bar', 1, null]]);
  assert.ok(csv.startsWith('﻿'), 'lleva BOM para que Excel lea bien los acentos');
  const [{ rows }] = await readFile(new File([csv], 'x.csv'));
  assert.deepEqual(rows, [['Nombre', 'Copias', 'Nota'], ['Called Shot', '2', 'dice "hola", y\nsigue'], ['Back-Alley Bar', '1', '']]);
});
