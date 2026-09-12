import type { Fix, MagFeature, Sample, StepEvent, Vec3 } from './types.ts';
import { AttitudeFilter } from './attitude.ts';
import { StepDetector, type StepDetectorOpts } from './steps.ts';
import { magFeature, DEFAULT_MAGFEAT_OPTS, type MagFeatOpts } from './magfeat.ts';
import { MagMap } from './magmap.ts';
import { VenueMap } from './graph.ts';
import { ParticleFilter, type PFOpts } from './pf.ts';
import { baroAltitude } from './geo.ts';
import { wrapPi, v3, sub } from './vec.ts';

/**
 * Spina wszystko w jeden przepływ: próbki czujników -> fixy pozycji.
 * TEN SAM kod uruchamia się w aplikacji na telefonie i w narzędziu replay
 * w Node. Jedna implementacja = brak rozjazdu między prototypem a produktem.
 */

export type Mode = 'NAV' | 'SURVEY';

export interface PipelineOpts {
  mode: Mode;
  step: Partial<StepDetectorOpts>;
  pf: Partial<PFOpts>;
  magfeat: MagFeatOpts;
  /** Korygować kurs magnetometrem, gdy pole jest "czyste"? */
  useCleanMagHeading: boolean;
  /** Waga korekty kursu z czystego pola (0..1 na krok). */
  magHeadingGain: number;
  /** Tryb SURVEY: traktuj próbki 'mark' z podanymi x,y jako pewne kotwice pozycji. */
  anchorOnMark: boolean;
  /** Tryb SURVEY: co który odczyt magnetometru trafia do mapy. */
  surveyEvery: number;
}

export const DEFAULT_PIPELINE_OPTS: PipelineOpts = {
  mode: 'NAV',
  step: {},
  pf: {},
  magfeat: DEFAULT_MAGFEAT_OPTS,
  useCleanMagHeading: true,
  magHeadingGain: 0.05,
  anchorOnMark: false,
  surveyEvery: 5,
};

export class Pipeline {
  opts: PipelineOpts;
  att = new AttitudeFilter();
  det: StepDetector;
  pf: ParticleFilter;
  magmap: MagMap | null = null;
  venue: VenueMap | null = null;

  private lastMag: Vec3 | null = null;
  private magBias: Vec3 = v3(0, 0, 0);
  private lastFeature: MagFeature | null = null;
  private prevHeading: number | null = null;
  private p0: number | null = null;
  private dz: number | null = null;
  private headingOffsetToNorth = 0;

  /** Historia — do rysowania i metryk. */
  fixes: Fix[] = [];
  steps: StepEvent[] = [];
  /** Surowa trajektoria PDR (bez filtru) — baseline do porównania w pitchu. */
  rawPDR: { t: number; x: number; y: number }[] = [];
  private rx = 0; private ry = 0;

  constructor(opts: Partial<PipelineOpts> = {}) {
    this.opts = { ...DEFAULT_PIPELINE_OPTS, ...opts };
    this.det = new StepDetector(this.opts.step);
    this.pf = new ParticleFilter(this.opts.pf);
  }

  attachVenue(v: VenueMap): void { this.venue = v; this.pf.venue = v; }
  attachMagMap(m: MagMap): void { this.magmap = m; this.pf.magmap = m; }

  /** Ustawia punkt startowy (LKP) i kurs początkowy (rad, 0 = Północ). */
  start(x0: number, y0: number, heading0 = 0): void {
    this.pf.init(x0, y0, heading0);
    this.rx = x0; this.ry = y0;
    this.headingOffsetToNorth = heading0;
    this.rawPDR.push({ t: 0, x: x0, y: y0 });
  }

  /** Główne wejście. Zwraca Fix tylko w momencie wykrycia kroku. */
  push(s: Sample): Fix | null {
    switch (s.type) {
      case 'acc': {
        const a = v3(s.x, s.y, s.z);
        this.att.onAccel(s.t, a);
        const st = this.det.push(s.t, a, this.att.gravityDev);
        if (st) return this.onStep(st.t, st.length, st.accAmp);
        return null;
      }
      case 'gyr':
        this.att.onGyro(s.t, v3(s.x, s.y, s.z));
        return null;
      case 'mag':
        this.lastMag = v3(s.x, s.y, s.z);
        this.lastFeature = magFeature(this.att.q, this.lastMag, this.opts.magfeat);
        this.surveySample();
        return null;
      case 'magu':
        this.magBias = v3(s.bx, s.by, s.bz);
        this.lastMag = sub(v3(s.x, s.y, s.z), this.magBias);
        this.lastFeature = magFeature(this.att.q, this.lastMag, this.opts.magfeat);
        this.surveySample();
        return null;
      case 'bar':
        if (this.p0 === null) this.p0 = s.p;
        this.dz = baroAltitude(s.p, this.p0);
        return null;
      case 'mark':
        if (this.opts.anchorOnMark && s.x !== undefined && s.y !== undefined) this.anchor(s.x, s.y, 0.5);
        return null;
      case 'gps':
        return null;
    }
  }

  /**
   * Tryb SURVEY: zapisuje odczyt do mapy magnetycznej w bieżącej estymowanej pozycji.
   * Próbkujemy co N-ty odczyt, żeby mapa nie puchła i żeby postoje nie dominowały statystyk.
   */
  private surveyN = 0;
  private surveySample(): void {
    if (this.opts.mode !== 'SURVEY' || !this.magmap || !this.lastFeature) return;
    if (this.fixes.length === 0) return;
    if (this.surveyN++ % this.opts.surveyEvery !== 0) return;
    const f = this.fixes[this.fixes.length - 1];
    this.magmap.add(f.x, f.y, this.lastFeature);
  }

  private onStep(t: number, length: number, accAmp: number): Fix {
    const heading = wrapPi(this.att.heading + this.headingOffsetToNorth);
    const dHeading = this.prevHeading === null ? 0 : wrapPi(heading - this.prevHeading);
    this.prevHeading = heading;

    const ev: StepEvent = {
      t, length, heading, dHeading, mag: this.lastFeature, dz: this.dz, accAmp,
    };
    this.steps.push(ev);

    // Baseline: czyste PDR bez filtru — do porównania "przed/po" w prezentacji.
    this.rx += length * Math.sin(heading);
    this.ry += length * Math.cos(heading);
    this.rawPDR.push({ t, x: this.rx, y: this.ry });

    const fix = this.pf.step(ev);
    this.fixes.push(fix);

    return fix;
  }

  /**
   * Wstrzyknięcie zewnętrznej, pewnej pozycji (kod QR w drzwiach, fix GNSS,
   * ręczne wskazanie na mapie). Zachowuje rozkład kursu, przesuwa tylko pozycję.
   */
  anchor(x: number, y: number, sigma = 1.5): void {
    const n = this.pf.opts.n;
    let mx = 0, my = 0;
    for (let i = 0; i < n; i++) { mx += this.pf.w[i] * this.pf.x[i]; my += this.pf.w[i] * this.pf.y[i]; }
    for (let i = 0; i < n; i++) {
      const k = sigma / Math.max(sigma + 3, 1e-6);
      this.pf.x[i] = x + (this.pf.x[i] - mx) * k;
      this.pf.y[i] = y + (this.pf.y[i] - my) * k;
      this.pf.w[i] = 1 / n;
    }
    this.rx = x; this.ry = y;
  }
}
