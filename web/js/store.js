// Estado persistente en localStorage: colección, mazos y ajustes.
// Colección: { [cardId]: { n: copias normales, f: copias foil } }

const KEYS = { collection: 'rb.collection.v1', decks: 'rb.decks.v1', settings: 'rb.settings.v1' };

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

const listeners = new Set();

export const store = {
  collection: read(KEYS.collection, {}),
  decks: read(KEYS.decks, []),
  settings: read(KEYS.settings, {}),

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

  add(id, delta = 1, foil = false) {
    const e = this.collection[id] || { n: 0, f: 0 };
    const k = foil ? 'f' : 'n';
    e[k] = Math.max(0, e[k] + delta);
    if (e.n + e.f === 0) delete this.collection[id];
    else this.collection[id] = e;
    write(KEYS.collection, this.collection);
    this.emit('collection');
  },

  saveDecks() {
    write(KEYS.decks, this.decks);
    this.emit('decks');
  },

  saveSettings() {
    write(KEYS.settings, this.settings);
  },

  exportData() {
    return { app: 'riftbound-scanner', version: 1, exported: new Date().toISOString(), collection: this.collection, decks: this.decks };
  },

  importData(data, mode = 'replace') {
    if (!data || typeof data.collection !== 'object') throw new Error('El archivo no es una copia de Riftbound Scanner.');
    if (mode === 'merge') {
      for (const [id, e] of Object.entries(data.collection)) {
        const cur = this.collection[id] || { n: 0, f: 0 };
        this.collection[id] = { n: cur.n + (e.n || 0), f: cur.f + (e.f || 0) };
      }
      const ids = new Set(this.decks.map((d) => d.id));
      this.decks.push(...(data.decks || []).filter((d) => !ids.has(d.id)));
    } else {
      this.collection = data.collection;
      this.decks = data.decks || [];
    }
    write(KEYS.collection, this.collection);
    write(KEYS.decks, this.decks);
    this.emit('collection');
    this.emit('decks');
  },
};
