"""Calcula los embeddings de referencia de todas las cartas para el reconocimiento.

Requiere haber ejecutado antes tools/fetch_cards.py.

Genera:
    web/models/dinov2s_qmm.onnx   modelo DINOv2-small con las MatMul cuantizadas a int8 por canal
    web/data/index.bin            matriz float16 (filas x 768) normalizada
    web/data/index.json           a qué carta corresponde cada fila + parámetros del modelo

Uso:
    python tools/build_index.py
"""
import json
import random
import shutil
import sys
import time
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from eval_models import dup_groups, fake_photo  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "cache" / "images"
DATA = ROOT / "web" / "data"
MODEL_SRC = ROOT / "models" / "dinov2s_qmm.onnx"
MODEL_DST = ROOT / "web" / "models" / "dinov2s_qmm.onnx"
WIDTH, HEIGHT = 224, 308
MEAN = np.array([0.485, 0.456, 0.406], np.float32)
STD = np.array([0.229, 0.224, 0.225], np.float32)
# Además de la imagen limpia, cada referencia promedia varias "fotos" simuladas:
# así se parece más a lo que ve la cámara del móvil.
PROTO_PHOTOS = 4
PROMO_SETS = {"OPP", "PR", "JDG", "OGS"}


def ensure_model():
    if MODEL_SRC.exists():
        return
    from onnxruntime.quantization import QuantType, quantize_dynamic
    import urllib.request

    fp32 = ROOT / "models" / "dinov2s_fp32.onnx"
    if not fp32.exists():
        fp32.parent.mkdir(exist_ok=True)
        print("Descargando DINOv2-small...")
        urllib.request.urlretrieve("https://huggingface.co/onnx-community/dinov2-small/resolve/main/onnx/model.onnx", fp32)
    # Solo MatMul: onnxruntime-web no implementa ConvInteger (la convolución de entrada queda en float32).
    quantize_dynamic(str(fp32), str(MODEL_SRC), per_channel=True, weight_type=QuantType.QInt8, op_types_to_quantize=["MatMul"])


def embed(session, img):
    arr = np.asarray(img.resize((WIDTH, HEIGHT), Image.BICUBIC), np.float32) / 255.0
    x = ((arr - MEAN) / STD).transpose(2, 0, 1)[None]
    t = session.run(None, {"pixel_values": x})[0][0]
    v = np.concatenate([t[0], t[1:].mean(0)])  # token CLS + media de los parches
    return v / np.linalg.norm(v)


def main():
    ensure_model()
    MODEL_DST.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(MODEL_SRC, MODEL_DST)
    session = ort.InferenceSession(str(MODEL_SRC))

    cards = json.loads((DATA / "cards.json").read_text(encoding="utf-8"))
    rng = random.Random(7)
    rows, vecs, portraits = [], [], []
    t0 = time.time()
    for idx, card in enumerate(cards):
        img = Image.open(CACHE / (card["thumb"].split("/")[1].replace(".webp", ".jpg"))).convert("RGB")
        # Las cartas apaisadas (Battlefields) se escanean en vertical, giradas hacia cualquier lado.
        views = [img.rotate(90, expand=True), img.rotate(-90, expand=True)] if img.width > img.height else [img]
        portraits.append(views[0])
        for view in views:
            v = 2 * embed(session, view) + sum(embed(session, fake_photo(view, rng)) for _ in range(PROTO_PHOTOS))
            rows.append(idx)
            vecs.append(v / np.linalg.norm(v))
        if idx % 100 == 0:
            print(f"  {idx}/{len(cards)}  ({time.time() - t0:.0f}s)")

    # Grupos de cartas con la misma ilustración (reimpresiones, promos...): la cámara no puede distinguirlas.
    same = dup_groups(portraits)
    groups, seen = [], set()
    for i in range(len(cards)):
        if i in seen:
            continue
        # El primero del grupo es el que se propone por defecto: mejor la edición normal que el promo.
        g = sorted((int(j) for j in np.nonzero(same[i])[0]), key=lambda j: (cards[j]["set"] in PROMO_SETS, j))
        seen.update(g)
        if len(g) > 1:
            groups.append([cards[j]["id"] for j in g])

    matrix = np.stack(vecs).astype(np.float16)
    (DATA / "index.bin").write_bytes(matrix.tobytes())
    meta = {
        "version": int(time.time()),
        "model": "models/" + MODEL_DST.name,
        "width": WIDTH,
        "height": HEIGHT,
        "mean": MEAN.tolist(),
        "std": STD.tolist(),
        "dim": int(matrix.shape[1]),
        "rows": [cards[i]["id"] for i in rows],
        "sameArt": groups,
    }
    (DATA / "index.json").write_text(json.dumps(meta, separators=(",", ":")), encoding="utf-8")
    print(f"Índice: {matrix.shape[0]} filas x {matrix.shape[1]} dims, {len(groups)} grupos de misma ilustración")


if __name__ == "__main__":
    main()
