"""Erratas de cartas: texto oficial vigente cuando difiere del impreso.

Fuente: la base de datos de riftbound.gg (api.dotgg.gg), la misma que alimenta
https://riftbound.gg/rules/errata/ y los artículos de erratas por set
(https://riftbound.gg/radiance-errata-updates, .../vendetta-errata-updates). Cada
impresión con errata trae el campo "errata" con el texto vigente.

Se asocia por set y número ("OGN-305*" -> "ogn-305*-298") y se extiende a las demás
impresiones de la misma carta (promos, arte alternativo...) que esa base no incluya.
"""
import html
import json
import re
import urllib.request

ERRATA_API = "https://api.dotgg.gg/cgfw/getcards?game=riftbound"
UA = {"User-Agent": "Mozilla/5.0 (riftbound-scanner)"}
PROMO_SETS = {"OPP", "PR", "JDG"}


def clean(text):
    text = re.sub(r"<br\s*/?>", "\n", text or "")
    return html.unescape(re.sub(r"<[^>]+>", "", text)).strip()


def fetch_errata():
    """[{"key": "ogn-305*", "name": "...", "text": "..."}] con el texto oficial vigente."""
    req = urllib.request.Request(ERRATA_API, headers=UA)
    with urllib.request.urlopen(req, timeout=120) as resp:
        cards = json.load(resp)
    out = []
    for c in cards:
        if not c.get("errata"):
            continue
        key = re.sub(r"-star$", "*", c["id"].lower())  # firmas: "OGN-310-star" -> "ogn-310*"
        # Promos y versiones especiales ("ogn-259-mb-p", "sfd-139-p2", "ogn-296/298"): no son
        # cartas aparte en nuestros datos, pero su texto se aplica igual por nombre.
        variant = key.count("-") > 1 or "/" in key
        out.append({"key": key, "name": c["name"], "text": clean(c["errata"]), "variant": variant})
    return out


def base_name(card):
    # "Yasuo - Unforgiven (Metal)", "Annie - Dark Child - Starter" -> nombre de la carta
    return re.sub(r"\s*\([^)]*\)\s*$", "", card["name"]).removesuffix(" - Starter")


def norm(text):
    return re.sub(r"[\s\[\]]+", " ", text or "").replace("’", "'").strip().lower()


def apply_errata(cards, errata):
    """Pone el texto vigente en "text", guarda el impreso en "printedText" y marca "errata".
    Devuelve las erratas que no se pudieron asociar a ninguna carta."""
    by_key = {}
    for c in cards:
        set_id, num = c["id"].split("-")[:2]
        by_key.setdefault(f"{set_id}-{num}", c)
    texts, missing = {}, []
    for e in errata:
        card = by_key.get(e["key"])
        if not card:
            if not e["variant"]:
                missing.append(e)
            continue
        set_errata(card, e["text"])
        texts.setdefault((base_name(card), card["type"]), e["text"])
    # Otras impresiones de la misma carta que la fuente no recoge: mismo nombre base y tipo, o
    # promo con el mismo número y total ("opp-020-024" es la promo de "ogs-020-024").
    by_number = {c["id"].split("-", 1)[1]: c for c in cards if c.get("errata") and c["set"] not in PROMO_SETS}
    for c in cards:
        if c.get("errata"):
            continue
        text = texts.get((base_name(c), c["type"]))
        twin = by_number.get(c["id"].split("-", 1)[1]) if c["set"] in PROMO_SETS else None
        if not text and twin and twin["type"] == c["type"]:
            text = twin["text"]
        if text:
            set_errata(c, text)
    return missing


def set_errata(card, text):
    if norm(card["text"]) != norm(text):
        card.setdefault("printedText", card["text"])
        card["text"] = text
    card["errata"] = True
