// Estado persistente en localStorage: colección, mazos, partidas, balance y ajustes.
// Colección: { [cardId]: { n: copias normales, f: copias foil } }
// Historial: las copias que se han quitado, la más reciente primero, para ver qué se quitó y
// deshacerlo: [{ at, id, n, foil, from ('colección' | 'ficha' | 'escáner' | 'intercambio' | 'venta' | 'otro dispositivo'), undone }].
// Solo en este navegador (lo que llega de otros dispositivos se apunta al sincronizar).

const KEYS = { collection: 'rb.collection.v1', decks: 'rb.decks.v1', matches: 'rb.matches.v1', settings: 'rb.settings.v1', history: 'rb.history.v1', table: 'rb.table.v1', ledger: 'rb.ledger.v1' };
const HISTORY_MAX = 200;
const HISTORY_JOIN = 2 * 60 * 1000; // quitar varias copias seguidas de la misma carta cuenta como una línea

function read(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.error('No se pudo guardar', key, err);
  }
}

/** Da formato de uuid a 16 bytes, con la versión indicada. */
export function uuidFromBytes(bytes, version) {
  bytes[6] = (bytes[6] & 0x0f) | (version << 4);
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Id de partida o movimiento: en la base de datos son uuid, también sin randomUUID (http, navegadores antiguos). */
export const newUuid = () => crypto.randomUUID?.() ?? uuidFromBytes(crypto.getRandomValues(new Uint8Array(16)), 4);

const listeners = new Set();

export const store = {
  collection: read(KEYS.collection, {}),
  decks: read(KEYS.decks, []),
  matches: read(KEYS.matches, []), // la más reciente primero
  ledger: read(KEYS.ledger, []), // compras y ventas (ledger.js), la más reciente primero
  settings: read(KEYS.settings, {}),
  history: read(KEYS.history, []),
  table: read(KEYS.table, null), // la partida que se está jugando en la mesa (table.js), o null

  onChange(fn) {
    listeners.add(fn);
  },

  emit(what) {
    listeners.forEach((fn) => fn(what));
  },

  owned(id) {
    const e = this.collection[id];
    return e ? e.n + e.f : 0;
  },

  totalOwned() {
    let t = 0;
    for (const e of Object.values(this.collection)) t += e.n + e.f;
    return t;
  },

  /**
   * Suma (o resta) copias. `from` dice desde dónde se quitan, para el historial; sin él (cambiar de
   * versión, deshacer…) no se apunta nada.
   */
  add(id, delta = 1, foil = false, from = null) {
    const e = this.collection[id] || { n: 0, f: 0 };
    const k = foil ? 'f' : 'n';
    const before = e[k];
    e[k] = Math.max(0, e[k] + delta);
    if (from && e[k] < before) this.logRemoval(id, before - e[k], foil, from);
    if (e.n + e.f === 0) delete this.collection[id];
    else this.collection[id] = e;
    write(KEYS.collection, this.collection);
    this.emit('collection');
  },

  /** Apunta copias quitadas en el historial (junta las seguidas de la misma carta). */
  logRemoval(id, n, foil, from) {
    const last = this.history[0];
    if (last && !last.undone && last.id === id && last.foil === foil && last.from === from && Date.now() - last.at < HISTORY_JOIN) {
      last.n += n;
      last.at = Date.now();
    } else {
      this.history.unshift({ at: Date.now(), id, n, foil, from });
      this.history.length = Math.min(this.history.length, HISTORY_MAX);
    }
    write(KEYS.history, this.history);
    this.emit('history');
  },

  /** Devuelve a la colección las copias de una línea del historial (todas, o solo `n`). */
  undoRemoval(entry, n = entry.n) {
    if (entry.undone) return;
    if (n < entry.n) entry.n -= n;
    else entry.undone = true;
    write(KEYS.history, this.history);
    this.add(entry.id, n, entry.foil);
    this.emit('history');
  },

  saveDecks() {
    write(KEYS.decks, this.decks);
    this.emit('decks');
  },

  saveMatches() {
    write(KEYS.matches, this.matches);
    this.emit('matches');
  },

  saveLedger() {
    write(KEYS.ledger, this.ledger);
    this.emit('ledger');
  },

  /** Guarda (o, con null, borra) la partida de la mesa. No se sincroniza: es de este dispositivo. */
  saveTable(table = this.table) {
    this.table = table;
    if (table) write(KEYS.table, table);
    else try { localStorage.removeItem(KEYS.table); } catch { /* sin almacenamiento */ }
  },

  saveSettings() {
    write(KEYS.settings, this.settings);
  },

  /** Guarda colección, mazos y partidas tal como están (p. ej. tras traerlos de la nube) y avisa. */
  persist() {
    write(KEYS.collection, this.collection);
    write(KEYS.decks, this.decks);
    write(KEYS.matches, this.matches);
    write(KEYS.ledger, this.ledger);
    this.emit('collection');
    this.emit('decks');
    this.emit('matches');
    this.emit('ledger');
  },

  exportData() {
    return { app: 'riftbound-scanner', version: 1, exported: new Date().toISOString(), collection: this.collection, decks: this.decks, matches: this.matches, ledger: this.ledger };
  },

  /** Solo la colección (desde Excel/CSV): "merge" suma, "replace" la sustituye. Los mazos no se tocan. */
  importCollection(collection, mode = 'merge') {
    if (mode === 'replace') this.collection = {};
    for (const [id, e] of Object.entries(collection)) {
      const cur = this.collection[id] || { n: 0, f: 0 };
      this.collection[id] = { n: cur.n + e.n, f: cur.f + e.f };
    }
    write(KEYS.collection, this.collection);
    this.emit('collection');
  },
};
