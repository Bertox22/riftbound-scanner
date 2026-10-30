// Cuenta y sincronización en la nube (Supabase).
//
// El localStorage sigue siendo la copia de trabajo: la app lee y escribe ahí como siempre. Con la
// sesión iniciada, cada cambio se sube a los pocos segundos y, al abrir la app o volver a ella, se
// baja lo que haya cambiado en otros dispositivos.
//
// Para saber qué subir se guarda una "foto" de lo que hay en la nube (rb.sync.v1) y se compara con
// lo local: lo que difiere se sube. Así no hace falta tocar cada sitio donde cambian los datos.
// Si una misma carta o mazo cambia en dos dispositivos sin conexión, gana el último que sube.

import { store } from './store.js';

const SUPABASE_URL = 'https://eyevxcflrgouelrfkosk.supabase.co';
const SUPABASE_KEY = 'sb_publishable_juyEUUFU4PVzQaIhgJVJLA_SkqddAD0'; // clave pública: puede ir en la web
const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.48.1/+esm';
const AUTH_KEY = 'sb-eyevxcflrgouelrfkosk-auth-token'; // donde supabase-js guarda la sesión
const EMAIL_DOMAIN = 'usuarios.riftbound-scanner.app'; // el usuario se convierte en un correo interno
const SYNC_KEY = 'rb.sync.v1';
const PUSH_DELAY = 2000;
const PAGE = 1000; // filas por petición (el máximo de la API)

export const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;

/** Estado visible: off (sin sesión) · syncing · pending (cambios por subir) · idle · offline · error. */
export const cloud = {
  state: 'off',
  username: null,
  lastSync: null,
  error: null,
};

const listeners = new Set();
export const onCloudChange = (fn) => listeners.add(fn);
function setState(state, error = null) {
  cloud.state = state;
  cloud.error = error;
  listeners.forEach((fn) => fn(cloud));
}

let client = null;
let session = null;
let askChoice = null; // pregunta qué hacer si este dispositivo y la cuenta tienen datos distintos

// ---------- Cliente y sesión ----------

async function getClient() {
  if (client) return client;
  const { createClient } = await import(SUPABASE_JS);
  client = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
  client.auth.onAuthStateChange((_event, s) => {
    // Sin await aquí dentro (lo pide supabase-js): la sincronización va en la siguiente vuelta.
    if (s?.user?.id !== session?.user?.id) setTimeout(() => setSession(s));
    else session = s;
  });
  return client;
}

function setSession(s) {
  session = s;
  if (!s) {
    cloud.username = null;
    setState('off');
    return;
  }
  cloud.username = s.user.user_metadata?.username ?? s.user.email.split('@')[0];
  syncNow();
}

/** Arranque: solo carga Supabase si ya había una sesión guardada en este dispositivo. */
export async function initCloud({ ask }) {
  askChoice = ask;
  store.onChange(() => schedulePush());
  document.addEventListener('visibilitychange', () => document.hidden || syncNow());
  window.addEventListener('online', () => syncNow());
  let saved = false;
  try { saved = !!localStorage.getItem(AUTH_KEY); } catch { /* sin almacenamiento */ }
  if (!saved) return;
  try {
    await getClient(); // su onAuthStateChange trae la sesión guardada
  } catch (err) {
    console.error(err);
    setState('offline', 'No se pudo conectar con la nube.');
  }
}

// ---------- Entrar, crear cuenta, salir ----------

const toEmail = (username) => `${username.toLowerCase()}@${EMAIL_DOMAIN}`;

function authMessage(error) {
  const m = error?.message ?? String(error);
  if (/already registered|already exists/i.test(m)) return 'Ese usuario ya existe. Elige otro o entra con él.';
  if (/invalid login credentials/i.test(m)) return 'Usuario o contraseña incorrectos.';
  if (/LIMITE_MAZOS/.test(m)) return 'Tu cuenta ya tiene 15 mazos: borra alguno para que se sincronicen los demás.';
  if (/signups? (are|is) disabled|signup.*not allowed/i.test(m)) return 'Ahora mismo no se pueden crear cuentas nuevas (está desactivado en Supabase).';
  if (/password.*(6|characters|short)/i.test(m)) return 'La contraseña debe tener al menos 6 caracteres.';
  if (/failed to fetch|network/i.test(m)) return 'No hay conexión con la nube. Inténtalo de nuevo.';
  return m;
}

function checkUsername(username) {
  if (!USERNAME_RE.test(username)) throw new Error('El usuario debe tener de 3 a 20 letras, números o _ (sin espacios ni tildes).');
}

export async function signIn(username, password) {
  checkUsername(username);
  const sb = await getClient();
  const { error } = await sb.auth.signInWithPassword({ email: toEmail(username), password });
  if (error) throw new Error(authMessage(error));
}

export async function signUp(username, password) {
  checkUsername(username);
  const sb = await getClient();
  const { data, error } = await sb.auth.signUp({ email: toEmail(username), password, options: { data: { username } } });
  if (error) throw new Error(authMessage(error));
  if (!data.session) throw new Error('La cuenta se ha creado, pero Supabase pide confirmar el correo: desactiva "Confirm email" en Authentication.');
}

/** Cierra la sesión. Los datos se quedan en este dispositivo. */
export async function signOut() {
  clearTimeout(pushTimer);
  const sb = await getClient();
  await sb.auth.signOut();
}

// ---------- Sincronización ----------

let pushTimer = null;
let running = false;
let again = false;

function schedulePush() {
  if (!session) return;
  if (running) { again = true; return; } // se sube al terminar la que está en marcha
  clearTimeout(pushTimer);
  setState('pending');
  pushTimer = setTimeout(syncNow, PUSH_DELAY);
}

/** Sube lo pendiente y baja lo nuevo. Si ya hay una en marcha, se repite al terminar. */
export async function syncNow() {
  if (!session) return;
  if (running) { again = true; return; }
  running = true;
  clearTimeout(pushTimer);
  setState('syncing');
  try {
    let done = true;
    do {
      again = false;
      done = await runSync();
    } while (again && done);
    if (done) {
      cloud.lastSync = new Date();
      setState('idle');
    } else {
      setState('pending', 'Elige qué hacer con los datos de este dispositivo.');
    }
  } catch (err) {
    console.error(err);
    setState(navigator.onLine === false ? 'offline' : 'error', authMessage(err));
  } finally {
    running = false;
  }
}

function readSnap() {
  try { return JSON.parse(localStorage.getItem(SYNC_KEY)); } catch { return null; }
}
function writeSnap(snap) {
  try { localStorage.setItem(SYNC_KEY, JSON.stringify(snap)); } catch (err) { console.error(err); }
}

/** JSON con las claves ordenadas: la base de datos no conserva el orden de los objetos. */
function canon(value) {
  if (Array.isArray(value)) return `[${value.map(canon).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canon(value[k])}`).join(',')}}`;
  return JSON.stringify(value ?? null);
}
const deckKey = (d) => canon({ name: d.name, legend: d.legend, champion: d.champion, main: d.main, runes: d.runes, battlefields: d.battlefields, sideboard: d.sideboard ?? {} });

function toRow(uid, d) {
  return {
    user_id: uid, id: d.id, name: (d.name || 'Mazo').slice(0, 80),
    legend_id: d.legend ?? null, champion_id: d.champion ?? null,
    main: d.main ?? {}, runes: d.runes ?? {}, battlefields: d.battlefields ?? [], sideboard: d.sideboard ?? {},
    deleted_at: null,
  };
}
function fromRow(r) {
  return {
    id: r.id, name: r.name, legend: r.legend_id, champion: r.champion_id,
    main: r.main ?? {}, runes: r.runes ?? {}, battlefields: r.battlefields ?? [], sideboard: r.sideboard ?? {},
    updated: Date.parse(r.updated_at),
  };
}

/** Todas las filas de una consulta, de mil en mil. */
async function selectAll(build) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < PAGE) return rows;
  }
}

const maxStamp = (a, b) => (!a || (b && b > a) ? b : a);

/** Devuelve false si queda esperando a que se elija qué hacer con los datos. */
async function runSync() {
  const uid = session.user.id;
  let snap = readSnap();
  if (!snap || snap.uid !== uid) {
    snap = await firstSync(uid);
    if (!snap) return false;
  }
  await push(uid, snap);
  await pull(uid, snap);
  return true;
}

/**
 * Primera vez de esta cuenta en este dispositivo. Si solo uno de los dos tiene datos, se usan esos;
 * si los dos tienen, se pregunta: juntar, quedarse con lo de la cuenta o subir lo de aquí.
 */
async function firstSync(uid) {
  const sb = await getClient();
  const colRows = await selectAll(() => sb.from('collection_items').select('card_id,normal,foil,updated_at').eq('user_id', uid).order('card_id'));
  const deckRows = await selectAll(() => sb.from('decks').select('*').eq('user_id', uid).order('id'));

  const remoteCol = {};
  let stamp = null;
  for (const r of colRows) {
    stamp = maxStamp(stamp, r.updated_at);
    if (r.normal || r.foil) remoteCol[r.card_id] = { n: r.normal, f: r.foil };
  }
  const remoteDecks = [];
  for (const r of deckRows) {
    stamp = maxStamp(stamp, r.updated_at);
    if (!r.deleted_at) remoteDecks.push(fromRow(r));
  }

  const count = (col, decks) => ({ cards: Object.values(col).reduce((a, e) => a + e.n + e.f, 0), decks: decks.length });
  const local = count(store.collection, store.decks);
  const remote = count(remoteCol, remoteDecks);
  let choice = 'device';
  if ((local.cards || local.decks) && (remote.cards || remote.decks)) choice = await askChoice({ local, remote });
  else if (remote.cards || remote.decks) choice = 'cloud';
  if (!choice) return null;

  if (choice === 'cloud') {
    store.collection = structuredClone(remoteCol);
    store.decks = structuredClone(remoteDecks);
  } else if (choice === 'merge') {
    for (const [id, e] of Object.entries(remoteCol)) {
      const cur = store.collection[id] || { n: 0, f: 0 };
      store.collection[id] = { n: cur.n + e.n, f: cur.f + e.f };
    }
    const ids = new Set(store.decks.map((d) => d.id));
    store.decks.push(...structuredClone(remoteDecks.filter((d) => !ids.has(d.id))));
  }
  // 'device': lo local se queda y el siguiente paso lo sube (y borra en la nube lo que no está aquí).

  const snap = {
    uid,
    lastPull: stamp,
    collection: remoteCol,
    decks: Object.fromEntries(remoteDecks.map((d) => [d.id, deckKey(d)])),
  };
  writeSnap(snap);
  if (choice !== 'device') store.persist();
  return snap;
}

/** Sube lo que difiere de la foto de la nube. */
async function push(uid, snap) {
  const sb = await getClient();

  const rows = [];
  for (const id of new Set([...Object.keys(store.collection), ...Object.keys(snap.collection)])) {
    const l = store.collection[id] ?? { n: 0, f: 0 };
    const r = snap.collection[id] ?? { n: 0, f: 0 };
    if (l.n !== r.n || l.f !== r.f) rows.push({ user_id: uid, card_id: id, normal: l.n, foil: l.f });
  }
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { error } = await sb.from('collection_items').upsert(chunk, { onConflict: 'user_id,card_id' });
    if (error) throw error;
    for (const r of chunk) {
      if (r.normal || r.foil) snap.collection[r.card_id] = { n: r.normal, f: r.foil };
      else delete snap.collection[r.card_id];
    }
    writeSnap(snap);
  }

  const changed = store.decks.filter((d) => snap.decks[d.id] !== deckKey(d));
  if (changed.length) {
    const { error } = await sb.from('decks').upsert(changed.map((d) => toRow(uid, d)), { onConflict: 'user_id,id' });
    if (error) throw error;
    for (const d of changed) snap.decks[d.id] = deckKey(d);
    writeSnap(snap);
  }

  const localIds = new Set(store.decks.map((d) => d.id));
  const gone = Object.keys(snap.decks).filter((id) => !localIds.has(id));
  if (gone.length) {
    const { error } = await sb.from('decks').update({ deleted_at: new Date().toISOString() }).eq('user_id', uid).in('id', gone);
    if (error) throw error;
    for (const id of gone) delete snap.decks[id];
    writeSnap(snap);
  }
}

/** Baja lo que ha cambiado en la nube desde la última vez (incluidos los cambios de otros dispositivos). */
async function pull(uid, snap) {
  const sb = await getClient();
  const since = snap.lastPull;
  const newer = (q) => (since ? q.gt('updated_at', since) : q);
  const colRows = await selectAll(() => newer(sb.from('collection_items').select('card_id,normal,foil,updated_at').eq('user_id', uid)).order('updated_at').order('card_id'));
  const deckRows = await selectAll(() => newer(sb.from('decks').select('*').eq('user_id', uid)).order('updated_at').order('id'));

  let changed = false;
  for (const r of colRows) {
    snap.lastPull = maxStamp(snap.lastPull, r.updated_at);
    const cur = store.collection[r.card_id];
    if (r.normal || r.foil) {
      snap.collection[r.card_id] = { n: r.normal, f: r.foil };
      if (cur?.n !== r.normal || cur?.f !== r.foil) { store.collection[r.card_id] = { n: r.normal, f: r.foil }; changed = true; }
    } else {
      delete snap.collection[r.card_id];
      if (cur) { delete store.collection[r.card_id]; changed = true; }
    }
  }
  for (const r of deckRows) {
    snap.lastPull = maxStamp(snap.lastPull, r.updated_at);
    const i = store.decks.findIndex((d) => d.id === r.id);
    if (r.deleted_at) {
      delete snap.decks[r.id];
      if (i >= 0) { store.decks.splice(i, 1); changed = true; }
      continue;
    }
    const deck = fromRow(r);
    snap.decks[r.id] = deckKey(deck);
    if (i < 0) { store.decks.unshift(deck); changed = true; }
    else if (deckKey(store.decks[i]) !== snap.decks[r.id]) { store.decks[i] = deck; changed = true; }
  }
  writeSnap(snap);
  if (changed) store.persist(); // avisa a la app; la comparación con la foto ya no ve nada que subir
}
