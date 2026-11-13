// Mano de prueba: roba una mano inicial del mazo principal, deja hacer el mulligan y seguir robando,
// y calcula la probabilidad de tener una carta concreta.
//
// Reglas que se usan: la mano inicial es de HAND cartas del mazo principal (el Campeón no está en él:
// empieza en su zona) y en el mulligan se devuelven hasta MULLIGAN cartas, se roban otras tantas y
// las devueltas van al fondo del mazo (así que no se vuelven a robar pronto).

import { $, el, cardImg, baseName } from './ui.js';

const HAND = 4;
const MULLIGAN = 2;
const MAX_EXTRA = 6;

let state = null; // { deck, library: [ids], hand: [ids], phase: 'mulligan' | 'play', pick: Set(posiciones), target, extra }

function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Combinaciones C(n, k) como número (los mazos son pequeños: no hace falta BigInt). */
function choose(n, k) {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}

/** Probabilidad de no ver ninguna de `k` copias al robar `d` cartas de un mazo de `n`. */
const miss = (n, k, d) => (d <= 0 ? 1 : choose(n - k, d) / choose(n, d));

/**
 * Probabilidad de tener al menos una copia (de `k` en un mazo de `n`): en la mano inicial, tras el
 * mulligan devolviendo las demás para buscarla, y tras robar `extra` cartas más.
 */
export function odds(n, k, extra = 0) {
  const m0 = miss(n, k, HAND);
  const m1 = m0 * miss(n - HAND, k, MULLIGAN);
  const m2 = m1 * miss(n - HAND - MULLIGAN, k, extra);
  return { hand: 1 - m0, mulligan: 1 - m1, extra: 1 - m2 };
}

const pct = (p) => `${Math.round(p * 100)} %`;

function deal() {
  const library = shuffle(Object.entries(state.deck.main).flatMap(([id, n]) => Array(n).fill(id)));
  state.hand = library.splice(0, HAND);
  state.library = library;
  state.phase = 'mulligan';
  state.pick = new Set();
}

function mulligan() {
  const back = [...state.pick].sort((a, b) => b - a).map((i) => state.hand.splice(i, 1)[0]);
  state.hand.push(...state.library.splice(0, back.length));
  state.library.push(...back); // al fondo
  state.phase = 'play';
  state.pick = new Set();
}

export function openTestHand(deck, byId) {
  const size = Object.values(deck.main).reduce((a, n) => a + n, 0);
  const dlg = $('#picker-dialog');
  const head = el('div', { class: 'dialog-head' },
    el('h2', { text: 'Mano de prueba' }),
    el('button', { class: 'icon-btn', title: 'Cerrar', 'aria-label': 'Cerrar', onclick: () => dlg.close() }, '✕'));
  if (size < HAND + MULLIGAN) {
    dlg.replaceChildren(head, el('p', { class: 'muted', text: 'Añade más cartas al mazo principal para robar una mano.' }));
    if (!dlg.open) dlg.showModal();
    return;
  }
  // Para la probabilidad, las versiones de una misma carta cuentan juntas (por nombre).
  const byName = new Map();
  for (const [id, n] of Object.entries(deck.main)) {
    const c = byId.get(id);
    if (!c) continue;
    const name = baseName(c);
    const g = byName.get(name) ?? { name, card: c, k: 0 };
    g.k += n;
    byName.set(name, g);
  }
  const groups = [...byName.values()].sort((a, b) => b.k - a.k || a.name.localeCompare(b.name));
  state = { deck, target: groups[0].name, extra: 2 };
  deal();

  const draw = () => {
    const mull = state.phase === 'mulligan';
    const hand = el('div', { class: 'test-hand' }, ...state.hand.map((id, i) => {
      const c = byId.get(id);
      const picked = state.pick.has(i);
      return el('button', {
        class: `test-card${picked ? ' picked' : ''}${i >= HAND ? ' drawn' : ''}`,
        'aria-pressed': mull ? String(picked) : null,
        title: c?.name,
        onclick: () => {
          if (!mull) return;
          if (picked) state.pick.delete(i);
          else if (state.pick.size < MULLIGAN) state.pick.add(i);
          draw();
        },
      }, c ? cardImg(c) : '?', picked && el('span', { class: 'test-back', 'aria-hidden': 'true', text: '↩' }));
    }));
    const g = byName.get(state.target);
    const o = odds(size, g.k, state.extra);
    dlg.replaceChildren(...[
      head,
      el('p', { class: 'muted small', text: mull
        ? `Toca hasta ${MULLIGAN} cartas para devolverlas al fondo del mazo y robar otras tantas.`
        : `En la mano: ${state.hand.length} · quedan ${state.library.length} en el mazo.` }),
      hand,
      el('div', { class: 'actions test-actions' }, ...(mull ? [
        el('button', { class: 'btn ghost small', onclick: () => { deal(); draw(); } }, 'Otra mano'),
        el('button', { class: 'btn primary small', onclick: () => { mulligan(); draw(); } },
          state.pick.size ? `Devolver ${state.pick.size} y robar` : 'Me la quedo'),
      ] : [
        el('button', { class: 'btn ghost small', onclick: () => { deal(); draw(); } }, 'Nueva mano'),
        el('button', { class: 'btn primary small', disabled: !state.library.length, onclick: () => { state.hand.push(state.library.shift()); draw(); } }, 'Robar una'),
      ])),
      el('h3', { class: 'stats-title', text: 'Probabilidad de tener una carta' }),
      el('select', { class: 'test-target', onchange: (e) => { state.target = e.target.value; draw(); } },
        ...groups.map((x) => el('option', { value: x.name, selected: x.name === state.target, text: `${x.name} (${x.k})` }))),
      el('ul', { class: 'odds' },
        el('li', {}, el('span', { text: `En la mano inicial (${HAND} cartas)` }), el('strong', { text: pct(o.hand) })),
        el('li', {}, el('span', { text: `Tras el mulligan, devolviendo ${MULLIGAN} para buscarla` }), el('strong', { text: pct(o.mulligan) })),
        el('li', {},
          el('span', {},
            'Y tras robar ',
            el('select', { class: 'test-extra', 'aria-label': 'Cartas robadas después', onchange: (e) => { state.extra = +e.target.value; draw(); } },
              ...Array.from({ length: MAX_EXTRA }, (_, i) => i + 1).map((d) => el('option', { value: d, selected: d === state.extra, text: d }))),
            ` carta${state.extra === 1 ? '' : 's'} más`),
          el('strong', { text: pct(o.extra) }))),
      el('p', { class: 'muted small', text: `Al menos una de las ${g.k} copias en un mazo principal de ${size} cartas (sin el Campeón, que empieza en su zona).` }),
    ].filter(Boolean));
  };
  draw();
  if (!dlg.open) dlg.showModal();
}
