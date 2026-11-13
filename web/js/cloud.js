// Cuenta y sincronización en la nube (Supabase).
//
// El localStorage sigue siendo la copia de trabajo: la app lee y escribe ahí como siempre. Con la
// sesión iniciada, cada cambio se sube a los pocos segundos y, al abrir la app o volver a ella, se
// baja lo que haya cambiado en otros dispositivos.
//
// Para saber qué subir se guarda una "foto" de lo que hay en la nube (rb.sync.v1) y se compara con
// lo local: lo que difiere se sube. Así no hace falta tocar cada sitio donde cambian los datos.
// Si una misma carta, mazo o partida cambia en dos dispositivos sin conexión, gana el último que sube.
// Las partidas tienen su propia marca de "bajado hasta" (matchPull): las fotos de antes de que se
// sincronizaran no las tienen, y la primera vez se bajan todas y se juntan con las de aquí.

import { store, uuidFromBytes } from './store.js';
import { joinCollection, joinById, countCards, sameCollection, sameById, autoPlan } from './merge.js';

const SUPABASE_URL = 'https://eyevxcflrgouelrfkosk.supabase.co';
const SUPABASE_KEY = 'sb_publishable_juyEUUFU4PVzQaIhgJVJLA_SkqddAD0'; // clave pública: puede ir en la web
const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.48.1/+esm';
const AUTH_KEY = 'sb-eyevxcflrgouelrfkosk-auth-token'; // donde supabase-js guarda la sesión
const LEGACY_DOMAIN = 'usuarios.riftbound-scanner.app'; // cuentas antiguas: el usuario era un correo interno
const SYNC_KEY = 'rb.sync.v1';
const PUSH_DELAY = 2000;
const PAGE = 1000; // filas por petición (el máximo de la API)
// updated_at es now(): la hora en que empezó la transacción, no en la que se confirmó. Una subida de
// otro dispositivo puede llegar con una marca algo anterior a la última bajada, así que cada bajada
// repasa también este margen (volver a ver filas ya bajadas no cambia nada).
const PULL_OVERLAP = 60_000;

export const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Estado visible: off (sin sesión) · syncing · pending (cambios por subir) · idle · offline · error. */
export const cloud = {
  state: 'off',
  username: null,
  profile: null, // { username, display_name, bio, city, is_public } cuando se ha leído
  people: null, // a quién sigues y quién te sigue (loadPeople)
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
let onRecovery = null; // se ha abierto el enlace de "nueva contraseña" del correo

// ---------- Cliente y sesión ----------

let clientLoading = null; // para que dos llamadas a la vez no creen dos clientes

function getClient() {
  if (client) return Promise.resolve(client);
  return (clientLoading ??= makeClient().finally(() => { clientLoading = null; }));
}

async function makeClient() {
  const { createClient } = await import(SUPABASE_JS);
  client = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
  client.auth.onAuthStateChange((event, s) => {
    if (event === 'PASSWORD_RECOVERY') setTimeout(() => onRecovery?.());
    // Sin await aquí dentro (lo pide supabase-js): la sincronización va en la siguiente vuelta.
    if (s?.user?.id !== session?.user?.id) setTimeout(() => setSession(s));
    else session = s;
  });
  return client;
}

function setSession(s) {
  session = s;
  cloud.profile = null;
  cloud.people = null;
  if (!s) {
    cloud.username = null;
    setState('off');
    return;
  }
  cloud.username = s.user.user_metadata?.username ?? s.user.email.split('@')[0];
  syncNow();
  loadProfile().catch((err) => console.error(err));
  loadPeople().catch((err) => console.error(err));
}

// ---------- Perfil ----------
// El usuario no se cambia desde la app: las cuentas antiguas entran con él.

const PROFILE_COLUMNS = 'username,display_name,bio,city,is_public';

/** Lee el perfil propio. El usuario de verdad es el de la tabla (los metadatos del alta no cambian). */
export async function loadProfile() {
  if (!session) return null;
  const sb = await getClient();
  const { data, error } = await sb.from('profiles').select(PROFILE_COLUMNS).eq('id', session.user.id).maybeSingle();
  if (error) throw error;
  cloud.profile = data;
  if (data) cloud.username = data.username;
  listeners.forEach((fn) => fn(cloud));
  return data;
}

/**
 * Lo que se ve del perfil de alguien: los datos del perfil, sus mazos visibles, sus partidas (para
 * las estadísticas) y su colección, si es pública. Funciona sin sesión con los perfiles públicos
 * (carga Supabase solo para esto). Del propio perfil se devuelve lo mismo que verían los demás.
 * Devuelve null si no existe o no se puede ver.
 */
export async function fetchProfilePage(username) {
  const sb = await getClient();
  const { data: profile, error } = await sb.from('profiles').select(`id,${PROFILE_COLUMNS}`).eq('username', username).maybeSingle();
  if (error) throw new Error(authMessage(error));
  if (!profile) return null;
  // La sesión guardada puede no estar aún en `session` si la página se abre directamente aquí.
  const { data: { session: current } } = await sb.auth.getSession();
  const own = profile.id === current?.user.id;
  const [deckRows, matchRows, colRows] = await Promise.all([
    selectAll(() => sb.from('decks').select('*').eq('user_id', profile.id).is('deleted_at', null).order('updated_at', { ascending: false }).order('id')),
    // De un perfil público, la vista public_matches (sin notas ni datos del rival); si no, la tabla (propias o de un amigo).
    selectAll(() => {
      const cols = 'deck_id,my_legend_id,opponent_legend_id,result,games_won,games_lost,points';
      const q = profile.is_public
        ? sb.from('public_matches').select(cols) // ya sin las borradas
        : sb.from('matches').select(cols).is('deleted_at', null);
      return q.eq('user_id', profile.id).order('id');
    }),
    profile.is_public ? selectAll(() => sb.from('collection_items').select('card_id,normal,foil').eq('user_id', profile.id).order('card_id')) : [],
  ]);
  const decks = deckRows.map(fromRow).filter((d) => !own || profile.is_public || d.shared);
  return {
    profile, own, decks,
    // Las partidas de un perfil privado no las ven los demás (ni sus estadísticas).
    matches: own && !profile.is_public ? [] : matchRows,
    collection: colRows.filter((r) => r.normal || r.foil),
  };
}

/**
 * Cartas que se quitaron del todo (su fila en la nube quedó a 0), las más recientes primero:
 * [{ id, at }]. Sirve para ver lo quitado antes de que existiera el historial o en otro dispositivo.
 */
export async function fetchRemovedCards(limit = 30) {
  if (!session) return [];
  const sb = await getClient();
  const { data, error } = await sb.from('collection_items').select('card_id,updated_at')
    .eq('user_id', session.user.id).eq('normal', 0).eq('foil', 0).order('updated_at', { ascending: false }).limit(limit);
  if (error) throw new Error(authMessage(error));
  return data.map((r) => ({ id: r.card_id, at: Date.parse(r.updated_at) }));
}

// ---------- Seguir y amigos ----------
// Amigos = os seguís los dos (la base de datos les deja ver mazos y partidas del otro).

/** Busca cuentas por usuario o nombre visible (sin la propia). */
export async function searchProfiles(text) {
  const q = text.trim().replace(/[^\p{L}\p{N}_ ]/gu, '').slice(0, 40);
  if (q.length < 2 || !session) return [];
  const sb = await getClient();
  const like = `%${q.replace(/_/g, '\\_')}%`;
  const [byUser, byName] = await Promise.all([
    sb.from('profiles').select('id,username,display_name').ilike('username', like).neq('id', session.user.id).order('username').limit(10),
    sb.from('profiles').select('id,username,display_name').ilike('display_name', like).neq('id', session.user.id).order('username').limit(10),
  ]);
  if (byUser.error || byName.error) throw new Error(authMessage(byUser.error ?? byName.error));
  const seen = new Set();
  return [...byUser.data, ...byName.data].filter((p) => !seen.has(p.id) && seen.add(p.id)).slice(0, 10);
}

/**
 * A quién sigues y quién te sigue: [{ id, username, display_name, following, follower, friend }],
 * primero los amigos. Se guarda en cloud.people para el resto de la app (rival de una partida…).
 */
export async function loadPeople() {
  if (!session) return [];
  const sb = await getClient();
  const me = session.user.id;
  const { data: rows, error } = await sb.from('follows').select('follower_id,followee_id').or(`follower_id.eq.${me},followee_id.eq.${me}`);
  if (error) throw new Error(authMessage(error));
  const people = new Map();
  for (const r of rows) {
    const id = r.follower_id === me ? r.followee_id : r.follower_id;
    const p = people.get(id) ?? { id, following: false, follower: false };
    if (r.follower_id === me) p.following = true;
    else p.follower = true;
    people.set(id, p);
  }
  if (people.size) {
    const { data: profiles, error: err } = await sb.from('profiles').select('id,username,display_name').in('id', [...people.keys()]);
    if (err) throw new Error(authMessage(err));
    for (const pr of profiles) Object.assign(people.get(pr.id), pr);
  }
  cloud.people = [...people.values()].filter((p) => p.username)
    .map((p) => ({ ...p, friend: p.following && p.follower }))
    .sort((a, b) => b.friend - a.friend || a.username.localeCompare(b.username, 'es', { sensitivity: 'base' }));
  listeners.forEach((fn) => fn(cloud));
  return cloud.people;
}

export async function follow(id) {
  const sb = await getClient();
  const { error } = await sb.from('follows').insert({ followee_id: id });
  if (error && error.code !== '23505') throw new Error(authMessage(error)); // 23505: ya lo seguías
  await loadPeople();
}

export async function unfollow(id) {
  const sb = await getClient();
  const { error } = await sb.from('follows').delete().eq('follower_id', session.user.id).eq('followee_id', id);
  if (error) throw new Error(authMessage(error));
  await loadPeople();
}

/**
 * Los mazos de un amigo (o de un perfil público), para apuntar con cuál jugó contra ti:
 * [{ id, name, legend }], los más recientes primero.
 */
export async function fetchUserDecks(userId) {
  if (!session || !userId) return [];
  const sb = await getClient();
  const { data, error } = await sb.from('decks').select('id,name,legend_id,battlefields').eq('user_id', userId).is('deleted_at', null)
    .order('updated_at', { ascending: false }).limit(50);
  if (error) throw new Error(authMessage(error));
  return data.map((r) => ({ id: r.id, name: r.name, legend: r.legend_id, battlefields: r.battlefields ?? [] }));
}

// ---------- Partida espejo ----------
// Un amigo apunta una partida con tu cuenta de rival: te llega para guardarla en tu historial (una
// partida tuya con mirrorOf = la suya) o descartarla (la misma copia, pero ya borrada). La copia tiene
// un id fijo sacado de la original, así que aceptarla en dos dispositivos no la duplica.

/** Id de la copia de una partida en esta cuenta (un uuid derivado de la original y de la cuenta). */
export async function mirrorId(originalId) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`espejo:${originalId}:${session.user.id}`))).slice(0, 16);
  return uuidFromBytes(bytes, 5); // versión 5 (por nombre)
}

/**
 * Partidas que otros han apuntado contra ti y aún no has guardado ni descartado, de la más nueva a
 * la más antigua: [{ match (formato de la app, desde su lado), author: { id, username, display_name } }].
 */
export async function fetchIncoming() {
  if (!session) return [];
  const sb = await getClient();
  const me = session.user.id;
  const [{ data: rows, error }, { data: mine, error: err2 }] = await Promise.all([
    sb.from('matches').select('*').eq('opponent_id', me).neq('user_id', me).is('mirror_of', null).is('deleted_at', null).order('played_at', { ascending: false }).limit(50),
    sb.from('matches').select('mirror_of,deleted_at').eq('user_id', me).not('mirror_of', 'is', null),
  ]);
  if (error || err2) throw new Error(authMessage(error ?? err2));
  // Ya guardada, o descartada (o borrada) después de la última vez que el otro la envió.
  const copies = new Map(mine.map((r) => [r.mirror_of, r.deleted_at]));
  const pending = rows.filter((r) => {
    if (!copies.has(r.id)) return true;
    const gone = copies.get(r.id);
    return gone != null && Date.parse(r.updated_at) > Date.parse(gone);
  });
  if (!pending.length) return [];
  const { data: authors, error: err3 } = await sb.from('profiles').select('id,username,display_name').in('id', [...new Set(pending.map((r) => r.user_id))]);
  if (err3) throw new Error(authMessage(err3));
  const byId = new Map(authors.map((a) => [a.id, a]));
  return pending.map((r) => ({ match: fromMatchRow(r), author: byId.get(r.user_id) ?? { id: r.user_id, username: '?' } }));
}

/** "No es mía": guarda la copia ya borrada para que deje de salir. */
export async function dismissIncoming(original) {
  const sb = await getClient();
  const { error } = await sb.from('matches').upsert({
    id: await mirrorId(original.id), user_id: session.user.id, mirror_of: original.id,
    played_at: new Date(original.at).toISOString(), result: { win: 'loss', loss: 'win', draw: 'draw' }[original.result],
    deleted_at: new Date().toISOString(),
  }, { onConflict: 'id' });
  if (error) throw new Error(authMessage(error));
}

/**
 * Las partidas de un amigo que tienen que ver contigo (sin las borradas): las que apuntó contra ti y
 * sus copias de las tuyas. En el formato de la app, desde su lado. Las de un amigo se pueden leer (SQL 08).
 */
export async function fetchMatchesWith(friendId) {
  const sb = await getClient();
  const me = session.user.id;
  const rows = await selectAll(() => sb.from('matches').select('*').eq('user_id', friendId).eq('opponent_id', me)
    .is('deleted_at', null).order('played_at', { ascending: false }).order('id'));
  return rows.map(fromMatchRow);
}

/**
 * Vuelve a enviar partidas tuyas a su rival: basta con tocarlas (cambia updated_at) para que le
 * vuelva a salir el aviso aunque hubiera descartado o borrado su copia. Solo las ya subidas.
 */
export async function resendMatches(ids, rivalId) {
  const sb = await getClient();
  const { data, error } = await sb.from('matches').update({ opponent_id: rivalId })
    .eq('user_id', session.user.id).eq('opponent_id', rivalId).is('mirror_of', null).is('deleted_at', null)
    .in('id', ids).select('id');
  if (error) throw new Error(authMessage(error));
  return data.length;
}

// ---------- Intercambios ----------
// Ofrezco / Busco: viven solo en la nube; las ves tú y tus amigos.

const TRADE_TABLE = { offer: 'trade_list', want: 'want_list' };

/** Las listas de una cuenta (la propia por defecto): { offer: [{ card_id, foil, quantity }], want }. */
export async function fetchTradeLists(userId = session?.user.id) {
  const sb = await getClient();
  const read = (table) => selectAll(() => sb.from(table).select('card_id,foil,quantity').eq('user_id', userId).order('card_id').order('foil'));
  const [offer, want] = await Promise.all([read(TRADE_TABLE.offer), read(TRADE_TABLE.want)]);
  return { offer, want };
}

/** Pone las copias de cartas de una lista propia: items [{ card_id, foil, quantity }]; con 0 se quita. */
export async function setTradeListItems(list, items) {
  check(session, 'Inicia sesión para usar los intercambios.');
  const sb = await getClient();
  const table = TRADE_TABLE[list];
  const user_id = session.user.id;
  const keep = items.filter((i) => i.quantity > 0).map((i) => ({ ...i, user_id }));
  if (keep.length) {
    const { error } = await sb.from(table).upsert(keep, { onConflict: 'user_id,card_id,foil' });
    if (error) throw new Error(authMessage(error));
  }
  for (const i of items.filter((x) => x.quantity <= 0)) {
    const { error } = await sb.from(table).delete().eq('user_id', user_id).eq('card_id', i.card_id).eq('foil', i.foil);
    if (error) throw new Error(authMessage(error));
  }
}

/**
 * Propone un intercambio a un amigo. items: [{ mine: true si la entregas tú, card_id, foil, quantity }].
 * Con counterOf es una contraoferta: rechaza esa propuesta recibida al crear la nueva.
 */
export async function proposeTrade({ receiver, items, message, counterOf }) {
  check(session, 'Inicia sesión para usar los intercambios.');
  const sb = await getClient();
  const { data, error } = await sb.rpc('propose_trade', { p_receiver: receiver, p_items: items, p_message: message || null, p_counter_of: counterOf ?? null });
  if (error) throw new Error(authMessage(error).replace(/^[A-Z_]+: /, ''));
  return data;
}

/**
 * Mis intercambios, los últimos primero, desde mi lado: [{ id, status, message, incoming (me lo
 * propusieron), other: { id, username, display_name }, give, take: [{ card_id, foil, quantity }],
 * applied (mi lado ya está en mi colección), counter_of, updated_at }].
 */
export async function fetchTrades() {
  if (!session) return [];
  const sb = await getClient();
  const me = session.user.id;
  const { data: rows, error } = await sb.from('trades').select('*, trade_items(*)').order('updated_at', { ascending: false }).limit(100);
  if (error) throw new Error(authMessage(error));
  const ids = [...new Set(rows.map((r) => (r.proposer_id === me ? r.receiver_id : r.proposer_id)))];
  const { data: people, error: err2 } = ids.length ? await sb.from('profiles').select('id,username,display_name').in('id', ids) : { data: [] };
  if (err2) throw new Error(authMessage(err2));
  const byId = new Map(people.map((p) => [p.id, p]));
  return rows.map((r) => {
    const incoming = r.receiver_id === me;
    const otherId = incoming ? r.proposer_id : r.receiver_id;
    return {
      id: r.id, status: r.status, message: r.message, incoming, counter_of: r.counter_of, updated_at: r.updated_at,
      other: byId.get(otherId) ?? { id: otherId, username: '?' },
      give: r.trade_items.filter((i) => i.from_user === me),
      take: r.trade_items.filter((i) => i.from_user !== me),
      applied: !!(incoming ? r.receiver_applied_at : r.proposer_applied_at),
    };
  });
}

/** Amigos con los que encajan tus listas: [{ other_id, cards_they_have, cards_they_want, … }]. */
export async function fetchTradeMatches() {
  if (!session) return [];
  const sb = await getClient();
  const { data, error } = await sb.rpc('trade_matches');
  if (error) throw new Error(authMessage(error));
  return data;
}

/** Cambia el estado de un intercambio (la base de datos comprueba quién puede hacer qué). */
export async function setTradeStatus(id, status) {
  const sb = await getClient();
  const { error } = await sb.rpc('set_trade_status', { p_trade: id, p_status: status });
  if (error) throw new Error(/No se puede pasar/.test(error.message) ? 'Ese intercambio ya ha cambiado: mira cómo está ahora.' : authMessage(error));
}

/** Apunta que mi lado ya está en mi colección. true solo la primera vez: entonces hay que aplicarlo. */
export async function markTradeApplied(id) {
  const sb = await getClient();
  const { data, error } = await sb.rpc('mark_trade_applied', { p_trade: id });
  if (error) throw new Error(authMessage(error));
  return data === true;
}

/** Guarda nombre visible, bio, ciudad y si el perfil es público. */
export async function saveProfile({ display_name, bio, city, is_public }) {
  check(session, 'Inicia sesión para editar tu perfil.');
  const clean = (s, max) => (s ?? '').trim().slice(0, max) || null;
  const row = { display_name: clean(display_name, 40), bio: clean(bio, 280), city: clean(city, 60), is_public: !!is_public };
  const sb = await getClient();
  const { data, error } = await sb.from('profiles').update(row).eq('id', session.user.id).select(PROFILE_COLUMNS).single();
  if (error) throw new Error(authMessage(error));
  cloud.profile = data;
  listeners.forEach((fn) => fn(cloud));
}

/** ¿Viene la página de un enlace del correo (confirmar cuenta o nueva contraseña)? */
const fromAuthLink = () => /access_token=|error_description=|type=(signup|recovery)/.test(location.hash);

/**
 * Arranque: solo carga Supabase si ya había una sesión guardada en este dispositivo o si se llega
 * desde un enlace del correo (supabase-js lee el enlace y abre la sesión).
 */
export async function initCloud({ ask, recovery }) {
  askChoice = ask;
  onRecovery = recovery;
  store.onChange((what) => what !== 'history' && schedulePush()); // el historial no se sube
  document.addEventListener('visibilitychange', () => document.hidden || syncNow());
  window.addEventListener('online', () => syncNow());
  let saved = false;
  try { saved = !!localStorage.getItem(AUTH_KEY); } catch { /* sin almacenamiento */ }
  if (!saved && !fromAuthLink()) return;
  try {
    await getClient(); // su onAuthStateChange trae la sesión guardada
  } catch (err) {
    console.error(err);
    setState('offline', 'No se pudo conectar con la nube.');
  }
}

// ---------- Entrar, crear cuenta, salir ----------
// Las cuentas van con un correo real que hay que confirmar (así no se crean cuentas sin fin).
// Se entra con el correo; las cuentas antiguas, creadas solo con usuario, siguen entrando con él.

const loginEmail = (id) => (id.includes('@') ? id.trim().toLowerCase() : `${id.trim().toLowerCase()}@${LEGACY_DOMAIN}`);
/** A dónde vuelven los enlaces del correo: esta misma página. */
const backHere = () => location.origin + location.pathname;

function authMessage(error) {
  const m = error?.message ?? String(error);
  if (/already registered|already exists/i.test(m)) return 'Ya hay una cuenta con ese correo. Entra con él o recupera la contraseña.';
  if (/database error saving new user/i.test(m)) return 'Ese nombre de usuario ya está cogido. Elige otro.';
  if (/invalid login credentials/i.test(m)) return 'Correo o contraseña incorrectos.';
  if (/email not confirmed/i.test(m)) return 'Aún no has confirmado el correo: abre el enlace que te enviamos al crear la cuenta.';
  if (/rate limit|too many|security purposes/i.test(m)) return 'Demasiados intentos seguidos. Espera unos minutos y vuelve a probar.';
  if (/LIMITE_FILAS/.test(m)) return 'Tu cuenta ha llegado al máximo de datos guardados en la nube. Borra algo para seguir sincronizando.';
  if (/LIMITE_MAZOS/.test(m)) return 'Tu cuenta ya tiene 15 mazos: borra alguno para que se sincronicen los demás.';
  if (/signups? (are|is) disabled|signup.*not allowed/i.test(m)) return 'Ahora mismo no se pueden crear cuentas nuevas (está desactivado en Supabase).';
  if (/password.*(6|characters|short)/i.test(m)) return 'La contraseña debe tener al menos 6 caracteres.';
  if (/invalid.*email|email.*invalid/i.test(m)) return 'Ese correo no es válido.';
  if (/failed to fetch|network/i.test(m)) return 'No hay conexión con la nube. Inténtalo de nuevo.';
  return m;
}

function check(cond, message) {
  if (!cond) throw new Error(message);
}

/** Entra con el correo (o con el usuario, en las cuentas antiguas). */
export async function signIn(id, password) {
  check(id.trim(), 'Escribe tu correo.');
  const sb = await getClient();
  const { error } = await sb.auth.signInWithPassword({ email: loginEmail(id), password });
  if (error) throw new Error(authMessage(error));
}

/**
 * Crea la cuenta. Devuelve true si ya queda dentro, o false si hay que confirmar el correo antes
 * (Supabase envía un enlace; al abrirlo se vuelve a esta página con la sesión iniciada).
 */
export async function signUp(username, email, password) {
  check(USERNAME_RE.test(username), 'El usuario debe tener de 3 a 20 letras, números o _ (sin espacios ni tildes).');
  check(EMAIL_RE.test(email.trim()), 'Ese correo no es válido.');
  const sb = await getClient();
  const { data, error } = await sb.auth.signUp({
    email: email.trim().toLowerCase(),
    password,
    options: { data: { username }, emailRedirectTo: backHere() },
  });
  if (error) throw new Error(authMessage(error));
  return !!data.session;
}

/** Envía el enlace para poner una contraseña nueva. */
export async function resetPassword(email) {
  check(EMAIL_RE.test(email.trim()), 'Escribe el correo de tu cuenta.');
  const sb = await getClient();
  const { error } = await sb.auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo: backHere() });
  if (error) throw new Error(authMessage(error));
}

/** Guarda la contraseña nueva (tras abrir el enlace del correo, con la sesión ya abierta). */
export async function updatePassword(password) {
  check(password.length >= 6, 'La contraseña debe tener al menos 6 caracteres.');
  const sb = await getClient();
  const { error } = await sb.auth.updateUser({ password });
  if (error) throw new Error(authMessage(error));
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
    let repaired = false;
    do {
      again = false;
      try {
        done = await runSync();
      } catch (err) {
        // La cuenta existe pero le falta el perfil (al que apuntan colección y mazos): se crea y se
        // repite una vez. Si la cuenta ya no existe, ensure_profile no crea nada y el error vuelve.
        if (repaired || !/user_id_fkey/i.test(err?.message ?? '')) throw err;
        repaired = true;
        const { error } = await client.rpc('ensure_profile');
        if (error) throw error;
        again = true;
      }
    } while (again && done);
    if (done) {
      cloud.lastSync = new Date();
      setState('idle');
    } else {
      setState('pending', 'Elige qué hacer con los datos de este dispositivo.');
    }
  } catch (err) {
    console.error(err);
    // La cuenta se ha borrado mientras este dispositivo tenía la sesión abierta: se cierra aquí
    // (los datos se quedan en el dispositivo) en vez de reintentar para siempre. Se pregunta al
    // servidor antes: un fallo de perfil no basta para cerrar la sesión de una cuenta que existe.
    if (/user_id_fkey|sub claim in JWT does not exist|user not found/i.test(err?.message ?? '') && await accountGone()) {
      running = false;
      try { localStorage.removeItem(SYNC_KEY); } catch { /* sin almacenamiento */ }
      await client?.auth.signOut({ scope: 'local' }).catch(() => {});
      setState('off', 'Esa cuenta ya no existe: se ha cerrado la sesión.');
      return;
    }
    setState(navigator.onLine === false ? 'offline' : 'error', authMessage(err));
  } finally {
    running = false;
  }
}

/** ¿Dice el servidor que la cuenta de esta sesión ya no existe? */
async function accountGone() {
  const res = await client?.auth.getUser().catch(() => null);
  return /sub claim in JWT does not exist|user not found/i.test(res?.error?.message ?? '');
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
const deckKey = (d) => canon({
  name: d.name, legend: d.legend, champion: d.champion, main: d.main, runes: d.runes, battlefields: d.battlefields, sideboard: d.sideboard ?? {}, shared: !!d.shared,
  // Solo si las hay: así los mazos de antes no cuentan como cambiados y no se vuelven a subir.
  ...(d.notes ? { notes: d.notes } : {}),
  ...(d.versions?.length ? { versions: d.versions } : {}),
});
// notes y versions llegan con 15_notas_versiones_mazo.sql. Mientras falten, los mazos se suben sin
// ellas y la foto tampoco las lleva, para volver a intentarlo en cada sincronización.
let deckExtrasMissing = false;
const uploadedDeck = (d) => (deckExtrasMissing ? { ...d, notes: '', versions: [] } : d);
const matchKey = (m) => canon({
  at: m.at, deck: m.deck ?? null, my: m.my ?? null, opp: m.opp ?? null, oppName: m.oppName ?? '', result: m.result,
  score: m.score ?? null, points: m.points ?? [], first: m.first ?? null, event: m.event ?? '', notes: m.notes ?? '',
  rival: m.rival ?? null, mirrorOf: m.mirrorOf ?? null,
  // Solo si los hay: así las partidas de antes no cuentan como cambiadas y no se vuelven a subir.
  ...(m.battlefields?.length ? { battlefields: m.battlefields } : {}),
  ...(m.starts?.length ? { starts: m.starts } : {}),
  ...(m.oppDeck ? { oppDeck: m.oppDeck } : {}),
});
// Columnas que llegan con archivos SQL posteriores (12_campos_partida.sql, 13_mazo_rival_turnos.sql).
// Mientras falte alguna, las partidas se suben sin ese dato (y las que lo tienen se reintentan en cada
// sincronización, hasta que la columna exista). `strip` quita el dato de la partida para la foto.
const OPTIONAL_MATCH_COLUMNS = [
  { cols: ['battlefields'], strip: (m) => ({ ...m, battlefields: [] }) },
  { cols: ['game_starts'], strip: (m) => ({ ...m, starts: [] }) },
  { cols: ['opponent_deck_id', 'opponent_deck_name'], strip: (m) => ({ ...m, oppDeck: null }) },
];
const missingMatchColumns = new Set(); // grupos de OPTIONAL_MATCH_COLUMNS que la base de datos no tiene
const uploadedMatch = (m) => [...missingMatchColumns].reduce((x, g) => g.strip(x), m);
// Mazo que existe aquí pero aún no está en la nube (la partida sube sin él): la foto lo guarda sin
// mazo, para que la partida se vuelva a subir con su deck_id cuando el mazo suba.
const deckPending = (m, snap) => !!m.deck && !snap.decks[m.deck] && store.decks.some((d) => d.id === m.deck);
const snapMatch = (m, snap) => (deckPending(m, snap) ? { ...m, deck: null } : m);
const ledgerKey = (m) => canon({
  at: m.at, kind: m.kind, label: m.label ?? null, card: m.card ?? null, foil: !!m.foil, qty: m.qty, price: m.price,
  ownedBefore: m.ownedBefore ?? null, inCollection: !!m.inCollection,
});

function toRow(uid, d) {
  return {
    user_id: uid, id: d.id, name: (d.name || 'Mazo').slice(0, 80),
    legend_id: d.legend ?? null, champion_id: d.champion ?? null,
    main: d.main ?? {}, runes: d.runes ?? {}, battlefields: d.battlefields ?? [], sideboard: d.sideboard ?? {},
    is_public: !!d.shared, deleted_at: null,
    ...(deckExtrasMissing ? {} : { notes: (d.notes || '').slice(0, 4000) || null, versions: d.versions?.length ? d.versions.slice(-20) : null }),
  };
}
function fromRow(r) {
  return {
    id: r.id, name: r.name, legend: r.legend_id, champion: r.champion_id,
    main: r.main ?? {}, runes: r.runes ?? {}, battlefields: r.battlefields ?? [], sideboard: r.sideboard ?? {},
    shared: !!r.is_public, updated: Date.parse(r.updated_at),
    notes: r.notes ?? '', versions: r.versions ?? [],
  };
}

/** El mazo solo se enlaza si ya está en la nube (la base de datos lo exige). */
function toMatchRow(uid, m, snap) {
  const [won, lost] = m.score ? m.score.split('-').map(Number) : [null, null];
  const row = {
    user_id: uid, id: m.id, played_at: new Date(m.at).toISOString(),
    deck_id: m.deck && snap.decks[m.deck] ? m.deck : null,
    my_legend_id: m.my ?? null, opponent_legend_id: m.opp ?? null,
    opponent_name: (m.oppName || '').slice(0, 40) || null,
    result: m.result, games_won: won, games_lost: lost, went_first: m.first ?? null,
    event: (m.event || '').slice(0, 80) || null, notes: (m.notes || '').slice(0, 500) || null,
    points: m.points?.length ? m.points : null,
    opponent_id: m.rival ?? null, mirror_of: m.mirrorOf ?? null,
    battlefields: m.battlefields?.length ? m.battlefields : null,
    game_starts: m.starts?.length ? m.starts : null,
    opponent_deck_id: m.oppDeck?.id ?? null,
    opponent_deck_name: m.oppDeck ? (m.oppDeck.name || '').slice(0, 80) || null : null,
    deleted_at: null,
  };
  for (const g of missingMatchColumns) for (const c of g.cols) delete row[c];
  return row;
}
function fromMatchRow(r) {
  return {
    id: r.id, at: Date.parse(r.played_at), deck: r.deck_id, my: r.my_legend_id, opp: r.opponent_legend_id,
    oppName: r.opponent_name ?? '', result: r.result,
    score: r.games_won != null && r.games_lost != null ? `${r.games_won}-${r.games_lost}` : null,
    points: r.points ?? [], first: r.went_first, event: r.event ?? '', notes: r.notes ?? '',
    rival: r.opponent_id ?? null, mirrorOf: r.mirror_of ?? null, battlefields: r.battlefields ?? [],
    starts: r.game_starts ?? [],
    oppDeck: r.opponent_deck_id ? { id: r.opponent_deck_id, name: r.opponent_deck_name ?? '' } : null,
    updated: Date.parse(r.updated_at),
  };
}
const byDate = (a, b) => b.at - a.at;

function toLedgerRow(uid, m) {
  return {
    user_id: uid, id: m.id, kind: m.kind, occurred_at: new Date(m.at).toISOString(),
    label: m.label ?? null, card_id: m.card ?? null, foil: !!m.foil, quantity: m.qty, unit_price: m.price,
    owned_before: m.ownedBefore ?? null, in_collection: !!m.inCollection, deleted_at: null,
  };
}
function fromLedgerRow(r) {
  return {
    id: r.id, at: Date.parse(r.occurred_at), kind: r.kind, label: r.label, card: r.card_id, foil: r.foil,
    qty: r.quantity, price: Number(r.unit_price), ownedBefore: r.owned_before, inCollection: r.in_collection,
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
  const deckError = await push(uid, snap);
  await pull(uid, snap);
  if (deckError) throw deckError; // lo demás ya está sincronizado: solo queda avisar del límite
  return true;
}

/**
 * Primera vez de esta cuenta en este dispositivo. Cartas, mazos y partidas se deciden por separado:
 * si solo un lado tiene datos de ese tipo se usan esos, si coinciden no se toca nada, y si no se
 * pregunta qué hacer (solo por los tipos en los que hay que elegir).
 */
async function firstSync(uid) {
  const sb = await getClient();
  const colRows = await selectAll(() => sb.from('collection_items').select('card_id,normal,foil,updated_at').eq('user_id', uid).order('card_id'));
  const deckRows = await selectAll(() => sb.from('decks').select('*').eq('user_id', uid).order('id'));
  const matchRows = await selectAll(() => sb.from('matches').select('*').eq('user_id', uid).order('id'));

  const remoteCol = {};
  let stamp = null;
  for (const r of colRows) {
    stamp = maxStamp(stamp, r.updated_at);
    if (r.normal || r.foil) remoteCol[r.card_id] = { n: r.normal, f: r.foil };
  }
  const remoteDecks = [];
  let deckStamp = null;
  for (const r of deckRows) {
    deckStamp = maxStamp(deckStamp, r.updated_at);
    if (!r.deleted_at) remoteDecks.push(fromRow(r));
  }
  let matchStamp = null;
  const remoteMatches = [];
  for (const r of matchRows) {
    matchStamp = maxStamp(matchStamp, r.updated_at);
    if (!r.deleted_at) remoteMatches.push(fromMatchRow(r));
  }

  const plan = {
    cards: autoPlan(!countCards(store.collection), !countCards(remoteCol), sameCollection(store.collection, remoteCol)),
    decks: autoPlan(!store.decks.length, !remoteDecks.length, sameById(store.decks, remoteDecks, deckKey)),
    matches: autoPlan(!store.matches.length, !remoteMatches.length, sameById(store.matches, remoteMatches, matchKey)),
  };
  const open = Object.keys(plan).filter((kind) => !plan[kind]);
  if (open.length) {
    const size = (how, kind) => (kind === 'cards'
      ? countCards(joinCollection(store.collection, remoteCol, how))
      : joinById(kind === 'decks' ? store.decks : store.matches, kind === 'decks' ? remoteDecks : remoteMatches, how).length);
    // Cuánto quedaría con cada respuesta, para enseñarlo en la pregunta.
    const options = { cards: ['max', 'sum', 'cloud', 'device'], decks: ['merge', 'cloud', 'device'], matches: ['merge', 'cloud', 'device'] };
    const questions = open.map((kind) => ({
      kind,
      local: size('device', kind),
      remote: size('cloud', kind),
      results: Object.fromEntries(options[kind].map((how) => [how, size(how, kind)])),
    }));
    const answers = await askChoice({ questions, auto: Object.keys(plan).filter((kind) => plan[kind]) });
    if (!answers) return null;
    Object.assign(plan, answers);
  }

  // 'device': lo local se queda y el siguiente paso lo sube (y borra en la nube lo que no está aquí).
  store.collection = joinCollection(store.collection, remoteCol, plan.cards);
  store.decks = joinById(store.decks, remoteDecks, plan.decks);
  store.matches = joinById(store.matches, remoteMatches, plan.matches).sort(byDate);
  // Quedarse con todo lo de la cuenta deja también el balance: el pull de después baja el de la
  // cuenta. En los demás casos el de aquí se conserva y se junta con el de la cuenta.
  const plans = Object.values(plan);
  if (plans.includes('cloud') && plans.every((how) => how === 'cloud' || how === 'same')) store.ledger = [];

  const snap = {
    uid,
    lastPull: stamp,
    collection: remoteCol,
    deckPull: deckStamp,
    decks: Object.fromEntries(remoteDecks.map((d) => [d.id, deckKey(d)])),
    matchPull: matchStamp,
    matches: Object.fromEntries(remoteMatches.map((m) => [m.id, matchKey(m)])),
  };
  writeSnap(snap);
  if (plans.some((how) => how !== 'device' && how !== 'same')) store.persist();
  return snap;
}

/**
 * Sube lo que difiere de la foto de la nube. Si no caben todos los mazos, sube lo que quepa y lo
 * demás, y devuelve ese error para avisar al terminar la sincronización.
 */
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

  // Primero los borrados: dejan sitio para los mazos que no cabían.
  const localIds = new Set(store.decks.map((d) => d.id));
  const gone = Object.keys(snap.decks).filter((id) => !localIds.has(id));
  if (gone.length) {
    const { error } = await sb.from('decks').update({ deleted_at: new Date().toISOString() }).eq('user_id', uid).in('id', gone);
    if (error) throw error;
    for (const id of gone) delete snap.decks[id];
    writeSnap(snap);
  }

  const changed = store.decks.filter((d) => snap.decks[d.id] !== deckKey(d));
  const upsertDecks = (list) => sb.from('decks').upsert(list.map((d) => toRow(uid, d)), { onConflict: 'user_id,id' });
  let deckError = null;
  if (changed.length) {
    let uploaded = changed;
    let { error } = await upsertDecks(changed);
    // Sin 15_notas_versiones_mazo.sql: se suben sin notas ni versiones.
    if (error && (error.code === 'PGRST204' || error.code === '42703') && /notes|versions/.test(error.message)) {
      console.warn('Faltan decks.notes / decks.versions: los mazos se suben sin notas ni versiones.');
      deckExtrasMissing = true;
      ({ error } = await upsertDecks(changed));
    }
    if (error && !/LIMITE_MAZOS/.test(error.message)) throw error;
    if (error) {
      // Pasa del límite: de uno en uno, para que suban las ediciones y los que quepan.
      deckError = error;
      uploaded = [];
      for (const d of changed) {
        const { error: one } = await upsertDecks([d]);
        if (!one) uploaded.push(d);
        else if (!/LIMITE_MAZOS/.test(one.message)) throw one;
      }
    }
    for (const d of uploaded) snap.decks[d.id] = deckKey(uploadedDeck(d));
    writeSnap(snap);
  }

  snap.matches ??= {}; // foto de antes de sincronizar partidas
  const changedMatches = store.matches.filter((m) => snap.matches[m.id] !== matchKey(m));
  for (let i = 0; i < changedMatches.length; i += 500) {
    const chunk = changedMatches.slice(i, i + 500);
    const upsert = () => sb.from('matches').upsert(chunk.map((m) => toMatchRow(uid, m, snap)), { onConflict: 'id' });
    let { error } = await upsert();
    // El rival con cuenta ya no es amigo (la base de datos solo deja poner amigos): la partida se
    // queda con su nombre, sin el enlace a su cuenta.
    if (error && /RIVAL_NO_AMIGO/.test(error.message)) {
      const friends = new Set((await loadPeople()).filter((p) => p.friend).map((p) => p.id));
      for (const m of chunk) if (m.rival && !friends.has(m.rival)) m.rival = null;
      store.persist();
      ({ error } = await upsert());
    }
    // A la base de datos le falta alguna columna nueva (12_campos_partida.sql, 13_mazo_rival_turnos.sql):
    // se sube sin ella. Puede faltar más de una, así que se repite mientras el error nombre otra.
    for (;;) {
      // Solo errores de columna inexistente (PostgREST PGRST204, Postgres 42703), no otros que la nombren.
      const missing = error && (error.code === 'PGRST204' || error.code === '42703');
      const g = missing && OPTIONAL_MATCH_COLUMNS.find((x) => !missingMatchColumns.has(x) && x.cols.some((c) => error.message.includes(c)));
      if (!g) break;
      console.warn(`Falta la columna matches.${g.cols.join('/')}: las partidas se suben sin ese dato.`);
      missingMatchColumns.add(g);
      ({ error } = await upsert());
    }
    if (error) throw error;
    // Sin la columna, lo subido no lleva ese dato: la foto tampoco, para reintentarlo la próxima vez.
    for (const m of chunk) snap.matches[m.id] = matchKey(uploadedMatch(snapMatch(m, snap)));
    writeSnap(snap);
  }

  const localMatchIds = new Set(store.matches.map((m) => m.id));
  const goneMatches = Object.keys(snap.matches).filter((id) => !localMatchIds.has(id));
  if (goneMatches.length) {
    const { error } = await sb.from('matches').update({ deleted_at: new Date().toISOString() }).eq('user_id', uid).in('id', goneMatches);
    if (error) throw error;
    for (const id of goneMatches) delete snap.matches[id];
    writeSnap(snap);
  }

  snap.ledger ??= {}; // foto de antes de sincronizar el balance
  const changedLedger = store.ledger.filter((m) => snap.ledger[m.id] !== ledgerKey(m));
  for (let i = 0; i < changedLedger.length; i += 500) {
    const chunk = changedLedger.slice(i, i + 500);
    const { error } = await sb.from('ledger').upsert(chunk.map((m) => toLedgerRow(uid, m)), { onConflict: 'id' });
    if (error) throw error;
    for (const m of chunk) snap.ledger[m.id] = ledgerKey(m);
    writeSnap(snap);
  }

  const localLedgerIds = new Set(store.ledger.map((m) => m.id));
  const goneLedger = Object.keys(snap.ledger).filter((id) => !localLedgerIds.has(id));
  if (goneLedger.length) {
    const { error } = await sb.from('ledger').update({ deleted_at: new Date().toISOString() }).eq('user_id', uid).in('id', goneLedger);
    if (error) throw error;
    for (const id of goneLedger) delete snap.ledger[id];
    writeSnap(snap);
  }
  return deckError;
}

/**
 * Baja lo que ha cambiado en la nube desde la última vez (incluidos los cambios de otros dispositivos).
 * Cada tipo lleva su propia marca: se consultan por separado, y con una sola la fecha de un mazo podría
 * saltarse una carta guardada entre las dos consultas. Lo que difiere de la foto se ha cambiado aquí
 * después de subir: no se pisa, solo se actualiza la foto y la siguiente vuelta lo sube.
 */
async function pull(uid, snap) {
  const sb = await getClient();
  snap.deckPull ??= snap.lastPull; // foto de antes de separar las marcas
  const newer = (q, since) => (since ? q.gt('updated_at', new Date(Date.parse(since) - PULL_OVERLAP).toISOString()) : q);
  const colRows = await selectAll(() => newer(sb.from('collection_items').select('card_id,normal,foil,updated_at').eq('user_id', uid), snap.lastPull).order('updated_at').order('card_id'));
  const deckRows = await selectAll(() => newer(sb.from('decks').select('*').eq('user_id', uid), snap.deckPull).order('updated_at').order('id'));

  let changed = false;
  for (const r of colRows) {
    snap.lastPull = maxStamp(snap.lastPull, r.updated_at);
    const cur = store.collection[r.card_id];
    const base = snap.collection[r.card_id];
    if ((cur?.n ?? 0) !== (base?.n ?? 0) || (cur?.f ?? 0) !== (base?.f ?? 0)) {
      if (r.normal || r.foil) snap.collection[r.card_id] = { n: r.normal, f: r.foil };
      else delete snap.collection[r.card_id];
      continue;
    }
    // Lo que se quitó en otro dispositivo también va al historial de este.
    if (cur && cur.n > r.normal) store.logRemoval(r.card_id, cur.n - r.normal, false, 'otro dispositivo');
    if (cur && cur.f > r.foil) store.logRemoval(r.card_id, cur.f - r.foil, true, 'otro dispositivo');
    if (r.normal || r.foil) {
      snap.collection[r.card_id] = { n: r.normal, f: r.foil };
      if (cur?.n !== r.normal || cur?.f !== r.foil) { store.collection[r.card_id] = { n: r.normal, f: r.foil }; changed = true; }
    } else {
      delete snap.collection[r.card_id];
      if (cur) { delete store.collection[r.card_id]; changed = true; }
    }
  }
  for (const r of deckRows) {
    snap.deckPull = maxStamp(snap.deckPull, r.updated_at);
    const i = store.decks.findIndex((d) => d.id === r.id);
    const dirty = snap.decks[r.id] !== (i >= 0 ? deckKey(store.decks[i]) : undefined);
    if (r.deleted_at) {
      delete snap.decks[r.id];
      if (i >= 0 && !dirty) { store.decks.splice(i, 1); changed = true; }
      continue;
    }
    const deck = fromRow(r);
    snap.decks[r.id] = deckKey(deck);
    if (dirty) continue;
    if (i < 0) { store.decks.unshift(deck); changed = true; }
    else if (deckKey(store.decks[i]) !== snap.decks[r.id]) { store.decks[i] = deck; changed = true; }
  }

  // Partidas, con su propia marca: sin ella (foto antigua) se bajan todas.
  const matchSince = snap.matchPull;
  const matchRows = await selectAll(() => newer(sb.from('matches').select('*').eq('user_id', uid), matchSince).order('updated_at').order('id'));
  for (const r of matchRows) {
    snap.matchPull = maxStamp(snap.matchPull, r.updated_at);
    const i = store.matches.findIndex((m) => m.id === r.id);
    const dirty = snap.matches[r.id] !== (i >= 0 ? matchKey(store.matches[i]) : undefined);
    if (r.deleted_at) {
      delete snap.matches[r.id];
      if (i >= 0 && !dirty) { store.matches.splice(i, 1); changed = true; }
      continue;
    }
    const match = fromMatchRow(r);
    // El mazo que la nube no enlaza (no estaba subido) se conserva si aquí sí lo tenemos.
    if (!match.deck && i >= 0) match.deck = store.matches[i].deck;
    snap.matches[r.id] = matchKey(r.deck_id ? match : snapMatch(match, snap));
    if (dirty) continue;
    if (i < 0) { store.matches.push(match); changed = true; }
    else if (matchKey(store.matches[i]) !== matchKey(match)) { store.matches[i] = match; changed = true; }
  }
  if (changed) store.matches.sort(byDate);

  // Balance, igual que las partidas.
  const ledgerSince = snap.ledgerPull;
  const ledgerRows = await selectAll(() => newer(sb.from('ledger').select('*').eq('user_id', uid), ledgerSince).order('updated_at').order('id'));
  let ledgerChanged = false;
  for (const r of ledgerRows) {
    snap.ledgerPull = maxStamp(snap.ledgerPull, r.updated_at);
    const i = store.ledger.findIndex((m) => m.id === r.id);
    const dirty = snap.ledger[r.id] !== (i >= 0 ? ledgerKey(store.ledger[i]) : undefined);
    if (r.deleted_at) {
      delete snap.ledger[r.id];
      if (i >= 0 && !dirty) { store.ledger.splice(i, 1); ledgerChanged = true; }
      continue;
    }
    const entry = fromLedgerRow(r);
    snap.ledger[r.id] = ledgerKey(entry);
    if (dirty) continue;
    if (i < 0) { store.ledger.push(entry); ledgerChanged = true; }
    else if (ledgerKey(store.ledger[i]) !== snap.ledger[r.id]) { store.ledger[i] = entry; ledgerChanged = true; }
  }
  if (ledgerChanged) {
    store.ledger.sort(byDate);
    changed = true;
  }
  writeSnap(snap);
  if (changed) store.persist(); // avisa a la app; la comparación con la foto ya no ve nada que subir
}
