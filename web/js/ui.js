// Utilidades de interfaz compartidas.
import { banInfo } from './bans.js';

export const $ = (sel, root = document) => root.querySelector(sel);

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) node.append(c.nodeType ? c : String(c));
  return node;
}

let toastTimer;
/** Aviso breve. Con `action` ({ label, onclick }) lleva un botón (p. ej. "Deshacer") y dura más. */
export function toast(msg, ms = 2200, action = null) {
  const t = $('#toast');
  const hide = () => t.classList.remove('show', 'has-action');
  // replaceChildren escribiría "null" sin botón: se filtra antes.
  t.replaceChildren(...[el('span', { text: msg }),
    action && el('button', { class: 'toast-action', type: 'button', onclick: () => { hide(); action.onclick(); } }, action.label)].filter(Boolean));
  t.classList.add('show');
  t.classList.toggle('has-action', !!action);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hide, action ? Math.max(ms, 5000) : ms);
}

export function cardImg(card, cls = 'thumb') {
  return el('img', { class: cls, src: card.thumb, alt: card.name, loading: 'lazy', decoding: 'async', dataset: { orient: card.orientation } });
}

/** "OGN 066a" a partir del id (más fiable que el número, que no distingue variantes). */
export function cardCode(card) {
  if (card.code) return card.code;
  const [, num] = card.id.split('-');
  return `${card.set}-${num?.toUpperCase() ?? card.number}`;
}

/** Nombre sin sufijos de variante: "(Signature)", "(Metal)", etc. */
export function baseName(card) {
  return card.name.replace(/\s*\([^)]*\)\s*$/, '');
}

export function download(filename, text, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = el('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const DOMAIN_ES = { Fury: 'Furia', Calm: 'Calma', Mind: 'Mente', Body: 'Cuerpo', Chaos: 'Caos', Order: 'Orden', Colorless: 'Incoloro' };
export const TYPE_ES = { Unit: 'Unidad', Champion: 'Campeón', Spell: 'Hechizo', Gear: 'Equipo', Legend: 'Leyenda', Battlefield: 'Campo de batalla', Rune: 'Runa', Other: 'Otro' };

/** Filtro por tipo. "Champion" no es un tipo de carta sino las unidades Campeón. */
export function matchesType(card, type) {
  if (!type) return true;
  if (type === 'Champion') return card.type === 'Unit' && card.supertype === 'Champion';
  return card.type === type;
}
export const RARITY_ES = { Common: 'Común', Uncommon: 'Infrecuente', Rare: 'Rara', Epic: 'Épica', Showcase: 'Showcase', Promo: 'Promo' };

// ---------- Piezas que comparten la ficha, el escáner y la colección ----------

/** Fila «Normales − 2 +» de la ficha y de la hoja de una carta escaneada. */
export function qtyRow(label, n, change) {
  return el('div', { class: 'qty-row' },
    el('span', { class: 'grow', text: label }),
    el('button', { class: 'icon-btn', onclick: () => change(-1), disabled: n === 0 }, '−'),
    el('span', { class: 'qty', text: n }),
    el('button', { class: 'icon-btn', onclick: () => change(1) }, '+'),
  );
}

/** Marca «Baneada» (o «Ban 2v2») sobre una carta; baja si ya lleva la de errata. */
export function banBadge(card) {
  const b = banInfo(card);
  return b && el('span', { class: `badge banned${card.errata ? ' below' : ''}`, title: b.text.replace(/^⛔ /, ''), text: b.label });
}

/** Insignia foil: solo el número, en plateado. */
export function foilBadge(n) {
  return n > 0 && el('span', { class: 'badge foil', title: `${n} foil`, 'aria-label': `${n} foil` }, n);
}
