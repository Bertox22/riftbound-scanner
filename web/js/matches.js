// Registro de partidas: con qué mazo jugaste, contra qué Leyenda y cómo acabó.
//
// Partida: { id, at (fecha, ms), deck (id del mazo o null), my y opp (Leyendas), oppName,
//            result ('win' | 'loss' | 'draw'), score ('2-1'… o null), points (puntos de cada juego:
//            [[8, 7], [5, 8]], tuyos y del rival), first (true: empecé yo, false: el rival, null: sin
//            apuntar), event, notes, rival (id de la cuenta del rival, si es un amigo), mirrorOf (si es
//            la copia de una partida que apuntó el rival), battlefields (el Campo de batalla de cada
//            uno en cada juego, al lado de sus puntos: [[tuyo, del rival], …], null si no se apuntó;
//            [] si no hay ninguno), starts (quién empezó cada juego, al lado de sus puntos: [true, false],
//            solo con más de un juego; first es el del primero), oppDeck (el mazo con el que jugó el
//            rival, si es un amigo: { id (el de su cuenta), name }, o null), updated }
// Las Leyendas y los Campos se guardan con un id "canónico" (no por impresión), para que la foil,
// la Metal o la Signature cuenten como la misma al sacar estadísticas.

import { store, newUuid } from './store.js';
import { $, el, toast, cardImg, baseName } from './ui.js';
import { cloud, onCloudChange, fetchIncoming, dismissIncoming, mirrorId, fetchUserDecks } from './cloud.js';

const RESULTS = { win: 'Victoria', loss: 'Derrota', draw: 'Empate' };
const RESULT_SHORT = { win: 'V', loss: 'D', draw: 'E' };
// 3–0 y 0–3: cuando, ya decidida la partida, se juega el tercer juego igualmente.
const SCORES = { '2-0': 'win', '2-1': 'win', '3-0': 'win', '0-2': 'loss', '1-2': 'loss', '0-3': 'loss', '1-1': 'draw' };
const MAX_GAMES = 3; // al mejor de 3

let ctx; // { cards, byId, openCard }
let deckFilter = ''; // estadísticas e historial de un solo mazo ('' = todos, 'none' = sin mazo)
let legends = []; // una carta por Leyenda, ordenadas por campeón
const canonicalOf = new Map(); // id de cualquier impresión → id de su Leyenda

// ---------- Leyendas ----------

/** "Master Yi - Wuju Bladesman - Starter (Metal)" → "master yi - wuju bladesman". */
const legendKey = (c) => c.name.replace(/\s*\([^)]*\)\s*$/, '').replace(/\s+-\s+Starter$/i, '').trim().toLowerCase();

function buildLegends() {
  const groups = new Map();
  for (const c of ctx.cards) {
    if (c.type !== 'Legend' || c.supertype === 'Token') continue;
    const k = legendKey(c);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c);
  }
  for (const group of groups.values()) {
    // La impresión normal (sin "(Metal)", "(Signature)"…) es la que representa a la Leyenda.
    const main = group.find((c) => !/\(/.test(c.name) && !/[*]|star/.test(c.id)) ?? group[0];
    for (const c of group) canonicalOf.set(c.id, main.id);
    legends.push(main);
  }
  legends.sort((a, b) => legendTitle(a).localeCompare(legendTitle(b), 'es'));
}

/** Una carta por Leyenda (la impresión normal), ordenadas por campeón. */
export const allLegends = () => legends;

export const canonicalLegend = (id) => (id ? canonicalOf.get(id) ?? id : null);

/** "Jinx · Loose Cannon" */
export function legendTitle(card) {
  const [champ, title] = card.name.replace(/\s*\([^)]*\)\s*$/, '').replace(/\s+-\s+Starter$/i, '').split(' - ');
  return title ? `${champ} · ${title}` : champ;
}
export const legendChamp = (card) => legendTitle(card).split(' · ')[0];

// ---------- Campos de batalla ----------

let battlefields = []; // uno por Campo (la impresión normal), por nombre
const canonicalBf = new Map(); // id de cualquier impresión → id de su Campo

function buildBattlefields() {
  const groups = new Map();
  for (const c of ctx.cards) {
    if (c.type !== 'Battlefield' || c.supertype === 'Token') continue;
    const k = baseName(c).toLowerCase();
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c);
  }
  for (const group of groups.values()) {
    const main = group.find((c) => !/\(/.test(c.name)) ?? group[0];
    for (const c of group) canonicalBf.set(c.id, main.id);
    battlefields.push(main);
  }
  battlefields.sort((a, b) => baseName(a).localeCompare(baseName(b), 'es'));
}

export const canonicalBattlefield = (id) => (id ? canonicalBf.get(id) ?? id : null);

/** Nombre de un Campo por su id ("Altar to Unity"), o null. */
export const battlefieldName = (id) => { const c = id && ctx.byId.get(id); return c ? baseName(c) : null; };

/**
 * Cuadrícula para elegir un Campo de batalla, con buscador. `suggested` (los del mazo) van primero;
 * `used` se marcan como ya jugados en esta partida. onpick(null) lo quita.
 */
export function battlefieldChooser(selected, onpick, { suggested = [], used = [], from = 'De tu mazo' } = {}) {
  let q = '';
  const top = [...new Set(suggested.map(canonicalBattlefield).filter((id) => ctx.byId.has(id)))];
  const grid = el('div', { class: 'legend-grid bf-grid' });
  const opt = (c) => el('button', {
    type: 'button', class: `legend-opt bf-opt${c.id === selected ? ' selected' : ''}`, onclick: () => onpick(c.id),
  }, cardImg(c), el('span', { text: used.includes(c.id) && c.id !== selected ? `${baseName(c)} · ya jugado` : baseName(c) }));
  const draw = () => {
    const s = q.trim().toLowerCase();
    const match = (c) => !s || baseName(c).toLowerCase().includes(s);
    const mine = top.map((id) => ctx.byId.get(id)).filter(match);
    const rest = battlefields.filter((c) => !top.includes(c.id) && match(c));
    grid.replaceChildren(...[
      mine.length > 0 && el('p', { class: 'bf-group muted small', text: from }),
      ...mine.map(opt),
      mine.length > 0 && rest.length > 0 && el('p', { class: 'bf-group muted small', text: 'Todos' }),
      ...rest.map(opt),
      !mine.length && !rest.length && el('p', { class: 'muted small', text: 'Ningún Campo con ese nombre.' }),
    ].filter(Boolean));
  };
  draw();
  return el('div', { class: 'legend-choose' },
    el('div', { class: 'legend-search' }, el('input', { type: 'search', placeholder: 'Buscar Campo de batalla…', 'aria-label': 'Buscar Campo de batalla', oninput: (e) => { q = e.target.value; draw(); } })),
    grid,
    selected && el('button', { type: 'button', class: 'link small', onclick: () => onpick(null) }, 'Quitar el Campo'));
}

/** Los Campos del mazo (para ponerlos primero al elegir). */
export const deckBattlefields = (deckId) => deckById(deckId)?.battlefields ?? [];

// ---------- Datos ----------

export const deckById = (id) => store.decks.find((d) => d.id === id);
const lastDeck = () => store.matches.find((m) => m.deck && deckById(m.deck))?.deck ?? store.decks[0]?.id ?? null;

export function blankMatch() {
  return { id: newUuid(), at: Date.now(), deck: lastDeck(), my: null, opp: null, oppName: '', result: null, score: null, points: [[null, null]], battlefields: [], starts: [], first: null, event: '', notes: '', rival: null, mirrorOf: null, oppDeck: null };
}

/** Quién empezó un juego: true tú, false el rival, null sin apuntar (las de antes solo tienen el primero). */
export const startOf = (m, i) => m.starts?.[i] ?? (i === 0 ? m.first ?? null : null);

/** Los Campos de un juego: [tuyo, del rival]. */
export const bfOf = (m, i) => m.battlefields?.[i] ?? [null, null];

// ---------- Puntos ----------

const fullGames = (points) => (points ?? []).filter(([a, b]) => a != null && b != null);
const pointsText = (points) => fullGames(points).map(([a, b]) => `${a}–${b}`).join(', ');

/**
 * Con los puntos de cada juego se sabe el resultado: un juego, quien tenga más; varios, quien gane
 * más juegos (y el marcador al mejor de 3). Si no cuadra con un marcador posible, no se toca nada.
 */
export function deriveFromPoints(m) {
  const games = fullGames(m.points);
  if (!games.length) return;
  const wins = games.filter(([a, b]) => a > b).length;
  const losses = games.filter(([a, b]) => b > a).length;
  if (games.length === 1) {
    m.result = wins ? 'win' : losses ? 'loss' : 'draw';
    m.score = null;
    return;
  }
  const key = `${wins}-${losses}`;
  if (SCORES[key]) {
    m.score = key;
    m.result = SCORES[key];
  }
}

export function saveMatch(m) {
  // Se quedan los juegos con puntos, con algún Campo o con quién empezó; los Campos y quién empezó
  // siguen al lado de sus puntos. first es quién empezó el primer juego.
  m.first = startOf(m, 0);
  const games = (m.points ?? []).map((g, i) => [g, bfOf(m, i), startOf(m, i)])
    .filter(([[a, b], [x, y], s]) => (a != null && b != null) || x || y || s != null);
  m.points = games.map(([g]) => g);
  m.battlefields = games.some(([, [x, y]]) => x || y) ? games.map(([, f]) => [f[0] ?? null, f[1] ?? null]) : [];
  m.starts = games.length > 1 && games.some(([, , s]) => s != null) ? games.map(([, , s]) => s) : [];
  m.my = canonicalLegend(deckById(m.deck)?.legend) ?? m.my;
  m.updated = Date.now();
  const i = store.matches.findIndex((x) => x.id === m.id);
  if (i >= 0) store.matches[i] = m;
  else store.matches.push(m);
  store.matches.sort((a, b) => b.at - a.at);
  store.saveMatches();
}

function deleteMatch(id) {
  store.matches = store.matches.filter((m) => m.id !== id);
  store.saveMatches();
}

// ---------- Fechas ----------

const sameYear = (t) => new Date(t).getFullYear() === new Date().getFullYear();
const fmtDay = (t) => new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', ...(sameYear(t) ? {} : { year: 'numeric' }) }).format(t);
const toInputDate = (t) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
/** Del <input type=date> a ms, conservando la hora si es el mismo día. */
function fromInputDate(value, prev) {
  if (!value || value === toInputDate(prev)) return prev;
  const [y, mo, d] = value.split('-').map(Number);
  return new Date(y, mo - 1, d, 12).getTime();
}

// ---------- Lista ----------

/** Nombre de un mazo que ya no existe: su Leyenda con "(borrado)", o "Mazo borrado" si no se sabe. */
function deletedDeckName(legendId) {
  const card = legendId && ctx.byId.get(legendId);
  return card ? `${legendChamp(card)} (borrado)` : 'Mazo borrado';
}

export function legendThumb(id) {
  const card = ctx.byId.get(id);
  return card ? cardImg(card, 'thumb small') : el('div', { class: 'thumb small placeholder', 'aria-hidden': 'true' }, '?');
}

/** "Empecé yo", o con varios juegos "Empezó: yo, rival, yo" (null si no se apuntó). */
function startsText(m) {
  if (m.starts?.length > 1) return `Empezó: ${m.starts.map((s) => (s === true ? 'yo' : s === false ? 'rival' : '?')).join(', ')}`;
  return m.first === true ? 'Empecé yo' : m.first === false ? 'Empezó el rival' : null;
}

function matchRow(m) {
  const deck = deckById(m.deck);
  const opp = ctx.byId.get(m.opp);
  const rival = [opp && legendChamp(opp), m.oppName].filter(Boolean).join(' · ');
  const meta = [
    fmtDay(m.at),
    // "2–1 (5–8, 8–6, 8–2)", o solo "8–7" en una partida a un juego.
    [m.score?.replace('-', '–'), m.points?.length && (m.score ? `(${pointsText(m.points)})` : pointsText(m.points))].filter(Boolean).join(' '),
    startsText(m),
    m.event,
  ].filter(Boolean).join(' · ');
  const decks = [deck ? deck.name : m.deck ? deletedDeckName(m.my) : 'Sin mazo', m.oppDeck?.name && `contra su «${m.oppDeck.name}»`].filter(Boolean).join(' ');
  // "Campos: Altar to Unity vs Aspirant's Climb · …", un par por juego.
  const fields = (m.battlefields ?? []).filter(([a, b]) => a || b)
    .map(([a, b]) => `${battlefieldName(a) ?? '?'} vs ${battlefieldName(b) ?? '?'}`).join(' · ');
  return el('li', { class: 'match-row', onclick: () => openSheet(m) },
    el('span', { class: `match-result ${m.result}`, title: RESULTS[m.result], 'aria-label': RESULTS[m.result] }, RESULT_SHORT[m.result]),
    el('div', { class: 'match-legends', 'aria-hidden': 'true' }, legendThumb(m.my), legendThumb(m.opp)),
    el('div', { class: 'grow' },
      el('strong', { text: rival ? `contra ${rival}` : 'Rival sin apuntar' }),
      el('div', { class: 'muted small', text: decks }),
      meta && el('div', { class: 'muted small', text: meta }),
      fields && el('div', { class: 'muted small', text: `Campos: ${fields}` }),
    ),
  );
}

// ---------- Estadísticas ----------
// Se cuentan juegos, no partidas: al mejor de 3, un 2–1 son dos victorias y una derrota y un 0–3,
// tres derrotas; a un juego, la partida es un juego. El porcentaje de victorias no cuenta los empates.

/**
 * Los juegos de una partida: [{ res: 'win' | 'loss' | 'draw', start: true | false | null }] (start:
 * quién empezó ese juego). Vale también para las filas de la nube que se ven en los perfiles
 * (games_won, games_lost, points, result).
 */
export function gamesOf(m) {
  const score = m.score ?? (m.games_won != null && m.games_lost != null ? `${m.games_won}-${m.games_lost}` : null);
  const [won, lost] = score ? score.split('-').map(Number) : [null, null];
  const played = (m.points ?? []).map(([a, b], i) => ({ a, b, i })).filter(({ a, b }) => a != null && b != null);
  const byPoints = played.map(({ a, b, i }) => ({ res: a > b ? 'win' : b > a ? 'loss' : 'draw', start: startOf(m, i) }));
  const w = byPoints.filter((g) => g.res === 'win').length, l = byPoints.filter((g) => g.res === 'loss').length;
  // Los puntos mandan si cuadran con el marcador (o si no hay marcador y hay varios juegos): saben quién empezó cada uno.
  if (played.length > 1 && (score == null || (w === won && l === lost))) return byPoints;
  if (score != null) {
    return [...Array(won).fill('win'), ...Array(lost).fill('loss')].map((res) => ({ res, start: null }));
  }
  return [{ res: m.result, start: m.first ?? m.went_first ?? null }];
}

function tally(games, matches) {
  const r = { matches, games: games.length, win: 0, loss: 0, draw: 0 };
  for (const g of games) r[g.res]++;
  const decided = r.win + r.loss;
  r.rate = decided ? Math.round((100 * r.win) / decided) : null;
  return r;
}

/** Récord de una lista de partidas, por juegos: { matches, games, win, loss, draw, rate }. */
export const record = (list) => tally(list.flatMap(gamesOf), list.length);
/** "3 partidas", o "3 partidas · 7 juegos" si alguna fue al mejor de 3. */
export const countText = (r) => `${r.matches} partida${r.matches === 1 ? '' : 's'}${r.games !== r.matches ? ` · ${r.games} juegos` : ''}`;
export const recordText = (r) => `${r.win}–${r.loss}${r.draw ? `–${r.draw}` : ''}`;
export const rateText = (r) => (r.rate == null ? '—' : `${r.rate} %`);

/** Agrupa partidas por una clave y devuelve [clave, récord] de más a menos partidas. */
export function groupBy(list, key) {
  const groups = new Map();
  for (const m of list) {
    const k = key(m);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(m);
  }
  return [...groups].map(([k, ms]) => [k, record(ms)]).sort((a, b) => b[1].matches - a[1].matches || (b[1].rate ?? -1) - (a[1].rate ?? -1));
}

function rateBar(r) {
  return el('div', { class: 'rate-bar', 'aria-hidden': 'true' }, el('span', { style: `width: ${r.rate ?? 0}%` }));
}

export function statRow(thumb, name, r) {
  return el('li', { class: 'stat-row' },
    thumb,
    el('div', { class: 'grow' },
      el('div', { class: 'stat-row-top' },
        el('span', { class: 'stat-row-name', text: name }),
        el('span', { class: 'stat-row-rate', text: rateText(r) })),
      rateBar(r),
      el('div', { class: 'muted small', text: `${recordText(r)} · ${countText(r)}` })));
}

const filtered = () => store.matches.filter((m) => !deckFilter || (m.deck ?? 'none') === deckFilter);

function renderStats(list) {
  const box = $('#match-stats');
  if (!store.matches.length) return box.replaceChildren();
  const all = record(list);
  // Empezando tú o el rival: cada juego por su cuenta (al mejor de 3, cada uno tiene quien empezó).
  const games = list.flatMap(gamesOf);
  const firstR = tally(games.filter((g) => g.start === true), 0);
  const secondR = tally(games.filter((g) => g.start === false), 0);

  // Mazos con partidas (y los que ya no existen, si quedan partidas suyas).
  const deckIds = [...new Set(store.matches.map((m) => m.deck ?? 'none'))];
  const deckLegend = (id) => canonicalLegend(deckById(id)?.legend) ?? store.matches.find((m) => (m.deck ?? 'none') === id)?.my;
  const deckName = (id) => (id === 'none' ? 'Sin mazo' : deckById(id)?.name ?? deletedDeckName(deckLegend(id)));
  const filter = el('select', { 'aria-label': 'Mazo', onchange: (e) => { deckFilter = e.target.value; render(); } },
    el('option', { value: '', text: 'Todos los mazos', selected: !deckFilter }),
    ...deckIds.map((id) => el('option', { value: id, text: deckName(id), selected: id === deckFilter })));

  const byDeck = deckFilter ? [] : groupBy(list, (m) => m.deck ?? 'none');
  const byOpp = groupBy(list.filter((m) => m.opp), (m) => m.opp);

  // replaceChildren escribiría "false" con las secciones que no tocan: se quitan antes.
  box.replaceChildren(...[
    el('div', { class: 'stats-filter' }, filter),
    el('div', { class: 'stats-summary' },
      el('div', { class: 'stats-big' },
        el('strong', { text: rateText(all) }),
        el('span', { class: 'muted small', text: 'victorias' })),
      el('div', { class: 'stats-big' },
        el('strong', { text: recordText(all) }),
        el('span', { class: 'muted small', text: all.draw ? 'V–D–E' : 'V–D' })),
      el('div', { class: 'stats-big' },
        el('strong', { text: String(all.matches) }),
        el('span', { class: 'muted small', text: `${all.matches === 1 ? 'partida' : 'partidas'}${all.games !== all.matches ? ` · ${all.games} juegos` : ''}` }))),
    (firstR.games || secondR.games) && el('div', { class: 'stats-first' },
      ...[['Empezando tú', firstR], ['Empezando el rival', secondR]].map(([label, r]) => el('div', {},
        el('span', { class: 'muted small', text: label }),
        el('strong', { text: rateText(r) }),
        el('span', { class: 'muted small', text: r.games ? recordText(r) : '' })))),
    byDeck.length > 1 && el('h3', { class: 'stats-title', text: 'Por mazo' }),
    byDeck.length > 1 && el('ul', { class: 'stat-list' },
      ...byDeck.map(([id, r]) => statRow(legendThumb(deckLegend(id)), deckName(id), r))),
    byOpp.length > 0 && el('h3', { class: 'stats-title', text: 'Contra cada Leyenda' }),
    byOpp.length > 0 && el('ul', { class: 'stat-list' },
      ...byOpp.map(([id, r]) => statRow(legendThumb(id), legendChamp(ctx.byId.get(id)), r))),
  ].filter(Boolean));
}

function render() {
  renderIncoming();
  if (deckFilter && !store.matches.some((m) => (m.deck ?? 'none') === deckFilter)) deckFilter = '';
  const list = filtered();
  renderStats(list);
  const n = store.matches.length;
  $('#match-count').textContent = n ? String(n) : '';
  $('#match-history-head').hidden = !n;
  $('#match-list').replaceChildren(...(n
    ? list.map(matchRow)
    : [el('li', { class: 'empty' }, 'Aún no has apuntado partidas. Al acabar una, pulsa «Apuntar partida».')]));
}

// ---------- Hoja para apuntar o editar ----------

function segmented(name, options, value, onpick, cls = '') {
  return el('div', { class: `segmented ${cls}`, role: 'radiogroup', 'aria-label': name },
    ...options.map(([v, label, cls]) => el('button', {
      type: 'button', role: 'radio', class: cls, 'aria-checked': String(v === value), dataset: { v: String(v) },
      onclick: () => onpick(v),
    }, label)));
}

/** Tus amigos para elegir de rival: [[id, nombre visible, usuario]] (y el de la partida, si ya no lo es). */
function rivalOptions(m) {
  const options = (cloud.people ?? []).filter((p) => p.friend).map((p) => [p.id, p.display_name || p.username, p.username]);
  if (m.rival && !options.some(([id]) => id === m.rival)) options.push([m.rival, m.oppName || 'Rival', m.oppName]);
  return options;
}

/**
 * Rival con cuenta: uno de tus amigos. La partida le llega para que la guarde en su historial con el
 * resultado al revés. Solo sale si tienes amigos (o si la partida ya lleva uno). Con un amigo, su nombre
 * de usuario es el del rival (no se escribe a mano) y se puede apuntar con qué mazo jugó.
 */
function rivalFields(m, draw) {
  const options = rivalOptions(m);
  if (!options.length) return [];
  const chosen = options.find(([id]) => id === m.rival);
  return [
    el('div', { class: 'match-field' },
      el('span', { class: 'match-label', text: 'Contra un amigo (opcional)' }),
      segmented('Rival con cuenta', [[null, 'Ninguno'], ...options.map(([id, label]) => [id, label])], m.rival ?? null, (v) => {
        const prev = options.find(([id]) => id === m.rival);
        const next = options.find(([id]) => id === v);
        if (v !== m.rival) m.oppDeck = null;
        // Con un amigo el nombre es su usuario; al quitarlo, el nombre vuelve a estar vacío.
        m.oppName = next ? next[2] : prev && m.oppName === prev[2] ? '' : m.oppName;
        m.rival = v;
        draw();
      }),
      chosen && el('p', { class: 'muted small', text: m.mirrorOf ? `Copia de la partida que apuntó ${chosen[1]}.` : `Le llegará a ${chosen[1]} para que la guarde en su historial.` })),
    // Con qué mazo jugó: al elegirlo, su Leyenda pasa a ser la del rival (y sus Campos salen primero).
    chosen && rivalDeckField(m.rival, chosen[1], m.oppDeck, (d) => {
      m.oppDeck = d ? { id: d.id, name: d.name } : null;
      if (d?.legend && ctx.byId.has(canonicalLegend(d.legend))) m.opp = canonicalLegend(d.legend);
      draw();
    }, draw),
  ].filter(Boolean);
}

// ---------- Mazo del rival (si es un amigo) ----------

const rivalDecks = new Map(); // id de su cuenta → { at, list | null (cargando) | 'error' }

/** Los mazos de un amigo ([{ id, name, legend }]); se piden a la nube como mucho una vez cada 5 minutos. */
export function loadRivalDecks(userId) {
  const hit = rivalDecks.get(userId);
  if (hit?.promise && Date.now() - hit.at < 5 * 60_000) return hit.promise;
  const entry = { at: Date.now(), list: null };
  entry.promise = fetchUserDecks(userId).then(
    (list) => { entry.list = list; return list; },
    (err) => { entry.list = 'error'; entry.promise = null; throw err; });
  rivalDecks.set(userId, entry);
  return entry.promise;
}

/** El mazo de un amigo ({ id, name, legend, battlefields }) si sus mazos ya llegaron; loaded: si llegaron. */
function cachedRivalDeck(userId, deck) {
  const list = userId && rivalDecks.get(userId)?.list;
  if (!Array.isArray(list)) return { loaded: false, deck: null };
  return { loaded: true, deck: (deck && list.find((d) => d.id === deck.id)) ?? null };
}

/**
 * La Leyenda del rival cuando se sabe con qué mazo jugó un amigo: la de ese mazo, y no se puede poner
 * otra. Mientras llegan sus mazos vale la que ya llevaba la partida. null si no hay mazo o no tiene Leyenda.
 */
export function rivalDeckLegend(userId, deck, current = null) {
  if (!userId || !deck) return null;
  const { loaded, deck: d } = cachedRivalDeck(userId, deck);
  if (!loaded) return rivalDecks.get(userId)?.list === 'error' ? null : current;
  const id = canonicalLegend(d?.legend);
  return id && ctx.byId.has(id) ? id : null;
}

/** Los Campos de batalla del mazo con el que jugó un amigo ([] si no se sabe). */
export const rivalDeckBattlefields = (userId, deck) => cachedRivalDeck(userId, deck).deck?.battlefields ?? [];

/**
 * Desplegable para apuntar con qué mazo jugó un amigo (los suyos que puedes ver). `selected` es
 * { id, name } o null; onpick(deck | null) con deck = { id, name, legend }. La primera vez sus mazos
 * se piden a la nube y, al llegar, redraw() vuelve a pintar (si el desplegable sigue en pantalla).
 */
export function rivalDeckField(userId, who, selected, onpick, redraw) {
  const entry = rivalDecks.get(userId);
  const field = el('label', { class: 'match-field' });
  if (!entry?.promise && entry?.list !== 'error') {
    loadRivalDecks(userId).catch(() => {}).finally(() => field.isConnected && redraw());
  }
  const list = Array.isArray(entry?.list) ? entry.list : [];
  const status = !entry || entry.list === null ? 'Cargando sus mazos…' : entry.list === 'error' ? 'No se han podido cargar sus mazos' : !list.length ? 'No tiene mazos que puedas ver' : null;
  const legendOf = (d) => { const c = ctx.byId.get(canonicalLegend(d.legend)); return c ? ` · ${legendChamp(c)}` : ''; };
  field.append(
    el('span', { class: 'match-label', text: `Mazo de ${who} (opcional)` }),
    el('select', {
      'aria-label': `Mazo de ${who}`,
      onchange: (e) => { const d = list.find((x) => x.id === e.target.value) ?? (e.target.value && selected?.id === e.target.value ? selected : null); onpick(d); },
    },
      el('option', { value: '', text: 'Sin apuntar', selected: !selected }),
      ...list.map((d) => el('option', { value: d.id, text: `${d.name}${legendOf(d)}`, selected: d.id === selected?.id })),
      selected && !list.some((d) => d.id === selected.id) && el('option', { value: selected.id, text: selected.name || 'Mazo', selected: true }),
      status && el('option', { value: '', disabled: true, text: status })));
  return field;
}

// ---------- Partidas que te han apuntado (partida espejo) ----------

let incoming = []; // [{ match, author }], la partida tal como la apuntó el otro
let incomingAt = 0;

const flip = { win: 'loss', loss: 'win', draw: 'draw' };

/** La partida de tu amigo vista desde tu lado: resultado, marcador, puntos, Leyendas y quién empezó al revés. */
async function mirrored({ match: o, author }) {
  const isFriend = cloud.people?.some((p) => p.id === author.id && p.friend);
  const blank = blankMatch();
  // Su mazo pasa a ser el del rival (con el nombre que tenga ahora) y el que apuntó como tuyo, el tuyo.
  const theirs = o.deck ? (await loadRivalDecks(author.id).catch(() => [])).find((d) => d.id === o.deck) : null;
  return {
    ...blank,
    id: await mirrorId(o.id), at: o.at, my: o.opp, opp: o.my, result: flip[o.result],
    deck: o.oppDeck?.id && deckById(o.oppDeck.id) ? o.oppDeck.id : blank.deck,
    oppDeck: theirs ? { id: theirs.id, name: theirs.name } : null,
    score: o.score ? o.score.split('-').reverse().join('-') : null,
    points: o.points?.length ? o.points.map(([a, b]) => [b, a]) : [[null, null]],
    battlefields: (o.battlefields ?? []).map(([a, b]) => [b, a]),
    starts: (o.starts ?? []).map((s) => (s == null ? null : !s)),
    first: o.first == null ? null : !o.first, event: o.event ?? '',
    oppName: author.username, rival: isFriend ? author.id : null, mirrorOf: o.id,
  };
}

async function refreshIncoming(force = false) {
  if (!cloud.username || (!force && Date.now() - incomingAt < 60_000)) return;
  incomingAt = Date.now();
  try {
    incoming = await fetchIncoming();
  } catch (err) {
    console.error(err);
    return;
  }
  render();
}

function incomingCard(item) {
  const { match: o, author } = item;
  const name = author.display_name || author.username;
  const mine = ctx.byId.get(o.opp), theirs = ctx.byId.get(o.my);
  const res = flip[o.result];
  const what = [
    res === 'draw' ? 'Empate' : res === 'win' ? 'Ganaste tú' : `Ganó ${name}`,
    o.score && o.score.split('-').sort((a, b) => b - a).join('–'), // el ganador primero: "2–1"
  ].filter(Boolean).join(' ');
  const legends = [mine && `tú con ${legendChamp(mine)}`, theirs && `${name} con ${legendChamp(theirs)}`].filter(Boolean).join(', ');
  return el('li', { class: 'incoming-row' },
    el('span', { class: `match-result ${res}`, title: RESULTS[res], 'aria-label': RESULTS[res] }, RESULT_SHORT[res]),
    el('div', { class: 'grow' },
      el('strong', { text: `${name} apuntó una partida contra ti` }),
      el('div', { class: 'muted small', text: [what, legends, fmtDay(o.at), o.event].filter(Boolean).join(' · ') }),
      el('div', { class: 'actions' },
        el('button', { class: 'btn primary small', onclick: async () => openSheet(null, null, await mirrored(item)) }, 'Guardar en mi historial'),
        el('button', {
          class: 'btn ghost small',
          onclick: async (e) => {
            const btn = e.currentTarget;
            btn.disabled = true;
            try {
              await dismissIncoming(o);
              incoming = incoming.filter((x) => x !== item);
              render();
            } catch (err) {
              toast(err.message);
              btn.disabled = false;
            }
          },
        }, 'Descartar'))));
}

function renderIncoming() {
  const box = $('#match-incoming');
  // Las que ya están en tu historial (también las guardadas en otro dispositivo) no se vuelven a ofrecer.
  const have = new Set(store.matches.map((m) => m.mirrorOf).filter(Boolean));
  const list = incoming.filter((x) => !have.has(x.match.id));
  box.replaceChildren(...(list.length ? [
    el('h3', { class: 'stats-title', text: list.length === 1 ? 'Te han apuntado una partida' : `Te han apuntado ${list.length} partidas` }),
    el('ul', { class: 'incoming-list' }, ...list.map(incomingCard)),
  ] : []));
}

/** existing: partida a editar. draft: partida nueva ya rellena (la copia de una partida espejo). */
function openSheet(existing, deckId = null, draft = null) {
  const dlg = $('#match-dialog');
  const editing = !!existing;
  const m = existing ? structuredClone(existing) : draft ?? blankMatch();
  if (deckId) m.deck = deckId;
  if (!m.points?.length) m.points = [[null, null]];
  m.battlefields = m.points.map((_, i) => [...bfOf(m, i)]); // uno por juego, al lado de sus puntos
  m.starts = m.points.map((_, i) => startOf(m, i)); // quién empezó cada juego
  let choosing = false; // mostrando la cuadrícula de Leyendas
  let pickingBf = null; // { i, side }: eligiendo el Campo de ese juego
  let q = '';
  let more = editing && !!(m.score || (m.points.length === 1 && m.first != null) || m.event || m.notes); // "Más datos" abierto

  const draw = () => {
    const rivalName = m.rival ? rivalOptions(m).find(([id]) => id === m.rival)?.[1] : null;
    // Si es un amigo y se sabe su mazo, la Leyenda del rival es la de ese mazo (no se elige).
    const deckLegend = rivalDeckLegend(m.rival, m.oppDeck, m.opp);
    if (deckLegend) { m.opp = deckLegend; choosing = false; }
    const opp = ctx.byId.get(m.opp);
    const events = [...new Set(store.matches.map((x) => x.event).filter(Boolean))].slice(0, 12);

    const legendPicker = () => {
      const s = q.trim().toLowerCase();
      const list = legends.filter((c) => !s || legendTitle(c).toLowerCase().includes(s));
      const search = el('input', {
        type: 'search', placeholder: 'Buscar Leyenda…', value: q, 'aria-label': 'Buscar Leyenda del rival',
        oninput: (e) => { q = e.target.value; const pos = e.target.selectionStart; draw(); const i = dlg.querySelector('.legend-search input'); i.focus(); i.setSelectionRange(pos, pos); },
      });
      return el('div', { class: 'legend-choose' },
        el('div', { class: 'legend-search' }, search),
        el('div', { class: 'legend-grid' },
          ...list.map((c) => el('button', {
            type: 'button', class: `legend-opt${c.id === m.opp ? ' selected' : ''}`,
            onclick: () => { m.opp = c.id; choosing = false; q = ''; draw(); },
          }, cardImg(c), el('span', { text: legendChamp(c) }))),
          !list.length && el('p', { class: 'muted small', text: 'Ninguna Leyenda con ese nombre.' })));
    };

    // Puntos de cada juego: tú – rival. El resultado y el marcador se marcan solos mientras se
    // escribe, sin repintar la hoja (así no se pierde el foco al pasar a la casilla siguiente).
    const syncChoices = () => {
      for (const [group, value] of [['Resultado', m.result], ['Marcador', m.score]]) {
        dlg.querySelectorAll(`[aria-label="${group}"] button`).forEach((b) => b.setAttribute('aria-checked', String(b.dataset.v === String(value))));
      }
    };
    const pointInput = (g, side, label) => el('input', {
      type: 'number', inputmode: 'numeric', min: 0, max: 99, value: g[side] ?? '', 'aria-label': label, placeholder: '0',
      oninput: (e) => {
        g[side] = e.target.value === '' ? null : Math.max(0, Math.min(99, Number(e.target.value)));
        deriveFromPoints(m);
        syncChoices();
      },
    });
    const pointsField = el('div', { class: 'match-field' },
      el('span', { class: 'match-label', text: m.points.length > 1 ? 'Puntos de cada juego (tú – rival)' : 'Puntos (tú – rival)' }),
      el('div', { class: 'points-list' },
        ...m.points.map((g, i) => el('div', { class: 'points-row' },
          m.points.length > 1 && el('span', { class: 'points-game muted small', text: `Juego ${i + 1}` }),
          pointInput(g, 0, `Tus puntos${m.points.length > 1 ? `, juego ${i + 1}` : ''}`),
          el('span', { class: 'points-sep', 'aria-hidden': 'true' }, '–'),
          pointInput(g, 1, `Puntos del rival${m.points.length > 1 ? `, juego ${i + 1}` : ''}`),
          m.points.length > 1 && el('button', {
            type: 'button', class: 'icon-btn small', title: 'Quitar juego', 'aria-label': `Quitar juego ${i + 1}`,
            onclick: () => { m.points.splice(i, 1); m.battlefields.splice(i, 1); m.starts.splice(i, 1); pickingBf = null; deriveFromPoints(m); draw(); },
          }, '✕'))),
        m.points.length < MAX_GAMES && el('button', {
          type: 'button', class: 'link small points-add',
          onclick: () => { m.points.push([null, null]); m.battlefields.push([null, null]); m.starts.push(null); draw(); dlg.querySelectorAll('.points-row input')[m.points.length * 2 - 2]?.focus(); },
        }, m.points.length === 1 ? '+ Otro juego (al mejor de 3)' : '+ Otro juego')));

    // Campos de batalla de cada juego: el tuyo y el del rival.
    const bfButton = (i, side, label) => {
      const id = m.battlefields[i][side];
      const active = pickingBf?.i === i && pickingBf.side === side;
      return el('button', {
        type: 'button', class: `bf-pick${id ? '' : ' empty-pick'}${active ? ' active' : ''}`,
        'aria-label': `${label}${m.points.length > 1 ? `, juego ${i + 1}` : ''}: ${battlefieldName(id) ?? 'sin apuntar'}`,
        onclick: () => { pickingBf = active ? null : { i, side }; draw(); },
      }, battlefieldName(id) ?? label);
    };
    const bfField = el('div', { class: 'match-field' },
      el('span', { class: 'match-label', text: 'Campos de batalla (tuyo – rival)' }),
      el('div', { class: 'bf-list' },
        ...m.points.map((_, i) => el('div', { class: 'bf-row' },
          m.points.length > 1 && el('span', { class: 'points-game muted small', text: `Juego ${i + 1}` }),
          bfButton(i, 0, 'Tu Campo'),
          bfButton(i, 1, 'El del rival')))),
      pickingBf && battlefieldChooser(m.battlefields[pickingBf.i][pickingBf.side], (id) => {
        m.battlefields[pickingBf.i][pickingBf.side] = id;
        pickingBf = null;
        draw();
      }, {
        // Primero los del mazo de cada uno: el tuyo y, si es un amigo y se sabe su mazo, el suyo.
        ...(pickingBf.side === 0
          ? { suggested: deckBattlefields(m.deck) }
          : { suggested: rivalDeckBattlefields(m.rival, m.oppDeck), from: `Del mazo de ${rivalName}` }),
        used: m.battlefields.filter((_, j) => j !== pickingBf.i).map((f) => f[pickingBf.side]).filter(Boolean),
      }));

    // Quién empezó: con un juego va en "Más datos"; al mejor de 3, uno por juego, debajo de los Campos.
    const startOptions = [[null, 'Sin apuntar'], [true, 'Yo'], [false, 'El rival']];
    const startsField = m.points.length > 1
      ? el('div', { class: 'match-field' },
        el('span', { class: 'match-label', text: '¿Quién empezó cada juego?' }),
        el('div', { class: 'bf-list' },
          ...m.points.map((_, i) => el('div', { class: 'bf-row start-row' },
            el('span', { class: 'points-game muted small', text: `Juego ${i + 1}` }),
            // En la fila no cabe "Sin apuntar": "?" (sin apuntar), como en el historial.
            segmented(`Quién empezó el juego ${i + 1}`, [[null, '?'], ...startOptions.slice(1)], m.starts[i], (v) => { m.starts[i] = v; draw(); })))))
      : el('div', { class: 'match-field' },
        el('span', { class: 'match-label', text: '¿Quién empezó?' }),
        segmented('Quién empezó', startOptions, m.starts[0], (v) => { m.starts[0] = v; draw(); }));

    const decks = store.decks;
    dlg.replaceChildren(
      el('div', { class: 'dialog-head' },
        el('h2', { text: editing ? 'Editar partida' : draft ? 'Guardar en tu historial' : 'Apuntar partida' }),
        el('button', { class: 'icon-btn', type: 'button', title: 'Cerrar', 'aria-label': 'Cerrar', onclick: () => dlg.close() }, '✕')),
      el('form', {
        class: 'match-form',
        onsubmit: (e) => {
          e.preventDefault();
          if (!m.result) return toast('Elige el resultado.');
          saveMatch(m);
          dlg.close();
          toast(editing || draft ? 'Partida guardada' : `${RESULTS[m.result]} apuntada`);
        },
      },
        el('div', { class: 'match-field' },
          el('span', { class: 'match-label', text: 'Resultado' }),
          segmented('Resultado', [['win', 'Victoria', 'win'], ['loss', 'Derrota', 'loss'], ['draw', 'Empate', 'draw']], m.result, (v) => {
            m.result = v;
            if (m.score && SCORES[m.score] !== v) m.score = null;
            draw();
          })),
        pointsField,
        el('label', { class: 'match-field' },
          el('span', { class: 'match-label', text: 'Tu mazo' }),
          el('select', { onchange: (e) => { m.deck = e.target.value || null; pickingBf = null; draw(); } },
            el('option', { value: '', text: 'Sin mazo', selected: !m.deck }),
            ...decks.map((d) => el('option', { value: d.id, text: d.name, selected: d.id === m.deck })),
            m.deck && !deckById(m.deck) && el('option', { value: m.deck, text: deletedDeckName(m.my), selected: true }))),
        // El rival: amigo y su mazo primero, porque de su mazo salen la Leyenda y los Campos.
        ...rivalFields(m, draw),
        el('div', { class: 'match-field' },
          el('span', { class: 'match-label', text: 'Leyenda del rival' }),
          deckLegend && opp
            ? el('div', { class: 'legend-pick locked' }, cardImg(opp, 'thumb small'),
              el('span', { class: 'grow' }, legendTitle(opp)),
              el('span', { class: 'muted small', text: 'La de su mazo' }))
            : choosing ? legendPicker() : el('button', {
              type: 'button', class: `legend-pick${opp ? '' : ' empty-pick'}`, onclick: () => { choosing = true; draw(); dlg.querySelector('.legend-search input')?.focus(); },
            }, opp ? cardImg(opp, 'thumb small') : null,
            el('span', { class: 'grow' }, opp ? legendTitle(opp) : 'Elegir Leyenda'),
            el('span', { class: 'muted small', text: opp ? 'Cambiar' : '' }))),
        // Con un amigo, su nombre ya es el de su cuenta.
        !m.rival && el('label', { class: 'match-field' },
          el('span', { class: 'match-label', text: 'Nombre del rival (opcional)' }),
          el('input', { value: m.oppName, maxlength: 40, autocomplete: 'off', oninput: (e) => { m.oppName = e.target.value; } })),
        bfField,
        m.points.length > 1 && startsField,
        el('details', { class: 'match-more', open: more, ontoggle: (e) => { more = e.target.open; } },
          el('summary', { text: 'Más datos' }),
          el('div', { class: 'match-field' },
            el('span', { class: 'match-label', text: 'Marcador (al mejor de 3)' }),
            segmented('Marcador', [[null, 'Única'], ...Object.keys(SCORES).map((s) => [s, s.replace('-', '–')])], m.score, (v) => {
              m.score = v;
              if (v) m.result = SCORES[v];
              draw();
            }, 'cols-4')),
          m.points.length === 1 && startsField,
          el('label', { class: 'match-field' },
            el('span', { class: 'match-label', text: 'Evento' }),
            el('input', { value: m.event, maxlength: 80, list: 'match-events', placeholder: 'Casual, Tienda X, Regional…', oninput: (e) => { m.event = e.target.value; } }),
            el('datalist', { id: 'match-events' }, ...events.map((ev) => el('option', { value: ev })))),
          el('label', { class: 'match-field' },
            el('span', { class: 'match-label', text: 'Fecha' }),
            el('input', { type: 'date', value: toInputDate(m.at), max: toInputDate(Date.now()), onchange: (e) => { m.at = fromInputDate(e.target.value, m.at); } })),
          el('label', { class: 'match-field' },
            el('span', { class: 'match-label', text: 'Notas' }),
            el('textarea', { rows: 3, maxlength: 500, oninput: (e) => { m.notes = e.target.value; } }, m.notes))),
        el('div', { class: 'actions match-actions' },
          el('button', { class: 'btn primary', type: 'submit' }, editing ? 'Guardar' : 'Apuntar'),
          editing && el('button', {
            class: 'btn danger', type: 'button',
            onclick: () => {
              if (!confirm('¿Borrar esta partida?')) return;
              deleteMatch(m.id);
              dlg.close();
              toast('Partida borrada');
            },
          }, 'Borrar'))),
    );
  };

  draw();
  dlg.showModal();
}

/** Balance de un mazo para la lista de mazos ("7–3 · 70 %"), o null si aún no tiene partidas. */
export function deckRecord(deckId) {
  const list = store.matches.filter((m) => m.deck === deckId);
  if (!list.length) return null;
  const r = record(list);
  return {
    text: `${recordText(r)}${r.rate == null ? '' : ` · ${rateText(r)}`}`,
    title: `${countText(r)}: ${r.win} V, ${r.loss} D${r.draw ? `, ${r.draw} E` : ''}`,
  };
}

/** Abre la hoja para apuntar una partida (con un mazo ya elegido, si se pasa). */
export const newMatch = (deckId) => openSheet(null, deckId);

/** Abre una partida ya guardada para corregirla. */
export const editMatch = (m) => openSheet(m);

export function initMatches(context) {
  ctx = context;
  buildLegends();
  buildBattlefields();
  $('#btn-new-match').addEventListener('click', () => openSheet(null));
  store.onChange((what) => (what === 'matches' || what === 'decks') && render());
  // Las partidas espejo se miran al abrir la app y, como mucho, una vez por minuto al sincronizar.
  onCloudChange(() => cloud.state === 'idle' && refreshIncoming());
  render();
}
