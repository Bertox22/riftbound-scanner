// Exportación a Excel, CSV y texto.
//
// Colección, con el formato de "coleccion_riftbound.xlsx":
//   Set | Nº | Tipo | Color | Nombre | Might | Energía | Poder | Color de poder | Copias | Texto | Errata
//   + hoja "Resumen" con totales por set y por tipo.
// Mazos: las mismas columnas con "Sección" delante y "Tengo" tras "Copias", más un resumen del mazo
// (Leyenda, dominios, curva de energía, avisos de reglas y cartas que faltan).

import { download } from './ui.js';

const EXCELJS = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
const SET_ORDER = ['OGN', 'OGS', 'SFD', 'UNL', 'VEN', 'RAD']; // orden de salida; los promos van detrás
const COLOR = {
  Fury: 'Fury - Rojo', Calm: 'Calm - Verde', Mind: 'Mind - Azul',
  Body: 'Body - Naranja', Chaos: 'Chaos - Morado', Order: 'Order - Amarillo',
};
const CARD_COLUMNS = [
  ['Set', 7], ['Nº', 6], ['Tipo', 18], ['Color', 32], ['Nombre', 36], ['Might', 8],
  ['Energía', 9], ['Poder', 8], ['Color de poder', 32], ['Copias', 8], ['Texto', 95], ['Errata', 9],
];
const DECK_COLUMNS = [['Sección', 16], ...CARD_COLUMNS.slice(0, 10), ['Tengo', 8], ...CARD_COLUMNS.slice(10)];
const SECTIONS = [['legend', 'Leyenda'], ['champion', 'Campeón'], ['main', 'Principal'], ['runes', 'Runas'], ['battlefields', 'Campo de batalla'], ['sideboard', 'Sideboard']];
const HEADER_FILL = 'FF2F3E4E';
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// ---------- Columnas de una carta ----------

/** "095", "090A", "SP3", "R01"… a partir del id ("ven-095-166"). */
function collectorNumber(card) {
  const seg = card.id.split('-')[1] ?? String(card.number);
  return /^\d+$/.test(seg) ? seg.padStart(3, '0') : seg.toUpperCase();
}

function isEquipment(card) {
  return card.type === 'Gear' && (card.tags.includes('Equipment') || card.mightBonus != null || !!card.effect || /\[Equip\b/.test(card.text));
}

function typeLabel(card) {
  const { type, supertype } = card;
  if (['Legend', 'Battlefield', 'Rune'].includes(type)) return type;
  if (supertype === 'Champion') return 'Champion unit';
  if (supertype === 'Signature' || supertype === 'Token') return `${supertype} ${type.toLowerCase()}`;
  if (isEquipment(card)) return 'Gear - Equipment';
  return type;
}

const DOMAIN_ORDER = Object.keys(COLOR);

function colors(domains) {
  return domains
    .filter((d) => d !== 'Colorless')
    .sort((a, b) => DOMAIN_ORDER.indexOf(a) - DOMAIN_ORDER.indexOf(b))
    .map((d) => COLOR[d] || d)
    .join(' / ');
}

/** Texto con los símbolos del juego en palabras, en una sola línea. */
export function readableText(text) {
  return (text || '')
    .replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&')
    .replace(/:rb_energy_(\d+):/g, '{$1}')
    .replace(/:rb_rune_rainbow:/g, '{Cualquier runa}') // el símbolo multicolor: vale una runa de cualquier dominio
    .replace(/:rb_rune_(\w+):/g, (_, d) => `{${d[0].toUpperCase()}${d.slice(1)}}`)
    .replace(/:rb_might:/g, 'Might')
    .replace(/:rb_exhaust:/g, '{Agotar}')
    .replace(/\[>\]/g, '→')
    .replace(/—\s*\n•\s*/g, '— ') // opciones de "Choose one —" en una línea: "— A / B"
    .replace(/\s*\n•\s*/g, ' / ')
    .replace(/\s*\n\s*/g, ' ')
    .replace(/\)(?=[A-Z[])/g, ') ') // habilidades que vienen pegadas
    .replace(/ {2,}/g, ' ')
    .trim();
}

function fullText(card) {
  const parts = [readableText(card.text), readableText(card.effect)];
  if (card.mightBonus != null) parts.push(`Equipment: ${card.mightBonus >= 0 ? '+' : ''}${card.mightBonus} Might.`);
  return parts.filter(Boolean).join(' ');
}

/** Las 12 columnas estándar de una carta con `copies` copias. */
function cardColumns(c, copies) {
  const power = c.energy != null ? (c.power ?? 0) : null;
  return [
    c.set,
    collectorNumber(c),
    typeLabel(c),
    colors(c.domain) || '-',
    c.name,
    c.type === 'Gear' && c.mightBonus != null ? null : c.might ?? null, // en equipos va en el texto
    c.energy ?? null,
    power,
    power > 0 ? colors(c.domain) || 'Neutral - Gris' : null,
    copies,
    fullText(c), // con la errata ya aplicada: es el texto oficial vigente
    c.errata ? 'Sí' : null,
  ];
}

const setRank = (s) => (SET_ORDER.includes(s) ? SET_ORDER.indexOf(s) : SET_ORDER.length);
// Las especiales (SP3, R01, T04…) van al final de su set, tras las numeradas.
const special = (c) => (/^\d/.test(collectorNumber(c)) ? 0 : 1);

/** Filas de la colección (solo cartas que tienes), en orden de set y número. */
export function collectionRows(cards, collection) {
  return cards
    .filter((c) => collection[c.id])
    .sort((a, b) => setRank(a.set) - setRank(b.set) || a.set.localeCompare(b.set) || special(a) - special(b) || a.number - b.number || a.id.localeCompare(b.id))
    .map((c) => cardColumns(c, collection[c.id].n + collection[c.id].f));
}

// ---------- Utilidades de archivo ----------

function toCsv(header, rows) {
  return '﻿' + [header, ...rows].map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
}

let excelLib;
export function loadExcelJS() {
  excelLib ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = EXCELJS;
    s.onload = () => resolve(window.ExcelJS);
    s.onerror = () => {
      excelLib = null;
      reject(new Error('No se pudo cargar el generador de Excel (¿sin conexión?).'));
    };
    document.head.append(s);
  });
  return excelLib;
}

function styleHeader(row) {
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
    cell.alignment = { vertical: 'middle' };
  });
}

/** Hoja con tabla: cabecera fija y con filtro, y la columna "Texto" con ajuste de línea. */
function addTable(wb, name, columns, rows) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = columns.map(([header, width]) => ({ header, width }));
  styleHeader(ws.getRow(1));
  ws.addRows(rows);
  const last = rows.length + 1;
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: last, column: columns.length } };
  const textCol = columns.findIndex(([h]) => h === 'Texto') + 1;
  for (let r = 2; r <= last; r++) {
    ws.getRow(r).eachCell({ includeEmpty: true }, (cell, col) => {
      cell.alignment = col === textCol ? { vertical: 'middle', wrapText: true } : { vertical: 'middle' };
    });
  }
  return { ws, last };
}

async function saveWorkbook(wb, filename) {
  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf], { type: XLSX_TYPE }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Nombre de archivo seguro a partir del nombre del mazo. */
function slug(name) {
  return (name || 'mazo').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'mazo';
}

/** Nombre de hoja válido en Excel (máx. 31, sin []:*?/\) y único. */
function sheetName(name, used) {
  const base = (name || 'Mazo').replace(/[[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 28) || 'Mazo';
  let n = base, i = 2;
  while (used.has(n.toLowerCase())) n = `${base.slice(0, 26)} (${i++})`;
  used.add(n.toLowerCase());
  return n;
}

// ---------- Colección ----------

export function exportCsv(cards, collection) {
  download('coleccion_riftbound.csv', toCsv(CARD_COLUMNS.map(([h]) => h), collectionRows(cards, collection)), 'text/csv');
}

export async function exportExcel(cards, collection) {
  const ExcelJS = await loadExcelJS();
  const rows = collectionRows(cards, collection);
  const wb = new ExcelJS.Workbook();
  const { last } = addTable(wb, 'Colección', CARD_COLUMNS, rows);

  // Hoja Resumen (con fórmulas y su resultado ya calculado, para quien la lea sin recalcular)
  const sum = wb.addWorksheet('Resumen');
  sum.columns = [{ width: 22 }, { width: 18 }, { width: 16 }];
  sum.getCell('A1').value = 'Resumen de la colección';
  sum.getCell('A1').font = { bold: true, size: 14 };
  const range = (col) => `'Colección'!$${col}$2:$${col}$${last}`;
  const block = (startRow, title, label, col, keys, keyOf) => {
    let r = startRow;
    if (title) {
      sum.getCell(`A${r}`).value = title;
      sum.getCell(`A${r}`).font = { bold: true };
      r++;
    }
    sum.getRow(r).values = [label, 'Cartas distintas', 'Copias totales'];
    styleHeader(sum.getRow(r));
    const first = ++r;
    for (const key of keys) {
      const mine = rows.filter((row) => keyOf(row) === key);
      sum.getCell(`A${r}`).value = key;
      sum.getCell(`B${r}`).value = { formula: `COUNTIF(${range(col)},A${r})`, result: mine.length };
      sum.getCell(`C${r}`).value = { formula: `SUMIF(${range(col)},A${r},${range('J')})`, result: mine.reduce((a, row) => a + row[9], 0) };
      r++;
    }
    return { first, next: r };
  };

  const setKeys = [...new Set(rows.map((row) => row[0]))];
  const sets = block(3, null, 'Set', 'A', setKeys, (row) => row[0]);
  const t = sets.next;
  sum.getCell(`A${t}`).value = 'Total';
  sum.getCell(`B${t}`).value = { formula: `SUM(B${sets.first}:B${t - 1})`, result: rows.length };
  sum.getCell(`C${t}`).value = { formula: `SUM(C${sets.first}:C${t - 1})`, result: rows.reduce((a, row) => a + row[9], 0) };
  sum.getRow(t).font = { bold: true };

  const typeKeys = [...new Set(rows.map((row) => row[2]))].sort();
  block(t + 2, 'Por tipo', 'Tipo', 'C', typeKeys, (row) => row[2]);

  await saveWorkbook(wb, 'coleccion_riftbound.xlsx');
}

// ---------- Mazos ----------
// ctx = { byId, owned(id), validate(deck) }

/** Filas de un mazo: Leyenda, Campeón, Principal (por coste), Runas, Campos de batalla y Sideboard. */
export function deckRows(deck, { byId, owned }) {
  const rows = [];
  const push = (label, id, n) => {
    const c = byId.get(id);
    if (!c) return;
    const cols = cardColumns(c, n);
    rows.push([label, ...cols.slice(0, 10), owned(id), ...cols.slice(10)]);
  };
  const byCost = (bag) => Object.entries(bag)
    .map(([id, n]) => [byId.get(id), n])
    .filter(([c]) => c)
    .sort((a, b) => (a[0].energy ?? 99) - (b[0].energy ?? 99) || a[0].name.localeCompare(b[0].name));
  for (const [key, label] of SECTIONS) {
    if (key === 'legend' && deck.legend) push(label, deck.legend, 1);
    if (key === 'champion' && deck.champion) push(label, deck.champion, 1);
    if (key === 'main') byCost(deck.main).forEach(([c, n]) => push(label, c.id, n));
    if (key === 'runes') byCost(deck.runes).forEach(([c, n]) => push(label, c.id, n));
    if (key === 'battlefields') deck.battlefields.forEach((id) => push(label, id, 1));
    if (key === 'sideboard') byCost(deck.sideboard ?? {}).forEach(([c, n]) => push(label, c.id, n));
  }
  return rows;
}

/** Datos de resumen de un mazo (para la hoja Resumen y el índice de mazos). */
function deckSummary(deck, { byId, validate }) {
  const legend = byId.get(deck.legend);
  const champion = byId.get(deck.champion);
  const v = validate(deck);
  const lacking = v.missing.reduce((a, [, n]) => a + n, 0);
  const curve = {};
  const types = {};
  const mainCards = Object.entries(deck.main).map(([id, n]) => [byId.get(id), n]);
  if (champion) mainCards.push([champion, 1]);
  for (const [c, n] of mainCards) {
    if (!c) continue;
    const cost = c.energy ?? 0;
    curve[cost] = (curve[cost] || 0) + n;
    types[typeLabel(c)] = (types[typeLabel(c)] || 0) + n;
  }
  return {
    legend, champion, v, lacking, curve, types,
    domains: legend ? colors(legend.domain) : '',
    status: v.issues.length ? `${v.issues.length} aviso(s)` : 'Válido',
  };
}

function writeDeckSummary(ws, deck, s) {
  ws.columns = [{ width: 26 }, { width: 60 }];
  ws.getCell('A1').value = deck.name;
  ws.getCell('A1').font = { bold: true, size: 14 };
  const info = [
    ['Leyenda', s.legend?.name ?? '—'],
    ['Campeón', s.champion?.name ?? '—'],
    ['Dominios', s.domains || '—'],
    ['Mazo principal', `${s.v.mainCount}/40`],
    ['Runas', `${s.v.runeCount}/12`],
    ['Campos de batalla', `${deck.battlefields.length}/3`],
    ['Sideboard', `${s.v.sideCount ?? 0}/10`],
    ['Estado', s.status],
    ['Cartas que te faltan', s.lacking],
  ];
  let r = 3;
  for (const [k, v] of info) {
    ws.getCell(`A${r}`).value = k;
    ws.getCell(`A${r}`).font = { bold: true };
    ws.getCell(`B${r}`).value = v;
    r++;
  }
  const section = (title, header, rows) => {
    if (!rows.length) return;
    r++;
    ws.getCell(`A${r}`).value = title;
    ws.getCell(`A${r}`).font = { bold: true };
    r++;
    if (header) {
      ws.getRow(r).values = header;
      styleHeader(ws.getRow(r));
      r++;
    }
    for (const row of rows) ws.getRow(r++).values = row;
  };
  section('Curva de energía (principal + Campeón)', ['Coste', 'Cartas'], Object.entries(s.curve).sort((a, b) => a[0] - b[0]).map(([c, n]) => [+c, n]));
  section('Por tipo', ['Tipo', 'Cartas'], Object.entries(s.types).sort());
  section('Avisos de reglas', null, s.v.issues.map((i) => ['', i]));
  section('Te faltan', ['Copias', 'Carta'], s.v.missing.map(([c, n]) => [n, `${c.name} (${c.set}-${collectorNumber(c)})`]));
}

export function exportDeckCsv(deck, ctx) {
  download(`mazo_${slug(deck.name)}.csv`, toCsv(DECK_COLUMNS.map(([h]) => h), deckRows(deck, ctx)), 'text/csv');
}

export async function exportDeckExcel(deck, ctx) {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  addTable(wb, 'Mazo', DECK_COLUMNS, deckRows(deck, ctx));
  writeDeckSummary(wb.addWorksheet('Resumen'), deck, deckSummary(deck, ctx));
  await saveWorkbook(wb, `mazo_${slug(deck.name)}.xlsx`);
}

export function exportAllDecksCsv(decks, ctx) {
  const rows = decks.flatMap((d) => deckRows(d, ctx).map((r) => [d.name, ...r]));
  download('mazos_riftbound.csv', toCsv(['Mazo', ...DECK_COLUMNS.map(([h]) => h)], rows), 'text/csv');
}

export function exportAllDecksText(decks, exportText) {
  download('mazos_riftbound.txt', decks.map(exportText).join('\n\n' + '-'.repeat(40) + '\n\n'));
}

/** Hoja "Mazos" con un resumen de cada uno y una hoja por mazo con sus cartas. */
export async function exportAllDecksExcel(decks, ctx) {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  const used = new Set(['mazos']);
  const names = decks.map((d) => sheetName(d.name, used));
  const index = decks.map((d, i) => {
    const s = deckSummary(d, ctx);
    return [d.name, names[i], s.legend?.name ?? '—', s.champion?.name ?? '—', s.domains || '—',
      `${s.v.mainCount}/40`, `${s.v.runeCount}/12`, `${d.battlefields.length}/3`, `${s.v.sideCount ?? 0}/10`, s.status, s.lacking, s.v.issues.join(' · ') || null];
  });
  addTable(wb, 'Mazos', [
    ['Mazo', 28], ['Hoja', 20], ['Leyenda', 32], ['Campeón', 30], ['Dominios', 32],
    ['Principal', 10], ['Runas', 8], ['Campos', 8], ['Sideboard', 10], ['Estado', 12], ['Te faltan', 10], ['Avisos', 80],
  ], index);
  decks.forEach((d, i) => addTable(wb, names[i], DECK_COLUMNS, deckRows(d, ctx)));
  await saveWorkbook(wb, 'mazos_riftbound.xlsx');
}
