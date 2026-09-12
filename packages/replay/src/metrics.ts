import type { Fix } from '../../core/src/types.ts';

export interface Truth { t: number; x: number; y: number }

export interface Metrics {
  n: number;
  /** Błąd zamknięcia pętli [m] — dystans między pierwszym a ostatnim punktem, gdy trasa jest pętlą. */
  closureErr: number;
  /** Przebyty dystans [m]. */
  distance: number;
  /** Błąd zamknięcia jako % przebytej drogi — standardowa miara jakości PDR. */
  closurePct: number;
  meanErr: number;
  rmse: number;
  cep50: number;
  cep95: number;
  maxErr: number;
  /** Średni promień 1-sigma raportowany przez filtr — porównaj z rmse: filtr ma być UCZCIWY. */
  meanR68: number;
  /** Ułamek próbek, gdzie prawdziwy błąd < raportowany r68. Idealnie ~0.68. */
  calibration: number;
}

export function interpTruth(truth: Truth[], t: number): Truth | null {
  if (!truth.length) return null;
  if (t <= truth[0].t) return truth[0];
  if (t >= truth[truth.length - 1].t) return truth[truth.length - 1];
  let lo = 0, hi = truth.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (truth[mid].t <= t) lo = mid; else hi = mid; }
  const a = truth[lo], b = truth[hi];
  const u = (t - a.t) / Math.max(1, b.t - a.t);
  return { t, x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
}

export function evaluate(fixes: Fix[], truth: Truth[], isLoop = true): Metrics {
  const errs: number[] = [];
  let inside = 0, sumR = 0;
  for (const f of fixes) {
    const g = interpTruth(truth, f.t);
    if (!g) continue;
    const e = Math.hypot(f.x - g.x, f.y - g.y);
    errs.push(e);
    sumR += f.r68;
    if (e <= f.r68) inside++;
  }
  const sorted = [...errs].sort((a, b) => a - b);
  const q = (p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : NaN);

  let distance = 0;
  for (let i = 1; i < truth.length; i++) distance += Math.hypot(truth[i].x - truth[i - 1].x, truth[i].y - truth[i - 1].y);

  const first = fixes[0], last = fixes[fixes.length - 1];
  const closureErr = isLoop && first && last ? Math.hypot(last.x - truth[0].x, last.y - truth[0].y) : NaN;

  return {
    n: errs.length,
    closureErr,
    distance,
    closurePct: (closureErr / Math.max(distance, 1e-9)) * 100,
    meanErr: errs.reduce((a, b) => a + b, 0) / Math.max(errs.length, 1),
    rmse: Math.sqrt(errs.reduce((a, b) => a + b * b, 0) / Math.max(errs.length, 1)),
    cep50: q(0.5), cep95: q(0.95), maxErr: sorted[sorted.length - 1] ?? NaN,
    meanR68: sumR / Math.max(errs.length, 1),
    calibration: inside / Math.max(errs.length, 1),
  };
}

export function fmt(m: Metrics, label: string): string {
  const f = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : ' n/a');
  return [
    `  ${label.padEnd(22)}`,
    `dystans=${f(m.distance, 1)} m`,
    `RMSE=${f(m.rmse)} m`,
    `CEP50=${f(m.cep50)} m`,
    `CEP95=${f(m.cep95)} m`,
    `max=${f(m.maxErr)} m`,
    `zamkniecie=${f(m.closureErr)} m (${f(m.closurePct, 1)}%)`,
    `r68_sr=${f(m.meanR68)} m`,
    `kalibracja=${f(m.calibration * 100, 0)}%`,
  ].join('  ');
}
