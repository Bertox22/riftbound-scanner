// Cámara + bucle de reconocimiento continuo.
//
// Máquina de estados:
//   - "buscando": cuando la misma carta sale primera en STABLE_FRAMES fotogramas seguidos con
//     similitud >= accept y ventaja suficiente sobre la segunda, se añade (si el modo automático
//     está activo) y pasa a "bloqueada". Si la coincidencia es muy clara (STRONG) basta un fotograma.
//   - "bloqueada": no se vuelve a añadir esa carta hasta que salga del recuadro (similitud por
//     debajo de release durante RELEASE_FRAMES) o aparezca otra carta distinta con claridad.
//     Así se pueden pasar varias copias iguales seguidas: basta con retirar una y poner la otra.

const STABLE_FRAMES = 2;
const RELEASE_FRAMES = 2;
const STRONG = { extraScore: 0.1, marginFactor: 2 };

export const DEFAULT_THRESHOLDS = { accept: 0.7, margin: 0.03, release: 0.55 }; // ver tools/calibrate.py

export class Scanner {
  constructor({ video, guide, recognizer, onResult, onAccept, onStatus }) {
    Object.assign(this, { video, guide, recognizer, onResult, onAccept, onStatus });
    this.running = false;
    this.auto = true;
    this.thresholds = { ...DEFAULT_THRESHOLDS };
    this.reset();
  }

  reset() {
    this.streak = { id: null, n: 0 };
    this.locked = null;
    this.lowFrames = 0;
  }

  async start() {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Este navegador no permite usar la cámara aquí (hace falta HTTPS).');
    }
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    });
    this.video.srcObject = this.stream;
    await this.video.play();
    this.track = this.stream.getVideoTracks()[0];
    try {
      // Enfoque continuo si el móvil lo admite (mejora mucho la lectura de cerca).
      const caps = this.track.getCapabilities?.() || {};
      if (caps.focusMode?.includes('continuous')) await this.track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
      this.torchSupported = !!caps.torch;
    } catch { /* opcional */ }
    this.running = true;
    this.reset();
    this.loop();
  }

  stop() {
    this.running = false;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
  }

  async setTorch(on) {
    if (!this.track) return;
    await this.track.applyConstraints({ advanced: [{ torch: on }] });
  }

  /** Región del vídeo (en píxeles del sensor) que queda bajo el recuadro guía. */
  cropRect() {
    const v = this.video, vw = v.videoWidth, vh = v.videoHeight;
    const vr = v.getBoundingClientRect(), gr = this.guide.getBoundingClientRect();
    const scale = Math.max(vr.width / vw, vr.height / vh); // object-fit: cover
    const offX = (vr.width - vw * scale) / 2, offY = (vr.height - vh * scale) / 2;
    const sx = (gr.left - vr.left - offX) / scale, sy = (gr.top - vr.top - offY) / scale;
    return [sx, sy, gr.width / scale, gr.height / scale];
  }

  async loop() {
    while (this.running) {
      if (this.video.readyState < 2) {
        await new Promise((r) => setTimeout(r, 100));
        continue;
      }
      const t0 = performance.now();
      try {
        const v = await this.recognizer.embed(this.video, ...this.cropRect());
        this.handle(this.recognizer.search(v, 5), performance.now() - t0);
      } catch (err) {
        console.error(err);
        this.onStatus?.(`Error: ${err.message}`);
        await new Promise((r) => setTimeout(r, 500));
      }
      await new Promise((r) => requestAnimationFrame(r));
    }
  }

  handle(results, ms) {
    const [top, second] = results;
    const { accept, margin, release } = this.thresholds;
    const gap = top.score - (second?.score ?? 0);
    const confident = top.score >= accept && gap >= margin;
    const strong = top.score >= accept + STRONG.extraScore && gap >= margin * STRONG.marginFactor;

    if (this.locked) {
      const lockedScore = results.find((r) => r.id === this.locked)?.score ?? 0;
      this.lowFrames = lockedScore < release ? this.lowFrames + 1 : 0;
      if (this.lowFrames >= RELEASE_FRAMES || (confident && top.id !== this.locked)) {
        this.locked = null;
        this.streak = { id: null, n: 0 };
      }
    }

    if (confident && !this.locked) {
      this.streak = this.streak.id === top.id ? { id: top.id, n: this.streak.n + 1 } : { id: top.id, n: 1 };
      if ((this.streak.n >= STABLE_FRAMES || strong) && this.auto) {
        this.locked = top.id;
        this.lowFrames = 0;
        this.onAccept?.(top.card, top.score);
      }
    } else if (!confident) {
      this.streak = { id: null, n: 0 };
    }

    const state = this.locked ? 'locked' : confident ? 'confident' : top.score >= release ? 'unsure' : 'empty';
    this.onResult?.({ results, state, ms });
  }

  /** El usuario ha añadido a mano una carta: se bloquea igual que si se hubiera añadido sola. */
  markAdded(id) {
    this.locked = id;
    this.lowFrames = 0;
  }
}
