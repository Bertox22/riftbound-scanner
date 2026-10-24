"""Mide la precisión del índice ya construido y propone umbrales para el escáner.

Positivos: fotos simuladas de cartas (semilla distinta a la del índice).
Negativos: fotogramas sin carta (mesa, ruido, manos, imágenes muy desenfocadas).

Uso:
    python tools/calibrate.py [n_fotos]
"""
import json
import random
import sys
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image, ImageDraw, ImageFilter

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_index import CACHE, DATA, MODEL_SRC, embed  # noqa: E402
from eval_models import fake_photo  # noqa: E402


def load_index():
    meta = json.loads((DATA / "index.json").read_text(encoding="utf-8"))
    m = np.frombuffer((DATA / "index.bin").read_bytes(), np.float16).astype(np.float32).reshape(-1, meta["dim"])
    group = {}
    for gi, g in enumerate(meta["sameArt"]):
        for cid in g:
            group[cid] = gi
    return meta, m, group


def ranked(v, meta, m, group):
    sims = m @ v
    best = {}
    for r, s in zip(meta["rows"], sims):
        key = f"g{group[r]}" if r in group else r
        if s > best.get(key, (-1, None))[0]:
            best[key] = (s, r)
    return sorted(best.items(), key=lambda kv: -kv[1][0])


def negatives(rng, cards, n):
    out = []
    for k in range(n):
        w, h = 300, 412
        kind = k % 4
        if kind == 0:  # mesa lisa con ruido
            img = Image.new("RGB", (w, h), tuple(rng.randint(10, 230) for _ in range(3)))
            img = Image.blend(img, Image.effect_noise((w, h), 60).convert("RGB"), rng.uniform(0.1, 0.5))
        elif kind == 1:  # "mano": manchas color piel sobre fondo
            img = Image.new("RGB", (w, h), tuple(rng.randint(20, 120) for _ in range(3)))
            d = ImageDraw.Draw(img)
            for _ in range(4):
                x, y, r = rng.uniform(0, w), rng.uniform(0, h), rng.uniform(40, 160)
                d.ellipse((x - r, y - r, x + r, y + r), fill=(rng.randint(170, 240), rng.randint(120, 190), rng.randint(90, 160)))
            img = img.filter(ImageFilter.GaussianBlur(6))
        elif kind == 2:  # carta totalmente desenfocada (cámara enfocando)
            c = rng.choice(cards)
            img = Image.open(CACHE / c["thumb"].split("/")[1].replace(".webp", ".jpg")).convert("RGB").resize((w, h))
            img = img.filter(ImageFilter.GaussianBlur(rng.uniform(10, 18)))
        else:  # degradado
            a = np.linspace(rng.uniform(0, 255), rng.uniform(0, 255), h)[:, None, None]
            b = np.array([rng.uniform(0.5, 1.0) for _ in range(3)])[None, None]
            img = Image.fromarray(np.clip(np.repeat(a, w, 1) * b, 0, 255).astype(np.uint8))
        out.append(img)
    return out


def main():
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 400
    cards = json.loads((DATA / "cards.json").read_text(encoding="utf-8"))
    meta, m, group = load_index()
    session = ort.InferenceSession(str(MODEL_SRC))
    rng = random.Random(123)

    pos = []
    for idx in rng.sample(range(len(cards)), n):
        c = cards[idx]
        img = Image.open(CACHE / c["thumb"].split("/")[1].replace(".webp", ".jpg")).convert("RGB")
        if img.width > img.height:
            img = img.rotate(rng.choice([90, -90]), expand=True)
        r = ranked(embed(session, fake_photo(img, rng)), meta, m, group)
        target = f"g{group[c['id']]}" if c["id"] in group else c["id"]
        rank = next(i for i, (key, _) in enumerate(r) if key == target)
        pos.append((rank, r[0][1][0], r[0][1][0] - r[1][1][0]))
    neg = []
    for img in negatives(rng, cards, n // 2):
        r = ranked(embed(session, img), meta, m, group)
        neg.append((r[0][1][0], r[0][1][0] - r[1][1][0]))

    ranks = np.array([p[0] for p in pos])
    print(f"Fotos simuladas: {n}. top1={np.mean(ranks == 0):.1%}  top4={np.mean(ranks < 4):.1%}")
    ok = np.array([p[1] for p in pos if p[0] == 0])
    bad = np.array([p[1] for p in pos if p[0] != 0])
    ns = np.array([x[0] for x in neg])
    print(f"Similitud top1 acierto: p5={np.percentile(ok, 5):.3f} p50={np.median(ok):.3f}")
    print(f"Similitud top1 fallo:   p50={np.median(bad):.3f} p95={np.percentile(bad, 95):.3f}" if len(bad) else "sin fallos")
    print(f"Similitud sin carta:    p50={np.median(ns):.3f} p99={np.percentile(ns, 99):.3f} max={ns.max():.3f}")
    print("\naccept margin -> añadidas automáticamente | de ellas erróneas | fondos aceptados")
    for accept in (0.5, 0.55, 0.6, 0.62, 0.65, 0.7):
        for margin in (0.0, 0.02, 0.03, 0.05):
            take = [p for p in pos if p[1] >= accept and p[2] >= margin]
            wrong = sum(1 for p in take if p[0] != 0)
            fp = sum(1 for x in neg if x[0] >= accept and x[1] >= margin)
            print(f"  {accept:.2f}  {margin:.2f}  -> {len(take) / n:6.1%} | {wrong / max(1, len(take)):5.1%} | {fp}/{len(neg)}")


if __name__ == "__main__":
    main()
