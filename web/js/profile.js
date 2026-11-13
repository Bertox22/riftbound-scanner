// Página de perfil (#@usuario, o #@usuario/idDelMazo para abrir uno de sus mazos): lo que los
// demás ven de una cuenta. Datos del perfil, estadísticas de partidas, Leyendas que más juega,
// mazos compartidos y tamaño de la colección (estas dos últimas, si el perfil es público).

import { $, el, toast, cardImg, cardCode, DOMAIN_ES } from './ui.js';
import { missingFor, copyToMyDecks } from './decks.js';
import { unitPrice, eur } from './prices.js';
import { store } from './store.js';
import { cloud, onCloudChange, fetchProfilePage, fetchMatchesWith, resendMatches } from './cloud.js';
import { followButton } from './friends.js';
import { tradeBox, wantButton } from './trades.js';
import { openFriends } from './account-ui.js';
import { record, recordText, rateText, countText, groupBy, statRow, legendThumb, legendChamp, canonicalLegend, openMirrored, sameGame, linked, matchLine, flipped } from './matches.js';

let ctx; // { cards, byId, openCard, showView }
let page = null; // lo último que se ha cargado: { profile, own, decks, matches, collection }

/** "#@diyi/abc" → { username: 'diyi', deckId: 'abc' }; null si la dirección no es de un perfil. */
export function parseProfileHash(hash = location.hash) {
  const m = /^#@([A-Za-z0-9_]{3,20})(?:\/([^/]+))?$/.exec(hash);
  return m ? { username: m[1], deckId: m[2] ? decodeURIComponent(m[2]) : null } : null;
}

/** Enlace para compartir un perfil (o uno de sus mazos). */
export const profileLink = (username, deckId) => `${location.origin}${location.pathname}#@${username}${deckId ? `/${encodeURIComponent(deckId)}` : ''}`;

export async function copyProfileLink(username, deckId) {
  const url = profileLink(username, deckId);
  try {
    await navigator.clipboard.writeText(url);
    toast('Enlace copiado');
  } catch {
    prompt('Copia el enlace:', url);
  }
}

const isFriend = (id) => !!cloud.people?.find((p) => p.id === id)?.friend;
const champTag = (legend) => legend?.champion ?? legend?.tags?.[0];
const sum = (obj) => Object.values(obj ?? {}).reduce((a, b) => a + b, 0);

// ---------- Página ----------

function message(text, sub) {
  return el('div', { class: 'profile-empty' }, el('p', { text }), sub && el('p', { class: 'muted small', text: sub }));
}

function header({ profile, own }) {
  const name = profile.display_name || profile.username;
  return el('div', { class: 'profile-head' },
    el('div', { class: 'profile-avatar', 'aria-hidden': 'true', text: name[0].toUpperCase() }),
    el('div', { class: 'grow' },
      el('h2', { text: name }),
      el('div', { class: 'muted small', text: [`@${profile.username}`, profile.city].filter(Boolean).join(' · ') }),
      profile.bio && el('p', { class: 'profile-bio', text: profile.bio })),
    el('div', { class: 'actions' },
      !own && cloud.username && followButton(profile, render),
      el('button', { class: 'btn ghost small', onclick: () => copyProfileLink(profile.username) }, 'Copiar enlace')),
    !own && isFriend(profile.id) && el('p', { class: 'profile-own muted small', text: 'Sois amigos: ves sus mazos y sus partidas aunque su perfil sea privado.' }),
    own && el('p', { class: 'profile-own muted small' },
      profile.is_public ? 'Así ven tu perfil los demás.' : 'Así ven tu perfil los demás: es privado, así que solo se ven los mazos que compartes.'));
}

/** Tú contra esta cuenta, con las partidas de tu historial en las que es tu rival con cuenta. */
function headToHead(profile) {
  const games = store.matches.filter((m) => m.rival === profile.id);
  if (!games.length) return null;
  const r = record(games);
  return el('div', { class: 'head-to-head' },
    el('span', { class: 'muted small', text: `Tú contra ${profile.display_name || profile.username}` }),
    el('strong', { text: recordText(r) }),
    el('span', { class: 'muted small', text: `${rateText(r)} · ${countText(r)}` }));
}

// ---------- Partidas entre vosotros ----------
// Las suyas contra ti que no tienes en tu historial (para apuntártelas) y las tuyas contra él que no
// tiene (para enviárselas otra vez). La base de datos asegura lo importante: solo el rival puede
// guardar la copia de una partida y cada cuenta una sola vez (id fijo e índice único). Lo que parece
// la misma partida apuntada por los dos por separado (sameGame) se aparta para no duplicarla.

let between = null; // { id, state: loading | ready | error, theirs: [partidas suyas, desde su lado] }
const sent = new Set(); // ids reenviados en esta visita

function loadBetween(profile) {
  between = { id: profile.id, state: 'loading', theirs: [] };
  fetchMatchesWith(profile.id).then((theirs) => {
    if (between?.id === profile.id) between = { id: profile.id, state: 'ready', theirs };
  }, (err) => {
    console.error(err);
    if (between?.id === profile.id) between = { id: profile.id, state: 'error', theirs: [] };
  }).then(() => page?.profile?.id === profile.id && render());
}

function betweenRow(m, button, note) {
  return el('li', { class: 'incoming-row' },
    el('span', { class: `match-result ${m.result}`, 'aria-hidden': 'true' }, { win: 'V', loss: 'D', draw: 'E' }[m.result] ?? '?'),
    el('div', { class: 'grow' },
      el('strong', { class: 'small', text: matchLine(m) }),
      note && el('div', { class: 'muted small', text: note }),
      el('div', { class: 'actions' }, button)));
}

function betweenBox(profile) {
  if (!cloud.username || !isFriend(profile.id)) return null;
  if (between?.id !== profile.id) loadBetween(profile);
  if (between.state === 'loading') return null;
  if (between.state === 'error') return el('p', { class: 'muted small', text: 'No se pudieron mirar las partidas entre vosotros.' });
  const name = profile.display_name || profile.username;
  const { theirs } = between;
  const mine = store.matches.filter((m) => m.rival === profile.id);
  const split = (list, isDup) => [list.filter((x) => !isDup(x)), list.filter(isDup)];

  // Suyas contra ti que no tienes: ni su copia ni la original de la que es copia.
  const [forMe, forMeDup] = split(theirs.filter((r) => !store.matches.some((m) => linked(m, r))),
    (r) => mine.some((m) => sameGame(m, r)));
  // Tuyas (originales) contra él que no tiene.
  const [forHim, forHimDup] = split(mine.filter((m) => !m.mirrorOf && !theirs.some((r) => linked(m, r))),
    (m) => theirs.some((r) => sameGame(m, r)));
  if (!forMe.length && !forMeDup.length && !forHim.length && !forHimDup.length) return null;

  const author = { id: profile.id, username: profile.username, display_name: profile.display_name };
  const take = (r) => el('button', { class: 'btn primary small', onclick: () => openMirrored(r, author) }, 'Apuntar en mi historial');
  const send = async (list, btn) => {
    btn.disabled = true;
    try {
      const n = await resendMatches(list.map((m) => m.id), profile.id);
      list.forEach((m) => sent.add(m.id));
      toast(n === list.length
        ? `${n === 1 ? 'Enviada' : `${n} enviadas`}: a ${name} le saldrá el aviso para guardarla${n === 1 ? '' : 's'}`
        : `Enviadas ${n} de ${list.length}: las demás aún no se han subido a la nube. Prueba tras sincronizar.`, 5000);
      render();
    } catch (err) {
      toast(err.message);
      btn.disabled = false;
    }
  };
  const giveBtn = (m) => (sent.has(m.id)
    ? el('span', { class: 'history-done', text: 'Enviada ✓' })
    : el('button', { class: 'btn ghost small', onclick: (e) => send([m], e.currentTarget) }, 'Enviársela'));
  const dupNote = 'Parece la misma que otra que ya está apuntada (menos de 1 h, mismo resultado y Leyendas).';
  const dupBox = (list, row) => list.length > 0 && el('details', { class: 'between-dup' },
    el('summary', { class: 'muted small', text: `${list.length === 1 ? '1 parece' : `${list.length} parecen`} que ya la tenéis · Ver` }),
    el('ul', { class: 'incoming-list' }, ...list.map((x) => row(x, dupNote))));
  const pendingSend = forHim.filter((m) => !sent.has(m.id));

  return el('div', { class: 'between' }, ...[
    el('h3', { class: 'stats-title', text: 'Partidas entre vosotros' }),
    (forMe.length || forMeDup.length) && el('p', { class: 'small', text: `Suyas contra ti que no tienes (${forMe.length})` }),
    forMe.length > 0 && el('ul', { class: 'incoming-list' }, ...forMe.map((r) => betweenRow(flipped(r), take(r)))),
    dupBox(forMeDup, (r, note) => betweenRow(flipped(r), take(r), note)),
    (forHim.length || forHimDup.length) && el('div', { class: 'between-head' },
      el('p', { class: 'small', text: `Tuyas contra ${name} que no tiene (${forHim.length})` }),
      pendingSend.length > 1 && el('button', { class: 'btn ghost small', onclick: (e) => send(pendingSend, e.currentTarget) }, 'Enviar todas')),
    forHim.length > 0 && el('ul', { class: 'incoming-list' }, ...forHim.map((m) => betweenRow(m, giveBtn(m)))),
    dupBox(forHimDup, (m, note) => betweenRow(m, giveBtn(m), note)),
  ].filter(Boolean));
}

function stats(matches) {
  if (!matches.length) return null;
  const all = record(matches);
  const byLegend = groupBy(matches.filter((m) => m.my_legend_id), (m) => canonicalLegend(m.my_legend_id)).slice(0, 5);
  return [
    el('div', { class: 'stats-summary' },
      el('div', { class: 'stats-big' }, el('strong', { text: rateText(all) }), el('span', { class: 'muted small', text: 'victorias' })),
      el('div', { class: 'stats-big' }, el('strong', { text: recordText(all) }), el('span', { class: 'muted small', text: all.draw ? 'V–D–E' : 'V–D' })),
      el('div', { class: 'stats-big' }, el('strong', { text: String(all.matches) }), el('span', { class: 'muted small', text: `${all.matches === 1 ? 'partida' : 'partidas'}${all.games !== all.matches ? ` · ${all.games} juegos` : ''}` }))),
    byLegend.length > 0 && el('h3', { class: 'stats-title', text: 'Leyendas que más juega' }),
    byLegend.length > 0 && el('ul', { class: 'stat-list' },
      ...byLegend.map(([id, r]) => statRow(legendThumb(id), ctx.byId.get(id) ? legendChamp(ctx.byId.get(id)) : 'Leyenda', r))),
  ];
}

function deckRow(deck, matches) {
  const legend = ctx.byId.get(deck.legend);
  const games = matches.filter((m) => m.deck_id === deck.id);
  const r = games.length ? record(games) : null;
  return el('li', { class: 'deck-row', onclick: () => openDeck(deck) },
    legend ? cardImg(legend, 'thumb small') : el('div', { class: 'thumb small placeholder' }, '?'),
    el('div', { class: 'grow' },
      el('strong', { text: deck.name }),
      el('div', { class: 'muted', text: legend ? `${champTag(legend)} · ${legend.domain.map((d) => DOMAIN_ES[d] || d).join(' / ')}` : 'Sin leyenda' }),
      r && el('div', { class: 'deck-record', text: `${recordText(r)}${r.rate == null ? '' : ` · ${rateText(r)}`}` })));
}

function render() {
  const root = $('#profile-view');
  const back = el('button', { class: 'btn ghost small', onclick: () => ctx.showView(cloud.username ? 'decks' : 'scan') }, '← Volver');
  if (page === 'loading') return root.replaceChildren(back, message('Cargando perfil…'));
  if (page?.error) return root.replaceChildren(back, message('No se pudo cargar el perfil.', page.error));
  if (!page) {
    return root.replaceChildren(back, message('No hay ningún perfil con ese nombre que puedas ver.',
      cloud.username ? 'Comprueba el nombre del enlace.' : 'Si es privado, solo lo ven quienes tienen cuenta.'));
  }
  const { profile, decks, matches, collection } = page;
  const copies = collection.reduce((a, r) => a + r.normal + r.foil, 0);
  root.replaceChildren(...[
    el('div', { class: 'section-head' }, back,
      cloud.username && el('button', { class: 'btn ghost small', onclick: openFriends }, 'Buscar jugadores')),
    header(page),
    !page.own && headToHead(profile),
    !page.own && isFriend(profile.id) && tradeBox(profile),
    !page.own && betweenBox(profile),
    ...(stats(matches) ?? []),
    el('h3', { class: 'stats-title', text: decks.length ? `Mazos (${decks.length})` : 'Mazos' }),
    decks.length
      ? el('ul', { class: 'deck-list' }, ...decks.map((d) => deckRow(d, matches)))
      : el('p', { class: 'muted small', text: 'No comparte ningún mazo.' }),
    profile.is_public && collection.length > 0 && el('p', { class: 'muted small profile-collection', text: `Colección: ${copies} cartas (${collection.length} distintas).` }),
    !profile.is_public && !page.friend && !matches.length && el('p', { class: 'muted small', text: 'Perfil privado: sus estadísticas y su colección no se ven.' }),
  ].filter(Boolean));
}

async function load(username) {
  try {
    page = await fetchProfilePage(username);
    if (page) page.friend = isFriend(page.profile.id);
  } catch (err) {
    console.error(err);
    page = { error: err.message };
  }
  render();
}

/** Abre la página del perfil (y, si se pide, uno de sus mazos). */
export async function openProfile(username, deckId = null) {
  ctx.showView('profile');
  between = null; // las partidas entre vosotros se miran otra vez en cada visita
  sent.clear();
  if (page?.profile?.username?.toLowerCase() !== username.toLowerCase()) {
    page = 'loading';
    render();
    await load(username);
  } else if (page?.profile) render();
  if (deckId && page?.decks) {
    const deck = page.decks.find((d) => d.id === deckId);
    if (deck) openDeck(deck);
    else toast('Ese mazo ya no está compartido.');
  }
}

// ---------- Mazo (solo lectura) ----------

function cardGrid(entries) {
  return el('div', { class: 'grid' }, ...entries.map(([c, n]) => el('div', { class: 'tile' },
    el('button', { class: 'tile-img', title: c.name, onclick: () => ctx.openCard(c) },
      cardImg(c), n > 1 && el('span', { class: 'badge', text: `×${n}` })),
    el('div', { class: 'tile-info' }, el('span', { class: 'tile-name', title: c.name, text: c.name })))));
}

function group(bag) {
  return Object.entries(bag ?? {}).map(([id, n]) => [ctx.byId.get(id), n]).filter(([c]) => c)
    .sort((a, b) => (a[0].energy ?? 99) - (b[0].energy ?? 99) || a[0].name.localeCompare(b[0].name));
}

/** ¿Cuánto me falta? Las cartas de este mazo que no tienes en tu colección y lo que costarían. */
function missingBox(deck) {
  const { missing, count, cost } = missingFor(deck);
  if (!count) return el('p', { class: 'ok missing-ok', text: '✓ Tienes todas las cartas de este mazo en tu colección.' });
  return el('details', { class: 'missing' },
    el('summary', { text: `Te faltan ${count} carta${count === 1 ? '' : 's'} de tu colección${cost ? ` (≈ ${eur(cost)} en Cardmarket)` : ''}` }),
    el('ul', {}, missing.map(([c, n]) => el('li', { text: `${n}× ${c.name} (${cardCode(c)})${unitPrice(c.id) != null ? ` · ${eur(unitPrice(c.id) * n)}` : ''}` }))),
    el('div', { class: 'actions' }, wantButton(missing.map(([c, n]) => [c.id, n]))));
}

function openDeck(deck) {
  const dlg = $('#picker-dialog');
  const { byId } = ctx;
  const heads = [byId.get(deck.legend), byId.get(deck.champion)].filter(Boolean).map((c) => [c, 1]);
  const fields = deck.battlefields.map((id) => byId.get(id)).filter(Boolean).map((c) => [c, 1]);
  const section = (title, entries) => entries.length > 0 && [el('h3', { class: 'stats-title', text: title }), cardGrid(entries)];
  const owner = page.profile.username;
  dlg.replaceChildren(...[
    el('div', { class: 'dialog-head' },
      el('h2', { text: deck.name }),
      el('button', { class: 'icon-btn', title: 'Cerrar', 'aria-label': 'Cerrar', onclick: () => dlg.close() }, '✕')),
    el('p', { class: 'muted small', text: `De @${owner}` }),
    !page.own && missingBox(deck),
    el('div', { class: 'actions' },
      !page.own && el('button', {
        class: 'btn primary small',
        onclick: () => {
          ctx.showView('decks');
          if (copyToMyDecks(deck, owner)) { dlg.close(); toast('Mazo copiado a tus mazos'); }
        },
      }, 'Copiar a mis mazos'),
      el('button', { class: 'btn ghost small', onclick: () => copyProfileLink(owner, deck.id) }, 'Copiar enlace del mazo')),
    section('Leyenda y Campeón', heads),
    section(`Principal (${sum(deck.main) + (deck.champion ? 1 : 0)})`, group(deck.main)),
    section(`Runas (${sum(deck.runes)})`, group(deck.runes)),
    section(`Campos de batalla (${fields.length})`, fields),
    section(`Sideboard (${sum(deck.sideboard)})`, group(deck.sideboard)),
  ].flat().filter(Boolean));
  if (!dlg.open) dlg.showModal();
}

// ---------- Arranque ----------

/** Si la dirección es la de un perfil, lo abre. Devuelve true si lo era. */
export function routeProfile() {
  const target = parseProfileHash();
  if (!target) return false;
  openProfile(target.username, target.deckId);
  return true;
}

const showing = () => $('#view-profile').classList.contains('active') && page?.profile;

export function initProfile(context) {
  ctx = context;
  window.addEventListener('hashchange', routeProfile);
  // Al hacerse amigos (o dejar de serlo) cambia lo que se puede ver: se vuelve a pedir.
  onCloudChange(() => {
    if (!showing()) return;
    if (page.friend !== isFriend(page.profile.id)) load(page.profile.username);
    else render();
  });
  // Al apuntarte una de sus partidas desaparece de «Partidas entre vosotros».
  store.onChange((what) => what === 'matches' && showing() && render());
}
