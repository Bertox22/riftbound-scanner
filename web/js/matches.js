// Registro de partidas: con qué mazo jugaste, contra qué Leyenda y cómo acabó.
//
// Partida: { id, at (fecha, ms), deck (id del mazo o null), my y opp (Leyendas), oppName,
//            result ('win' | 'loss' | 'draw'), score ('2-1'… o null), points (puntos de cada juego:
//            [[8, 7], [5, 8]], tuyos y del rival), first (true: empecé yo, false: el rival, null: sin
//            apuntar), event, notes, updated }
// Las Leyendas se guardan con un id "canónico" por Leyenda (no por impresión), para que la foil,
// la Metal o la Signature cuenten como la misma al sacar estadísticas.

import { store } from './store.js';
import { $, el, toast, cardImg } from './ui.js';

const RESULTS = { win: 'Victoria', loss: 'Derrota', draw: 'Empate' };
const RESULT_SHORT = { win: 'V', loss: 'D', draw: 'E' };
const SCORES = { '2-0': 'win', '2-1': 'win', '1-2': 'loss', '0-2': 'loss', '1-1': 'draw' };
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

export const canonicalLegend = (id) => (id ? canonicalOf.get(id) ?? id : null);

/** "Jinx · Loose Cannon" */
function legendTitle(card) {
  const [champ, title] = card.name.replace(/\s*\([^)]*\)\s*$/, '').replace(/\s+-\s+Starter$/i, '').split(' - ');
  return title ? `${champ} · ${title}` : champ;
}
const legendChamp = (card) => legendTitle(card).split(' · ')[0];

// ---------- Datos ----------

const deckById = (id) => store.decks.find((d) => d.id === id);
const lastDeck = () => store.matches.find((m) => m.deck && deckById(m.deck))?.deck ?? store.decks[0]?.id ?? null;

function blankMatch() {
  return { id: crypto.randomUUID?.() ?? String(Date.now()), at: Date.now(), deck: lastDeck(), my: null, opp: null, oppName: '', result: null, score: null, points: [[null, null]], first: null, event: '', notes: '' };
}

// ---------- Puntos ----------

const fullGames = (points) => (points ?? []).filter(([a, b]) => a != null && b != null);
const pointsText = (points) => fullGames(points).map(([a, b]) => `${a}–${b}`).join(', ');

/**
 * Con los puntos de cada juego se sabe el resultado: un juego, quien tenga más; varios, quien gane
 * más juegos (y el marcador al mejor de 3). Si no cuadra con un marcador posible, no se toca nada.
 */
function deriveFromPoints(m) {
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

function saveMatch(m) {
  m.points = fullGames(m.points);
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

function legendThumb(id) {
  const card = ctx.byId.get(id);
  return card ? cardImg(card, 'thumb small') : el('div', { class: 'thumb small placeholder', 'aria-hidden': 'true' }, '?');
}

function matchRow(m) {
  const deck = deckById(m.deck);
  const opp = ctx.byId.get(m.opp);
  const rival = [opp && legendChamp(opp), m.oppName].filter(Boolean).join(' · ');
  const meta = [
    fmtDay(m.at),
    // "2–1 (5–8, 8–6, 8–2)", o solo "8–7" en una partida a un juego.
    [m.score?.replace('-', '–'), m.points?.length && (m.score ? `(${pointsText(m.points)})` : pointsText(m.points))].filter(Boolean).join(' '),
    m.first === true ? 'Empecé yo' : m.first === false ? 'Empezó el rival' : null,
    m.event,
  ].filter(Boolean).join(' · ');
  return el('li', { class: 'match-row', onclick: () => openSheet(m) },
    el('span', { class: `match-result ${m.result}`, title: RESULTS[m.result], 'aria-label': RESULTS[m.result] }, RESULT_SHORT[m.result]),
    el('div', { class: 'match-legends', 'aria-hidden': 'true' }, legendThumb(m.my), legendThumb(m.opp)),
    el('div', { class: 'grow' },
      el('strong', { text: rival ? `contra ${rival}` : 'Rival sin apuntar' }),
      el('div', { class: 'muted small', text: deck ? deck.name : m.deck ? 'Mazo borrado' : 'Sin mazo' }),
      meta && el('div', { class: 'muted small', text: meta }),
    ),
  );
}

// ---------- Estadísticas ----------
// El porcentaje de victorias no cuenta los empates (igual que las vistas de la base de datos).

function record(list) {
  const r = { games: list.length, win: 0, loss: 0, draw: 0 };
  for (const m of list) r[m.result]++;
  const decided = r.win + r.loss;
  r.rate = decided ? Math.round((100 * r.win) / decided) : null;
  return r;
}
const recordText = (r) => `${r.win}–${r.loss}${r.draw ? `–${r.draw}` : ''}`;
const rateText = (r) => (r.rate == null ? '—' : `${r.rate} %`);

/** Agrupa partidas por una clave y devuelve [clave, récord] de más a menos partidas. */
function groupBy(list, key) {
  const groups = new Map();
  for (const m of list) {
    const k = key(m);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(m);
  }
  return [...groups].map(([k, ms]) => [k, record(ms)]).sort((a, b) => b[1].games - a[1].games || (b[1].rate ?? -1) - (a[1].rate ?? -1));
}

function rateBar(r) {
  return el('div', { class: 'rate-bar', 'aria-hidden': 'true' }, el('span', { style: `width: ${r.rate ?? 0}%` }));
}

function statRow(thumb, name, r) {
  return el('li', { class: 'stat-row' },
    thumb,
    el('div', { class: 'grow' },
      el('div', { class: 'stat-row-top' },
        el('span', { class: 'stat-row-name', text: name }),
        el('span', { class: 'stat-row-rate', text: rateText(r) })),
      rateBar(r),
      el('div', { class: 'muted small', text: `${recordText(r)} · ${r.games} partida${r.games === 1 ? '' : 's'}` })));
}

const filtered = () => store.matches.filter((m) => !deckFilter || (m.deck ?? 'none') === deckFilter);

function renderStats(list) {
  const box = $('#match-stats');
  if (!store.matches.length) return box.replaceChildren();
  const all = record(list);
  const firstR = record(list.filter((m) => m.first === true));
  const secondR = record(list.filter((m) => m.first === false));

  // Mazos con partidas (y los que ya no existen, si quedan partidas suyas).
  const deckIds = [...new Set(store.matches.map((m) => m.deck ?? 'none'))];
  const deckName = (id) => (id === 'none' ? 'Sin mazo' : deckById(id)?.name ?? 'Mazo borrado');
  const deckLegend = (id) => canonicalLegend(deckById(id)?.legend) ?? store.matches.find((m) => (m.deck ?? 'none') === id)?.my;
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
        el('strong', { text: String(all.games) }),
        el('span', { class: 'muted small', text: all.games === 1 ? 'partida' : 'partidas' }))),
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

function openSheet(existing, deckId = null) {
  const dlg = $('#match-dialog');
  const editing = !!existing;
  const m = existing ? structuredClone(existing) : blankMatch();
  if (deckId) m.deck = deckId;
  if (!m.points?.length) m.points = [[null, null]];
  let choosing = false; // mostrando la cuadrícula de Leyendas
  let q = '';
  let more = editing && !!(m.score || m.first !== null || m.event || m.notes); // "Más datos" abierto

  const draw = () => {
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
            onclick: () => { m.points.splice(i, 1); deriveFromPoints(m); draw(); },
          }, '✕'))),
        m.points.length < MAX_GAMES && el('button', {
          type: 'button', class: 'link small points-add',
          onclick: () => { m.points.push([null, null]); draw(); dlg.querySelectorAll('.points-row input')[m.points.length * 2 - 2]?.focus(); },
        }, m.points.length === 1 ? '+ Otro juego (al mejor de 3)' : '+ Otro juego')));

    const decks = store.decks;
    dlg.replaceChildren(
      el('div', { class: 'dialog-head' },
        el('h2', { text: editing ? 'Editar partida' : 'Apuntar partida' }),
        el('button', { class: 'icon-btn', type: 'button', title: 'Cerrar', 'aria-label': 'Cerrar', onclick: () => dlg.close() }, '✕')),
      el('form', {
        class: 'match-form',
        onsubmit: (e) => {
          e.preventDefault();
          if (!m.result) return toast('Elige el resultado.');
          saveMatch(m);
          dlg.close();
          toast(editing ? 'Partida guardada' : `${RESULTS[m.result]} apuntada`);
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
          el('select', { onchange: (e) => { m.deck = e.target.value || null; } },
            el('option', { value: '', text: 'Sin mazo', selected: !m.deck }),
            ...decks.map((d) => el('option', { value: d.id, text: d.name, selected: d.id === m.deck })),
            m.deck && !deckById(m.deck) && el('option', { value: m.deck, text: 'Mazo borrado', selected: true }))),
        el('div', { class: 'match-field' },
          el('span', { class: 'match-label', text: 'Leyenda del rival' }),
          choosing ? legendPicker() : el('button', {
            type: 'button', class: `legend-pick${opp ? '' : ' empty-pick'}`, onclick: () => { choosing = true; draw(); dlg.querySelector('.legend-search input')?.focus(); },
          }, opp ? cardImg(opp, 'thumb small') : null,
          el('span', { class: 'grow' }, opp ? legendTitle(opp) : 'Elegir Leyenda'),
          el('span', { class: 'muted small', text: opp ? 'Cambiar' : '' }))),
        el('label', { class: 'match-field' },
          el('span', { class: 'match-label', text: 'Nombre del rival (opcional)' }),
          el('input', { value: m.oppName, maxlength: 40, autocomplete: 'off', oninput: (e) => { m.oppName = e.target.value; } })),
        el('details', { class: 'match-more', open: more, ontoggle: (e) => { more = e.target.open; } },
          el('summary', { text: 'Más datos' }),
          el('div', { class: 'match-field' },
            el('span', { class: 'match-label', text: 'Marcador (al mejor de 3)' }),
            segmented('Marcador', [[null, 'Única'], ...Object.keys(SCORES).map((s) => [s, s.replace('-', '–')])], m.score, (v) => {
              m.score = v;
              if (v) m.result = SCORES[v];
              draw();
            }, 'cols-3')),
          el('div', { class: 'match-field' },
            el('span', { class: 'match-label', text: '¿Quién empezó?' }),
            segmented('Quién empezó', [[null, 'Sin apuntar'], [true, 'Yo'], [false, 'El rival']], m.first, (v) => { m.first = v; draw(); })),
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

/** Abre la hoja para apuntar una partida (con un mazo ya elegido, si se pasa). */
export const newMatch = (deckId) => openSheet(null, deckId);

export function initMatches(context) {
  ctx = context;
  buildLegends();
  $('#btn-new-match').addEventListener('click', () => openSheet(null));
  store.onChange((what) => (what === 'matches' || what === 'decks') && render());
  render();
}
