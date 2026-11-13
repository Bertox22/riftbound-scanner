// Cómo se juntan los datos de un dispositivo con los de la cuenta la primera vez que coinciden.
// Cartas, mazos y partidas se deciden por separado (ver firstSync en cloud.js).
//
// Cartas: max (la cantidad mayor de cada carta) · sum (suma las copias) · cloud · device.
// Mazos y partidas: merge (todos, sin repetir id; si un id está en los dos, gana el de aquí) · cloud · device.

export function joinCollection(local, remote, how) {
  if (how === 'cloud') return structuredClone(remote);
  if (how !== 'max' && how !== 'sum') return local;
  const pick = how === 'sum' ? (a, b) => a + b : Math.max;
  const out = structuredClone(local);
  for (const [id, e] of Object.entries(remote)) {
    const cur = out[id] ?? { n: 0, f: 0 };
    out[id] = { n: pick(cur.n, e.n), f: pick(cur.f, e.f) };
  }
  return out;
}

export function joinById(local, remote, how) {
  if (how === 'cloud') return structuredClone(remote);
  if (how !== 'merge') return local;
  const ids = new Set(local.map((x) => x.id));
  return [...local, ...structuredClone(remote.filter((x) => !ids.has(x.id)))];
}

export const countCards = (col) => Object.values(col).reduce((a, e) => a + e.n + e.f, 0);

export function sameCollection(a, b) {
  for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if ((a[id]?.n ?? 0) !== (b[id]?.n ?? 0) || (a[id]?.f ?? 0) !== (b[id]?.f ?? 0)) return false;
  }
  return true;
}

/** ¿Las dos listas tienen lo mismo? key da el contenido de cada elemento (sin contar el orden). */
export function sameById(a, b, key) {
  if (a.length !== b.length) return false;
  const keys = new Map(a.map((x) => [x.id, key(x)]));
  return b.every((x) => keys.get(x.id) === key(x));
}

/**
 * Lo que se hace sin preguntar con un tipo de datos: 'same' si ya coinciden (no hay nada que hacer),
 * 'cloud' o 'device' si solo un lado tiene datos. null si hay que preguntar.
 */
export function autoPlan(localEmpty, remoteEmpty, same) {
  if (same) return 'same';
  if (localEmpty) return 'cloud';
  if (remoteEmpty) return 'device';
  return null;
}

// ---------- Copias de seguridad (backup.js) ----------

/** Lo que trae el archivo, ya comprobado. Lanza un error si no es una copia de la app. */
export function readBackup(data) {
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

const byDate = (a, b) => b.at - a.at;

/**
 * Lo que queda al importar una copia sobre lo que hay (here: { collection, decks, matches, ledger }).
 * picks: { cards, decks, matches, ledger } con las opciones de arriba ('cloud' es lo de la copia);
 * lo que no se diga se deja como está. Partidas y balance quedan de la más reciente a la más antigua.
 */
export function mergeBackup(here, file, picks) {
  const how = (kind) => picks[kind] ?? 'device';
  const out = {
    collection: joinCollection(here.collection, file.collection, how('cards')),
    decks: joinById(here.decks, file.decks, how('decks')),
    matches: [...joinById(here.matches, file.matches, how('matches'))].sort(byDate),
    ledger: here.ledger,
  };
  if (file.ledger) out.ledger = [...joinById(here.ledger, file.ledger, how('ledger'))].sort(byDate);
  return out;
}
