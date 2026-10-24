"""Descarga los datos y las imágenes de todas las cartas de Riftbound.

Fuentes (se combinan por id de carta, p. ej. "ven-095-166"):
  1. Galería oficial de Riot: es la que antes incluye los sets nuevos (Radiance...).
  2. API pública de Riftcodex: añade lo que falte en la galería (promos, cartas de OP...).

Uso:
    python tools/fetch_cards.py            # todos los sets
    python tools/fetch_cards.py VEN RAD    # solo esos sets

Genera:
    cache/images/<id>.jpg      imagen reducida (para calcular los embeddings)
    web/thumbs/<id>.webp       miniatura para mostrar en la app
    web/data/cards.json        metadatos de las cartas

Vuelve a ejecutarlo cuando salga un set nuevo: solo descarga las imágenes que faltan.
"""
import html
import io
import json
import re
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
GALLERY = "https://riftbound.leagueoflegends.com/en-us/card-gallery/"
API = "https://api.riftcodex.com"
CACHE = ROOT / "cache" / "images"
THUMBS = ROOT / "web" / "thumbs"
DATA = ROOT / "web" / "data"
THUMB_WIDTH = 240
CACHE_WIDTH = 600
UA = {"User-Agent": "Mozilla/5.0 (riftbound-scanner)"}


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=90) as resp:
        return resp.read()


def get_json(url):
    return json.loads(get(url))


def strip_html(text):
    text = re.sub(r"<br\s*/?>|</p>\s*<p>", "\n", text or "")
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
        if not types:  # algunas cartas recién publicadas vienen sin tipo: se saca del texto alternativo
            m = re.match(r"Riftbound (\w+):", c["cardImage"].get("accessibilityText", ""))
            types = [m.group(1) if m and m.group(1) != "None" else "Other"]
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
            "tags": (c.get("tags") or {}).get("tags", []),
            "text": strip_html((c.get("text") or {}).get("richText", {}).get("body")),
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


def main():
    only = {s.upper() for s in sys.argv[1:]} or None
    for d in (CACHE, THUMBS, DATA):
        d.mkdir(parents=True, exist_ok=True)

    merged = {}
    for source, fetch in (("Riftcodex", lambda: from_riftcodex(only)), ("galería oficial", from_gallery)):
        try:
            found = [c for c in fetch() if not only or c["set"] in only]
        except Exception as exc:  # noqa: BLE001
            print(f"No se pudo leer {source}: {exc}")
            continue
        print(f"{source}: {len(found)} cartas")
        for c in found:  # la galería va después, así que sus datos tienen prioridad
            merged[c["id"]] = {**merged.get(c["id"], {}), **{k: v for k, v in c.items() if v is not None}}

    cards = sorted(merged.values(), key=lambda c: (c["set"], c["number"], c["id"]))
    for c in cards:
        c.setdefault("code", None)
        c.setdefault("supertype", None)
        c["thumb"] = f"thumbs/{file_id(c['id'])}.webp"

    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(download, cards))

    cards = [c for c in cards if (CACHE / f"{file_id(c['id'])}.jpg").exists()]
    (DATA / "cards.json").write_text(json.dumps(cards, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    by_set = {}
    for c in cards:
        by_set[c["set"]] = by_set.get(c["set"], 0) + 1
    print(f"Guardadas {len(cards)} cartas: {by_set}")


if __name__ == "__main__":
    main()
