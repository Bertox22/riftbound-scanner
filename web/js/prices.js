// Precios de las cartas (web/data/prices.json, actualizado cada noche).
// Cada entrada: [eur, eurFoil, usd, usdFoil, soloFoil, eur7d] — Cardmarket en euros y TCGplayer en dólares.

export const VALUABLE_EUR = 5; // a partir de aquí se avisa al escanear: "¡carta valiosa!"

let data = { updated: null, prices: {} };

export async function loadPrices() {
  try {
    data = await (await fetch('data/prices.json', { cache: 'no-cache' })).json();
  } catch {
    data = { updated: null, prices: {} }; // sin precios la app funciona igual
  }
  return data;
}

export const pricesDate = () => data.updated;

export function priceInfo(id) {
  const p = data.prices[id];
  if (!p) return null;
  const [eur, eurFoil, usd, usdFoil, foilOnly, eur7d] = p;
  return { eur, eurFoil, usd, usdFoil, foilOnly: !!foilOnly, eur7d };
}

/** Precio en euros de una copia. Las versiones que solo existen en foil valen siempre como foil. */
export function unitPrice(id, foil = false) {
  const p = priceInfo(id);
  if (!p) return null;
  if (foil || p.foilOnly) return p.eurFoil ?? p.eur;
  return p.eur ?? p.eurFoil;
}

/** Valor en euros de las copias que tienes ({ n, f }). */
export function entryValue(id, entry) {
  if (!entry) return 0;
  return (unitPrice(id, false) ?? 0) * entry.n + (unitPrice(id, true) ?? 0) * entry.f;
}

const EUR = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });
const USD = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'USD' });

export function eur(v) {
  return v == null ? '—' : EUR.format(v);
}

export function usd(v) {
  return v == null ? '—' : USD.format(v);
}
