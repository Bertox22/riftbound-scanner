// Hoja "Tu cuenta": entrar con correo y contraseña, crear cuenta (usuario + correo que hay que
// confirmar), recuperar la contraseña, estado de la sincronización y la pregunta de qué hacer la
// primera vez que una cuenta con datos entra en un dispositivo con datos.

import { $, el, toast } from './ui.js';
import { cloud, onCloudChange, initCloud, signIn, signUp, signOut, syncNow, resetPassword, updatePassword, loadProfile, saveProfile, USERNAME_RE, EMAIL_RE } from './cloud.js';

const dlg = () => $('#account-dialog');
let choice = null; // { local, remote, resolve } mientras se pregunta qué hacer con los datos
let error = '';
let busy = false;
let mode = 'in'; // in (entrar) · up (crear cuenta) · forgot (recuperar) · sent (correo enviado) · recovery (nueva contraseña)
let sentTo = '';
let draft = { id: '', username: '', email: '', password: '' }; // lo escrito, para no perderlo al repintar
let editing = null; // borrador del perfil mientras se edita

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

/** Ejecuta una acción del formulario mostrando "Un momento…" y el error, si lo hay. */
async function run(action) {
  error = '';
  busy = true;
  render();
  try {
    await action();
  } catch (err) {
    error = err.message;
  } finally {
    busy = false;
    render();
  }
}

const field = (label, attrs) => el('label', {}, el('span', { text: label }), el('input', attrs));
const errorBox = () => error && el('p', { class: 'form-error', role: 'alert', text: error });
const link = (text, to) => el('button', { class: 'link small', type: 'button', disabled: busy, onclick: () => { mode = to; error = ''; render(); } }, text);

function form(onsubmit, ...children) {
  const f = el('form', { class: 'account-form', onsubmit: (e) => { e.preventDefault(); onsubmit(f); } }, ...children);
  return f;
}

function signInView() {
  return [
    el('p', { text: 'Con una cuenta, tu colección y tus mazos se guardan en la nube y aparecen en todos tus dispositivos.' }),
    form((f) => {
      draft.id = f.login.value.trim();
      draft.password = f.password.value;
      run(async () => {
        await signIn(draft.id, draft.password);
        draft.password = '';
        toast('Sesión iniciada');
      });
    },
    field('Correo', { name: 'login', value: draft.id, inputmode: 'email', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', required: true, 'aria-describedby': 'account-hint' }),
    field('Contraseña', { name: 'password', value: draft.password, type: 'password', autocomplete: 'current-password', required: true }),
    el('p', { id: 'account-hint', class: 'muted small', text: 'Si tu cuenta es de antes de pedir correo, entra con tu usuario.' }),
    errorBox(),
    el('div', { class: 'actions' },
      el('button', { class: 'btn primary', type: 'submit', disabled: busy }, busy ? 'Un momento…' : 'Entrar'),
      el('button', { class: 'btn ghost', type: 'button', disabled: busy, onclick: () => { mode = 'up'; error = ''; render(); } }, 'Crear cuenta')),
    el('p', { class: 'account-links' }, link('¿Has olvidado la contraseña?', 'forgot'))),
  ];
}

function signUpView() {
  return [
    el('p', { text: 'Te enviaremos un correo para confirmar la cuenta. El usuario es el nombre que verán los demás.' }),
    form((f) => {
      draft.username = f.username.value.trim();
      draft.email = f.email.value.trim();
      draft.password = f.password.value;
      if (!USERNAME_RE.test(draft.username)) { error = 'El usuario debe tener de 3 a 20 letras, números o _ (sin espacios ni tildes).'; return render(); }
      if (!EMAIL_RE.test(draft.email)) { error = 'Ese correo no es válido.'; return render(); }
      if (draft.password.length < 6) { error = 'La contraseña debe tener al menos 6 caracteres.'; return render(); }
      run(async () => {
        const inside = await signUp(draft.username, draft.email, draft.password);
        draft.password = '';
        if (inside) toast(`Cuenta creada: ${draft.username}`);
        else { sentTo = draft.email; mode = 'sent'; }
      });
    },
    field('Usuario', { name: 'username', value: draft.username, autocomplete: 'nickname', autocapitalize: 'none', spellcheck: 'false', required: true, maxlength: 20, 'aria-describedby': 'signup-hint' }),
    field('Correo', { name: 'email', value: draft.email, type: 'email', autocomplete: 'email', required: true }),
    field('Contraseña', { name: 'password', value: draft.password, type: 'password', autocomplete: 'new-password', required: true, minlength: 6, 'aria-describedby': 'signup-hint' }),
    el('p', { id: 'signup-hint', class: 'muted small', text: 'Usuario de 3 a 20 letras, números o _. Contraseña de 6 caracteres o más.' }),
    errorBox(),
    el('div', { class: 'actions' },
      el('button', { class: 'btn primary', type: 'submit', disabled: busy }, busy ? 'Un momento…' : 'Crear cuenta')),
    el('p', { class: 'account-links' }, link('Ya tengo cuenta', 'in'))),
  ];
}

function forgotView() {
  return [
    el('p', { text: 'Escribe el correo de tu cuenta y te enviaremos un enlace para poner una contraseña nueva.' }),
    form((f) => {
      draft.email = f.email.value.trim();
      run(async () => {
        await resetPassword(draft.email);
        sentTo = draft.email;
        mode = 'sent';
      });
    },
    field('Correo', { name: 'email', value: draft.email || (draft.id.includes('@') ? draft.id : ''), type: 'email', autocomplete: 'email', required: true }),
    errorBox(),
    el('div', { class: 'actions' },
      el('button', { class: 'btn primary', type: 'submit', disabled: busy }, busy ? 'Un momento…' : 'Enviar enlace')),
    el('p', { class: 'account-links' }, link('Volver', 'in'))),
  ];
}

function sentView() {
  return [
    el('p', {}, 'Te hemos enviado un correo a ', el('strong', { text: sentTo }), '. Ábrelo y pulsa el enlace: volverás aquí con la sesión iniciada.'),
    el('p', { class: 'muted small', text: 'Si no lo ves en unos minutos, mira en la carpeta de spam.' }),
    el('div', { class: 'actions' }, el('button', { class: 'btn ghost', onclick: () => { mode = 'in'; render(); } }, 'Entendido')),
  ];
}

function recoveryView() {
  return [
    el('p', { text: 'Escribe tu contraseña nueva.' }),
    form((f) => {
      const password = f.password.value;
      run(async () => {
        await updatePassword(password);
        mode = 'in';
        toast('Contraseña cambiada');
      });
    },
    field('Contraseña nueva', { name: 'password', type: 'password', autocomplete: 'new-password', required: true, minlength: 6 }),
    errorBox(),
    el('div', { class: 'actions' },
      el('button', { class: 'btn primary', type: 'submit', disabled: busy }, busy ? 'Un momento…' : 'Guardar'))),
  ];
}

const SIGNED_OUT = { in: ['Tu cuenta', signInView], up: ['Crear cuenta', signUpView], forgot: ['Recuperar contraseña', forgotView], sent: ['Revisa tu correo', sentView] };

/** Perfil: nombre visible, ciudad, bio y si lo pueden ver otros. */
function profileView() {
  const p = cloud.profile;
  if (!p) return el('p', { class: 'muted small', text: 'Cargando tu perfil…' });
  if (!editing) {
    return el('div', { class: 'profile-box' },
      el('div', { class: 'profile-top' },
        el('div', { class: 'grow' },
          el('strong', { text: p.display_name || p.username }),
          el('div', { class: 'muted small', text: [`@${p.username}`, p.city].filter(Boolean).join(' · ') })),
        el('span', { class: `profile-badge${p.is_public ? ' on' : ''}`, text: p.is_public ? 'Público' : 'Privado' })),
      p.bio && el('p', { class: 'profile-bio', text: p.bio }),
      el('button', { class: 'btn ghost small', type: 'button', onclick: () => { editing = { ...p }; error = ''; render(); } }, 'Editar perfil'));
  }
  // Lo escrito se guarda en el borrador al momento: la hoja se repinta cuando cambia la sincronización.
  const read = (f) => ({ display_name: f.display_name.value, city: f.city.value, bio: f.bio.value, is_public: f.is_public.checked });
  const f = form((f) => {
    editing = read(f);
    run(async () => {
      await saveProfile(editing);
      editing = null;
      toast('Perfil guardado');
    });
  },
  field('Nombre visible', { name: 'display_name', value: editing.display_name ?? '', maxlength: 40, autocomplete: 'off', placeholder: cloud.profile.username }),
  field('Ciudad', { name: 'city', value: editing.city ?? '', maxlength: 60, autocomplete: 'address-level2', placeholder: 'Para quedar a jugar o cambiar cartas' }),
  el('label', {}, el('span', { text: 'Sobre ti' }), el('textarea', { name: 'bio', rows: 3, maxlength: 280, placeholder: 'Qué juegas, dónde sueles jugar…' }, editing.bio ?? '')),
  el('label', { class: 'toggle' },
    el('input', { type: 'checkbox', name: 'is_public', checked: !!editing.is_public }),
    el('span', { text: 'Perfil público' })),
  el('p', { class: 'muted small', text: 'Con el perfil público, cualquiera con tu enlace ve tu colección, tus mazos y tus estadísticas de partidas. Sin él, solo los mazos que compartas uno a uno.' }),
  errorBox(),
  el('div', { class: 'actions' },
    el('button', { class: 'btn primary small', type: 'submit', disabled: busy }, busy ? 'Un momento…' : 'Guardar'),
    el('button', { class: 'btn ghost small', type: 'button', disabled: busy, onclick: () => { editing = null; error = ''; render(); } }, 'Cancelar')));
  f.addEventListener('input', () => { editing = read(f); });
  return f;
}

function signedInView() {
  return [
    el('h3', { class: 'account-section first', text: 'Tu perfil' }),
    profileView(),
    el('h3', { class: 'account-section', text: 'Sincronización' }),
    el('p', { class: `sync-status ${cloud.state}`, role: 'status', text: statusText() }),
    el('p', { class: 'muted small', text: 'Tu colección y tus mazos se sincronizan solos en todos los dispositivos donde entres. Si sales, se quedan también en este.' }),
    el('div', { class: 'actions' },
      el('button', { class: 'btn ghost small', disabled: cloud.state === 'syncing', onclick: () => syncNow() }, 'Sincronizar ahora'),
      el('button', { class: 'btn danger small', onclick: async () => { await signOut(); toast('Sesión cerrada'); } }, 'Salir')),
  ];
}

function choiceView() {
  const { local, remote } = choice;
  const what = ({ cards, decks, matches }) => `${cards} carta${cards === 1 ? '' : 's'}, ${decks} mazo${decks === 1 ? '' : 's'} y ${matches} partida${matches === 1 ? '' : 's'}`;
  const option = (key, label, hint) => el('button', { class: 'export-option', onclick: () => answer(key) },
    el('strong', { text: label }), el('span', { class: 'muted small', text: hint }));
  return [
    el('p', { text: 'Este dispositivo y tu cuenta tienen datos distintos. ¿Qué hacemos?' }),
    el('p', { class: 'muted small', text: `Aquí: ${what(local)}. En tu cuenta: ${what(remote)}.` }),
    el('div', { class: 'export-options' },
      option('merge', 'Juntar las dos', 'Suma las copias de cada carta y conserva todos los mazos y partidas.'),
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
  else if (mode === 'recovery') d.replaceChildren(head('Contraseña nueva'), ...recoveryView());
  else if (cloud.username) d.replaceChildren(head('Tu cuenta'), ...signedInView().filter(Boolean));
  else {
    const [title, view] = SIGNED_OUT[mode] ?? SIGNED_OUT.in;
    d.replaceChildren(head(title), ...view());
  }
}

function open() {
  error = '';
  if (mode === 'sent' || (cloud.username && mode !== 'recovery')) mode = 'in';
  editing = null;
  if (cloud.username && !cloud.profile) loadProfile().catch((err) => console.error(err));
  render();
  if (!dlg().open) dlg().showModal();
}

export function initAccount() {
  const btn = $('#btn-account');
  btn.addEventListener('click', open);
  // Si se cierra la pregunta sin contestar, se vuelve a preguntar en la próxima sincronización.
  dlg().addEventListener('close', () => {
    draft.password = ''; // la contraseña no se queda guardada al cerrar
    if (mode === 'recovery') mode = 'in';
    if (choice) { const { resolve } = choice; choice = null; resolve(null); }
  });
  onCloudChange(() => {
    btn.dataset.state = cloud.state;
    btn.title = cloud.username ? `Cuenta: ${cloud.username}` : 'Cuenta';
    if (dlg().open) render();
  });
  initCloud({
    // Se ha abierto el enlace de "nueva contraseña": se pide la nueva.
    recovery: () => {
      mode = 'recovery';
      error = '';
      render();
      if (!dlg().open) dlg().showModal();
    },
    ask: (counts) => new Promise((resolve) => {
      choice = { ...counts, resolve };
      render();
      if (!dlg().open) dlg().showModal();
    }),
  });
}
