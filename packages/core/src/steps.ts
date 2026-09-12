import type { Vec3 } from './types.ts';
import { dot, norm, normalize } from './vec.ts';

/**
 * Detektor kroku + estymacja długości kroku.
 *
 * Kluczowa różnica wobec naiwnego podejścia "peak na osi Z akcelerometru":
 * oś Z telefonu NIE jest pionem, gdy telefon jest trzymany w ręce pod kątem albo
 * leży w kieszeni. Rzutujemy więc przyspieszenie na bieżący wektor grawitacji
 * (z filtru orientacji), co czyni detektor odpornym na sposób trzymania.
 *
 * Model długości kroku: Weinberg
 *      L = K * (a_max - a_min)^(1/4)
 * K kalibrowane per-użytkownik na odcinku o znanej długości (patrz calibrateK).
 */

export interface StepDetectorOpts {
  /** Minimalny odstęp między krokami [ms]. 250 ms ~ 4 kroki/s (górna granica biegu). */
  minStepMs: number;
  /** Maksymalny sensowny odstęp [ms] — powyżej traktujemy jako nową serię. */
  maxStepMs: number;
  /** Bazowy próg amplitudy piku [m/s^2]. */
  baseThreshold: number;
  /** Współczynnik Weinberga (domyślny; skalibruj!). */
  K: number;
  minLength: number;
  maxLength: number;
}

export const DEFAULT_STEP_OPTS: StepDetectorOpts = {
  minStepMs: 250,
  maxStepMs: 2000,
  baseThreshold: 0.6,
  K: 0.47,
  minLength: 0.30,
  maxLength: 1.10,
};

export interface DetectedStep { t: number; length: number; accAmp: number }

export class StepDetector {
  opts: StepDetectorOpts;
  private hp = 0;          // wyjście filtru górnoprzepustowego (usuwa g)
  private lp = 0;          // wyjście pasmowe
  private prevLp = 0;
  private rising = false;
  private peak = -Infinity;
  private valley = Infinity;
  private lastStepT = -Infinity;
  private lastT: number | null = null;
  private ampHist: number[] = [];
  /** Licznik kroków od startu sesji. */
  count = 0;

  constructor(opts: Partial<StepDetectorOpts> = {}) {
    this.opts = { ...DEFAULT_STEP_OPTS, ...opts };
  }

  /**
   * @param t   czas [ms]
   * @param acc surowe przyspieszenie w ramie urządzenia [m/s^2] (z grawitacją)
   * @param gravityDev znormalizowany wektor grawitacji w ramie urządzenia (z AttitudeFilter)
   */
  push(t: number, acc: Vec3, gravityDev: Vec3): DetectedStep | null {
    if (this.lastT === null) { this.lastT = t; return null; }
    const dt = Math.max(1e-3, Math.min((t - this.lastT) / 1000, 0.2));
    this.lastT = t;

    // Składowa wzdłuż grawitacji, bez g.
    const g = norm(gravityDev) > 0.5 ? gravityDev : normalize(acc);
    const aVert = dot(acc, g) - 9.81;

    // Pasmo 0.5–3 Hz: HP (usuwa dryf/resztkę g) + LP (usuwa szum wysokoczęstotliwościowy).
    const fcHi = 0.5, fcLo = 3.0;
    const aHi = 1 / (1 + 2 * Math.PI * fcHi * dt);
    const aLo = (2 * Math.PI * fcLo * dt) / (1 + 2 * Math.PI * fcLo * dt);
    this.hp = aHi * (this.hp + aVert - (this._prevVert ?? aVert));
    this._prevVert = aVert;
    this.prevLp = this.lp;
    this.lp = this.lp + aLo * (this.hp - this.lp);

    // Adaptacyjny próg z historii amplitud.
    const thr = this.adaptiveThreshold();

    // Detekcja: przejście z narastania w opadanie powyżej progu = pik.
    const dv = this.lp - this.prevLp;
    let out: DetectedStep | null = null;

    if (dv > 0) {
      if (!this.rising) { this.rising = true; this.valley = Math.min(this.valley, this.prevLp); }
      this.peak = Math.max(this.peak, this.lp);
    } else if (dv < 0 && this.rising) {
      this.rising = false;
      const amp = this.peak - this.valley;
      const gap = t - this.lastStepT;
      if (this.peak > thr && amp > this.opts.baseThreshold && gap >= this.opts.minStepMs) {
        this.lastStepT = t;
        this.count++;
        this.ampHist.push(amp);
        if (this.ampHist.length > 20) this.ampHist.shift();
        const length = this.clamp(this.opts.K * Math.pow(Math.max(amp, 1e-3), 0.25));
        out = { t, length, accAmp: amp };
      }
      this.peak = -Infinity;
      this.valley = Infinity;
    }
    return out;
  }

  private _prevVert: number | undefined;

  private adaptiveThreshold(): number {
    if (this.ampHist.length < 3) return this.opts.baseThreshold * 0.5;
    const m = this.ampHist.reduce((a, b) => a + b, 0) / this.ampHist.length;
    return Math.max(this.opts.baseThreshold * 0.4, 0.25 * m);
  }

  private clamp(l: number): number {
    return Math.max(this.opts.minLength, Math.min(this.opts.maxLength, l));
  }
}

/**
 * Kalibracja K na odcinku o znanej długości.
 * Przejdź prostą, zmierzoną trasę (>= 20 m), zbierz amplitudy pików.
 * @returns współczynnik K do wstawienia w StepDetectorOpts
 */
export function calibrateK(knownDistanceM: number, amps: number[]): number {
  if (!amps.length) return DEFAULT_STEP_OPTS.K;
  const sum = amps.reduce((a, x) => a + Math.pow(Math.max(x, 1e-3), 0.25), 0);
  return knownDistanceM / sum;
}
