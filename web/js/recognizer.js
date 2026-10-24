// Reconocimiento de cartas: DINOv2-small (ONNX) + búsqueda del vecino más cercano
// entre los embeddings de referencia que genera tools/build_index.py.

const ORT_CDN = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/';
const MODEL_CACHE = 'rb-model';

// Tabla float16 -> float32 para decodificar index.bin.
const F16 = (() => {
  const t = new Float32Array(65536);
  for (let h = 0; h < 65536; h++) {
    const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 0x1f, f = h & 0x3ff;
    t[h] = e === 0 ? s * 2 ** -14 * (f / 1024) : e === 31 ? (f ? NaN : s * Infinity) : s * 2 ** (e - 15) * (1 + f / 1024);
  }
  return t;
})();

async function fetchWithProgress(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  // content-length es solo orientativo: si el servidor comprime (GitHub Pages usa gzip) indica el
  // tamaño comprimido, pero el stream entrega los bytes ya descomprimidos.
  const total = +res.headers.get('content-length') || 0;
  if (!res.body || !total) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    onProgress?.(Math.min(got / total, 0.99));
  }
  const out = new Uint8Array(got);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

// El modelo pesa ~24 MB: se guarda en la Cache API para no descargarlo cada vez.
async function loadModel(url, version, onProgress) {
  const key = `${url}?v=${version}`;
  try {
    const cache = await caches.open(MODEL_CACHE);
    const hit = await cache.match(key);
    if (hit) return new Uint8Array(await hit.arrayBuffer());
    const bytes = await fetchWithProgress(url, onProgress);
    for (const old of await cache.keys()) await cache.delete(old);
    await cache.put(key, new Response(bytes));
    return bytes;
  } catch {
    return fetchWithProgress(url, onProgress); // sin Cache API (http no seguro, modo privado…)
  }
}

export class Recognizer {
  constructor(cards) {
    this.cards = cards;
    this.byId = new Map(cards.map((c) => [c.id, c]));
    this.canvas = document.createElement('canvas');
    this.ctx = null;
    this.busy = false;
  }

  async load(onProgress) {
    const meta = await (await fetch('data/index.json')).json();
    this.meta = meta;
    this.canvas.width = meta.width;
    this.canvas.height = meta.height;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });

    const bin = new Uint16Array((await fetchWithProgress(`data/index.bin?v=${meta.version}`)).buffer);
    this.matrix = new Float32Array(bin.length);
    for (let i = 0; i < bin.length; i++) this.matrix[i] = F16[bin[i]];
    this.rows = meta.rows;
    this.dim = meta.dim;

    // Cartas con la misma ilustración: la cámara no las distingue, se tratan como un grupo.
    this.group = new Map();
    meta.sameArt.forEach((g, gi) => g.forEach((id) => this.group.set(id, gi)));

    ort.env.wasm.wasmPaths = ORT_CDN;
    ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
    const model = await loadModel(meta.model, meta.version, onProgress);
    this.session = await ort.InferenceSession.create(model, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    });
    this.inputName = this.session.inputNames[0];
  }

  /** Dibuja la región (sx, sy, sw, sh) de `source` y devuelve su embedding normalizado. */
  async embed(source, sx = 0, sy = 0, sw, sh) {
    const { width: W, height: H, mean, std } = this.meta;
    sw ??= source.videoWidth || source.naturalWidth || source.width;
    sh ??= source.videoHeight || source.naturalHeight || source.height;
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = 'high';
    this.ctx.drawImage(source, sx, sy, sw, sh, 0, 0, W, H);
    const px = this.ctx.getImageData(0, 0, W, H).data;
    const n = W * H;
    const x = new Float32Array(3 * n);
    for (let i = 0; i < n; i++) {
      x[i] = (px[4 * i] / 255 - mean[0]) / std[0];
      x[n + i] = (px[4 * i + 1] / 255 - mean[1]) / std[1];
      x[2 * n + i] = (px[4 * i + 2] / 255 - mean[2]) / std[2];
    }
    const out = await this.session.run({ [this.inputName]: new ort.Tensor('float32', x, [1, 3, H, W]) });
    const t = out[this.session.outputNames[0]].data; // [1, tokens, 384]
    const d = this.dim / 2, tokens = t.length / d;
    const v = new Float32Array(this.dim);
    for (let j = 0; j < d; j++) v[j] = t[j]; // token CLS
    for (let k = 1; k < tokens; k++) for (let j = 0; j < d; j++) v[d + j] += t[k * d + j];
    for (let j = 0; j < d; j++) v[d + j] /= tokens - 1; // media de los parches
    let norm = 0;
    for (let j = 0; j < this.dim; j++) norm += v[j] * v[j];
    norm = Math.sqrt(norm) || 1;
    for (let j = 0; j < this.dim; j++) v[j] /= norm;
    return v;
  }

  /** Mejores `k` cartas (una entrada por grupo de ilustración) con su similitud coseno. */
  search(v, k = 5) {
    const best = new Map(); // id -> score
    const { matrix, dim, rows } = this;
    for (let r = 0; r < rows.length; r++) {
      let s = 0;
      const o = r * dim;
      for (let j = 0; j < dim; j++) s += matrix[o + j] * v[j];
      const id = rows[r];
      if (!(best.get(id) >= s)) best.set(id, s);
    }
    const sorted = [...best].sort((a, b) => b[1] - a[1]);
    const out = [], seen = new Set();
    for (const [id, score] of sorted) {
      const gi = this.group.get(id);
      const g = gi === undefined ? id : `g${gi}`;
      if (seen.has(g)) continue;
      seen.add(g);
      const pick = gi === undefined ? id : this.meta.sameArt[gi][0];
      out.push({ id: pick, card: this.byId.get(pick), score });
      if (out.length >= k) break;
    }
    return out;
  }

  /** Ids de cartas con la misma ilustración que `id` (incluida ella). */
  sameArt(id) {
    if (!this.group.has(id)) return [id];
    return this.meta.sameArt[this.group.get(id)];
  }
}
