"""Precios de las cartas: guía de precios oficial de Cardmarket (euros) y riftbound.gg (dólares).

Genera web/data/prices.json:
    {"updated": "2026-11-13", "source": "cardmarket-guide",
     "prices": {"<id>": [eur, eurFoil, usd, usdFoil, soloFoil, eur7d]}}
  - eur / eurFoil: Cardmarket, euros (copia normal / foil). Ver `pick`.
  - usd / usdFoil: TCGplayer, dólares (de riftbound.gg)
  - soloFoil: 1 si esa versión solo existe en foil (Showcase, runas de arte alternativo...);
    entonces eur es null y eurFoil es su precio.
  - eur7d: cambio del precio en euros en los últimos 7 días, sacado de price-history.json
    (lo pone fetch_cards.py después de guardar el día; null si aún no hay 7 días de historial).
  - updated: el día en que Cardmarket generó su guía.
Un valor null es "sin dato". Va aparte de cards.json porque cambia cada día.

La guía (price_guide_22.json, la de Riftbound) se publica una vez al día y trae por producto
trend, avg1, avg7, avg30, low... en normal y en "-foil". Cada carta se enlaza con su producto por
el "cmid" de riftbound.gg.

Uso:
    python tools/prices.py   # rehace prices.json y el día de hoy del historial sin bajar las cartas
"""
import datetime
import json
import urllib.request
from pathlib import Path

from dotgg import UA, get_cards, is_variant, key_of, money

CARDMARKET = "https://www.cardmarket.com/en/Riftbound/Products/Singles/"
GUIDE = "https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_22.json"
ROOT = Path(__file__).resolve().parent.parent


def get_guide():
    """{idProduct: fila de la guía} y la fecha en que Cardmarket la generó."""
    req = urllib.request.Request(GUIDE, headers=UA)
    with urllib.request.urlopen(req, timeout=120) as resp:
        data = json.load(resp)
    created = data["createdAt"][:10]
    return {g["idProduct"]: g for g in data["priceGuides"]}, created


def pick(row, foil):
    """La regla: el más bajo de trend, media de 7 días y media de 30 días de esa columna.

    Así un pico de pocas ventas (típico del bulk: se compra a 0,02 € y el trend dice 0,53 €) no
    infla el precio, y en las cartas caras se queda cerca del "Price Trend" de la web. Cardmarket
    pone 0 o null donde no tiene dato; se ignoran. Una carta muy nueva sin medias usa el trend solo.
    """
    suf = "-foil" if foil else ""
    vals = [row.get(k + suf) for k in ("trend", "avg7", "avg30")]
    vals = [v for v in vals if isinstance(v, (int, float)) and v > 0]
    return round(min(vals), 2) if vals else None


def build_prices(cards):
    guide, created = get_guide()
    by_key = {}
    for c in get_cards():
        key = key_of(c["id"])
        if not is_variant(key):
            by_key.setdefault(key, c)
    prices = {}
    linked = 0
    for card in cards:
        src = by_key.get("-".join(card["id"].split("-")[:2]))
        if not src:
            continue
        foil_only = src.get("hasNormal") == "0" and src.get("hasFoil") == "1"
        row = guide.get(int(src["cmid"])) if str(src.get("cmid") or "").isdigit() else None
        eur = eur_foil = None
        if row:
            linked += 1
            eur, eur_foil = pick(row, False), pick(row, True)
            if foil_only:
                # Solo hay copias foil: algunos vendedores no las marcan como foil y caen en la
                # columna normal, que entonces es la de las mismas cartas.
                eur, eur_foil = None, eur_foil if eur_foil is not None else eur
        entry = [eur, eur_foil, money(src.get("price")), money(src.get("foilPrice")), 1 if foil_only else 0, None]
        if any(v is not None for v in entry[:4]):
            prices[card["id"]] = entry
        if (src.get("cmurl") or "").startswith(CARDMARKET):
            card["cardmarket"] = src["cmurl"].removeprefix(CARDMARKET)  # ruta corta: "Vendetta/Akali-Rogue-Assassin"
    if linked < len(cards) // 2:
        raise RuntimeError(f"Solo {linked} cartas casan con la guía de Cardmarket: ¿ha cambiado de formato?")
    return {"updated": created, "source": "cardmarket-guide", "prices": prices}


def add_change(prices, hist, days=7):
    """Pone en cada carta el cambio de su precio en euros respecto a hace `days` días (o más)."""
    dates = hist["dates"]
    if not dates:
        return prices
    limit = (datetime.date.fromisoformat(dates[-1]) - datetime.timedelta(days=days)).isoformat()
    old = max((i for i, d in enumerate(dates) if d <= limit), default=None)
    if old is None:
        return prices
    for cid, p in prices["prices"].items():
        s = hist["n"].get(cid)
        if s and s[-1] is not None and s[old] is not None:
            p[5] = round((s[-1] - s[old]) / 100, 2) or None
    return prices


def write(prices):
    (ROOT / "web" / "data" / "prices.json").write_text(json.dumps(prices, separators=(",", ":")), encoding="utf-8")


if __name__ == "__main__":
    import price_history

    cards = json.loads((ROOT / "web" / "data" / "cards.json").read_text(encoding="utf-8"))
    prices = build_prices(cards)
    hist = price_history.update(prices)
    write(add_change(prices, hist))
    print(f"Precios: {len(prices['prices'])} cartas (guía del {prices['updated']}); historial: {len(hist['dates'])} días")
