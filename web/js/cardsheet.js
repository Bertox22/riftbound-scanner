// Ficha de una carta: datos y texto, precio en Cardmarket con su gráfica, copias normales y foil,
// intercambios y las otras versiones (mismo nombre o misma ilustración).

import { store } from './store.js';
import { tradeBlock } from './trades.js';
import { readableText } from './export.js';
import { banInfo } from './bans.js';
import { loadHistory, cardSeries, rangeStart, lineChart, dayText, changeText } from './pricehistory.js';
import { pricesDate, priceInfo, unitPrice, eur, usd, VALUABLE_EUR } from './prices.js';
import { $, el, cardImg, cardCode, baseName, qtyRow, DOMAIN_ES, TYPE_ES, RARITY_ES } from './ui.js';

let cards, byId, recognizer; // recognizer: para saber qué versiones comparten ilustración

export function initCardSheet(ctx) {
  ({ cards, byId, recognizer } = ctx);
}

/** Otras impresiones de la misma carta: mismo nombre o misma ilustración. */
export function variantsOf(card) {
  const ids = new Set(recognizer.meta ? recognizer.sameArt(card.id) : [card.id]);
  for (const c of cards) if (baseName(c) === baseName(card)) ids.add(c.id);
  return [...ids].map((id) => byId.get(id));
}

/**
 * Versión mucho más cara con la misma ilustración (p. ej. la Showcase firmada "*"): la cámara no
 * las distingue, así que conviene avisar para que se mire la carta.
 */
export function pricierTwin(card) {
  if (!recognizer.meta) return null;
  const base = unitPrice(card.id) ?? 0;
  let best = null;
  for (const id of recognizer.sameArt(card.id)) {
    const p = unitPrice(id);
    if (id !== card.id && p >= VALUABLE_EUR && p > base * 3 && (!best || p > best.price)) best = { card: byId.get(id), price: p };
  }
  return best;
}

function priceBlock(card) {
  const p = priceInfo(card.id);
  const twin = pricierTwin(card);
  if (!p && !twin) return null;
  const trend = p?.eur7d ? ` (${p.eur7d > 0 ? '▲' : '▼'} ${eur(Math.abs(p.eur7d))} en 7 días)` : '';
  return el('div', { class: 'price-block' },
    p && el('p', {},
      el('strong', { text: 'Cardmarket: ' }),
      p.foilOnly ? `${eur(p.eurFoil ?? p.eur)} (solo existe en foil)` : `normal ${eur(p.eur)} · foil ${eur(p.eurFoil)}${trend}`),
    p && (p.usd || p.usdFoil) && el('p', { class: 'muted small', text: `TCGplayer: normal ${usd(p.usd)} · foil ${usd(p.usdFoil)}` }),
    twin && el('p', { class: 'warn small', text: `💰 Hay una versión con la misma ilustración que vale ${eur(twin.price)}: ${twin.card.name} (${cardCode(twin.card)}${twin.card.id.includes('*') ? ', firmada' : ''}). Mira si la tuya es esa.` }),
    el('p', { class: 'muted small' },
      el('a', {
        href: card.cardmarket
          ? `https://www.cardmarket.com/en/Riftbound/Products/Singles/${card.cardmarket}`
          : `https://www.cardmarket.com/en/Riftbound/Products/Search?searchString=${encodeURIComponent(baseName(card))}`,
        target: '_blank', rel: 'noopener',
      }, card.cardmarket ? 'Ver en Cardmarket' : 'Buscar en Cardmarket'),
      pricesDate() && ` · precios del ${new Date(pricesDate()).toLocaleDateString('es-ES')}`),
    p && priceChart(card),
  );
}

/** En la ficha: cómo ha ido el precio normal en Cardmarket (se rellena al llegar el historial). */
function priceChart(card) {
  const box = el('div', { class: 'card-chart' });
  loadHistory().then((h) => {
    const s = h && cardSeries(h, card.id);
    if (!s || s.length < 2) return;
    const start = rangeStart(h, 30);
    const label = el('span', { class: 'muted small' });
    const idle = () => { label.textContent = `${start > 0 ? '30 días' : `Desde el ${dayText(h.dates[0])}`}: ${changeText(s[start], s.at(-1))}`; };
    idle();
    box.replaceChildren(
      el('div', { class: 'card-chart-head' }, el('strong', { class: 'small', text: priceInfo(card.id)?.foilOnly ? 'Precio (solo foil)' : 'Precio normal' }), label),
      lineChart(h.dates, s, { height: 56, onPoint: (i) => (i == null ? idle() : (label.textContent = `${dayText(h.dates[i])} · ${eur(s[i])}`)) }));
  });
  return box;
}

export function openCard(card) {
  const dlg = $('#card-dialog');
  const render = () => {
    const e = store.collection[card.id] || { n: 0, f: 0 };
    const variants = variantsOf(card).filter((c) => c.id !== card.id);
    const stats = [
      card.energy != null && `Coste ${card.energy}`,
      card.power != null && `Poder ${card.power}`,
      card.might != null && `Fuerza ${card.might}`,
    ].filter(Boolean).join(' · ');
    dlg.replaceChildren(
      el('div', { class: 'dialog-head' }, el('h2', { text: card.name }), el('button', { class: 'icon-btn', onclick: () => dlg.close() }, '✕')),
      el('div', { class: 'card-detail' },
        el('img', { class: 'card-full', src: card.image, alt: card.name, dataset: { orient: card.orientation } }),
        el('div', {},
          el('p', { class: 'muted', text: `${card.setName} · ${cardCode(card)} · ${RARITY_ES[card.rarity] || card.rarity}` }),
          el('p', { text: [TYPE_ES[card.type] || card.type, card.supertype].filter(Boolean).join(' · ') + (card.domain.length ? ` · ${card.domain.map((d) => DOMAIN_ES[d] || d).join(' / ')}` : '') }),
          stats && el('p', { text: stats }),
          card.tags.length > 0 && el('p', { class: 'muted', text: card.tags.join(', ') }),
          banInfo(card) && el('p', { class: 'ban-note', text: banInfo(card).text }),
          card.errata && el('p', { class: 'errata-note', text: '⚠ Errata: el texto oficial vigente difiere del impreso en la carta.' }),
          card.text && el('p', { class: 'card-text', text: readableText(card.text) }),
          card.printedText && el('details', { class: 'printed' }, el('summary', { text: 'Texto impreso (antiguo)' }), el('p', { class: 'card-text muted', text: readableText(card.printedText) })),
          (card.effect || card.mightBonus != null) && el('p', { class: 'card-text', text: `Unidad equipada: ${[readableText(card.effect), card.mightBonus != null ? `${card.mightBonus >= 0 ? '+' : ''}${card.mightBonus} Might` : ''].filter(Boolean).join(' · ')}` }),
          priceBlock(card),
          qtyRow('Normales', e.n, (d) => { store.add(card.id, d, false, 'ficha'); render(); }),
          qtyRow('Foil', e.f, (d) => { store.add(card.id, d, true, 'ficha'); render(); }),
          tradeBlock(card, render),
          variants.length > 0 && el('div', {},
            el('h3', { text: 'Otras versiones' }),
            el('div', { class: 'variants' }, variants.map((v) => el('button', { class: 'variant', onclick: () => { card = v; render(); } },
              cardImg(v, 'thumb small'), el('span', { class: 'small', text: `${cardCode(v)}${store.owned(v.id) ? ` · ${store.owned(v.id)}` : ''}` })))),
          ),
        ),
      ),
    );
  };
  render();
  if (!dlg.open) dlg.showModal();
}
