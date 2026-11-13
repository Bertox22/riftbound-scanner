// Cartas y campos de batalla baneados en Constructed (Standard y 2v2), lista global de Riot.
// Se mantiene a mano: al salir un anuncio nuevo, añadir aquí las cartas con su fecha.
// Fuentes: https://playriftbound.com/en-us/news/announcements/radiance-ban-list-updates-effective-november-23-2026/
// (Radiance) y, para los anteriores, https://senseos.gg/wiki/riftbound/ban-list/.
// El nombre va como en la base de cartas («Campeón - Título»); vale para todas sus versiones.

const BANS = [
  // 31 de marzo de 2026
  ['Called Shot', '2026-03-31'],
  ['Draven - Vanquisher', '2026-03-31'],
  ['Fight or Flight', '2026-03-31'],
  ['Scrapheap', '2026-03-31'],
  ['The Dreaming Tree', '2026-03-31'],
  ['Obelisk of Power', '2026-03-31'],
  ["Reaver's Row", '2026-03-31'],
  // 24 de julio de 2026
  ['Stealthy Pursuer', '2026-07-24'],
  ["The Arena's Greatest", '2026-07-24'],
  ["Aspirant's Climb", '2026-07-24'],
  ['Master Yi - Wuju Bladesman', '2026-07-24', '2v2'], // solo en 2v2
  // 18 de septiembre de 2026
  ['Ekko - Recurrent', '2026-09-18'],
  ['Stacked Deck', '2026-09-18'],
  // Radiance: 23 de noviembre de 2026
  ['Riven - Broken Blade', '2026-11-23'],
  ["Zhonya's Hourglass", '2026-11-23'],
  ['Stellacorn Herder', '2026-11-23'],
  ['Nocturne - Horrifying', '2026-11-23'],
  ['Rhasa the Sunderer', '2026-11-23'],
  ['Brynhir Thundersong', '2026-11-23'],
  ['Dazzling Aurora', '2026-11-23'],
  ['Baited Hook', '2026-11-23'],
  ["Emperor's Dais", '2026-11-23'],
  ['Star Spring', '2026-11-23'],
];

/** Nombre comparable: sin «(Metal)», «(Signature)»…, sin « - Starter» y con apóstrofos rectos. */
const key = (name) => name
  .replace(/\s*\([^)]*\)\s*$/, '')
  .replace(/\s*-\s*Starter$/i, '')
  .replace(/[’‘]/g, "'")
  .trim().toLowerCase();

const byName = new Map(BANS.map(([name, date, only]) => [key(name), { date, only: only ?? null }]));

const fmt = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });

/**
 * Si la carta está baneada: { date, upcoming (aún no ha entrado), dateText («23 de noviembre de 2026»),
 * only ('2v2' o null), label (texto corto para la marca), text (frase para la ficha) }. Si no, null.
 * now: la fecha con la que se decide si ya ha entrado (por defecto, hoy).
 */
export function banInfo(card, now = new Date()) {
  const b = byName.get(key(card.name));
  if (!b) return null;
  const upcoming = new Date(`${b.date}T00:00:00`) > now;
  const where = b.only ? `en ${b.only}` : 'en Constructed (Standard y 2v2)';
  return {
    ...b,
    upcoming,
    dateText: fmt(b.date),
    label: b.only ? `Ban ${b.only}` : 'Baneada',
    text: upcoming
      ? `⛔ Baneada ${where} a partir del ${fmt(b.date)}.`
      : `⛔ Baneada ${where} desde el ${fmt(b.date)}.`,
  };
}
