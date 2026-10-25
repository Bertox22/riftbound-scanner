"""Base de datos de riftbound.gg (api.dotgg.gg): erratas, precios y versiones que faltan en
las otras fuentes (p. ej. las Showcase firmadas "*").

Se descarga una sola vez por ejecución.
"""
import html
import json
import re
import urllib.request

API = "https://api.dotgg.gg/cgfw/getcards?game=riftbound"
UA = {"User-Agent": "Mozilla/5.0 (riftbound-scanner)"}
_cache = None


def get_cards():
    global _cache
    if _cache is None:
        req = urllib.request.Request(API, headers=UA)
        with urllib.request.urlopen(req, timeout=120) as resp:
            _cache = json.load(resp)
    return _cache


def key_of(dotgg_id):
    """"OGN-310-STAR" -> "ogn-310*", "RAD-R01A" -> "rad-r01a" (set-número, como nuestros ids)."""
    return re.sub(r"-star$", "*", dotgg_id.lower())


def is_variant(key):
    """Promos y versiones especiales ("ogn-259-mb-p", "sfd-139-p2", "ogn-296/298") que no son
    cartas aparte en nuestros datos."""
    return key.count("-") > 1 or "/" in key


def clean(text):
    text = re.sub(r"<br\s*/?>", "\n", text or "")
    return html.unescape(re.sub(r"<[^>]+>", "", text)).strip()


def number(value):
    """"3" -> 3, "" / None / "-" -> None."""
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def money(value):
    """Precio en número; 0 o vacío significa "sin dato"."""
    try:
        v = round(float(value), 2)
    except (TypeError, ValueError):
        return None
    return v if v > 0 else None
