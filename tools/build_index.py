"""Calcula los embeddings de referencia de todas las cartas para el reconocimiento.

Requiere haber ejecutado antes tools/fetch_cards.py.

Genera:
    web/models/dinov2s_qmm.onnx   modelo DINOv2-small con las MatMul cuantizadas a int8 por canal
    web/data/index.bin            matriz float16 (filas x 768) normalizada
    web/data/index.json           a qué carta corresponde cada fila + parámetros del modelo

Uso:
    python tools/build_index.py                 # todo desde cero
    python tools/build_index.py --incremental   # solo las cartas que aún no están en el índice

En modo incremental se usa el modelo ya publicado (web/models) para que los vectores nuevos
sean compatibles con los existentes. Es lo que hace la actualización diaria automática.
"""
import hashlib
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


def load_existing():
    """{id: [vectores]} del índice publicado, o {} si no hay."""
    try:
        meta = json.loads((DATA / "index.json").read_text(encoding="utf-8"))
        m = np.frombuffer((DATA / "index.bin").read_bytes(), np.float16).reshape(-1, meta["dim"])
    except FileNotFoundError:
        return {}
    old = {}
    for cid, v in zip(meta["rows"], m):
        old.setdefault(cid, []).append(v.astype(np.float32))
    return old


def existing_groups():
    try:
        return json.loads((DATA / "index.json").read_text(encoding="utf-8"))["sameArt"]
    except (FileNotFoundError, KeyError):
        return None


def art_groups(cards, portraits):
    """Grupos de cartas con la misma ilustración, que la cámara no puede distinguir:
    reimpresiones y promos idénticas (por píxeles) y cada Showcase firmada ("ven-189*") con su
    versión sin firmar ("ven-189"), aunque la imagen de la firmada sea una foto con brillo foil."""
    parent = list(range(len(cards)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union(i, j):
        parent[find(i)] = find(j)

    same = dup_groups(portraits)
    for i, j in zip(*np.nonzero(np.triu(same, 1))):
        union(int(i), int(j))
    by_key = {"-".join(c["id"].split("-")[:2]): i for i, c in enumerate(cards)}
    for key, i in by_key.items():
        if key.endswith("*") and key[:-1] in by_key:
            union(i, by_key[key[:-1]])

    members = {}
    for i in range(len(cards)):
        members.setdefault(find(i), []).append(i)
    groups = []
    for g in members.values():
        if len(g) > 1:
            # El primero es el que se propone por defecto: la edición normal antes que promos y firmadas.
            g.sort(key=lambda j: (cards[j]["set"] in PROMO_SETS, "*" in cards[j]["id"], j))
            groups.append([cards[j]["id"] for j in g])
    return sorted(groups, key=lambda g: g[0])


def main():
    incremental = "--incremental" in sys.argv
    if incremental and MODEL_DST.exists():
        model = MODEL_DST  # el mismo modelo con el que se calcularon los vectores existentes
    else:
        ensure_model()
        MODEL_DST.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(MODEL_SRC, MODEL_DST)
        model = MODEL_SRC
    session = ort.InferenceSession(str(model))
    old = load_existing() if incremental else {}

    cards = json.loads((DATA / "cards.json").read_text(encoding="utf-8"))
    rng = random.Random(7)
    rows, vecs, portraits = [], [], []
    computed = 0
    t0 = time.time()
    for idx, card in enumerate(cards):
        img = Image.open(CACHE / (card["thumb"].split("/")[1].replace(".webp", ".jpg"))).convert("RGB")
        # Las cartas apaisadas (Battlefields) se escanean en vertical, giradas hacia cualquier lado.
        views = [img.rotate(90, expand=True), img.rotate(-90, expand=True)] if img.width > img.height else [img]
        portraits.append(views[0])
        if card["id"] in old and len(old[card["id"]]) == len(views):
            for v in old[card["id"]]:
                rows.append(idx)
                vecs.append(v)
            continue
        for view in views:
            v = 2 * embed(session, view) + sum(embed(session, fake_photo(view, rng)) for _ in range(PROTO_PHOTOS))
            rows.append(idx)
            vecs.append(v / np.linalg.norm(v))
        computed += 1
        if computed % 100 == 0:
            print(f"  {computed} cartas calculadas  ({time.time() - t0:.0f}s)")
    removed = set(old) - {c["id"] for c in cards}
    groups = art_groups(cards, portraits)
    if incremental and not computed and not removed and groups == existing_groups():
        print("Índice al día: no hay cartas nuevas.")
        return
    print(f"Vectores calculados: {computed} cartas · reutilizados: {len(cards) - computed} · eliminados: {len(removed)}")

    matrix = np.stack(vecs).astype(np.float16)
    (DATA / "index.bin").write_bytes(matrix.tobytes())
    meta = {
        "version": int(time.time()),
        "model": "models/" + MODEL_DST.name,
        # La app guarda el modelo en caché con esta clave: solo se vuelve a descargar si cambia.
        "modelVersion": hashlib.sha1(MODEL_DST.read_bytes()).hexdigest()[:12],
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
