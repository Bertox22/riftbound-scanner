// Amigos: buscar jugadores, seguirlos y la lista de a quién sigues y quién te sigue. Dos cuentas que
// se siguen mutuamente son amigas: ven los mazos y las partidas del otro y pueden apuntarse
// partidas el uno contra el otro (partida espejo).

import { el, toast } from './ui.js';
import { cloud, searchProfiles, loadPeople, follow, unfollow } from './cloud.js';

let q = '';
let results = null; // null: sin buscar · []: sin resultados
let searchTimer = null;
let searching = false;
let busyId = null; // la cuenta que se está siguiendo o dejando de seguir

const personOf = (id) => cloud.people?.find((p) => p.id === id);
const shownName = (p) => p.display_name || p.username;

/** Botón Seguir / Siguiendo / Amigos de una cuenta. onDone se llama al cambiar. */
export function followButton(target, onDone) {
  const p = personOf(target.id);
  const label = p?.friend ? 'Amigos ✓' : p?.following ? 'Siguiendo' : p?.follower ? 'Seguir también' : 'Seguir';
  const on = p?.following;
  return el('button', {
    class: `btn ${on ? 'ghost' : 'primary'} small follow-btn`, type: 'button', disabled: busyId === target.id,
    title: on ? 'Dejar de seguir' : `Seguir a ${target.username}`,
    onclick: async (e) => {
      e.stopPropagation();
      if (on && !confirm(`¿Dejar de seguir a ${target.username}?${p.friend ? ' Dejaréis de ser amigos.' : ''}`)) return;
      busyId = target.id;
      onDone?.();
      try {
        if (on) await unfollow(target.id);
        else {
          await follow(target.id);
          toast(personOf(target.id)?.friend ? `Ahora ${target.username} y tú sois amigos` : `Sigues a ${target.username}`);
        }
      } catch (err) {
        toast(err.message, 3500);
      } finally {
        busyId = null;
        onDone?.();
      }
    },
  }, label);
}

function personRow(p, rerender, close) {
  const sub = p.friend ? 'Amigos' : p.following ? 'Le sigues (aún no te sigue)' : p.follower ? 'Te sigue' : `@${p.username}`;
  return el('li', { class: 'person-row' },
    el('button', { class: 'person-open', type: 'button', title: `Ver el perfil de ${p.username}`, onclick: () => { close(); location.hash = `@${p.username}`; } },
      el('span', { class: 'person-avatar', 'aria-hidden': 'true', text: shownName(p)[0].toUpperCase() }),
      el('span', { class: 'grow' },
        el('strong', { text: shownName(p) }),
        el('span', { class: 'muted small', text: p.display_name ? `@${p.username} · ${sub}` : sub }))),
    followButton(p, rerender));
}

/** Contenido del panel de amigos dentro de la hoja de cuenta. */
export function friendsView({ rerender, close }) {
  if (cloud.people == null) loadPeople().catch((err) => toast(err.message));
  const people = cloud.people ?? [];
  const friends = people.filter((p) => p.friend);
  const following = people.filter((p) => p.following && !p.friend);
  const followers = people.filter((p) => p.follower && !p.friend);

  const search = el('input', {
    type: 'search', name: 'friend-search', value: q, placeholder: 'Buscar por usuario o nombre…', 'aria-label': 'Buscar jugadores',
    autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false',
    oninput: (e) => {
      q = e.target.value;
      clearTimeout(searchTimer);
      if (q.trim().length < 2) { results = null; return rerender(); }
      searchTimer = setTimeout(async () => {
        searching = true;
        rerender();
        try {
          results = await searchProfiles(q);
        } catch (err) {
          results = [];
          toast(err.message);
        } finally {
          searching = false;
          rerender();
        }
      }, 300);
    },
  });

  const list = (title, ps, empty) => [
    el('h3', { class: 'account-section', text: ps.length ? `${title} (${ps.length})` : title }),
    ps.length ? el('ul', { class: 'person-list' }, ...ps.map((p) => personRow(p, rerender, close))) : empty && el('p', { class: 'muted small', text: empty }),
  ];

  return [
    el('p', { class: 'muted small', text: 'Si os seguís los dos sois amigos: veis los mazos y las partidas del otro (aunque el perfil sea privado) y podéis apuntar partidas el uno contra el otro.' }),
    el('div', { class: 'friend-search' }, search),
    results != null && el('ul', { class: 'person-list search-results' },
      ...(searching && !results.length ? [el('li', { class: 'muted small', text: 'Buscando…' })]
        : results.length ? results.map((p) => personRow({ ...p, ...personOf(p.id) }, rerender, close))
          : [el('li', { class: 'muted small', text: 'Nadie con ese nombre.' })])),
    ...list('Amigos', friends, cloud.people ? 'Aún no tienes amigos. Busca a alguien y síguelo; cuando te siga, seréis amigos.' : 'Cargando…'),
    ...(followers.length ? list('Te siguen', followers) : []),
    ...(following.length ? list('Sigues', following) : []),
  ].flat().filter(Boolean);
}
