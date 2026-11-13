// El mazo como imagen (PNG) para compartirlo por WhatsApp, Discord… Se dibuja en un <canvas> con las
// miniaturas de la propia web (mismo origen: el lienzo no queda bloqueado y funciona sin conexión).
// En el móvil se abre el menú de compartir del sistema; si no se puede, se descarga.

import { toast, baseName, DOMAIN_ES } from './ui.js';

const W = 1080;
const PAD = 40;
const GAP = 12;
const COLS = 7;
const COLORS = { bg: '#0b0b0b', panel: '#141414', text: '#f2f2f2', muted: '#b4b4b4', faint: '#949494', accent: '#e2b955', ink: '#1a1405' };
const FONT = 'Inter, system-ui, sans-serif';

function loadImg(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function round(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

/** Las cartas de un montón ({ id: n }) como [[carta, n]], por coste y nombre. */
function entries(bag, byId) {
  return Object.entries(bag ?? {}).map(([id, n]) => [byId.get(id), n]).filter(([c, n]) => c && n > 0)
    .sort((a, b) => (a[0].energy ?? 99) - (b[0].energy ?? 99) || a[0].name.localeCompare(b[0].name));
}

/** Dibuja el mazo y devuelve el lienzo. */
export async function drawDeck(deck, byId, owner = '') {
  await document.fonts?.load(`600 40px Inter`).catch(() => {});
  const legend = byId.get(deck.legend);
  const champion = byId.get(deck.champion);
  const sections = [
    ['Principal', entries(deck.main, byId)],
    ['Runas', entries(deck.runes, byId)],
    ['Campos de batalla', deck.battlefields.map((id) => [byId.get(id), 1]).filter(([c]) => c)],
    ['Sideboard', entries(deck.sideboard, byId)],
  ].filter(([, list]) => list.length);

  const all = [legend, champion, ...sections.flatMap(([, list]) => list.map(([c]) => c))].filter(Boolean);
  const imgs = new Map(await Promise.all([...new Set(all)].map(async (c) => [c.id, await loadImg(c.thumb)])));

  const inner = W - 2 * PAD;
  const cell = (inner - (COLS - 1) * GAP) / COLS;
  const cellH = cell * 1.396;
  const fieldW = (inner - 2 * GAP) / 3;
  const fieldH = fieldW * 0.717;
  const headH = 300;
  const titleH = 56;
  const heights = sections.map(([name, list]) => titleH + (name === 'Campos de batalla'
    ? fieldH
    : Math.ceil(list.length / COLS) * (cellH + GAP) - GAP));
  const H = PAD + headH + heights.reduce((a, h) => a + h + 24, 0) + 70;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = Math.ceil(H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, W, H);

  const card = (c, x, y, w, h, n) => {
    const img = imgs.get(c.id);
    ctx.save();
    round(ctx, x, y, w, h, 10);
    ctx.clip();
    ctx.fillStyle = COLORS.panel;
    ctx.fillRect(x, y, w, h);
    if (img) {
      // Encaja la imagen sin deformarla (los Campos son apaisados).
      const s = Math.min(w / img.naturalWidth, h / img.naturalHeight);
      const iw = img.naturalWidth * s, ih = img.naturalHeight * s;
      ctx.drawImage(img, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
    }
    ctx.restore();
    if (n > 1) {
      const label = `×${n}`;
      ctx.font = `600 26px ${FONT}`;
      const bw = ctx.measureText(label).width + 20;
      round(ctx, x + w - bw - 6, y + h - 42, bw, 36, 18);
      ctx.fillStyle = COLORS.accent;
      ctx.fill();
      ctx.fillStyle = COLORS.ink;
      ctx.textBaseline = 'middle';
      ctx.fillText(label, x + w - bw + 4, y + h - 23);
    }
  };
  const text = (s, x, y, size, color, weight = 400, maxW = W - x - PAD) => {
    ctx.font = `${weight} ${size}px ${FONT}`;
    ctx.fillStyle = color;
    ctx.textBaseline = 'alphabetic';
    let t = s;
    while (t.length > 1 && ctx.measureText(t).width > maxW) t = t.slice(0, -2) + '…';
    ctx.fillText(t, x, y);
  };

  // Cabecera: Leyenda y Campeón, y a su lado el nombre y los datos.
  let y = PAD;
  const headW = 200, headCardH = headW * 1.4;
  let x = PAD;
  for (const c of [legend, champion]) {
    if (!c) continue;
    card(c, x, y, headW, headCardH, 1);
    x += headW + GAP;
  }
  const tx = x + 16;
  const size = Object.values(deck.main).reduce((a, n) => a + n, 0) + (champion ? 1 : 0);
  text(deck.name || 'Mazo', tx, y + 52, 46, COLORS.text, 600);
  if (owner) text(`@${owner}`, tx, y + 96, 28, COLORS.muted);
  const lines = [
    legend && baseName(legend),
    legend?.domain.length && legend.domain.map((d) => DOMAIN_ES[d] || d).join(' / '),
    `${size} cartas · ${Object.values(deck.runes).reduce((a, n) => a + n, 0)} runas`,
  ].filter(Boolean);
  lines.forEach((l, i) => text(l, tx, y + 150 + i * 40, 26, i === 2 ? COLORS.accent : COLORS.muted, i === 2 ? 600 : 400));
  y += headH;

  sections.forEach(([name, list], i) => {
    const count = list.reduce((a, [, n]) => a + n, 0);
    text(`${name} (${count})`, PAD, y + 38, 28, COLORS.text, 600);
    y += titleH;
    if (name === 'Campos de batalla') {
      list.forEach(([c], k) => card(c, PAD + k * (fieldW + GAP), y, fieldW, fieldH, 1));
    } else {
      list.forEach(([c, n], k) => card(c, PAD + (k % COLS) * (cell + GAP), y + Math.floor(k / COLS) * (cellH + GAP), cell, cellH, n));
    }
    y += heights[i] - titleH + 24;
  });
  text('Riftbound Scanner · bertox22.github.io/riftbound-scanner', PAD, H - 30, 22, COLORS.faint);
  return canvas;
}

/** Comparte el mazo como imagen (o la descarga si el navegador no deja compartir archivos). */
export async function shareDeckImage(deck, byId, owner = '') {
  let blob;
  try {
    const canvas = await drawDeck(deck, byId, owner);
    blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  } catch (err) {
    console.error(err);
    return toast('No se pudo hacer la imagen del mazo.');
  }
  if (!blob) return toast('No se pudo hacer la imagen del mazo.');
  const name = `${(deck.name || 'mazo').replace(/[\\/:*?"<>|]+/g, '').trim() || 'mazo'}.png`;
  const file = new File([blob], name, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: deck.name });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return; // cerró el menú de compartir
    }
  }
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  toast('Imagen del mazo descargada');
}
