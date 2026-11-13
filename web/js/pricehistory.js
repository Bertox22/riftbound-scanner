// Historial de precios de Cardmarket (web/data/price-history.json, lo escribe cada noche
// tools/price_history.py): un punto por día (por semana pasados 90 días), en céntimos, de una copia
// normal ("n") y de una foil ("f", solo las cartas en que difiere). Se descarga al abrirlo, no al arrancar.
//
// El valor de la colección se calcula con lo que tienes hoy y los precios de cada día: «lo que tengo
// ahora, ¿cuánto valía entonces?». No hace falta guardar nada por usuario y no tiene huecos.

import { el } from './ui.js';
import { eur } from './prices.js';

let loading = null;

/** { dates: [Date], n: Map(id → [€]), f: Map } con los huecos rellenos; null si no hay historial. */
export function loadHistory() {
  loading ??= fetch('data/price-history.json', { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : null))
    .then((raw) => raw && raw.dates?.length ? {
      dates: raw.dates.map((d) => new Date(`${d}T12:00:00`)),
      n: fill(raw.n),
      f: fill(raw.f),
    } : null)
    .catch(() => { loading = null; return null; });
  return loading;
}

// Un día sin precio usa el anterior (o, antes del primero, el primero): así una carta que aparece
// a mitad no hace saltar el valor de la colección.
function fill(obj) {
  const out = new Map();
  for (const [id, series] of Object.entries(obj ?? {})) {
    const first = series.find((v) => v != null);
    if (first == null) continue;
    let last = first;
    out.set(id, series.map((v) => (last = v ?? last) / 100));
  }
  return out;
}

/** Precios de una copia, día a día (null si la carta no tiene historial). */
export function cardSeries(h, id, foil = false) {
  return (foil && h.f.get(id)) || h.n.get(id) || null;
}

/** Valor de las copias que tienes ({ id: { n, f } }) cada día del historial. */
export function collectionSeries(h, collection) {
  const total = h.dates.map(() => 0);
  for (const [id, e] of Object.entries(collection)) {
    const n = h.n.get(id);
    if (!n) continue;
    const f = h.f.get(id) ?? n;
    for (let i = 0; i < total.length; i++) total[i] += n[i] * (e.n ?? 0) + f[i] * (e.f ?? 0);
  }
  return total;
}

/** Desde qué posición empieza un periodo de `days` días (null = todo). */
export function rangeStart(h, days) {
  if (!days) return 0;
  const from = h.dates.at(-1).getTime() - days * 86400000;
  const i = h.dates.findIndex((d) => d.getTime() >= from);
  return Math.max(0, Math.min(i, h.dates.length - 2));
}

/** Tus cartas que más cambian de valor desde `start`: [{ id, from, to, diff (×copias), pct }]. */
export function movers(h, collection, start) {
  const out = [];
  for (const [id, e] of Object.entries(collection)) {
    for (const foil of [false, true]) {
      const copies = foil ? e.f : e.n;
      if (!copies) continue;
      const s = cardSeries(h, id, foil);
      if (!s) continue;
      const from = s[start];
      const to = s.at(-1);
      if (from === to) continue;
      out.push({ id, foil, copies, from, to, diff: (to - from) * copies, pct: from ? (to - from) / from : null });
    }
  }
  return out;
}

const DAY = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' });
export const dayText = (d) => DAY.format(d);

/** 0.15 → "+15 %", -0.4 → "−40 %". */
export const pctText = (r) => `${r >= 0 ? '+' : '−'}${Math.abs(Math.round(r * 100))} %`;

export function changeText(from, to) {
  const diff = to - from;
  const pct = from ? ` (${pctText(diff / from)})` : '';
  return `${diff >= 0 ? '+' : '−'}${eur(Math.abs(diff))}${pct}`;
}

/**
 * Gráfica de línea en SVG. Al pasar el dedo o el ratón, `onPoint(i)` con el día más cercano
 * (y `onPoint(null)` al salir), para que quien la usa escriba la fecha y el valor.
 */
export function lineChart(dates, values, { height = 120, onPoint } = {}) {
  const W = 300;
  const H = height;
  const pad = 6;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || Math.max(1, max * 0.1);
  const x = (i) => (values.length === 1 ? W / 2 : (i * W) / (values.length - 1));
  const y = (v) => pad + (H - 2 * pad) * (1 - (v - min) / span);
  const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('class', 'line-chart');
  svg.setAttribute('role', 'img');
  const add = (tag, attrs) => {
    const node = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    svg.append(node);
    return node;
  };
  add('polygon', { points: `0,${H} ${pts} ${W},${H}`, class: 'line-chart-area' });
  add('polyline', { points: pts, class: 'line-chart-line', 'vector-effect': 'non-scaling-stroke' });
  const cursor = add('line', { y1: 0, y2: H, class: 'line-chart-cursor', 'vector-effect': 'non-scaling-stroke', visibility: 'hidden' });
  if (onPoint) {
    const move = (ev) => {
      const box = svg.getBoundingClientRect();
      const i = Math.round(((ev.clientX - box.left) / box.width) * (values.length - 1));
      const k = Math.max(0, Math.min(values.length - 1, i));
      cursor.setAttribute('x1', x(k));
      cursor.setAttribute('x2', x(k));
      cursor.setAttribute('visibility', 'visible');
      onPoint(k);
    };
    svg.addEventListener('pointermove', move);
    svg.addEventListener('pointerdown', move);
    svg.addEventListener('pointerleave', () => { cursor.setAttribute('visibility', 'hidden'); onPoint(null); });
  }
  return el('div', { class: 'line-chart-wrap' }, svg,
    el('div', { class: 'line-chart-axis muted small' }, el('span', { text: dayText(dates[0]) }), el('span', { text: dayText(dates.at(-1)) })));
}
