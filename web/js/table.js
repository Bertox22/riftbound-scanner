// Herramienta de mesa: un marcador a pantalla completa para jugar con el móvil en medio.
//
// "Iniciar partida" pide tu mazo (o tu Leyenda), el rival (una cuenta, si la hay, o solo un nombre)
// y su Leyenda, y si es a un juego o al mejor de 3. En la mesa cada jugador tiene su mitad (la del
// rival va girada para quien está enfrente): tocar arriba suma un punto y abajo lo resta. Llegar a
// los puntos de victoria solo avisa: los juegos y la partida se cierran a mano. Al terminar, la
// partida se guarda en tu historial (y, si el rival es un amigo, le llega como partida espejo).
//
// Mesa (store.table, solo en este dispositivo, así una recarga no la pierde):
// { id, started, bestOf (1 | 3), target (puntos para ganar un juego), me: { deck, legend },
//   opp: { name, legend, account: { id, username } | null }, games: [[tuyos, rival], …] (el último es
//   el que se juega), first: 'me' | 'opp' | null (quién empezó el primer juego) }

import { store } from './store.js';
import { $, el, toast, cardImg } from './ui.js';
import { cloud, searchProfiles } from './cloud.js';
import { allLegends, legendTitle, legendChamp, canonicalLegend, deckById, blankMatch, deriveFromPoints, saveMatch, editMatch } from './matches.js';

let ctx; // { byId, showView }
let wakeLock = null;

const DOMAIN_COLOR = { Fury: '#e5484d', Calm: '#3fc07a', Mind: '#4c8dff', Body: '#f08c3a', Chaos: '#a066e8', Order: '#e2b955' };
const TARGETS = [8, 11];

const t = () => store.table;
const current = () => t().games[t().games.length - 1];
const oppLabel = (tb = t()) => tb.opp.name || 'Rival';

// ---------- Iniciar partida ----------

/** Cuadrícula para elegir una Leyenda, con buscador (como en "Apuntar partida"). */
function legendChooser(selected, onpick) {
  let q = '';
  const grid = el('div', { class: 'legend-grid' });
  const draw = () => {
    const s = q.trim().toLowerCase();
    const list = allLegends().filter((c) => !s || legendTitle(c).toLowerCase().includes(s));
    grid.replaceChildren(...list.map((c) => el('button', {
      type: 'button', class: `legend-opt${c.id === selected ? ' selected' : ''}`, onclick: () => onpick(c.id),
    }, cardImg(c), el('span', { text: legendChamp(c) }))));
    if (!list.length) grid.append(el('p', { class: 'muted small', text: 'Ninguna Leyenda con ese nombre.' }));
  };
  draw();
  return el('div', { class: 'legend-choose' },
    el('div', { class: 'legend-search' }, el('input', { type: 'search', placeholder: 'Buscar Leyenda…', 'aria-label': 'Buscar Leyenda', oninput: (e) => { q = e.target.value; draw(); } })),
    grid);
}

function legendButton(id, label, onclick) {
  const card = ctx.byId.get(id);
  return el('button', { type: 'button', class: `legend-pick${card ? '' : ' empty-pick'}`, onclick },
    card ? cardImg(card, 'thumb small') : null,
    el('span', { class: 'grow' }, card ? legendTitle(card) : label),
    el('span', { class: 'muted small', text: card ? 'Cambiar' : '' }));
}

function segmented(name, options, value, onpick) {
  return el('div', { class: 'segmented', role: 'radiogroup', 'aria-label': name },
    ...options.map(([v, label]) => el('button', { type: 'button', role: 'radio', 'aria-checked': String(v === value), onclick: () => onpick(v) }, label)));
}

/** Hoja para preparar la partida antes de pasar a la mesa. */
export function openSetup() {
  if (t()) return openTable(); // ya hay una en marcha
  const dlg = $('#match-dialog');
  const lastDeck = store.matches.find((m) => m.deck && deckById(m.deck))?.deck ?? store.decks[0]?.id ?? null;
  const s = { deck: lastDeck, legend: null, oppName: '', account: null, oppLegend: null, bestOf: 1, target: 8 };
  let choosing = null; // 'me' | 'opp': mostrando la cuadrícula de Leyendas
  let found = []; // cuentas que coinciden con el nombre del rival
  let searchTimer = null;

  const myLegend = () => canonicalLegend(deckById(s.deck)?.legend) ?? s.legend;

  // Sugerencias para el rival: primero tus amigos, luego otras cuentas con ese nombre.
  const suggestions = () => {
    const q = s.oppName.trim().toLowerCase();
    if (q.length < 2 || s.account) return [];
    const friends = (cloud.people ?? []).filter((p) => p.friend && (p.username.toLowerCase().includes(q) || p.display_name?.toLowerCase().includes(q)));
    const ids = new Set(friends.map((p) => p.id));
    return [...friends.map((p) => ({ ...p, friend: true })), ...found.filter((p) => !ids.has(p.id)).map((p) => ({ ...p, friend: !!cloud.people?.find((x) => x.id === p.id)?.friend }))].slice(0, 6);
  };

  const draw = () => {
    const focusedName = document.activeElement?.name;
    const pos = document.activeElement?.selectionStart;
    const sugg = suggestions();
    const friend = s.account && cloud.people?.find((p) => p.id === s.account.id)?.friend;
    dlg.replaceChildren(
      el('div', { class: 'dialog-head' },
        el('h2', { text: 'Iniciar partida' }),
        el('button', { class: 'icon-btn', type: 'button', title: 'Cerrar', 'aria-label': 'Cerrar', onclick: () => dlg.close() }, '✕')),
      el('form', {
        class: 'match-form',
        onsubmit: (e) => {
          e.preventDefault();
          if (!myLegend()) return toast('Elige tu mazo o tu Leyenda.');
          dlg.close();
          start(s, myLegend());
        },
      },
        el('label', { class: 'match-field' },
          el('span', { class: 'match-label', text: 'Tu mazo' }),
          el('select', { onchange: (e) => { s.deck = e.target.value || null; draw(); } },
            el('option', { value: '', text: 'Sin mazo', selected: !s.deck }),
            ...store.decks.map((d) => el('option', { value: d.id, text: d.name, selected: d.id === s.deck })))),
        !deckById(s.deck)?.legend && el('div', { class: 'match-field' },
          el('span', { class: 'match-label', text: 'Tu Leyenda' }),
          choosing === 'me'
            ? legendChooser(s.legend, (id) => { s.legend = id; choosing = null; draw(); })
            : legendButton(s.legend, 'Elegir tu Leyenda', () => { choosing = 'me'; draw(); })),
        el('label', { class: 'match-field' },
          el('span', { class: 'match-label', text: 'Rival' }),
          el('input', {
            name: 'opp-name', value: s.oppName, maxlength: 40, autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false',
            placeholder: 'Su usuario, o su nombre si no tiene cuenta',
            oninput: (e) => {
              s.oppName = e.target.value;
              s.account = null;
              clearTimeout(searchTimer);
              if (cloud.username && s.oppName.trim().length >= 2) {
                searchTimer = setTimeout(async () => {
                  try { found = await searchProfiles(s.oppName); } catch { found = []; }
                  draw();
                }, 300);
              }
              draw();
            },
          })),
        sugg.length > 0 && el('ul', { class: 'person-list opp-suggest' }, ...sugg.map((p) => el('li', {},
          el('button', {
            type: 'button', class: 'person-open', onclick: () => { s.account = { id: p.id, username: p.username }; s.oppName = p.username; found = []; draw(); },
          },
          el('span', { class: 'person-avatar', 'aria-hidden': 'true', text: (p.display_name || p.username)[0].toUpperCase() }),
          el('span', { class: 'grow' },
            el('strong', { text: p.display_name || p.username }),
            el('span', { class: 'muted small', text: `@${p.username}${p.friend ? ' · amigo' : ''}` })))))),
        s.account && el('p', { class: 'muted small', text: friend
          ? `Es tu amigo: al terminar le llegará la partida para que la guarde en su historial.`
          : `@${s.account.username} no es tu amigo (no os seguís los dos): la partida se guarda solo con su nombre.` }),
        el('div', { class: 'match-field' },
          el('span', { class: 'match-label', text: 'Leyenda del rival' }),
          choosing === 'opp'
            ? legendChooser(s.oppLegend, (id) => { s.oppLegend = id; choosing = null; draw(); })
            : legendButton(s.oppLegend, 'Elegir su Leyenda', () => { choosing = 'opp'; draw(); })),
        el('div', { class: 'match-field' },
          el('span', { class: 'match-label', text: 'Formato' }),
          segmented('Formato', [[1, 'Un juego'], [3, 'Al mejor de 3']], s.bestOf, (v) => { s.bestOf = v; draw(); })),
        el('div', { class: 'match-field' },
          el('span', { class: 'match-label', text: 'Puntos para ganar un juego' }),
          segmented('Puntos para ganar', TARGETS.map((n) => [n, String(n)]), s.target, (v) => { s.target = v; draw(); })),
        el('div', { class: 'actions match-actions' },
          el('button', { class: 'btn primary', type: 'submit' }, 'Empezar'))),
    );
    if (focusedName) {
      const again = dlg.querySelector(`[name="${focusedName}"]`);
      again?.focus();
      if (pos != null) again?.setSelectionRange?.(pos, pos);
    }
  };
  draw();
  dlg.showModal();
}

function start(s, myLegend) {
  store.saveTable({
    id: crypto.randomUUID?.() ?? String(Date.now()), started: Date.now(), bestOf: s.bestOf, target: s.target,
    me: { deck: s.deck, legend: myLegend },
    opp: { name: s.oppName.trim(), legend: s.oppLegend, account: s.account },
    games: [[0, 0]], first: null,
  });
  openTable();
}

// ---------- Mesa ----------

function half(side) {
  const tb = t();
  const p = side === 0 ? tb.me : tb.opp;
  const legend = ctx.byId.get(p.legend);
  const score = current()[side];
  const won = score >= tb.target && score > current()[1 - side];
  const colors = (legend?.domain ?? []).map((d) => DOMAIN_COLOR[d]).filter(Boolean);
  const name = side === 0 ? (cloud.profile?.display_name || cloud.username || 'Tú') : oppLabel(tb);
  const startsHere = tb.games.length === 1 && tb.first === (side === 0 ? 'me' : 'opp');
  const bump = (d) => {
    const g = current();
    g[side] = Math.max(0, Math.min(99, g[side] + d));
    store.saveTable();
    navigator.vibrate?.(10);
    renderTable();
  };
  return el('section', {
    class: `mesa-half${side === 1 ? ' flipped' : ''}${won ? ' won' : ''}`,
    style: `--c1: ${colors[0] ?? '#444'}; --c2: ${colors[1] ?? colors[0] ?? '#444'}`,
  },
    legend && el('div', { class: 'mesa-art', style: `background-image: url("${legend.image}")`, 'aria-hidden': 'true' }),
    el('button', { class: 'mesa-tap plus', type: 'button', 'aria-label': `Sumar un punto a ${name}`, onclick: () => bump(1) }, el('span', { text: '+' })),
    el('button', { class: 'mesa-tap minus', type: 'button', 'aria-label': `Quitar un punto a ${name}`, onclick: () => bump(-1) }, el('span', { text: '−' })),
    el('div', { class: 'mesa-info', 'aria-live': 'polite' },
      el('div', { class: 'mesa-name' }, name, legend && el('span', { text: ` · ${legendChamp(legend)}` })),
      el('div', { class: 'mesa-score', text: String(score) }),
      won ? el('div', { class: 'mesa-flag', text: 'Gana el juego' })
        : startsHere ? el('div', { class: 'mesa-flag start', text: 'Empieza' }) : null,
      tb.bestOf > 1 && el('div', { class: 'mesa-games', 'aria-label': `${gamesWon(side)} juegos ganados` },
        ...Array.from({ length: 2 }, (_, i) => el('span', { class: `dot${i < gamesWon(side) ? ' on' : ''}` })))));
}

/** Juegos ya cerrados que ha ganado un lado (el que se está jugando no cuenta). */
function gamesWon(side) {
  return t().games.slice(0, -1).filter(([a, b]) => (side === 0 ? a > b : b > a)).length;
}

function iconBtn(label, svg, onclick, cls = '') {
  const b = el('button', { class: `mesa-btn ${cls}`, type: 'button', title: label, 'aria-label': label, onclick });
  b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${svg}</svg>`;
  return b;
}

function bar() {
  const tb = t();
  const n = tb.games.length;
  const decided = tb.bestOf > 1 && (gamesWon(0) >= 2 || gamesWon(1) >= 2);
  return el('div', { class: 'mesa-bar' },
    iconBtn('Salir de la mesa (la partida sigue guardada)', '<path d="M15 6l-6 6 6 6"/>', closeTable),
    iconBtn('Sortear quién empieza', '<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="9" r="1.2" fill="currentColor"/><circle cx="15" cy="15" r="1.2" fill="currentColor"/><circle cx="15" cy="9" r="1.2" fill="currentColor"/><circle cx="9" cy="15" r="1.2" fill="currentColor"/>', drawFirst),
    el('div', { class: 'mesa-status' },
      el('strong', { text: tb.bestOf > 1 ? `Juego ${n}` : 'Un juego' }),
      el('span', { text: tb.bestOf > 1 ? `${gamesWon(0)}–${gamesWon(1)} · a ${tb.target}` : `a ${tb.target} puntos` })),
    tb.bestOf > 1 && n < 3 && !decided && iconBtn('Siguiente juego', '<path d="M6 5l8 7-8 7M16 5v14"/>', nextGame),
    iconBtn('Reiniciar', '<path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v5h5"/>', reset),
    iconBtn('Terminar y guardar la partida', '<rect x="6" y="6" width="12" height="12" rx="2"/>', finish, 'end'));
}

function renderTable() {
  const root = $('#mesa');
  if (!t()) { root.hidden = true; return; }
  root.replaceChildren(half(1), bar(), half(0));
}

export function openTable() {
  if (!t()) return;
  $('#mesa').hidden = false;
  document.body.classList.add('mesa-open');
  if (location.hash !== '#mesa') history.pushState(null, '', '#mesa');
  renderTable();
  keepAwake();
}

function closeTable() {
  $('#mesa').hidden = true;
  document.body.classList.remove('mesa-open');
  wakeLock?.release().catch(() => {});
  wakeLock = null;
  if (location.hash === '#mesa') history.replaceState(null, '', '#partidas');
  ctx.showView('matches');
  refreshButton();
}

/** Que la pantalla no se apague mientras se juega (donde el navegador lo permite). */
async function keepAwake() {
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* no disponible */ }
}

// ---------- Acciones ----------

/** Sorteo de quién empieza: las dos mitades se iluminan por turnos y se para en una. */
function drawFirst() {
  const halves = [...document.querySelectorAll('.mesa-half')]; // [rival, tú]
  const pick = Math.random() < 0.5 ? 'me' : 'opp';
  const steps = 9 + (pick === 'me' ? 1 : 0); // acaba en la mitad elegida
  let i = 0;
  const tick = () => {
    halves.forEach((h, k) => h.classList.toggle('lit', k === i % 2));
    if (++i < steps) setTimeout(tick, 70 + i * 18);
    else {
      halves.forEach((h) => h.classList.remove('lit'));
      if (t().games.length === 1) { t().first = pick; store.saveTable(); }
      renderTable();
      const who = pick === 'me' ? 'Empiezas tú' : `Empieza ${oppLabel()}`;
      toast(who);
      flash(pick === 'me' ? 0 : 1);
    }
  };
  tick();
}

function flash(side) {
  document.querySelectorAll('.mesa-half')[side === 0 ? 1 : 0]?.classList.add('picked');
}

function nextGame() {
  const [a, b] = current();
  if (!a && !b) return toast('Este juego aún no tiene puntos.');
  if (!confirm(`¿Cerrar el juego ${t().games.length} (${a}–${b}) y empezar el siguiente?`)) return;
  t().games.push([0, 0]);
  store.saveTable();
  renderTable();
}

function reset() {
  if (!confirm('¿Reiniciar la partida? Los puntos vuelven a 0.')) return;
  t().games = [[0, 0]];
  t().first = null;
  store.saveTable();
  renderTable();
}

/** La partida de la mesa, lista para el historial. */
function toMatch(tb) {
  const games = tb.games.filter(([a, b]) => a || b);
  const friend = tb.opp.account && cloud.people?.find((p) => p.id === tb.opp.account.id)?.friend;
  const m = {
    ...blankMatch(), at: tb.started, deck: tb.me.deck, my: tb.me.legend, opp: tb.opp.legend,
    oppName: tb.opp.name, rival: friend ? tb.opp.account.id : null,
    points: games, first: tb.first === 'me' ? true : tb.first === 'opp' ? false : null,
  };
  deriveFromPoints(m);
  if (!m.result) { // un marcador que no es de "al mejor de 3" (p. ej. con un juego empatado)
    const w = games.filter(([a, b]) => a > b).length, l = games.filter(([a, b]) => b > a).length;
    m.result = w > l ? 'win' : l > w ? 'loss' : 'draw';
    m.score = null;
  }
  return m;
}

function finish() {
  const tb = t();
  if (!tb.games.some(([a, b]) => a || b)) {
    if (confirm('No hay puntos. ¿Cerrar la mesa sin guardar nada?')) { store.saveTable(null); closeTable(); }
    return;
  }
  const m = toMatch(tb);
  const what = { win: 'victoria', loss: 'derrota', draw: 'empate' }[m.result];
  const pts = m.points.map(([a, b]) => `${a}–${b}`).join(', ');
  if (!confirm(`¿Terminar la partida? Se guardará como ${what} (${pts}).`)) return;
  saveMatch(m);
  store.saveTable(null);
  closeTable();
  const saved = store.matches.find((x) => x.id === m.id);
  toast(m.rival ? `Partida guardada. Le llegará a ${tb.opp.name}.` : 'Partida guardada', 5000, { label: 'Editar', onclick: () => saved && editMatch(saved) });
}

// ---------- Arranque ----------

/** El botón de Partidas dice "Volver a la mesa" mientras hay una partida en marcha. */
function refreshButton() {
  const b = $('#btn-table');
  b.textContent = t() ? 'Volver a la mesa' : 'Iniciar partida';
}

export function initTable(context) {
  ctx = context;
  $('#btn-table').addEventListener('click', openSetup);
  refreshButton();
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !$('#mesa').hidden) keepAwake(); });
  // Atrás en el móvil sale de la mesa (la partida sigue guardada).
  window.addEventListener('popstate', () => { if (location.hash !== '#mesa' && !$('#mesa').hidden) closeTable(); });
  if (location.hash === '#mesa' && t()) openTable();
}
