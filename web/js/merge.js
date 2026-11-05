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
