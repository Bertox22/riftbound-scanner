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
//   opp: { name, legend, account: { id, username } | null, deck: { id, name } | null (su mazo, si es
//   un amigo) }, games: [[tuyos, rival], …] (el último es
//   el que se juega), fields: [[tuyo, del rival], …] (el Campo de batalla de cada uno en cada juego),
//   first: 'me' | 'opp' | null (quién empezó el primer juego), start: igual, pero del juego que se
//   juega, starts: ['me' | 'opp' | null, …] (quién empezó cada juego), chooser: 'me' | 'opp' | null (tiene que elegir quién empieza: en el primer juego, quien
//   gana el sorteo; en los siguientes, quien perdió el anterior) }
// Al mejor de 3, con 2–0 se puede jugar el tercero igualmente («Jugar el 3.º»): acaba 3–0 o 2–1.

import { store } from './store.js';
import { $, el, toast, cardImg } from './ui.js';
import { cloud, searchProfiles } from './cloud.js';
import {
  allLegends, legendTitle, legendChamp, canonicalLegend, deckById, blankMatch, deriveFromPoints, saveMatch, editMatch,
  battlefieldChooser, battlefieldName, canonicalBattlefield, deckBattlefields, rivalDeckField,
} from './matches.js';

let ctx; // { byId, showView }
let wakeLock = null;
let drawing = false; // el sorteo está en marcha

// El color del primer dominio de cada Leyenda tiñe su mitad (identidad, no datos).
const DOMAIN_COLOR = { Fury: '#e5484d', Calm: '#3fc07a', Mind: '#4c8dff', Body: '#f08c3a', Chaos: '#a066e8', Order: '#e2b955' };
const TARGETS = [8, 11];

const t = () => store.table;
const current = () => t().games[t().games.length - 1];
const oppLabel = (tb = t()) => tb.opp.name || 'Rival';
/** Quién empieza el juego que se está jugando (las mesas de antes solo apuntaban el primero). */
const starter = () => t().start ?? (t().games.length === 1 ? t().first : null);
/** Quién empezó el juego i (las mesas de antes solo apuntaban el primero y el que se juega). */
const startOfGame = (tb, i) => tb.starts?.[i] ?? (i === 0 ? tb.first : i === tb.games.length - 1 ? tb.start : null) ?? null;
/** Los Campos del juego que se está jugando: [tuyo, del rival]. */
const fieldsNow = () => {
  const tb = t();
  tb.fields ??= [];
  return (tb.fields[tb.games.length - 1] ??= [null, null]);
};

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
  const s = { deck: lastDeck, legend: null, oppName: '', account: null, oppDeck: null, oppLegend: null, bestOf: 1, target: 8 };
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
              s.oppDeck = null;
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
            type: 'button', class: 'person-open', onclick: () => { s.account = { id: p.id, username: p.username }; s.oppName = p.username; s.oppDeck = null; found = []; draw(); },
          },
          el('span', { class: 'person-avatar', 'aria-hidden': 'true', text: (p.display_name || p.username)[0].toUpperCase() }),
          el('span', { class: 'grow' },
            el('strong', { text: p.display_name || p.username }),
            el('span', { class: 'muted small', text: `@${p.username}${p.friend ? ' · amigo' : ''}` })))))),
        s.account && el('p', { class: 'muted small', text: friend
          ? `Es tu amigo: al terminar le llegará la partida para que la guarde en su historial.`
          : `@${s.account.username} no es tu amigo (no os seguís los dos): la partida se guarda solo con su nombre.` }),
        // Con qué mazo juega tu amigo: al elegirlo, su Leyenda pasa a ser la del rival.
        friend && rivalDeckField(s.account.id, s.account.username, s.oppDeck, (d) => {
          s.oppDeck = d ? { id: d.id, name: d.name } : null;
          if (d?.legend && ctx.byId.has(canonicalLegend(d.legend))) s.oppLegend = canonicalLegend(d.legend);
          draw();
        }, draw),
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
    opp: { name: s.oppName.trim(), legend: s.oppLegend, account: s.account, deck: s.account ? s.oppDeck : null },
    games: [[0, 0]], fields: [[null, null]], starts: [null], first: null, start: null, chooser: null,
  });
  openTable();
}

// ---------- Mesa ----------

/** ¿Hay alguien que ya gana el juego que se está jugando? 0 tú, 1 el rival, null nadie. */
function leader() {
  const [a, b] = current();
  const target = t().target;
  if (a >= target && a > b) return 0;
  if (b >= target && b > a) return 1;
  return null;
}

/**
 * La mitad de un jugador, de arriba abajo tal como la mira él: su nombre y su Leyenda con los juegos
 * ganados, los puntos (tocarlos suma uno), la pista hasta los puntos de victoria y los botones − y +,
 * que quedan en su borde de la mesa. La del rival se gira entera.
 */
function half(side) {
  const tb = t();
  const p = side === 0 ? tb.me : tb.opp;
  const legend = ctx.byId.get(p.legend);
  const score = current()[side];
  const won = leader() === side;
  const tint = DOMAIN_COLOR[(legend?.domain ?? []).find((d) => DOMAIN_COLOR[d])] ?? '#555';
  const name = side === 0 ? (cloud.profile?.display_name || cloud.username || 'Tú') : oppLabel(tb);
  const startsHere = starter() === (side === 0 ? 'me' : 'opp');
  const field = fieldsNow()[side];
  const chooses = tb.chooser === (side === 0 ? 'me' : 'opp');
  const bump = (d) => {
    const g = current();
    g[side] = Math.max(0, Math.min(99, g[side] + d));
    store.saveTable();
    navigator.vibrate?.(10);
    renderTable();
  };
  const filled = Math.min(score, tb.target);
  return el('section', {
    class: `mesa-half${side === 1 ? ' flipped' : ''}${won ? ' won' : ''}`,
    style: `--tint: ${tint}`, 'aria-label': `${name}: ${score} puntos`,
  },
    legend && el('div', { class: 'mesa-art', style: `background-image: url("${legend.image}")`, 'aria-hidden': 'true' }),
    el('header', { class: 'mesa-head' },
      el('div', { class: 'mesa-who' },
        el('strong', { text: name }),
        legend && el('span', { text: legendChamp(legend) })),
      tb.bestOf > 1 && el('div', { class: 'mesa-games', 'aria-label': `${gamesWon(side)} juego${gamesWon(side) === 1 ? '' : 's'} ganado${gamesWon(side) === 1 ? '' : 's'}` },
        el('span', { text: 'Juegos' }),
        // Dos casillas; tres si se juega el tercero con 2–0 y lo gana el mismo (3–0).
        ...Array.from({ length: Math.max(2, gamesWon(side)) }, (_, i) => el('i', { class: i < gamesWon(side) ? 'on' : '' })))),
    el('button', {
      class: `mesa-bf${field ? '' : ' empty'}`, type: 'button',
      'aria-label': field ? `Campo de batalla de ${name}: ${battlefieldName(field)}. Cambiar` : `Elegir el Campo de batalla de ${name}`,
      onclick: () => pickField(side, name),
    }, field ? battlefieldName(field) : '+ Campo de batalla'),
    el('button', {
      class: 'mesa-score', type: 'button', 'aria-label': `Sumar un punto a ${name}`, onclick: () => bump(1),
    },
      // Un 6 o un 9 girados se confunden: van subrayados, como en los dados.
      el('span', { class: `mesa-num${/[69]/.test(String(score)) ? ' marked' : ''}`, text: String(score) }),
      el('span', { class: 'mesa-track', 'aria-hidden': 'true' },
        ...Array.from({ length: tb.target }, (_, i) => el('i', { class: i < filled ? 'on' : '' }))),
      won ? el('span', { class: 'mesa-flag', text: 'Gana el juego' })
        : startsHere ? el('span', { class: 'mesa-flag start', text: 'Empieza' })
          : el('span', { class: 'mesa-flag none', 'aria-hidden': 'true' })),
    el('div', { class: 'mesa-steps' },
      el('button', { class: 'mesa-step', type: 'button', 'aria-label': `Quitar un punto a ${name}`, disabled: !score, onclick: () => bump(-1) }, '−'),
      el('button', { class: 'mesa-step plus', type: 'button', 'aria-label': `Sumar un punto a ${name}`, onclick: () => bump(1) }, '+')),
    chooses && choosePanel(side));
}

/**
 * Quien elige quién empieza: en el primer juego, el que gana el sorteo; en los siguientes, el que
 * perdió el anterior. Va en su mitad, así que lo lee de frente.
 */
function choosePanel(side) {
  const self = side === 0 ? 'me' : 'opp';
  const other = side === 0 ? 'opp' : 'me';
  const otherName = other === 'opp' ? oppLabel() : (cloud.profile?.display_name || cloud.username || 'tu rival');
  return el('div', { class: 'mesa-choose', role: 'group', 'aria-label': 'Elegir quién empieza' },
    el('strong', { text: t().games.length === 1 ? 'Has ganado el sorteo' : 'Perdiste el juego anterior' }),
    el('span', { text: '¿Quién empieza?' }),
    el('button', { class: 'mesa-choice', type: 'button', onclick: () => chooseFirst(self) }, 'Empiezo yo'),
    el('button', { class: 'mesa-choice', type: 'button', onclick: () => chooseFirst(other) }, `Empieza ${otherName}`));
}

/** Juegos ya cerrados que ha ganado un lado (el que se está jugando no cuenta). */
function gamesWon(side) {
  return t().games.slice(0, -1).filter(([a, b]) => (side === 0 ? a > b : b > a)).length;
}

function iconBtn(label, svg, onclick) {
  const b = el('button', { class: 'mesa-btn', type: 'button', title: label, 'aria-label': label, onclick });
  b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${svg}</svg>`;
  return b;
}

/** ¿La partida ya tiene ganador, contando el juego que se está jugando si alguien ya lo gana? */
function decided() {
  if (t().bestOf === 1) return leader() !== null;
  return gamesWon(0) + (leader() === 0) >= 2 || gamesWon(1) + (leader() === 1) >= 2;
}

/**
 * La barra del medio, para quien tiene el móvil delante. Solo una acción va en blanco: «Terminar
 * juego» cuando alguien ya gana el juego y quedan juegos (lo guarda y pasa al siguiente), «Terminar»
 * cuando la partida ya está decidida (la guarda en el historial).
 */
function bar() {
  const tb = t();
  const n = tb.games.length;
  const [a, b] = current();
  const over = leader() !== null;
  const done = decided();
  const closeGame = tb.bestOf > 1 && over && !done;
  // 2–0 en el segundo juego: se puede jugar el tercero igualmente (acaba 3–0 o 2–1).
  const canThird = tb.bestOf > 1 && n === 2 && over && done;
  // Cerrar un juego sin llegar a los puntos (p. ej. si alguien se rinde).
  const canNext = tb.bestOf > 1 && n < 3 && !over && !(gamesWon(0) >= 2 || gamesWon(1) >= 2) && (a > 0 || b > 0);
  // Sorteo en el primer juego; en los siguientes elige quien perdió (si el anterior acabó empatado, sorteo).
  const prev = tb.games[n - 2];
  const canDraw = !a && !b && !tb.chooser && (n === 1 || (prev[0] === prev[1] && !starter()));
  const pill = (text, label, onclick, primary) => el('button', { class: `mesa-pill${primary ? ' primary' : ''}`, type: 'button', 'aria-label': label, onclick }, text);
  return el('div', { class: 'mesa-bar' },
    iconBtn('Salir de la mesa (la partida sigue guardada)', '<path d="M15 6l-6 6 6 6"/>', closeTable),
    canDraw && pill('Sortear', 'Sortear quién elige quién empieza', drawFirst, false),
    el('div', { class: 'mesa-status' },
      el('strong', { text: tb.bestOf > 1 ? `Juego ${n}` : 'Un juego' }),
      el('span', { text: tb.bestOf > 1 ? `${gamesWon(0)}–${gamesWon(1)} · a ${tb.target}` : `a ${tb.target} puntos` })),
    iconBtn('Reiniciar la partida', '<path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v5h5"/>', reset),
    canNext && pill('Siguiente', 'Cerrar este juego y empezar el siguiente', nextGame, false),
    canThird && pill('Jugar el 3.º', 'Guardar el juego 2 y jugar el tercero aunque la partida ya esté decidida', nextGame, false),
    closeGame
      ? pill('Terminar juego', `Guardar el juego ${n} y empezar el juego ${n + 1}`, nextGame, true)
      : pill('Terminar', 'Terminar y guardar la partida', finish, done));
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

/** Sorteo: las dos mitades se iluminan por turnos y se para en una, que elige quién empieza. */
function drawFirst() {
  if (drawing) return;
  drawing = true;
  const halves = [...document.querySelectorAll('.mesa-half')]; // [rival, tú]
  const pick = Math.random() < 0.5 ? 'me' : 'opp';
  const steps = 9 + (pick === 'me' ? 1 : 0); // acaba en la mitad elegida
  let i = 0;
  const tick = () => {
    halves.forEach((h, k) => h.classList.toggle('lit', k === i % 2));
    if (++i < steps) setTimeout(tick, 70 + i * 18);
    else {
      drawing = false;
      halves.forEach((h) => h.classList.remove('lit'));
      if (!t()) return;
      if (t().games.length === 1) t().first = null;
      t().start = null;
      (t().starts ??= [])[t().games.length - 1] = null;
      t().chooser = pick;
      store.saveTable();
      renderTable();
      flash(pick === 'me' ? 0 : 1);
    }
  };
  tick();
}

/** Apunta a quien haya elegido el ganador del sorteo como el que empieza. */
function chooseFirst(who) {
  if (t().games.length === 1) t().first = who;
  t().start = who;
  (t().starts ??= [])[t().games.length - 1] = who;
  t().chooser = null;
  store.saveTable();
  renderTable();
  toast(who === 'me' ? 'Empiezas tú' : `Empieza ${oppLabel()}`);
  flash(who === 'me' ? 0 : 1);
}

function flash(side) {
  document.querySelectorAll('.mesa-half')[side === 0 ? 1 : 0]?.classList.add('picked');
}

function nextGame() {
  const [a, b] = current();
  if (!a && !b) return toast('Este juego aún no tiene puntos.');
  const n = t().games.length;
  const third = decided(); // 2–0: el tercero se juega aunque la partida ya esté decidida
  if (!confirm(third
    ? `¿Jugar el tercer juego? El juego ${n} (${a}–${b}) se guarda y la partida acabará 3–0 o 2–1.`
    : `¿Terminar el juego ${n} (${a}–${b})? Se guarda y empieza el juego ${n + 1}.`)) return;
  const tb = t();
  fieldsNow(); // que el juego cerrado tenga su sitio en los Campos
  tb.starts = tb.games.map((_, i) => startOfGame(tb, i)); // y en quién empezó (las mesas de antes)
  tb.games.push([0, 0]);
  tb.fields.push([null, null]);
  tb.starts.push(null);
  // El que perdió el juego elige quién empieza el siguiente (si quedó empatado, se sortea).
  tb.start = null;
  tb.chooser = a < b ? 'me' : b < a ? 'opp' : null;
  store.saveTable();
  renderTable();
  toast(`Juego ${n} guardado (${gamesWon(0)}–${gamesWon(1)}). Empieza el juego ${n + 1}.`);
  if (tb.chooser) flash(tb.chooser === 'me' ? 0 : 1);
}

function reset() {
  if (!confirm('¿Reiniciar la partida? Los puntos vuelven a 0.')) return;
  const tb = t();
  tb.games = [[0, 0]];
  tb.fields = [tb.fields?.[0] ?? [null, null]]; // los Campos del primer juego siguen valiendo
  tb.first = null;
  tb.start = null;
  tb.starts = [null];
  tb.chooser = null;
  store.saveTable();
  renderTable();
}

/** Elegir el Campo de batalla de un jugador en el juego que se está jugando. */
function pickField(side, name) {
  const tb = t();
  const dlg = $('#match-dialog');
  const n = tb.games.length;
  const used = (tb.fields ?? []).slice(0, n - 1).map((f) => f?.[side]).filter(Boolean);
  dlg.replaceChildren(
    el('div', { class: 'dialog-head' },
      el('h2', { text: side === 0 ? 'Tu Campo de batalla' : `Campo de batalla de ${name}` }),
      el('button', { class: 'icon-btn', type: 'button', title: 'Cerrar', 'aria-label': 'Cerrar', onclick: () => dlg.close() }, '✕')),
    tb.bestOf > 1 && el('p', { class: 'muted small', text: `Juego ${n}` }),
    battlefieldChooser(fieldsNow()[side], (id) => {
      fieldsNow()[side] = canonicalBattlefield(id);
      store.saveTable();
      dlg.close();
      renderTable();
    }, { suggested: side === 0 ? deckBattlefields(tb.me.deck) : [], used }),
  );
  dlg.showModal();
}

/** La partida de la mesa, lista para el historial. */
function toMatch(tb) {
  // Los juegos con puntos, cada uno con sus Campos.
  const side = { me: true, opp: false };
  const kept = tb.games.map((g, i) => [g, tb.fields?.[i] ?? [null, null], side[startOfGame(tb, i)] ?? null]).filter(([[a, b]]) => a || b);
  const games = kept.map(([g]) => g);
  const fields = kept.map(([, f]) => f);
  const friend = tb.opp.account && cloud.people?.find((p) => p.id === tb.opp.account.id)?.friend;
  const m = {
    ...blankMatch(), at: tb.started, deck: tb.me.deck, my: tb.me.legend, opp: tb.opp.legend,
    oppName: tb.opp.name, rival: friend ? tb.opp.account.id : null,
    oppDeck: friend ? tb.opp.deck ?? null : null,
    points: games, starts: kept.map(([, , s]) => s), first: side[startOfGame(tb, 0)] ?? null,
    battlefields: fields.some(([x, y]) => x || y) ? fields : [],
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
  const early = tb.bestOf > 1 && !decided() ? 'Nadie ha ganado aún 2 juegos. ' : '';
  if (!confirm(`${early}¿Terminar la partida? Se guardará como ${what} (${pts}).`)) return;
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
