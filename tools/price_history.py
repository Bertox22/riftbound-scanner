"""Historial de precios de Cardmarket: web/data/price-history.json.

Cada noche fetch_cards.py añade el día de web/data/prices.json. Formato (céntimos de euro):

    {
      "dates": ["2026-10-25", ...],
      "n": {"ogn-001-298": [4, 2, ...], ...},   # una copia normal (o la foil si solo existe en foil)
      "f": {"ogn-007a-298": [461, ...], ...}     # una copia foil, solo si alguna vez difiere de "n"
    }

Cada lista va alineada con "dates"; null = ese día no había precio. Los últimos KEEP_DAILY días se
guardan todos; los anteriores, uno por semana (el primero de cada semana), para que el archivo no
crezca sin parar.

Empezó de cero el 14/11/2026: antes los precios eran la media de un solo día de ventas (de
riftbound.gg) y mezclarlos con los de ahora (ver prices.pick) daría saltos falsos. Por eso
--backfill solo usa los prices.json con "source": SOURCE.

Uso:
    python tools/price_history.py --backfill   # lo rehace desde los prices.json guardados en git
"""
import datetime
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FILE = ROOT / "web" / "data" / "price-history.json"
KEEP_DAILY = 90
SOURCE = "cardmarket-guide"  # el "source" de los prices.json que entran en el historial


def cents(v):
    return None if v is None else round(v * 100)


def day_prices(prices):
    """{"updated", "prices": {id: [eur, eurFoil, usd, usdFoil, soloFoil, eur7d]}} → {id: (normal, foil)}."""
    out = {}
    for cid, p in prices["prices"].items():
        eur, eur_foil, foil_only = p[0], p[1], p[4]
        normal = (eur_foil if eur_foil is not None else eur) if foil_only else (eur if eur is not None else eur_foil)
        foil = eur_foil if eur_foil is not None else eur
        out[cid] = (cents(normal), cents(foil))
    return out


def load():
    if FILE.exists():
        return json.loads(FILE.read_text(encoding="utf-8"))
    return {"dates": [], "n": {}, "f": {}}


def add_day(hist, date, prices):
    """Añade (o sustituye, si ya estaba) el día `date` con los precios de prices.json."""
    day = day_prices(prices)
    dates = hist["dates"]
    if dates and dates[-1] == date:
        idx = len(dates) - 1
    elif dates and dates[-1] > date:
        return hist  # más antiguo que lo guardado: no se reescribe el pasado
    else:
        dates.append(date)
        idx = len(dates) - 1
    width = len(dates)
    for key in ("n", "f"):
        for series in hist[key].values():
            series.extend([None] * (width - len(series)))
    for cid, (normal, foil) in day.items():
        n = hist["n"].setdefault(cid, [None] * width)
        n[idx] = normal
        if foil != normal or cid in hist["f"]:
            f = hist["f"].setdefault(cid, list(n))  # hasta hoy, igual que la normal
            f[idx] = foil
    return hist


def thin(hist, keep_daily=KEEP_DAILY):
    """Deja todos los días recientes y, de los más antiguos, el primero de cada semana."""
    dates = hist["dates"]
    if not dates:
        return hist
    last = datetime.date.fromisoformat(dates[-1])
    limit = (last - datetime.timedelta(days=keep_daily)).isoformat()
    keep, weeks = [], set()
    for i, d in enumerate(dates):
        if d >= limit:
            keep.append(i)
            continue
        week = datetime.date.fromisoformat(d).isocalendar()[:2]
        if week not in weeks:
            weeks.add(week)
            keep.append(i)
    if len(keep) == len(dates):
        return hist
    hist["dates"] = [dates[i] for i in keep]
    for key in ("n", "f"):
        hist[key] = {cid: [s[i] for i in keep] for cid, s in hist[key].items()}
    return hist


def drop_empty(hist):
    for key in ("n", "f"):
        hist[key] = {cid: s for cid, s in hist[key].items() if any(v is not None for v in s)}
    return hist


def save(hist):
    FILE.write_text(json.dumps(drop_empty(hist), separators=(",", ":")), encoding="utf-8")


def update(prices):
    """Lo que llama fetch_cards.py cada noche con el prices.json recién hecho."""
    hist = load()
    add_day(hist, prices["updated"], prices)
    save(thin(hist))
    return hist


def backfill():
    """Rehace el historial con cada versión de prices.json que hay en git (y la del disco)."""
    revs = subprocess.run(["git", "log", "--reverse", "--format=%H", "--", "web/data/prices.json"],
                          capture_output=True, text=True, check=True, cwd=ROOT).stdout.split()
    hist = {"dates": [], "n": {}, "f": {}}
    for rev in revs:
        raw = subprocess.run(["git", "show", f"{rev}:web/data/prices.json"], capture_output=True, check=True, cwd=ROOT).stdout
        prices = json.loads(raw)
        if prices.get("source") == SOURCE:
            add_day(hist, prices["updated"], prices)
    current = json.loads((ROOT / "web" / "data" / "prices.json").read_text(encoding="utf-8"))
    add_day(hist, current["updated"], current)
    save(thin(hist))
    print(f"Historial: {len(hist['dates'])} días ({hist['dates'][0]} … {hist['dates'][-1]}), "
          f"{len(hist['n'])} cartas, {FILE.stat().st_size // 1024} KB")


if __name__ == "__main__":
    if "--backfill" in sys.argv:
        backfill()
    else:
        print(__doc__)
