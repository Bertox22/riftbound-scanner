"""Compara descriptores de imagen simulando fotos hechas con el móvil.

Para cada carta de muestra genera una "foto" sintética (perspectiva, giro, encuadre
impreciso, iluminación, desenfoque, reflejos, JPEG) y comprueba si el vecino más
cercano entre todas las cartas de referencia es la carta correcta.
"""
import io
import json
import random
import sys
import time
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "cache" / "images"
MEAN = np.array([0.485, 0.456, 0.406], np.float32)
STD = np.array([0.229, 0.224, 0.225], np.float32)


def load_card(card):
    img = Image.open(CACHE / (card["thumb"].split("/")[1].replace(".webp", ".jpg"))).convert("RGB")
    if img.width > img.height:  # Battlefields: se escanean en vertical
        img = img.rotate(90, expand=True)
    return img


def to_tensor(img, w, h):
    arr = np.asarray(img.resize((w, h), Image.BICUBIC), np.float32) / 255.0
    return ((arr - MEAN) / STD).transpose(2, 0, 1)[None]


class Mnv4:
    w, h = 224, 320

    def __init__(self):
        self.s = ort.InferenceSession(str(ROOT / "models" / "mnv4s_feat.onnx"))

    def __call__(self, img):
        fm = self.s.run(None, {"pixel_values": to_tensor(img, self.w, self.h)})[0][0]  # C,H,W
        g = np.power(np.maximum(fm, 1e-6) ** 3, 1).mean((1, 2)) ** (1 / 3)  # GeM p=3
        a = fm.mean((1, 2))
        C, H, W = fm.shape
        grid = [fm[:, i * H // 2:(i + 1) * H // 2, j * W // 2:(j + 1) * W // 2].mean((1, 2)) for i in range(2) for j in range(2)]
        return {"gap": a, "gem": g, "grid": np.concatenate([a] + grid)}


class Dino:
    w, h = 224, 308
    file = "dinov2s_q.onnx"

    def __init__(self):
        self.s = ort.InferenceSession(str(ROOT / "models" / self.file))
        self.fp16 = "float16" in self.s.get_inputs()[0].type

    def __call__(self, img):
        x = to_tensor(img, self.w, self.h)
        t = self.s.run(None, {"pixel_values": x.astype(np.float16) if self.fp16 else x})[0][0].astype(np.float32)
        cls, patches = t[0], t[1:]
        return {"cls": cls, "mean": patches.mean(0), "cls+mean": np.concatenate([cls, patches.mean(0)])}


class DinoFp16(Dino):
    file = "dinov2s_fp16.onnx"


class DinoFp32(Dino):
    file = "dinov2s_fp32.onnx"


class DinoQpc(Dino):
    file = "dinov2s_qpc.onnx"


class DinoQ4(Dino):
    file = "dinov2s_q4.onnx"


class DinoLarge(Dino):
    w, h = 280, 392


MODELS = {"mnv4": Mnv4, "dino": Dino, "dino16": DinoFp16, "dinoL": DinoLarge, "dino32": DinoFp32, "dinoqpc": DinoQpc, "dinoq4": DinoQ4}


def norm(v):
    return v / (np.linalg.norm(v) + 1e-9)


def find_coeffs(src, dst):
    m = []
    for (x, y), (u, v) in zip(dst, src):
        m.append([x, y, 1, 0, 0, 0, -u * x, -u * y])
        m.append([0, 0, 0, x, y, 1, -v * x, -v * y])
    return np.linalg.solve(np.array(m, float), np.array(src, float).reshape(8))


def fake_photo(card_img, rng):
    """Simula la carta fotografiada dentro del recuadro guía de la app."""
    cw, ch = 360, round(360 * card_img.height / card_img.width)
    card = card_img.resize((cw, ch), Image.BICUBIC)
    pad = 80
    W, H = cw + 2 * pad, ch + 2 * pad
    bg = Image.new("RGB", (W, H), tuple(rng.randint(20, 200) for _ in range(3)))
    bg = Image.blend(bg, Image.effect_noise((W, H), 40).convert("RGB"), 0.25)
    # Perspectiva y giro: cada esquina se desplaza un poco.
    j = lambda: rng.uniform(-0.05, 0.05) * cw  # noqa: E731
    quad = [(pad + j(), pad + j()), (pad + cw + j(), pad + j()), (pad + cw + j(), pad + ch + j()), (pad + j(), pad + ch + j())]
    coeffs = find_coeffs([(0, 0), (cw, 0), (cw, ch), (0, ch)], quad)
    warped = card.transform((W, H), Image.PERSPECTIVE, coeffs, Image.BICUBIC)
    mask = Image.new("L", (cw, ch), 255).transform((W, H), Image.PERSPECTIVE, coeffs, Image.BICUBIC)
    bg.paste(warped, (0, 0), mask)
    # Encuadre impreciso del recuadro guía (posición y escala).
    s = rng.uniform(0.94, 1.08)
    gw, gh = cw * s, ch * s
    cx, cy = W / 2 + rng.uniform(-0.04, 0.04) * cw, H / 2 + rng.uniform(-0.04, 0.04) * ch
    img = bg.crop((round(cx - gw / 2), round(cy - gh / 2), round(cx + gw / 2), round(cy + gh / 2)))
    # Iluminación, temperatura de color, reflejo, desenfoque, ruido y JPEG.
    img = ImageEnhance.Brightness(img).enhance(rng.uniform(0.6, 1.3))
    img = ImageEnhance.Contrast(img).enhance(rng.uniform(0.7, 1.2))
    img = ImageEnhance.Color(img).enhance(rng.uniform(0.7, 1.2))
    r, g, b = img.split()
    t = rng.uniform(-20, 20)
    img = Image.merge("RGB", (r.point(lambda v: v + t), g, b.point(lambda v: v - t)))
    if rng.random() < 0.5:
        glare = Image.new("L", img.size, 0)
        gx, gy, gr = rng.uniform(0, img.width), rng.uniform(0, img.height), rng.uniform(30, 120)
        ImageDraw.Draw(glare).ellipse((gx - gr, gy - gr, gx + gr, gy + gr), fill=int(rng.uniform(80, 200)))
        img = Image.composite(Image.new("RGB", img.size, (255, 255, 255)), img, glare.filter(ImageFilter.GaussianBlur(gr / 2)))
    img = img.filter(ImageFilter.GaussianBlur(rng.uniform(0, 1.8)))
    arr = np.asarray(img, np.float32) + np.random.default_rng(rng.randint(0, 1 << 30)).normal(0, rng.uniform(0, 8), (img.height, img.width, 1))
    img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=rng.randint(40, 85))
    return Image.open(buf).convert("RGB")


def dup_groups(imgs):
    """Cartas con exactamente la misma ilustración (reimpresiones/promos) cuentan como acierto."""
    small = np.stack([np.asarray(i.convert("L").resize((24, 34)), np.float32).ravel() for i in imgs])
    small = (small - small.mean(1, keepdims=True)) / (small.std(1, keepdims=True) + 1e-6)
    sim = small @ small.T / small.shape[1]
    return sim > 0.97


def main():
    n_queries = int(sys.argv[1]) if len(sys.argv) > 1 else 300
    cards = json.loads((ROOT / "web" / "data" / "cards.json").read_text(encoding="utf-8"))
    imgs = [load_card(c) for c in cards]
    same = dup_groups(imgs)
    print(f"{len(cards)} cartas; pares con ilustración idéntica: {(same.sum() - len(cards)) // 2}")
    rng = random.Random(42)
    qidx = rng.sample(range(len(cards)), n_queries)
    queries = [fake_photo(imgs[i], rng) for i in qidx]
    queries[0].save(ROOT / "cache" / "sample_query.jpg")

    for model in [MODELS[m]() for m in ([a for a in sys.argv[2:] if not a.startswith("--")] or ["mnv4", "dino"])]:
        name = type(model).__name__
        t0 = time.time()
        ref = [model(i) for i in imgs]
        if "--proto" in sys.argv:  # referencia = media de la imagen limpia y 4 fotos simuladas
            prng = random.Random(7)
            for k, i in enumerate(imgs):
                extra = [model(fake_photo(i, prng)) for _ in range(4)]
                ref[k] = {key: norm(ref[k][key]) * 2 + sum(norm(e[key]) for e in extra) for key in ref[k]}
        t1 = time.time()
        qs = [model(q) for q in queries]
        print(f"\n{name}: {1000 * (t1 - t0) / len(imgs):.0f} ms/imagen (CPU del PC)")
        for key in ref[0]:
            R = np.stack([norm(r[key]) for r in ref])
            Q = np.stack([norm(q[key]) for q in qs])
            sims = Q @ R.T
            order = np.argsort(-sims, 1)
            top1 = np.mean([same[qi, order[k, 0]] for k, qi in enumerate(qidx)])
            top5 = np.mean([same[qi, order[k, :5]].any() for k, qi in enumerate(qidx)])
            margin = np.median(sims[np.arange(len(qidx)), order[:, 0]] - sims[np.arange(len(qidx)), order[:, 1]])
            print(f"  {key:9s} dim={R.shape[1]:5d} top1={top1:.1%} top5={top5:.1%} margen_mediano={margin:.3f}")


if __name__ == "__main__":
    main()
