import type { Fix, StepEvent } from './types.ts';
import { wrapPi } from './vec.ts';
import type { MagMap } from './magmap.ts';
import type { VenueMap } from './graph.ts';

/**
 * Filtr cząsteczkowy działający NA ZDARZENIE KROKU (ok. 2 Hz), nie na próbkę
 * czujnika (100 Hz). To jest powód, dla którego 500-1500 cząstek liczy się
 * w czystym JavaScripcie na telefonie bez zacinania UI.
 *
 * Stan cząstki:
 *   x, y   — pozycja w lokalnym ENU [m]
 *   th     — kurs [rad], 0 = Północ, rosnący zgodnie z ruchem wskazówek
 *   k      — indywidualny mnożnik długości kroku (uczy się sylwetki użytkownika)
 *   bw     — systematyczny bias skrętu [rad/krok] (łapie dryf żyroskopu)
 */
export interface PFOpts {
  n: number;
  /** Sigma szumu długości kroku (ułamek długości). */
  sigmaLen: number;
  /** Sigma szumu przyrostu kursu [rad] na krok. */
  sigmaTurn: number;
  /** Dyfuzja mnożnika długości kroku na krok. */
  sigmaK: number;
  /** Dyfuzja biasu skrętu [rad] na krok. */
  sigmaBw: number;
  /** Waga (mnożnik log-wiarygodności) obserwacji magnetycznej. */
  magWeight: number;
  /** Kara [log] za odległość od ścieżki chodzenia; 0 = wyłączone. */
  walkablePull: number;
  /** Próg N_eff/N wyzwalający resampling. */
  resampleAt: number;
  /** Współczynnik K roughening'u (Gordon): sigma = K * rozrzut * N^(-1/4). */
  roughening: number;
  seed: number;
}

export const DEFAULT_PF_OPTS: PFOpts = {
  n: 800,
  sigmaLen: 0.10,
  sigmaTurn: 0.035,
  sigmaK: 0.004,
  sigmaBw: 0.002,
  magWeight: 1.0,
  walkablePull: 0.15,
  resampleAt: 0.5,
  roughening: 0.08,
  seed: 42,
};

export class ParticleFilter {
  opts: PFOpts;
  x: Float64Array; y: Float64Array; th: Float64Array; k: Float64Array; bw: Float64Array; w: Float64Array;
  private rngState: number;
  private lastHeading: number | null = null;
  venue: VenueMap | null = null;
  magmap: MagMap | null = null;
  /** Statystyka: ile cząstek zabiły ściany w ostatnim kroku. */
  lastSurvival = 1;

  constructor(opts: Partial<PFOpts> = {}) {
    this.opts = { ...DEFAULT_PF_OPTS, ...opts };
    const n = this.opts.n;
    this.x = new Float64Array(n); this.y = new Float64Array(n);
    this.th = new Float64Array(n); this.k = new Float64Array(n);
    this.bw = new Float64Array(n); this.w = new Float64Array(n);
    this.rngState = this.opts.seed >>> 0 || 1;
  }

  /** Inicjalizacja wokół znanej pozycji (LKP) z zadaną niepewnością. */
  init(x0: number, y0: number, h0: number, posSigma = 3, headSigma = 0.35): void {
    const n = this.opts.n;
    for (let i = 0; i < n; i++) {
      this.x[i] = x0 + this.gauss() * posSigma;
      this.y[i] = y0 + this.gauss() * posSigma;
      this.th[i] = h0 + this.gauss() * headSigma;
      this.k[i] = 1 + this.gauss() * 0.08;
      this.bw[i] = 0;
      this.w[i] = 1 / n;
    }
    this.lastHeading = h0;
  }

  /** Inicjalizacja globalna: rozsyp cząstki po całej mapie (brak LKP). */
  initGlobal(minX: number, minY: number, maxX: number, maxY: number): void {
    const n = this.opts.n;
    for (let i = 0; i < n; i++) {
      this.x[i] = minX + this.rand() * (maxX - minX);
      this.y[i] = minY + this.rand() * (maxY - minY);
      this.th[i] = this.rand() * 2 * Math.PI - Math.PI;
      this.k[i] = 1 + this.gauss() * 0.08;
      this.bw[i] = 0;
      this.w[i] = 1 / n;
    }
    this.lastHeading = 0;
  }

  step(ev: StepEvent): Fix {
    const o = this.opts;
    const n = o.n;
    const dPsi = this.lastHeading === null ? 0 : ev.dHeading;
    this.lastHeading = ev.heading;

    let alive = 0;
    let maxLog = -Infinity;
    const logw = new Float64Array(n);

    for (let i = 0; i < n; i++) {
      // --- propagacja ---
      this.bw[i] += this.gauss() * o.sigmaBw;
      this.th[i] = wrapPi(this.th[i] + dPsi + this.bw[i] + this.gauss() * o.sigmaTurn);
      this.k[i] = Math.max(0.5, Math.min(1.6, this.k[i] + this.gauss() * o.sigmaK));
      const L = ev.length * this.k[i] * (1 + this.gauss() * o.sigmaLen);
      const nx = this.x[i] + L * Math.sin(this.th[i]); // East
      const ny = this.y[i] + L * Math.cos(this.th[i]); // North

      // --- twarde ograniczenie: ściany ---
      if (this.venue && this.venue.crossesWall(this.x[i], this.y[i], nx, ny)) {
        logw[i] = -Infinity;
        continue;
      }
      this.x[i] = nx; this.y[i] = ny;
      alive++;

      // --- miękkie obserwacje ---
      let ll = Math.log(Math.max(this.w[i], 1e-300));
      if (this.magmap && ev.mag) ll += o.magWeight * this.magmap.logLikelihood(nx, ny, ev.mag);
      if (this.venue && o.walkablePull > 0) {
        const d = this.venue.distToWalkable(nx, ny);
        if (Number.isFinite(d)) ll -= o.walkablePull * d * d;
      }
      logw[i] = ll;
      if (ll > maxLog) maxLog = ll;
    }

    this.lastSurvival = alive / n;

    // Awaria: wszystkie cząstki wpadły w ścianę -> reset wag zamiast NaN.
    if (!Number.isFinite(maxLog)) {
      for (let i = 0; i < n; i++) this.w[i] = 1 / n;
      return this.estimate(ev, 'pdr');
    }

    let sum = 0;
    for (let i = 0; i < n; i++) {
      const v = logw[i] === -Infinity ? 0 : Math.exp(logw[i] - maxLog);
      this.w[i] = v; sum += v;
    }
    if (sum <= 0) { for (let i = 0; i < n; i++) this.w[i] = 1 / n; }
    else { for (let i = 0; i < n; i++) this.w[i] /= sum; }

    const nEff = this.nEff();
    if (nEff < o.resampleAt * n) this.resample();

    const src: Fix['source'] =
      this.magmap && ev.mag && this.magmap.size > 0 ? 'pdr+map+mag' : this.venue ? 'pdr+map' : 'pdr';
    return this.estimate(ev, src);
  }

  nEff(): number {
    let s = 0;
    for (let i = 0; i < this.opts.n; i++) s += this.w[i] * this.w[i];
    return s > 0 ? 1 / s : 0;
  }

  private estimate(ev: StepEvent, source: Fix['source']): Fix {
    const n = this.opts.n;
    let mx = 0, my = 0, sc = 0, ss = 0;
    for (let i = 0; i < n; i++) {
      mx += this.w[i] * this.x[i]; my += this.w[i] * this.y[i];
      sc += this.w[i] * Math.cos(this.th[i]); ss += this.w[i] * Math.sin(this.th[i]);
    }
    let sxx = 0, syy = 0, sxy = 0;
    for (let i = 0; i < n; i++) {
      const dx = this.x[i] - mx, dy = this.y[i] - my;
      sxx += this.w[i] * dx * dx; syy += this.w[i] * dy * dy; sxy += this.w[i] * dx * dy;
    }
    // 1-sigma promień = pierwiastek większej wartości własnej kowariancji
    const tr = sxx + syy, det = sxx * syy - sxy * sxy;
    const disc = Math.max(0, (tr * tr) / 4 - det);
    const lmax = tr / 2 + Math.sqrt(disc);
    return {
      t: ev.t, x: mx, y: my, cov: [sxx, syy, sxy], r68: Math.sqrt(Math.max(lmax, 0)),
      heading: Math.atan2(ss, sc), nEff: this.nEff(), survival: this.lastSurvival, source,
    };
  }

  private resample(): void {
    const n = this.opts.n;
    const nx = new Float64Array(n), ny = new Float64Array(n),
      nt = new Float64Array(n), nk = new Float64Array(n), nb = new Float64Array(n);
    // systematic resampling
    const u0 = this.rand() / n;
    let c = this.w[0], i = 0;
    for (let j = 0; j < n; j++) {
      const u = u0 + j / n;
      while (u > c && i < n - 1) { i++; c += this.w[i]; }
      nx[j] = this.x[i]; ny[j] = this.y[i]; nt[j] = this.th[i]; nk[j] = this.k[i]; nb[j] = this.bw[i];
    }
    // Roughening (Gordon 1993) — bez tego resampling zabija różnorodność cząstek
    // i filtr "zatrzaskuje się" na błędnej hipotezie (klasyczna awaria: kilka
    // dobrych przebiegów i nagle jeden, w którym filtr ucieka o 30 m).
    // Sigma skalowana szerokością chmury i liczbą cząstek: K * E * N^(-1/d).
    const d = 4; // wymiar stanu: x, y, th, k
    const sc = this.opts.roughening * Math.pow(n, -1 / d);
    const spread = (a: Float64Array): number => {
      let lo = Infinity, hi = -Infinity;
      for (let j = 0; j < n; j++) { if (a[j] < lo) lo = a[j]; if (a[j] > hi) hi = a[j]; }
      return hi - lo;
    };
    const ex = spread(nx) * sc, ey = spread(ny) * sc, et = spread(nt) * sc;
    for (let j = 0; j < n; j++) {
      this.x[j] = nx[j] + this.gauss() * ex;
      this.y[j] = ny[j] + this.gauss() * ey;
      this.th[j] = nt[j] + this.gauss() * et;
      this.k[j] = nk[j]; this.bw[j] = nb[j];
      this.w[j] = 1 / n;
    }
  }

  // Deterministyczny RNG (mulberry32) — powtarzalne testy i replay.
  private rand(): number {
    this.rngState = (this.rngState + 0x6d2b79f5) >>> 0;
    let t = this.rngState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  private spare: number | null = null;
  private gauss(): number {
    if (this.spare !== null) { const s = this.spare; this.spare = null; return s; }
    let u = 0, v = 0, s = 0;
    do { u = this.rand() * 2 - 1; v = this.rand() * 2 - 1; s = u * u + v * v; } while (s === 0 || s >= 1);
    const f = Math.sqrt((-2 * Math.log(s)) / s);
    this.spare = v * f;
    return u * f;
  }
}
