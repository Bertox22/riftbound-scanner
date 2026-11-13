// Colección: los filtros (en el móvil, en una hoja), la cuadrícula de cartas y exportar o importar.

import { store } from './store.js';
import { banInfo } from './bans.js';
import { exportCsv, exportExcel } from './export.js';
import { importBackup } from './backup.js';
import { unitPrice, entryValue, eur, VALUABLE_EUR } from './prices.js';
import { $, el, toast, cardImg, cardCode, download, matchesType, foilBadge, banBadge, DOMAIN_ES, TYPE_ES, RARITY_ES } from './ui.js';

let cards, openCard;

const col = { q: '', set: '', type: '', domain: '', rarity: '', owned: true, errata: false, banned: false, sort: 'set' };

// ---------- Filtros en el móvil ----------
// En pantallas estrechas los filtros no caben en una fila: van en una hoja que se abre con «Filtros (n)»
// y los activos se ven bajo el buscador como etiquetas que se quitan con la ✕. La hoja usa los mismos
// controles (se mueven dentro al abrirla y vuelven al cerrarla), así que no hay nada que sincronizar.
const FILTER_DEFAULTS = { set: '', type: '', domain: '', rarity: '', owned: true, errata: false, banned: false };
const FILTER_CONTROLS = { set: '#col-set', type: '#col-type', domain: '#col-domain', rarity: '#col-rarity', owned: '#col-owned', errata: '#col-errata', banned: '#col-banned' };
let colCount = 0; // cartas que salen con los filtros de ahora (para el botón de la hoja)

/** [clave, texto] de cada filtro que no está como al principio. El orden no cuenta: no quita cartas. */
function activeFilters() {
  const out = ['set', 'type', 'domain', 'rarity'].filter((k) => col[k]).map((k) => [k, $(FILTER_CONTROLS[k]).selectedOptions[0]?.text ?? col[k]]);
  if (!col.owned) out.push(['owned', 'Todas las cartas']);
  if (col.errata) out.push(['errata', 'Con errata']);
  if (col.banned) out.push(['banned', 'Baneadas']);
  return out;
}

function setFilter(key, value) {
  col[key] = value;
  const ctl = $(FILTER_CONTROLS[key]);
  if (ctl.type === 'checkbox') ctl.checked = value;
  else ctl.value = value;
}

function clearFilters() {
  for (const [k, v] of Object.entries(FILTER_DEFAULTS)) setFilter(k, v);
  renderCollection();
}

function renderFilterBar() {
  const active = activeFilters();
  const badge = $('#col-filters-btn .filters-count');
  badge.hidden = !active.length;
  badge.textContent = active.length;
  $('#col-filters-btn').setAttribute('aria-label', active.length ? `Filtros: ${active.length} activos` : 'Filtros');
  $('#col-chips').replaceChildren(...active.map(([key, label]) => el('button', {
    class: 'filter-chip', type: 'button', title: `Quitar «${label}»`, 'aria-label': `Quitar el filtro ${label}`,
    onclick: () => { setFilter(key, FILTER_DEFAULTS[key]); renderCollection(); },
  }, label, el('span', { class: 'x', 'aria-hidden': 'true', text: '✕' }))));
  const dlg = $('#filters-dialog');
  if (!dlg.open) return;
  dlg.querySelector('.filters-apply').textContent = colCount === 1 ? 'Ver 1 carta' : `Ver ${colCount} cartas`;
  dlg.querySelector('.filters-clear').hidden = !active.length;
}

function openFilters() {
  const dlg = $('#filters-dialog');
  dlg.replaceChildren(
    el('div', { class: 'dialog-head' },
      el('h2', { id: 'filters-title', text: 'Filtros' }),
      el('button', { class: 'link filters-clear', type: 'button', onclick: clearFilters }, 'Quitar todos')),
    $('#col-filter-panel'),
    el('button', { class: 'btn primary filters-apply', type: 'button', onclick: () => dlg.close() }),
  );
  dlg.showModal();
  renderFilterBar();
}

const COL_PAGE = 120;
let colLimit = COL_PAGE;
// Cartas que se acaban de quitar del todo con "−": siguen en la cuadrícula (en gris) aunque esté
// "Solo las que tengo", para que no desaparezcan bajo el dedo. Se olvidan al cambiar el filtro.
const justEmptied = new Set();

/** "−" en la cuadrícula: quita una copia (la normal antes que la foil) y deja deshacerlo. */
function removeFromGrid(c, e) {
  const foil = !e?.n && e?.f > 0;
  store.add(c.id, -1, foil, 'colección');
  if (!store.owned(c.id)) justEmptied.add(c.id);
  renderCollection(true);
  toast(store.owned(c.id) ? `Quitada una copia de ${c.name}` : `Quitada: ${c.name}`, 5000, {
    label: 'Deshacer',
    onclick: () => {
      const entry = store.history.find((h) => h.id === c.id && h.foil === foil && !h.undone);
      if (entry) store.undoRemoval(entry, 1); // solo la copia de este "−"
      else store.add(c.id, 1, foil);
      renderCollection(true);
    },
  });
}

/** Desde «Progreso por set»: la colección con todas las cartas de ese set. */
export function showSetInCollection(id) {
  Object.assign(col, { set: id, owned: false });
  $('#col-set').value = id;
  $('#col-owned').checked = false;
  $('#picker-dialog').close();
  renderCollection();
  $('#col-grid').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export function renderCollection(keepLimit = false) {
  if (!keepLimit) { colLimit = COL_PAGE; justEmptied.clear(); }
  const q = col.q.trim().toLowerCase();
  let list = cards.filter((c) =>
    (!col.owned || store.owned(c.id) > 0 || justEmptied.has(c.id)) &&
    (!col.errata || c.errata) &&
    (!col.banned || banInfo(c)) &&
    (!col.set || c.set === col.set) &&
    matchesType(c, col.type) &&
    (!col.domain || c.domain.includes(col.domain)) &&
    (!col.rarity || c.rarity === col.rarity) &&
    (!q || `${c.name} ${c.tags.join(' ')} ${c.text} ${cardCode(c)}`.toLowerCase().includes(q)));
  const sorters = {
    set: (a, b) => 0,
    name: (a, b) => a.name.localeCompare(b.name),
    qty: (a, b) => store.owned(b.id) - store.owned(a.id),
    energy: (a, b) => (a.energy ?? 99) - (b.energy ?? 99) || a.name.localeCompare(b.name),
    price: (a, b) => (unitPrice(b.id) ?? -1) - (unitPrice(a.id) ?? -1),
    value: (a, b) => entryValue(b.id, store.collection[b.id]) - entryValue(a.id, store.collection[a.id]) || (unitPrice(b.id) ?? -1) - (unitPrice(a.id) ?? -1),
  };
  list = [...list].sort(sorters[col.sort]);

  colCount = list.length;
  renderFilterBar();
  const copies = list.reduce((a, c) => a + store.owned(c.id), 0);
  const value = list.reduce((a, c) => a + entryValue(c.id, store.collection[c.id]), 0);
  $('#col-summary').textContent = (col.owned
    ? `${list.length} cartas distintas · ${copies} copias`
    : `${list.length} cartas · tienes ${list.filter((c) => store.owned(c.id)).length}`) + (value ? ` · valor ≈ ${eur(value)}` : '');

  const grid = $('#col-grid');
  grid.replaceChildren(...list.slice(0, colLimit).map((c) => {
    const e = store.collection[c.id];
    const n = e ? e.n + e.f : 0;
    return el('div', { class: `tile ${n ? '' : 'dim'}` },
      el('button', { class: 'tile-img', onclick: () => openCard(c) }, cardImg(c), n > 0 && el('span', { class: 'badge', text: `×${n}` }), foilBadge(e?.f), c.errata && el('span', { class: 'badge errata', title: 'Tiene errata', text: 'Errata' }), banBadge(c)),
      el('div', { class: 'tile-info' },
        el('span', { class: 'tile-name', title: c.name, text: c.name }),
        el('span', { class: 'tile-code muted small', text: cardCode(c) }),
        el('span', { class: `tile-price small ${unitPrice(c.id) >= VALUABLE_EUR ? 'price-hot' : 'muted'}`, text: unitPrice(c.id) != null ? eur(unitPrice(c.id)) : ' ' }),
        el('div', { class: 'tile-qty' },
          el('button', { class: 'icon-btn small', title: 'Quitar una', onclick: () => removeFromGrid(c, e), disabled: !n }, '−'),
          el('span', { class: 'qty', text: n }),
          el('button', { class: 'icon-btn small', title: 'Añadir una', onclick: () => { store.add(c.id, 1); renderCollection(true); } }, '+'),
        ),
      ),
    );
  }));
  if (list.length > colLimit) {
    grid.append(el('button', { class: 'btn ghost more', onclick: () => { colLimit += COL_PAGE; renderCollection(true); } }, `Mostrar más (${list.length - colLimit})`));
  }
  if (!list.length) {
    grid.append(el('p', { class: 'muted', text: col.owned && !store.totalOwned() ? 'Tu colección está vacía. Ve a Escanear para empezar.' : 'No hay cartas con estos filtros.' }));
  }
}

export function initCollection(ctx) {
  ({ cards, openCard } = ctx);
  const { sets } = ctx;
  $('#col-set').append(...sets.map(([id, name]) => el('option', { value: id, text: `${name} (${id})` })));
  // En el orden de TYPE_ES ("Campeón" justo después de "Unidad"); los tipos desconocidos, al final.
  const present = new Set([...cards.map((c) => c.type), 'Champion']);
  const types = [...Object.keys(TYPE_ES).filter((t) => present.has(t)), ...[...present].filter((t) => !(t in TYPE_ES))];
  $('#col-type').append(...types.map((t) => el('option', { value: t, text: TYPE_ES[t] || t })));
  $('#col-domain').append(...Object.entries(DOMAIN_ES).map(([d, es]) => el('option', { value: d, text: es })));
  const rarities = new Set(cards.map((c) => c.rarity));
  $('#col-rarity').append(...[...Object.keys(RARITY_ES).filter((r) => rarities.has(r)), ...[...rarities].filter((r) => !(r in RARITY_ES))]
    .map((r) => el('option', { value: r, text: RARITY_ES[r] || r })));
  for (const [key, sel, ev] of [['q', '#col-search', 'input'], ['set', '#col-set', 'change'], ['type', '#col-type', 'change'], ['domain', '#col-domain', 'change'], ['rarity', '#col-rarity', 'change'], ['sort', '#col-sort', 'change']]) {
    $(sel).addEventListener(ev, (e) => { col[key] = e.target.value; renderCollection(); });
  }
  $('#col-owned').addEventListener('change', (e) => { col.owned = e.target.checked; renderCollection(); });
  $('#col-errata').addEventListener('change', (e) => { col.errata = e.target.checked; renderCollection(); });
  $('#col-banned').addEventListener('change', (e) => { col.banned = e.target.checked; renderCollection(); });

  $('#col-filters-btn').addEventListener('click', openFilters);
  // Al cerrar, los controles vuelven a su sitio (en el ordenador se ven en la página).
  $('#filters-dialog').addEventListener('close', () => $('#view-collection .filters').append($('#col-filter-panel')));
  // Si la ventana se ensancha con la hoja abierta, se cierra: ya caben en la página.
  matchMedia('(min-width: 640px)').addEventListener('change', (e) => { if (e.matches && $('#filters-dialog').open) $('#filters-dialog').close(); });

  $('#btn-export-excel').addEventListener('click', async (e) => {
    if (!store.totalOwned()) return toast('Tu colección está vacía.');
    e.target.disabled = true;
    try {
      await exportExcel(cards, store.collection);
    } catch (err) {
      toast(err.message);
    } finally {
      e.target.disabled = false;
    }
  });
  $('#btn-export-csv').addEventListener('click', () => {
    if (!store.totalOwned()) return toast('Tu colección está vacía.');
    exportCsv(cards, store.collection);
  });
  $('#btn-export-json').addEventListener('click', () => {
    download(`riftbound-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(store.exportData(), null, 1), 'application/json');
  });
  $('#import-json').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = ''; // para poder elegir otra vez el mismo archivo
    if (file) await importBackup(file);
  });
}
