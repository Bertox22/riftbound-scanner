// Exportación de la colección a Excel y CSV con el formato de "coleccion_riftbound.xlsx":
// Set | Nº | Tipo | Color | Nombre | Might | Energía | Poder | Color de poder | Copias | Texto | Errata
// y una hoja "Resumen" con totales por set y por tipo.

import { download } from './ui.js';

const EXCELJS = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
const SET_ORDER = ['OGN', 'OGS', 'SFD', 'UNL', 'VEN', 'RAD']; // orden de salida; los promos van detrás
const COLOR = {
  Fury: 'Fury - Rojo', Calm: 'Calm - Verde', Mind: 'Mind - Azul',
  Body: 'Body - Naranja', Chaos: 'Chaos - Morado', Order: 'Order - Amarillo',
};
const COLUMNS = [
  ['Set', 7], ['Nº', 6], ['Tipo', 18], ['Color', 32], ['Nombre', 36], ['Might', 8],
  ['Energía', 9], ['Poder', 8], ['Color de poder', 32], ['Copias', 8], ['Texto', 95], ['Errata', 9],
];
const HEADER_FILL = 'FF2F3E4E';

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

const setRank = (s) => (SET_ORDER.includes(s) ? SET_ORDER.indexOf(s) : SET_ORDER.length);
// Las especiales (SP3, R01, T04…) van al final de su set, tras las numeradas.
const special = (c) => (/^\d/.test(collectorNumber(c)) ? 0 : 1);

/** Filas de la colección (solo cartas que tienes), en orden de set y número. */
export function collectionRows(cards, collection) {
  return cards
    .filter((c) => collection[c.id])
    .sort((a, b) => setRank(a.set) - setRank(b.set) || a.set.localeCompare(b.set) || special(a) - special(b) || a.number - b.number || a.id.localeCompare(b.id))
    .map((c) => {
      const e = collection[c.id];
      const hasCost = c.energy != null;
      const power = hasCost ? (c.power ?? 0) : null;
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
        e.n + e.f,
        fullText(c), // con la errata ya aplicada: es el texto oficial vigente
        c.errata ? 'Sí' : null,
      ];
    });
}

export function exportCsv(cards, collection) {
  const rows = [COLUMNS.map(([h]) => h), ...collectionRows(cards, collection)];
  const csv = rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
  download('coleccion_riftbound.csv', '﻿' + csv, 'text/csv');
}

let excelLib;
function loadExcelJS() {
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

export async function exportExcel(cards, collection) {
  const ExcelJS = await loadExcelJS();
  const rows = collectionRows(cards, collection);
  const wb = new ExcelJS.Workbook();

  // Hoja Colección
  const ws = wb.addWorksheet('Colección', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = COLUMNS.map(([header, width]) => ({ header, width }));
  styleHeader(ws.getRow(1));
  ws.addRows(rows);
  const last = rows.length + 1;
  ws.autoFilter = `A1:L${last}`;
  for (let r = 2; r <= last; r++) {
    ws.getRow(r).eachCell({ includeEmpty: true }, (cell, col) => {
      cell.alignment = col === 11 ? { vertical: 'middle', wrapText: true } : { vertical: 'middle' };
    });
  }

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

  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'coleccion_riftbound.xlsx';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
