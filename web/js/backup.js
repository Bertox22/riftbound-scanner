// Importar una copia (JSON) de la app: qué hacer con cartas, mazos, partidas y balance se decide por
// separado, como la primera vez que se sincroniza una cuenta. Cerrar la hoja no cambia nada, y tras
// importar el aviso deja «Deshacer».

import { store } from './store.js';
import { $, el, toast } from './ui.js';
import { MAX_DECKS } from './decks.js';
import { joinCollection, joinById, countCards, sameCollection, sameById, autoPlan } from './merge.js';

const dlg = () => $('#backup-dialog');

// Los nombres de merge.js: 'cloud' es lo de la copia y 'device' lo que hay aquí.
const KINDS = {
  cards: {
    title: 'Cartas', one: 'carta', many: 'cartas', first: 'max',
    options: {
      max: ['Juntar sin duplicar', 'De cada carta, la cantidad mayor de los dos lados. Lo normal si es la misma colección.'],
      sum: ['Sumar las copias', 'Solo si son cartas distintas: 2 aquí y 2 en la copia serían 4.'],
      cloud: ['Solo las de la copia', 'Sustituye tu colección por la de la copia.'],
      device: ['Dejar las mías', 'No toca tu colección.'],
    },
  },
  decks: {
    title: 'Mazos', one: 'mazo', many: 'mazos', first: 'merge',
    options: {
      merge: ['Juntar', 'Añade los mazos de la copia que no tienes.'],
      cloud: ['Solo los de la copia', 'Sustituye tus mazos por los de la copia.'],
      device: ['Dejar los míos', 'No toca tus mazos.'],
    },
  },
  matches: {
    title: 'Partidas', one: 'partida', many: 'partidas', first: 'merge',
    options: {
      merge: ['Juntar', 'Añade las partidas de la copia que no tienes.'],
      cloud: ['Solo las de la copia', 'Sustituye tu historial por el de la copia.'],
      device: ['Dejar las mías', 'No toca tus partidas.'],
    },
  },
  ledger: {
    title: 'Balance', one: 'apunte', many: 'apuntes', first: 'merge',
    options: {
      merge: ['Juntar', 'Añade las compras y ventas de la copia que no tienes.'],
      cloud: ['Solo los de la copia', 'Sustituye tu balance por el de la copia.'],
      device: ['Dejar los míos', 'No toca tu balance.'],
    },
  },
};

const howMany = (n, kind) => `${n} ${n === 1 ? KINDS[kind].one : KINDS[kind].many}`;
const byDate = (a, b) => b.at - a.at;
const plain = (x) => JSON.stringify(x);

/** Lo que trae el archivo, ya comprobado. Lanza un error si no es una copia de la app. */
function readBackup(data) {
  if (!data || typeof data.collection !== 'object' || Array.isArray(data.collection)) {
    throw new Error('El archivo no es una copia de Riftbound Scanner.');
  }
  const collection = {};
  for (const [id, e] of Object.entries(data.collection)) {
    const n = Math.max(0, Math.floor(+e?.n || 0)), f = Math.max(0, Math.floor(+e?.f || 0));
    if (n || f) collection[id] = { n, f };
  }
  const list = (x) => (Array.isArray(x) ? x.filter((v) => v && typeof v === 'object' && v.id) : []);
  // Las copias antiguas no traen balance: entonces no se pregunta por él.
  return { collection, decks: list(data.decks), matches: list(data.matches), ledger: Array.isArray(data.ledger) ? list(data.ledger) : null };
}

function current() {
  return { collection: store.collection, decks: store.decks, matches: store.matches, ledger: store.ledger };
}

/** Qué quedaría con cada opción, y si hay que preguntar. */
function plan(file) {
  const here = current();
  const out = [];
  const add = (kind, local, remote, size, join, same) => {
    const results = Object.fromEntries(Object.keys(KINDS[kind].options).map((how) => [how, size(join(local, remote, how))]));
    out.push({ kind, local: size(local), remote: size(remote), results, auto: autoPlan(!size(local), !size(remote), same) });
  };
  add('cards', here.collection, file.collection, countCards, joinCollection, sameCollection(here.collection, file.collection));
  add('decks', here.decks, file.decks, (x) => x.length, joinById, sameById(here.decks, file.decks, plain));
  add('matches', here.matches, file.matches, (x) => x.length, joinById, sameById(here.matches, file.matches, plain));
  if (file.ledger) add('ledger', here.ledger, file.ledger, (x) => x.length, joinById, sameById(here.ledger, file.ledger, plain));
  return out;
}

/** Aplica las respuestas ({ cards: 'max', decks: 'merge'… }) y devuelve lo que había antes. */
function apply(file, picks) {
  const before = structuredClone(current());
  const how = (kind) => picks[kind] ?? 'device';
  store.collection = joinCollection(store.collection, file.collection, how('cards'));
  store.decks = joinById(store.decks, file.decks, how('decks'));
  store.matches = joinById(store.matches, file.matches, how('matches')).sort(byDate);
  if (file.ledger) store.ledger = joinById(store.ledger, file.ledger, how('ledger')).sort(byDate);
  store.persist();
  return before;
}

function restore(before) {
  Object.assign(store, structuredClone(before));
  store.persist();
  toast('Importación deshecha');
}

function finish(file, picks) {
  const before = apply(file, picks);
  toast('Copia importada', 6000, { label: 'Deshacer', onclick: () => restore(before) });
}

function group({ kind, local, remote, results }, picks, onPick) {
  const { title, options } = KINDS[kind];
  return el('fieldset', { class: 'merge-group' },
    el('legend', { text: title }),
    el('p', { class: 'muted small', text: `Aquí: ${howMany(local, kind)}. En la copia: ${howMany(remote, kind)}.` }),
    ...Object.entries(options).map(([how, [label, hint]]) => {
      // Juntar mazos no puede pasar del máximo: la nube no los aceptaría.
      const tooMany = kind === 'decks' && results[how] > MAX_DECKS;
      return el('label', { class: `merge-option${tooMany ? ' disabled' : ''}` },
        el('input', { type: 'radio', name: `backup-${kind}`, value: how, checked: picks[kind] === how, disabled: tooMany, onchange: () => onPick(kind, how) }),
        el('span', { class: 'grow' },
          el('strong', { text: label }),
          el('span', { class: 'muted small', text: tooMany ? `Pasaría de ${MAX_DECKS} mazos: borra alguno antes.` : hint })),
        el('span', { class: 'merge-result', text: howMany(results[how], kind), title: 'Lo que quedará' }));
    }));
}

/** Pregunta qué hacer con lo que no se puede decidir solo. Sin nada que preguntar, importa directamente. */
function ask(file) {
  const steps = plan(file);
  const questions = steps.filter((s) => !s.auto);
  const picks = Object.fromEntries(steps.map((s) => [s.kind, s.auto ?? KINDS[s.kind].first]));
  if (picks.decks === 'merge' && questions.find((q) => q.kind === 'decks')?.results.merge > MAX_DECKS) picks.decks = 'device';
  if (!questions.length) {
    if (steps.every((s) => s.auto === 'same' || s.auto === 'device')) return toast('La copia no trae nada que no tengas.');
    return finish(file, picks);
  }
  const autoNames = steps.filter((s) => s.auto).map((s) => KINDS[s.kind].title.toLowerCase());
  const d = dlg();
  d.replaceChildren(
    el('div', { class: 'dialog-head' },
      el('h2', { text: 'Importar copia' }),
      el('button', { class: 'icon-btn', type: 'button', title: 'Cerrar', 'aria-label': 'Cerrar', onclick: () => d.close() }, '✕')),
    el('p', { text: 'Tienes datos aquí y en la copia. Elige qué hacer con cada cosa.' }),
    ...questions.map((q) => group(q, picks, (kind, how) => { picks[kind] = how; })),
    ...[autoNames.length > 0 && el('p', { class: 'muted small', text: `No hay que elegir nada para ${autoNames.join(' ni ')}: ya coinciden o solo están en un lado.` })].filter(Boolean),
    el('div', { class: 'actions' },
      el('button', { class: 'btn ghost', type: 'button', onclick: () => d.close() }, 'Cancelar'),
      el('button', { class: 'btn primary', type: 'button', onclick: () => { d.close(); finish(file, picks); } }, 'Importar')));
  d.showModal();
}

/** Lee el archivo elegido y pregunta. Si no es una copia válida, solo avisa. */
export async function importBackup(fileInput) {
  try {
    ask(readBackup(JSON.parse(await fileInput.text())));
  } catch (err) {
    toast(err instanceof SyntaxError ? 'El archivo no es una copia de Riftbound Scanner.' : err.message);
  }
}
