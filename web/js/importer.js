// Importación de colecciones desde Excel, CSV o una lista pegada, con el formato que sea.
//
// 1. Leer: .xlsx (todas las hojas), CSV con cualquier separador, o texto "3x Nombre (SET-001)".
// 2. Adivinar el papel de cada columna (código, set, nº, nombre, copias, foil) por su cabecera
//    y su contenido. El usuario lo puede corregir.
// 3. Emparejar cada fila con una carta: código o set+nº (exacto) > nombre (exacto o variante
//    conocida) > nombre aproximado (faltas de ortografía). Nada se importa sin revisarlo.

import { loadExcelJS } from './export.js';

export const ROLES = {
  code: 'Código (OGN-001/298)',
  set: 'Set',
  number: 'Nº de colección',
  name: 'Nombre',
  qty: 'Copias',
  foilQty: 'Copias foil',
  foil: '¿Es foil? (sí/no)',
};

const PROMO_SETS = new Set(['OPP', 'PR', 'JDG']);
const FUZZY_MIN = 0.82; // similitud mínima para proponer una carta por nombre aproximado

// ---------- Utilidades de texto ----------

export function norm(s) {
  return String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’`´]/g, "'")
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function similarity(a, b) {
  if (a === b) return 1;
  const m = a.length, n = b.length;
  if (!m || !n) return 0;
  if (Math.abs(m - n) / Math.max(m, n) > 1 - FUZZY_MIN) return 0; // imposible llegar al mínimo
  // Distancia de edición contando como un solo error intercambiar dos letras ("Crusier"/"Cruiser").
  let prev2 = null;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) cur[j] = Math.min(cur[j], prev2[j - 2] + 1);
    }
    prev2 = prev;
    prev = cur;
  }
  return 1 - prev[n] / Math.max(m, n);
}

/** "x2", "2x", "2", "2 copias" -> 2; vacío -> null. */
function parseQty(v) {
  const m = String(v ?? '').match(/\d+/);
  return m ? parseInt(m[0], 10) : null;
}

function truthy(v) {
  return /^(s|si|sí|y|yes|true|1|x|foil|✓|✔)$/i.test(String(v ?? '').trim());
}

// ---------- Lectura de archivos ----------

function detectDelimiter(text) {
  // Se prueba cada separador sobre filas ya parseadas (un texto entre comillas puede tener saltos
  // de línea) y gana el que da el mismo número de columnas (>1) en más filas.
  const head = text.split(/\r?\n/).slice(0, 60).join('\n');
  let best = null, bestScore = 0;
  for (const d of [';', ',', '\t', '|']) {
    const counts = parseCsv(head, d).slice(0, 20).map((r) => r.length);
    if (!counts.length) continue;
    const mode = counts.sort((x, y) => counts.filter((c) => c === y).length - counts.filter((c) => c === x).length)[0];
    const score = mode > 1 ? counts.filter((c) => c === mode).length / counts.length : 0;
    if (score > bestScore) { best = d; bestScore = score; }
  }
  return bestScore >= 0.6 ? best : null;
}

function splitCsvLine(line, d) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === d) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function parseCsv(text, d) {
  // Respeta saltos de línea dentro de comillas (textos de carta largos).
  const rows = [];
  let buf = '';
  for (const line of text.split(/\r?\n/)) {
    buf = buf ? `${buf}\n${line}` : line;
    if ((buf.match(/"/g) || []).length % 2 === 0) {
      if (buf.trim()) rows.push(splitCsvLine(buf, d));
      buf = '';
    }
  }
  return rows;
}

/** Lista suelta: "3x Arena Kingpin", "Arena Kingpin x3", "2 Brawl (RAD-004)". */
export function parseList(text) {
  const rows = [['Copias', 'Nombre', 'Código']];
  for (let line of text.split(/\r?\n/)) {
    line = line.trim();
    if (!line || /^(#|\/\/)/.test(line) || /:$/.test(line)) continue; // comentarios y "Runas:"
    let qty = '';
    let m = line.match(/^(\d+)\s*[x×]?\s+(.+)$/i);
    if (m) { qty = m[1]; line = m[2]; }
    else if ((m = line.match(/^(.+?)\s+[x×]\s*(\d+)$/i) || line.match(/^(.+?)\s+(\d+)\s*[x×]$/i))) { line = m[1]; qty = m[2]; }
    let code = '';
    m = line.match(/^(.*?)\s*[([]\s*([A-Za-z]{2,4}[-\s]?[A-Za-z]{0,3}\d{1,3}[A-Za-z*]?(?:\s*\/\s*\d+)?)\s*[)\]]\s*$/);
    if (m) { line = m[1]; code = m[2]; }
    rows.push([qty, line.trim(), code]);
  }
  return [{ name: 'Lista', rows }];
}

/** Devuelve [{ name, rows: string[][] }] (una entrada por hoja). */
export async function readFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (ext === 'xls') throw new Error('Los .xls antiguos no se pueden leer: guárdalo como .xlsx o CSV desde Excel.');
  if (ext === 'xlsx' || ext === 'xlsm') {
    const ExcelJS = await loadExcelJS();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await file.arrayBuffer());
    const sheets = [];
    wb.eachSheet((ws) => {
      const rows = [];
      ws.eachRow({ includeEmpty: false }, (row) => {
        const vals = [];
        row.eachCell({ includeEmpty: true }, (cell, col) => { vals[col - 1] = (cell.text ?? '').toString().trim(); });
        rows.push(Array.from(vals, (v) => v ?? ''));
      });
      if (rows.length) sheets.push({ name: ws.name, rows });
    });
    if (!sheets.length) throw new Error('El Excel está vacío.');
    return sheets;
  }
  let text = await file.text();
  text = text.replace(/^﻿/, '');
  const d = detectDelimiter(text);
  return d ? [{ name: file.name, rows: parseCsv(text, d) }] : parseList(text);
}

// ---------- Índices de cartas ----------

export function buildIndex(cards) {
  const byKey = new Map(); // "ogn-001" -> carta (primera impresión con ese set+nº)
  const primary = new Map(); // nombre normalizado -> [cartas]
  const secondary = new Map(); // variantes del nombre ("Rogue Assassin" para "Akali - Rogue Assassin")
  const add = (map, key, c) => {
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    if (!map.get(key).includes(c)) map.get(key).push(c);
  };
  for (const c of cards) {
    const [set, num] = c.id.split('-');
    if (!byKey.has(`${set}-${num}`)) byKey.set(`${set}-${num}`, c);
    const base = c.name.replace(/\s*\([^)]*\)\s*$/, '').replace(/ - Starter$/, '');
    add(primary, norm(c.name), c);
    add(primary, norm(base), c);
    if (base.includes(' - ')) {
      const [left, ...rest] = base.split(' - ');
      add(secondary, norm(rest.join(' - ')), c); // título: "Rogue Assassin"
      if (c.supertype === 'Signature') add(secondary, norm(left), c);
    }
    if (c.champion && c.supertype === 'Signature') add(secondary, norm(`${base} ${c.champion}`), c);
  }
  const setCodes = new Set(cards.map((c) => c.set));
  const setNames = new Map(cards.map((c) => [norm(c.setName), c.set]));
  return { byKey, primary, secondary, keys: [...primary.keys()], setCodes, setNames };
}

function setCode(value, idx) {
  const v = String(value ?? '').trim();
  if (!v) return null;
  if (idx.setCodes.has(v.toUpperCase())) return v.toUpperCase();
  return idx.setNames.get(norm(v)) ?? null;
}

function collectorKey(set, number) {
  let n = String(number ?? '').trim().replace(/\s*\/\s*\d+$/, '');
  if (!n) return null;
  n = /^\d+$/.test(n) ? n.padStart(3, '0') : n.toLowerCase();
  return `${set.toLowerCase()}-${n}`;
}

/** "OGN-001/298", "OGN 001", "RAD-SP1", "UNL-229*" -> { set, key }. */
function parseCode(value, idx) {
  const m = String(value ?? '').trim().match(/^([A-Za-z]{2,4})[-\s·_]*([A-Za-z]{0,3}\d{1,3}[A-Za-z*]?)(?:\s*\/\s*\d+)?$/);
  if (!m || !idx.setCodes.has(m[1].toUpperCase())) return null;
  return { set: m[1].toUpperCase(), key: collectorKey(m[1], m[2]) };
}

// ---------- Detección de columnas ----------

const HEADER_HINTS = {
  code: /^(cod|codigo|code|card code|card id|id|collector code|public code|ref|referencia)$/,
  set: /^(set|set code|set name|expansion|edicion|coleccion de la carta|expansion code)$/,
  number: /^(n|no|n o|nº|num|numero|number|collector number|card number|nr)$/,
  name: /^(nombre|name|carta|card|card name|nombre de la carta|cartas)$/,
  qty: /^(cantidad|copias|qty|quantity|count|cant|unidades|amount|total|normales|copies|have|tengo)$/,
  foilQty: /^(foil|foils|copias foil|cantidad foil|foil qty|foil quantity)$/,
  foil: /^(es foil|foil|is foil|acabado|finish)$/,
};

function isHeaderRow(row) {
  const hits = row.filter((v) => Object.values(HEADER_HINTS).some((re) => re.test(norm(v)))).length;
  return hits >= 2 || (hits >= 1 && row.filter(Boolean).length <= 2);
}

/** Separa cabecera y datos (la cabecera puede no estar en la primera fila, o no existir). */
export function splitHeader(rows) {
  const i = rows.slice(0, 10).findIndex(isHeaderRow);
  if (i >= 0) return { header: rows[i], data: rows.slice(i + 1) };
  const width = Math.max(...rows.map((r) => r.length));
  return { header: Array.from({ length: width }, (_, k) => `Columna ${String.fromCharCode(65 + k)}`), data: rows };
}

/** { role: índice de columna } a partir de cabeceras y contenido. */
export function guessMapping(header, data, idx) {
  const sample = data.slice(0, 200);
  const col = (i) => sample.map((r) => r[i] ?? '').filter((v) => String(v).trim());
  const share = (vals, fn) => (vals.length ? vals.filter(fn).length / vals.length : 0);
  const map = {};
  const taken = new Set();
  const take = (role, i) => { if (i >= 0 && map[role] == null && !taken.has(i)) { map[role] = i; taken.add(i); } };

  // 1) Por cabecera. "normales" tiene prioridad sobre "total" para no contar los foil dos veces.
  const h = header.map(norm);
  take('qty', h.indexOf('normales'));
  for (const role of ['code', 'set', 'number', 'name', 'qty']) take(role, h.findIndex((x, i) => !taken.has(i) && HEADER_HINTS[role].test(x)));
  const foilCol = h.findIndex((x, i) => !taken.has(i) && (HEADER_HINTS.foilQty.test(x) || HEADER_HINTS.foil.test(x)));
  if (foilCol >= 0) {
    // Con números es "cuántas foil"; con sí/no/x es "estas copias son foil".
    const numeric = share(col(foilCol), (v) => /^\d+$/.test(v)) > 0.8 && h[foilCol] !== 'es foil';
    take(numeric ? 'foilQty' : 'foil', foilCol);
  }

  // 2) Por contenido, para lo que falte.
  header.forEach((_, i) => {
    if (taken.has(i)) return;
    const vals = col(i);
    if (!vals.length) return;
    if (map.code == null && share(vals, (v) => parseCode(v, idx)) > 0.6) take('code', i);
    else if (map.set == null && share(vals, (v) => setCode(v, idx)) > 0.8) take('set', i);
    else if (map.name == null && share(vals, (v) => idx.primary.has(norm(v)) || idx.secondary.has(norm(v))) > 0.4) take('name', i);
  });
  if (map.name == null) {
    // La columna con más texto que no sea número.
    const scores = header.map((_, i) => (taken.has(i) ? -1 : share(col(i), (v) => /[a-z]{3,}/i.test(v) && !/^\d+$/.test(v)) * col(i).length));
    const best = scores.indexOf(Math.max(...scores));
    if (scores[best] > 0) take('name', best);
  }
  if (map.number == null && map.set != null && map.code == null) {
    header.forEach((_, i) => { if (!taken.has(i) && share(col(i), (v) => /^[A-Za-z]{0,3}\d{1,3}[A-Za-z*]?$/.test(v)) > 0.8) take('number', i); });
  }
  if (map.qty == null) {
    header.forEach((_, i) => { if (!taken.has(i) && share(col(i), (v) => /^[x×]?\d{1,3}[x×]?$/i.test(v)) > 0.8) take('qty', i); });
  }
  return map;
}

// ---------- Emparejado de filas ----------

/** Impresión más probable entre varias con el mismo nombre: la del set indicado, edición normal… */
function preferred(cands, set) {
  return [...cands].sort((a, b) =>
    (set ? (b.set === set) - (a.set === set) : 0) ||
    PROMO_SETS.has(a.set) - PROMO_SETS.has(b.set) ||
    (a.rarity === 'Showcase') - (b.rarity === 'Showcase') ||
    /[a-z*]/.test(a.id.split('-')[1]) - /[a-z*]/.test(b.id.split('-')[1]) ||
    a.number - b.number)[0];
}

function byName(name, set, idx) {
  const n = norm(name);
  if (!n) return null;
  for (const [map, how] of [[idx.primary, 'name'], [idx.secondary, 'name']]) {
    const c = map.get(n);
    if (c) return { card: preferred(c, set), how, alternatives: c.length };
  }
  let best = null, bestSim = 0;
  for (const k of idx.keys) {
    const s = similarity(n, k);
    if (s > bestSim) { bestSim = s; best = k; }
  }
  if (bestSim >= FUZZY_MIN) return { card: preferred(idx.primary.get(best), set), how: 'fuzzy', similarity: bestSim };
  return null;
}

/**
 * Empareja cada fila. status: "exact" (código o set+nº, coherente con el nombre),
 * "name" (por nombre exacto), "fuzzy" (nombre aproximado), "check" (código y nombre no cuadran),
 * "missing" (no encontrada). qty/foil ya interpretados.
 */
export function matchRows(data, map, idx) {
  const get = (r, role) => (map[role] != null ? r[map[role]] ?? '' : '');
  const out = [];
  for (const r of data) {
    if (!r.some((v) => String(v).trim())) continue;
    const name = String(get(r, 'name')).trim();
    const set = setCode(get(r, 'set'), idx);
    let card = null, status = 'missing', note = '';

    const code = parseCode(get(r, 'code'), idx) || (map.code == null && map.number != null ? parseCode(get(r, 'number'), idx) : null);
    const key = code?.key ?? (set && map.number != null ? collectorKey(set, get(r, 'number')) : null);
    if (key && idx.byKey.has(key)) {
      card = idx.byKey.get(key);
      status = 'exact';
      if (name) {
        const n = norm(name), c = norm(card.name);
        const nameMatch = byName(name, card.set, idx);
        if (!(c.includes(n) || n.includes(c) || nameMatch?.card === card || (nameMatch && norm(nameMatch.card.name) === c))) {
          status = 'check';
          note = `El código es de "${card.name}" pero el nombre dice "${name}"`;
        }
      }
    } else if (name) {
      const m = byName(name, set ?? code?.set, idx);
      if (m) {
        card = m.card;
        status = m.how === 'fuzzy' ? 'fuzzy' : 'name';
        if (m.how === 'fuzzy') note = `Parecido al ${Math.round(m.similarity * 100)} %`;
        else if (m.alternatives > 1) note = `${m.alternatives} versiones con este nombre`;
      }
    }

    let qty = map.qty != null ? parseQty(get(r, 'qty')) : 1;
    let foilQty = map.foilQty != null ? parseQty(get(r, 'foilQty')) ?? 0 : 0;
    if (map.foil != null && truthy(get(r, 'foil'))) { foilQty += qty ?? 1; qty = 0; }
    qty ??= map.qty != null && foilQty ? 0 : 1;
    if (!qty && !foilQty) continue; // filas con 0 copias
    out.push({ raw: r, label: name || String(get(r, 'code') || `${get(r, 'set')} ${get(r, 'number')}`).trim(), card, status, note, qty, foilQty });
  }
  return out;
}

/** Búsqueda manual para corregir una fila: por nombre o código. */
export function searchCards(q, cards, idx, limit = 8) {
  const n = norm(q);
  if (!n) return [];
  const code = parseCode(q, idx);
  if (code && idx.byKey.has(code.key)) return [idx.byKey.get(code.key)];
  const scored = [];
  for (const c of cards) {
    const name = norm(c.name);
    const s = name.startsWith(n) ? 3 : name.includes(n) ? 2 : similarity(n, name) >= 0.7 ? 1 : 0;
    if (s) scored.push([s, c]);
  }
  return scored.sort((a, b) => b[0] - a[0] || a[1].name.localeCompare(b[1].name)).slice(0, limit).map(([, c]) => c);
}
