// Hoja "Tu cuenta": entrar o crear cuenta con usuario y contraseña, estado de la sincronización y
// la pregunta de qué hacer la primera vez que una cuenta con datos entra en un dispositivo con datos.

import { $, el, toast } from './ui.js';
import { cloud, onCloudChange, initCloud, signIn, signUp, signOut, syncNow, USERNAME_RE } from './cloud.js';

const dlg = () => $('#account-dialog');
let choice = null; // { local, remote, resolve } mientras se pregunta qué hacer con los datos
let error = '';
let busy = false;
let draft = { username: '', password: '' }; // lo escrito, para no perderlo al repintar con un error

const STATUS = {
  off: 'Sin sesión: los datos solo están en este dispositivo.',
  syncing: 'Sincronizando…',
  pending: 'Hay cambios por subir…',
  offline: 'Sin conexión: los cambios se subirán al volver.',
};

function statusText() {
  if (cloud.state === 'idle') {
    const t = cloud.lastSync?.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    return `Todo sincronizado${t ? ` (${t})` : ''}.`;
  }
  if (cloud.state === 'error') return `No se pudo sincronizar: ${cloud.error}`;
  return cloud.error && cloud.state === 'pending' ? cloud.error : STATUS[cloud.state];
}

function head(title) {
  return el('div', { class: 'dialog-head' },
    el('h2', { text: title }),
    el('button', { class: 'icon-btn', title: 'Cerrar', 'aria-label': 'Cerrar', onclick: () => dlg().close() }, '✕'));
}

async function submit(form, mode) {
  const username = form.username.value.trim();
  const password = form.password.value;
  draft = { username, password };
  error = '';
  if (!USERNAME_RE.test(username)) error = 'El usuario debe tener de 3 a 20 letras, números o _ (sin espacios ni tildes).';
  else if (password.length < 6) error = 'La contraseña debe tener al menos 6 caracteres.';
  if (error) return render();
  busy = true;
  render();
  try {
    await (mode === 'up' ? signUp(username, password) : signIn(username, password));
    draft = { username: '', password: '' };
    toast(mode === 'up' ? `Cuenta creada: ${username}` : `Hola, ${username}`);
  } catch (err) {
    error = err.message;
  } finally {
    busy = false;
    render();
  }
}

function signedOutView() {
  const form = el('form', { class: 'account-form', onsubmit: (e) => { e.preventDefault(); submit(form, 'in'); } },
    el('label', {},
      el('span', { text: 'Usuario' }),
      el('input', { name: 'username', value: draft.username, autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', required: true, maxlength: 20, 'aria-describedby': 'account-hint' })),
    el('label', {},
      el('span', { text: 'Contraseña' }),
      el('input', { name: 'password', value: draft.password, type: 'password', autocomplete: 'current-password', required: true, minlength: 6 })),
    el('p', { id: 'account-hint', class: 'muted small', text: 'Usuario de 3 a 20 letras, números o _. Contraseña de 6 caracteres o más. Guárdala bien: no se puede recuperar por correo.' }),
    error && el('p', { class: 'form-error', role: 'alert', text: error }),
    el('div', { class: 'actions' },
      el('button', { class: 'btn primary', type: 'submit', disabled: busy }, busy ? 'Un momento…' : 'Entrar'),
      el('button', { class: 'btn ghost', type: 'button', disabled: busy, onclick: () => submit(form, 'up') }, 'Crear cuenta')),
  );
  return [
    el('p', { text: 'Con una cuenta, tu colección y tus mazos se guardan en la nube y aparecen en todos tus dispositivos.' }),
    form,
  ];
}

function signedInView() {
  return [
    el('p', {}, 'Conectado como ', el('strong', { text: cloud.username })),
    el('p', { class: `sync-status ${cloud.state}`, role: 'status', text: statusText() }),
    el('p', { class: 'muted small', text: 'Tu colección y tus mazos se sincronizan solos en todos los dispositivos donde entres. Si sales, se quedan también en este.' }),
    el('div', { class: 'actions' },
      el('button', { class: 'btn ghost small', disabled: cloud.state === 'syncing', onclick: () => syncNow() }, 'Sincronizar ahora'),
      el('button', { class: 'btn danger small', onclick: async () => { await signOut(); toast('Sesión cerrada'); } }, 'Salir')),
  ];
}

function choiceView() {
  const { local, remote } = choice;
  const what = ({ cards, decks }) => `${cards} carta${cards === 1 ? '' : 's'} y ${decks} mazo${decks === 1 ? '' : 's'}`;
  const option = (key, label, hint) => el('button', { class: 'export-option', onclick: () => answer(key) },
    el('strong', { text: label }), el('span', { class: 'muted small', text: hint }));
  return [
    el('p', { text: 'Este dispositivo y tu cuenta tienen datos distintos. ¿Qué hacemos?' }),
    el('p', { class: 'muted small', text: `Aquí: ${what(local)}. En tu cuenta: ${what(remote)}.` }),
    el('div', { class: 'export-options' },
      option('merge', 'Juntar las dos', 'Suma las copias de cada carta y conserva todos los mazos.'),
      option('cloud', 'Quedarme con lo de la cuenta', 'Este dispositivo pasa a tener lo mismo que tu cuenta.'),
      option('device', 'Subir lo de este dispositivo', 'Tu cuenta pasa a tener lo mismo que este dispositivo.')),
  ];
}

function answer(key) {
  const { resolve } = choice;
  choice = null;
  resolve(key);
  render();
}

function render() {
  const d = dlg();
  if (choice) d.replaceChildren(head('Juntar datos'), ...choiceView());
  else d.replaceChildren(head('Tu cuenta'), ...(cloud.username ? signedInView() : signedOutView()));
}

function open() {
  error = '';
  render();
  if (!dlg().open) dlg().showModal();
}

export function initAccount() {
  const btn = $('#btn-account');
  btn.addEventListener('click', open);
  // Si se cierra la pregunta sin contestar, se vuelve a preguntar en la próxima sincronización.
  dlg().addEventListener('close', () => {
    draft.password = ''; // la contraseña no se queda guardada al cerrar
    if (choice) { const { resolve } = choice; choice = null; resolve(null); }
  });
  onCloudChange(() => {
    btn.dataset.state = cloud.state;
    btn.title = cloud.username ? `Cuenta: ${cloud.username}` : 'Cuenta';
    if (dlg().open) render();
  });
  initCloud({
    ask: (counts) => new Promise((resolve) => {
      choice = { ...counts, resolve };
      render();
      if (!dlg().open) dlg().showModal();
    }),
  });
}
