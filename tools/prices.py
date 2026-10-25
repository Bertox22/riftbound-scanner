"""Precios de las cartas (base de datos de riftbound.gg, que los toma de Cardmarket y TCGplayer).

Genera web/data/prices.json:
    {"updated": "2026-10-25",
     "prices": {"<id>": [eur, eurFoil, usd, usdFoil, soloFoil, eur7d]}}
  - eur / eurFoil: Cardmarket, euros (normal / foil)
  - usd / usdFoil: TCGplayer, dólares
  - soloFoil: 1 si esa versión solo existe en foil (Showcase, runas de arte alternativo...)
  - eur7d: cambio del precio normal de Cardmarket en los últimos 7 días
Un valor null es "sin dato". Va aparte de cards.json porque cambia cada día.
"""
import datetime

from dotgg import get_cards, is_variant, key_of, money

CARDMARKET = "https://www.cardmarket.com/en/Riftbound/Products/Singles/"


def build_prices(cards):
    by_key = {}
    for c in get_cards():
        key = key_of(c["id"])
        if not is_variant(key):
            by_key.setdefault(key, c)
    prices = {}
    for card in cards:
        src = by_key.get("-".join(card["id"].split("-")[:2]))
        if not src:
            continue
        row = [
            money(src.get("cmPrice")),
            money(src.get("cmFoilPrice")),
            money(src.get("price")),
            money(src.get("foilPrice")),
            1 if src.get("hasNormal") == "0" and src.get("hasFoil") == "1" else 0,
            round(float(src["cmDelta7dPrice"]), 2) if src.get("cmDelta7dPrice") not in (None, "") else None,
        ]
        if any(v is not None for v in row[:4]):
            prices[card["id"]] = row
        if (src.get("cmurl") or "").startswith(CARDMARKET):
            card["cardmarket"] = src["cmurl"].removeprefix(CARDMARKET)  # ruta corta: "Vendetta/Akali-Rogue-Assassin"
    return {"updated": datetime.date.today().isoformat(), "prices": prices}
