"""Descarga los datos y las imágenes de todas las cartas de Riftbound.

Fuentes (se combinan por id de carta, p. ej. "ven-095-166"):
  1. Galería oficial de Riot: es la que antes incluye los sets nuevos (Radiance...).
  2. API pública de Riftcodex: añade lo que falte en la galería (promos, cartas de OP...).

Uso:
    python tools/fetch_cards.py            # todos los sets
    python tools/fetch_cards.py VEN RAD    # solo esos sets
    python tools/fetch_cards.py --strict   # actualización automática: si falla una fuente o
                                           # faltan cartas, no toca web/data/cards.json

Genera:
    cache/images/<id>.jpg      imagen reducida (para calcular los embeddings)
    web/thumbs/<id>.webp       miniatura para mostrar en la app
    web/data/cards.json        metadatos de las cartas

Vuelve a ejecutarlo cuando salga un set nuevo: solo descarga las imágenes que faltan.
"""
import html
import io
import json
import math
import re
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from errata import apply_errata, fetch_errata  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
GALLERY = "https://riftbound.leagueoflegends.com/en-us/card-gallery/"
API = "https://api.riftcodex.com"
CACHE = ROOT / "cache" / "images"
THUMBS = ROOT / "web" / "thumbs"
DATA = ROOT / "web" / "data"
THUMB_WIDTH = 240
CACHE_WIDTH = 600
UA = {"User-Agent": "Mozilla/5.0 (riftbound-scanner)"}
KNOWN_TYPES = {"Unit", "Spell", "Gear", "Legend", "Battlefield", "Rune"}

# Comprobación del dominio por el color de la banda del nombre (ver check_domains). Centroides RGB
# medidos sobre ~775 cartas de un solo dominio de OGN/SFD/UNL/VEN (99,9 % de acierto).
DOMAIN_COLORS = {
    "Fury": (190, 24, 31), "Calm": (75, 141, 49), "Mind": (18, 110, 162),
    "Body": (218, 110, 16), "Chaos": (106, 63, 143), "Order": (187, 160, 18),
}
# Sets cuyos datos oficiales traen dominios equivocados y se corrigen con la imagen.
IMAGE_DOMAIN_SETS = {"RAD"}


# Datos que faltan en las fuentes, sacados de la imagen de la carta. Solo se aplican si la fuente
# sigue sin traer ese campo, así que cuando Riot los complete mandan los suyos.
OVERRIDES = {
    "rad-006-167": {"domain": ["Fury"]},  # Scorched Earth
    "rad-009-167": {"domain": ["Fury"]},  # Antagonistic Apparatus
    "rad-022-167": {"domain": ["Fury"]},  # Whirling Twirligig
    "rad-041-167": {"domain": ["Calm"]},  # Hush
    "rad-104-167": {"domain": ["Chaos"]},  # Pitiless Stalker
    "rad-123-167": {"domain": ["Order"], "tags": ["Equipment"]},  # Protector's Shield
    "rad-134-167": {"domain": ["Order"]},  # Raucous Anthem
}


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=90) as resp:
        return resp.read()


def get_json(url):
    return json.loads(get(url))


def strip_html(text):
    text = re.sub(r"<li[^>]*>", "\n• ", text or "")  # opciones de "Choose one —"
    text = re.sub(r"<br\s*/?>|</p>\s*<p>", "\n", text)
    return html.unescape(re.sub(r"<[^>]+>", "", text)).strip()


def value(field):
    return (field or {}).get("value", {}).get("id")


def from_gallery():
    page = get(GALLERY).decode("utf-8")
    data = json.loads(re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', page, re.S).group(1))
    blades = data["props"]["pageProps"]["page"]["blades"]
    items = next(b["cards"]["items"] for b in blades if "cards" in b)
    cards = []
    for c in items:
        types = [t["label"] for t in c["cardType"].get("type", [])]
        # El texto alternativo de la imagen ("Riftbound Spell: ...") es más fiable que cardType: en
        # Radiance llegó con tipos cambiados entre cartas, o vacíos.
        m = re.match(r"Riftbound (\w+):", c["cardImage"].get("accessibilityText", ""))
        alt_type = m.group(1) if m and m.group(1) != "None" else None
        tags = (c.get("tags") or {}).get("tags", [])
        if alt_type and alt_type in KNOWN_TYPES:
            if types and types[0] != alt_type:
                tags = []  # si el tipo venía cambiado, las etiquetas tampoco son de esta carta
            types = [alt_type]
        elif not types:
            types = ["Other"]
        supertype = (c["cardType"].get("superType") or [{}])[0].get("label")
        name = c["name"]
        if c.get("subtitle") and c["subtitle"] not in name:
            name = f"{name} - {c['subtitle']}"
        cards.append({
            "id": c["id"],
            "name": name,
            "set": c["set"]["value"]["id"],
            "setName": c["set"]["value"]["label"],
            "number": c["collectorNumber"],
            "code": c["publicCode"],
            "type": types[0],
            "supertype": supertype,
            "rarity": c["rarity"]["value"]["label"],
            "domain": [d["label"] for d in c["domain"]["values"]],
            "energy": value(c.get("energy")),
            "might": value(c.get("might")),
            "power": value(c.get("power")),
            "tags": tags,
            "text": strip_html((c.get("text") or {}).get("richText", {}).get("body")),
            # Equipos: lo que ganan la unidad equipada (effect) y su bonificación de Might.
            # (solo en equipos: alguna otra carta trae basura en este campo, p. ej. un "1")
            "effect": (strip_html((c.get("effect") or {}).get("richText", {}).get("body")) or None) if types[0] == "Gear" else None,
            "mightBonus": value(c.get("mightBonus")),
            "image": c["cardImage"]["url"],
            "orientation": c["orientation"],
        })
    return cards


def from_riftcodex(set_ids=None):
    sets = get_json(f"{API}/sets?size=100")["items"]
    cards = []
    for s in sets:
        if set_ids and s["set_id"] not in set_ids:
            continue
        page = 1
        while True:
            data = get_json(f"{API}/cards?set_id={s['set_id']}&size=100&page={page}")
            for c in data["items"]:
                if not c["media"].get("image_url"):
                    continue
                cl, at = c["classification"], c["attributes"]
                cards.append({
                    "id": c["riftbound_id"],
                    "name": c["name"],
                    "set": c["set"]["set_id"],
                    "setName": c["set"]["label"],
                    "number": c["collector_number"],
                    "code": None,
                    "type": cl["type"],
                    "supertype": cl["supertype"],
                    "rarity": cl["rarity"],
                    "domain": cl["domain"] or [],
                    "energy": at["energy"],
                    "might": at["might"],
                    "power": at["power"],
                    "tags": c.get("tags") or [],
                    "text": c["text"]["plain"] or "",
                    "image": c["media"]["image_url"],
                    "orientation": c.get("orientation") or "portrait",
                })
            if page >= data["pages"]:
                break
            page += 1
    return cards


def file_id(card_id):
    # Los ids pueden llevar "*" (p. ej. "unl-229*-219"), que no es válido en nombres de archivo.
    return card_id.replace("*", "s")


def download(card):
    src = CACHE / f"{file_id(card['id'])}.jpg"
    if not src.exists():
        for attempt in range(3):
            try:
                img = Image.open(io.BytesIO(get(card["image"]))).convert("RGB")
                h = round(img.height * CACHE_WIDTH / img.width) if img.width < img.height else CACHE_WIDTH
                w = CACHE_WIDTH if img.width < img.height else round(img.width * CACHE_WIDTH / img.height)
                img.resize((w, h), Image.LANCZOS).save(src, "JPEG", quality=92)
                break
            except Exception as exc:  # noqa: BLE001
                if attempt == 2:
                    print(f"  ERROR {card['id']}: {exc}")
                    return
                time.sleep(2)
    thumb = THUMBS / f"{file_id(card['id'])}.webp"
    if not thumb.exists():
        img = Image.open(src).convert("RGB")
        scale = THUMB_WIDTH / min(img.size)
        img.resize((round(img.width * scale), round(img.height * scale)), Image.LANCZOS).save(thumb, "WEBP", quality=80)


def banner_domain(card):
    """Dominio según el color de la banda del nombre, o None si no es concluyente."""
    img = Image.open(CACHE / f"{file_id(card['id'])}.jpg").convert("RGB")
    w, h = img.size
    if w > h:
        return None
    region = img.crop((int(w * 0.05), int(h * 0.585), int(w * 0.60), int(h * 0.615)))
    raw = region.tobytes()
    px = [p for p in zip(raw[0::3], raw[1::3], raw[2::3]) if 25 < max(p) < 235]  # sin texto blanco ni borde negro
    if not px:
        return None
    median = tuple(sorted(ch)[len(ch) // 2] for ch in zip(*px))
    domain, dist = min(((d, math.dist(median, rgb)) for d, rgb in DOMAIN_COLORS.items()), key=lambda t: t[1])
    return domain if dist <= 60 else None


def check_domains(cards):
    """Corrige con la imagen el dominio de las cartas normales (de un color) de IMAGE_DOMAIN_SETS."""
    fixed = {}
    for c in cards:
        if c["set"] not in IMAGE_DOMAIN_SETS or c["type"] not in ("Unit", "Spell", "Gear"):
            continue
        if c.get("supertype") in ("Champion", "Signature"):  # estas venían bien y algunas son bicolor
            continue
        d = banner_domain(c)
        if d:
            fixed[(c["set"], c["name"])] = d
            if c["domain"] != [d]:
                print(f"  dominio por imagen: {c['id']} {c['name']}: {c['domain']} -> {d}")
                c["domain"], c["tags"] = [d], []
    # Variantes (arte alternativo, showcase) cuyo marco no permite leer el color: igual que la normal.
    for c in cards:
        d = fixed.get((c["set"], c["name"]))
        if d and c["domain"] != [d] and c.get("supertype") not in ("Champion", "Signature"):
            c["domain"], c["tags"] = [d], []


def add_champions(cards):
    """Campo "champion" en Leyendas, Campeones y cartas de firma, y nombres más reconocibles:
    "Akali - Rogue Assassin" para las Leyendas y "Death Mark (Zed)" para las de firma."""
    champions = {c["name"].split(" - ")[0] for c in cards if c["type"] == "Unit" and c.get("supertype") == "Champion"}
    for c in cards:
        if c["type"] != "Legend" and c.get("supertype") not in ("Champion", "Signature"):
            continue
        champ = next((t for t in c["tags"] if t in champions), None)
        if not champ:
            continue
        c["champion"] = champ
        if c["type"] == "Legend" and not c["name"].lower().startswith(champ.lower()):
            c["name"] = f"{champ} - {c['name']}"
        elif c["type"] != "Legend" and c.get("supertype") == "Signature":
            name = c["name"].removesuffix(f" - {champ}").removesuffix(" (Signature)")
            c["name"] = name if name.endswith(f"({champ})") else f"{name} ({champ})"


class SourceError(Exception):
    pass


def main():
    strict = "--strict" in sys.argv
    only = {s.upper() for s in sys.argv[1:] if not s.startswith("--")} or None
    for d in (CACHE, THUMBS, DATA):
        d.mkdir(parents=True, exist_ok=True)

    merged = {}
    for source, fetch in (("Riftcodex", lambda: from_riftcodex(only)), ("galería oficial", from_gallery)):
        try:
            found = [c for c in fetch() if not only or c["set"] in only]
        except Exception as exc:  # noqa: BLE001
            if strict:
                raise SourceError(f"No se pudo leer {source}: {exc}") from exc
            print(f"No se pudo leer {source}: {exc}")
            continue
        print(f"{source}: {len(found)} cartas")
        for c in found:  # la galería va después, así que sus datos tienen prioridad
            merged[c["id"]] = {**merged.get(c["id"], {}), **{k: v for k, v in c.items() if v is not None}}

    cards = sorted(merged.values(), key=lambda c: (c["set"], c["number"], c["id"]))
    for c in cards:
        for key, fix in OVERRIDES.get(c["id"], {}).items():
            if not c.get(key):
                c[key] = fix
        c.setdefault("code", None)
        c.setdefault("supertype", None)
        c["thumb"] = f"thumbs/{file_id(c['id'])}.webp"

    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(download, cards))

    cards = [c for c in cards if (CACHE / f"{file_id(c['id'])}.jpg").exists()]
    check_domains(cards)
    add_champions(cards)  # antes de las erratas: así los nombres de una misma carta coinciden
    try:
        errata = fetch_errata()
        missing = apply_errata(cards, errata)
        print(f"Erratas: {len(errata)} ({sum(1 for c in cards if c.get('errata'))} impresiones afectadas)")
        for e in missing:
            print(f"  errata sin carta asociada: {e['key']} {e['name']}")
    except Exception as exc:  # noqa: BLE001
        if strict:
            raise SourceError(f"No se pudieron leer las erratas: {exc}") from exc
        print(f"No se pudieron leer las erratas: {exc}")
    if strict and not only:
        # Una fuente que de repente devuelve menos cartas es casi seguro un fallo suyo, no cartas retiradas.
        previous = {c["id"] for c in json.loads((DATA / "cards.json").read_text(encoding="utf-8"))}
        lost = previous - {c["id"] for c in cards}
        if len(lost) > 5:
            raise SourceError(f"Faltan {len(lost)} cartas que antes estaban (p. ej. {sorted(lost)[:5]}); no se guarda nada.")
    (DATA / "cards.json").write_text(json.dumps(cards, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    by_set = {}
    for c in cards:
        by_set[c["set"]] = by_set.get(c["set"], 0) + 1
    print(f"Guardadas {len(cards)} cartas: {by_set}")


if __name__ == "__main__":
    try:
        main()
    except SourceError as exc:
        print(f"ERROR: {exc}")
        sys.exit(1)
