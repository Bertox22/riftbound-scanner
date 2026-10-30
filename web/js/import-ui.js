// Pantalla de importación (colección o mazo): elegir archivo o pegar lista -> revisar columnas y
// cartas -> importar a la colección o crear el mazo.

import { store } from './store.js';
import { $, el, toast, cardImg, cardCode } from './ui.js';
import { ROLES, readFile, parseList, parseDeckText, splitHeader, guessMapping, buildIndex, matchRows, searchCards, assembleDeck } from './importer.js';
import { validate, openEditor, canAddDeck } from './decks.js';

const STATUS = {
  exact: { icon: '✓', text: 'Exacta (código o set + nº)', cls: 'ok' },
  name: { icon: '✓', text: 'Por nombre', cls: 'ok' },
  fuzzy: { icon: '⚠', text: 'Nombre aproximado: revísala', cls: 'warn' },
  check: { icon: '⚠', text: 'El código y el nombre no cuadran', cls: 'warn' },
  missing: { icon: '✗', text: 'No encontrada', cls: 'bad' },
  manual: { icon: '✓', text: 'Elegida a mano', cls: 'ok' },
};

let ctx; // { cards, byId, openCard }
let idx;
let state; // { sheets, sheet, header, data, map, rows, deckName }
let kind = 'collection'; // o 'deck'

const SLOT_ES = { legend: 'Leyenda', champion: 'Campeón', main: 'Principal', runes: 'Runa', battlefields: 'Campo de batalla', sideboard: 'Sideboard' };

function dlg() {
  return $('#import-dialog');
}

/** Pone el contenido del diálogo ignorando las secciones opcionales que no aplican (false/null). */
function show(...nodes) {
  dlg().replaceChildren(...nodes.filter((n) => n != null && n !== false && n !== ''));
}

function close() {
  dlg().close();
  state = null;
}

// ---------- Paso 1: origen ----------

function renderStart() {
  const deck = kind === 'deck';
  const text = el('textarea', {
    rows: deck ? 12 : 8,
    placeholder: deck
      ? 'Legend:\n1 Akali - Rogue Assassin\nChampion:\n1 Akali - Silent\nMain Deck:\n3 Brawl\n2x Smite (UNL-007)\n…\nRunes:\n6 Fury Rune\n6 Calm Rune\nBattlefields:\n1 Mystic Vortex'
      : '3x Arena Kingpin\nBrawl x2\n1 Supernova (RAD-059)\nAkali - Rogue Assassin',
  });
  show(
    el('div', { class: 'dialog-head' }, el('h2', { text: deck ? 'Importar mazo' : 'Importar colección' }), el('button', { class: 'icon-btn', onclick: close }, '✕')),
    el('p', { class: 'muted', text: deck
      ? 'Pega la lista del mazo (de cualquier web o la que exporta esta app) o elige un archivo. Las secciones (Legend, Champion, Main Deck, Runes, Battlefields…) son opcionales: lo que no tenga sección se coloca según el tipo de carta.'
      : 'Vale cualquier Excel (.xlsx) o CSV: la app adivina qué es cada columna y te enseña cada carta antes de importar nada.' }),
    el('label', { class: 'btn primary' }, deck ? 'Elegir archivo (.txt, CSV o Excel)' : 'Elegir archivo Excel o CSV',
      el('input', { type: 'file', accept: '.xlsx,.xlsm,.csv,.tsv,.txt,text/csv,text/plain', hidden: true, onchange: (e) => e.target.files[0] && loadFile(e.target.files[0]) })),
    el('h3', { text: deck ? 'O pega la lista' : 'O pega una lista' }),
    text,
    el('button', { class: 'btn ghost', onclick: () => {
      if (!text.value.trim()) return toast('La lista está vacía.');
      load(deck ? parseDeckText(text.value) : parseList(text.value));
    } }, 'Analizar lista'),
  );
}

async function loadFile(file) {
  show(el('p', { class: 'muted', text: `Leyendo ${file.name}…` }));
  try {
    load(await readFile(file, { deck: kind === 'deck' }), file.name.replace(/\.[^.]+$/, ''));
  } catch (err) {
    toast(err.message, 4000);
    renderStart();
  }
}

function load(sheets, fileName = '') {
  // Por defecto, la hoja con más filas reconocibles (p. ej. "Colección" antes que "Resumen").
  let best = 0, bestScore = -1;
  // A igualdad de cartas, la que dice la sección de cada una (en el Excel de un mazo, "Detalle" frente a "Mazo").
  sheets.forEach((s, i) => {
    const { header, data } = splitHeader(s.rows);
    const map = guessMapping(header, data, idx);
    const rows = matchRows(data, map, idx);
    const score = rows.filter((r) => r.card).length + (kind === 'deck' && map.section != null ? 0.5 : 0);
    if (score > bestScore) { best = i; bestScore = score; }
  });
  state = { sheets, deckName: sheets[best].deckName || fileName || 'Mazo importado' };
  selectSheet(best);
}

function selectSheet(i) {
  const { header, data } = splitHeader(state.sheets[i].rows);
  Object.assign(state, { sheet: i, header, data, map: guessMapping(header, data, idx) });
  rematch();
}

function rematch() {
  state.rows = matchRows(state.data, state.map, idx);
  state.rows.forEach((r) => { r.include = !!r.card; });
  renderReview();
}

// ---------- Paso 2: revisión ----------

function mappingControls() {
  const sample = (i) => state.data.find((r) => String(r[i] ?? '').trim())?.[i] ?? '';
  const roles = Object.entries(ROLES).filter(([role]) => (kind === 'deck' ? !['foil', 'foilQty'].includes(role) : role !== 'section'));
  return el('div', { class: 'import-map' }, roles.map(([role, label]) =>
    el('label', {},
      el('span', { class: 'small muted', text: label }),
      el('select', {
        onchange: (e) => {
          const v = e.target.value;
          for (const r of Object.keys(state.map)) if (state.map[r] === +v) delete state.map[r]; // una columna, un papel
          if (v === '') delete state.map[role]; else state.map[role] = +v;
          rematch();
        },
      },
      el('option', { value: '', text: '— ninguna —' }),
      state.header.map((h, i) => el('option', { value: i, selected: state.map[role] === i, text: `${h || `Columna ${i + 1}`}${sample(i) ? ` (ej.: ${String(sample(i)).slice(0, 18)})` : ''}` }))),
    )));
}

function rowView(r) {
  const s = STATUS[r.status];
  const right = r.card
    ? el('button', { class: 'import-card', onclick: () => ctx.openCard(r.card) }, cardImg(r.card, 'thumb small'),
      el('span', {}, el('strong', { text: r.card.name }), el('span', { class: 'muted small', text: ` ${cardCode(r.card)}` })))
    : el('span', { class: 'muted', text: 'Sin carta' });
  const search = el('div', { class: 'import-search', hidden: true });
  const openSearch = () => {
    search.hidden = !search.hidden;
    if (search.hidden) return;
    const results = el('div', { class: 'import-results' });
    const input = el('input', {
      type: 'search', placeholder: 'Nombre o código (OGN-001)…', value: r.label,
      oninput: () => results.replaceChildren(...searchCards(input.value, ctx.cards, idx).map((c) => el('button', {
        class: 'import-card',
        onclick: () => { r.card = c; r.status = 'manual'; r.note = ''; r.include = true; renderReview(); },
      }, cardImg(c, 'thumb small'), el('span', {}, el('strong', { text: c.name }), el('span', { class: 'muted small', text: ` ${cardCode(c)} · ${c.setName}` }))))),
    });
    search.replaceChildren(input, results);
    input.dispatchEvent(new Event('input'));
    input.focus();
  };
  return el('li', { class: `import-row ${r.include ? '' : 'skipped'}` },
    el('div', { class: 'import-line' },
      el('span', { class: `import-status ${s.cls}`, title: s.text, text: s.icon }),
      el('div', { class: 'grow' },
        el('div', { class: 'small muted', text: `En el archivo: "${r.label}" · ${[r.qty && `${r.qty}×`, r.foilQty && `${r.foilQty} foil`].filter(Boolean).join(' + ')}` }),
        right,
        r.note && el('div', { class: `small ${s.cls}`, text: r.note }),
        kind === 'deck' && r.slot && el('span', { class: `slot-chip ${r.slot}`, text: SLOT_ES[r.slot] }),
      ),
      el('div', { class: 'import-actions' },
        el('button', { class: 'btn ghost small', onclick: openSearch }, r.card ? 'Cambiar' : 'Buscar'),
        r.card && el('button', { class: 'btn ghost small', onclick: () => { r.include = !r.include; renderReview(); } }, r.include ? 'Omitir' : 'Incluir'),
      ),
    ),
    search,
  );
}

function renderReview() {
  const rows = state.rows;
  const count = (st) => rows.filter((r) => r.status === st).length;
  const included = rows.filter((r) => r.include && r.card);
  const copies = included.reduce((a, r) => a + r.qty + r.foilQty, 0);
  const assembled = kind === 'deck' ? assembleDeck(rows) : null; // también anota r.slot
  const attention = rows.filter((r) => ['missing', 'check', 'fuzzy'].includes(r.status));
  const ok = rows.filter((r) => !attention.includes(r));
  let mode = 'merge';

  show(
    el('div', { class: 'dialog-head' },
      el('button', { class: 'btn ghost small', onclick: renderStart }, '← Otro archivo'),
      el('button', { class: 'icon-btn', onclick: close }, '✕')),
    state.sheets.length > 1 && el('label', { class: 'toggle' }, el('span', { text: 'Hoja:' }),
      el('select', { onchange: (e) => selectSheet(+e.target.value) },
        state.sheets.map((s, i) => el('option', { value: i, selected: i === state.sheet, text: `${s.name} (${s.rows.length} filas)` })))),
    el('details', { class: 'import-cols', open: !rows.some((r) => r.card) },
      el('summary', { text: 'Columnas detectadas (cámbialas si alguna está mal)' }),
      mappingControls()),
    el('div', { class: 'import-summary' },
      el('span', { class: 'ok', text: `✓ ${count('exact') + count('name') + count('manual')} encontradas` }),
      el('span', { class: 'warn', text: `⚠ ${count('fuzzy') + count('check')} para revisar` }),
      el('span', { class: 'bad', text: `✗ ${count('missing')} sin encontrar` })),
    attention.length > 0 && el('div', {},
      el('h3', { text: 'Revisa estas' }),
      el('ul', { class: 'import-list' }, attention.map(rowView))),
    ok.length > 0 && el('details', { class: 'import-ok', open: attention.length === 0 && ok.length <= 30 },
      el('summary', { text: `Ver las ${ok.length} encontradas` }),
      el('ul', { class: 'import-list' }, ok.map(rowView))),
    !rows.length && el('p', { class: 'muted', text: 'No hay filas con cartas. Revisa qué columna es el nombre o el código.' }),
    kind === 'deck' ? deckFooter(assembled) : el('div', { class: 'import-footer' },
      el('label', { class: 'toggle' }, el('input', { type: 'radio', name: 'import-mode', checked: true, onchange: () => { mode = 'merge'; } }), el('span', { text: 'Sumar a mi colección' })),
      el('label', { class: 'toggle' }, el('input', { type: 'radio', name: 'import-mode', onchange: () => { mode = 'replace'; } }), el('span', { text: 'Reemplazar mi colección' })),
      el('button', {
        class: 'btn primary', disabled: !included.length,
        onclick: () => {
          if (mode === 'replace' && store.totalOwned() && !confirm(`Se borrarán las ${store.totalOwned()} cartas que tienes ahora y se quedarán solo las del archivo. ¿Seguir?`)) return;
          const col = {};
          for (const r of included) {
            const e = col[r.card.id] || { n: 0, f: 0 };
            col[r.card.id] = { n: e.n + r.qty, f: e.f + r.foilQty };
          }
          store.importCollection(col, mode);
          toast(`Importadas ${copies} copias (${Object.keys(col).length} cartas distintas)`, 3500);
          close();
        },
      }, `Importar ${copies} copias`),
    ),
  );
}

function deckFooter({ deck, notes }) {
  const legend = ctx.byId.get(deck.legend);
  const champion = ctx.byId.get(deck.champion);
  const full = { ...deck, id: crypto.randomUUID?.() ?? String(Date.now()), name: state.deckName, updated: Date.now() };
  const v = validate(full);
  const lacking = v.missing.reduce((a, [, n]) => a + n, 0);
  const nameInput = el('input', { class: 'deck-name', value: state.deckName, oninput: (e) => { state.deckName = e.target.value; } });
  return el('div', { class: 'import-footer deck' },
    el('div', { class: 'grow' },
      nameInput,
      el('div', { class: 'small', text: `Leyenda: ${legend?.name ?? '—'} · Campeón: ${champion?.name ?? '—'}` }),
      el('div', { class: 'small muted', text: `Principal ${v.mainCount}/40 · Runas ${v.runeCount}/12 · Campos ${deck.battlefields.length}/3 · Sideboard ${v.sideCount}/10${lacking ? ` · te faltan ${lacking} cartas de tu colección` : ' · tienes todas las cartas'}` }),
      notes.map((n) => el('div', { class: 'small muted', text: n })),
      v.issues.length > 0 && el('details', {}, el('summary', { class: 'small warn', text: `${v.issues.length} aviso(s) de reglas` }),
        el('ul', { class: 'issues' }, v.issues.map((i) => el('li', { text: i })))),
    ),
    el('button', {
      class: 'btn primary', disabled: !legend && !Object.keys(deck.main).length,
      onclick: () => {
        if (!canAddDeck()) return;
        full.name = nameInput.value.trim() || 'Mazo importado';
        store.decks.unshift(full);
        store.saveDecks();
        close();
        toast(`Mazo "${full.name}" creado`);
        openEditor(full);
      },
    }, 'Crear mazo'),
  );
}

function open(k) {
  kind = k;
  renderStart();
  dlg().showModal();
}

export function initImport(context) {
  ctx = context;
  idx = buildIndex(ctx.cards);
  $('#btn-import-table').addEventListener('click', () => open('collection'));
  $('#btn-import-deck').addEventListener('click', () => open('deck'));
}
