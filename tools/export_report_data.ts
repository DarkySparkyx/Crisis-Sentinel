/**
 * Liczy WSZYSTKIE liczby z raportu wynikowego i zapisuje je jako jeden JSON.
 * Po zebraniu prawdziwych przejść z korytarza podmień generate() na wczytanie
 * nagrań .jsonl — reszta pipeline'u zostaje bez zmian.
 *
 *   node tools/export_report_data.ts      ->  data/out/report-data.json
 */
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
import { Pipeline } from '../packages/core/src/pipeline.ts';
import { MagMap } from '../packages/core/src/magmap.ts';
import { loadVenue } from '../packages/core/src/geojson.ts';
import type { VenueMap } from '../packages/core/src/graph.ts';
import { generate, DEFAULT_SYNTH } from '../packages/replay/src/synth.ts';
import { evaluate, interpTruth, type Truth } from '../packages/replay/src/metrics.ts';

const SURVEY_SEED = 7;
const EVAL_SEEDS = [11, 23, 37, 41, 53];

// ---- mapa magnetyczna z przejścia kalibracyjnego (seed 7) ----
function buildMagMap(): MagMap {
  const { samples } = generate({ seed: SURVEY_SEED });
  const p1 = new Pipeline({ pf: { n: 200 } });
  p1.start(0, 0, Math.PI / 2);
  const stepT: number[] = [];
  for (const s of samples) { const f = p1.push(s); if (f) stepT.push(f.t); }
  const marks = samples.filter(s => s.type === 'mark').map(s => ({ t: s.t, x: (s as any).x, y: (s as any).y }));
  marks.unshift({ t: 0, x: DEFAULT_SYNTH.waypoints[0].x, y: DEFAULT_SYNTH.waypoints[0].y });
  const idx = (t: number) => { let lo = 0, hi = stepT.length; while (lo < hi) { const m = (lo + hi) >> 1; if (stepT[m] <= t) lo = m + 1; else hi = m; } return lo; };
  const mi = marks.map(m => idx(m.t));
  const map = new MagMap('synthetic', 1.0, { lat: 52.2297, lon: 21.0122 });
  const p2 = new Pipeline({ pf: { n: 50 } });
  p2.start(marks[0].x, marks[0].y, Math.PI / 2);
  let k = 0;
  for (const s of samples) {
    p2.push(s);
    if (s.type !== 'mag' && s.type !== 'magu') continue;
    if (k++ % 3 !== 0) continue;
    const si = idx(s.t);
    let j = 0; while (j + 1 < mi.length && mi[j + 1] < si) j++;
    if (j + 1 >= marks.length) continue;
    const u = Math.max(0, Math.min(1, (si - mi[j]) / Math.max(1, mi[j + 1] - mi[j])));
    const feat = (p2 as any).lastFeature;
    if (feat) map.add(marks[j].x + (marks[j + 1].x - marks[j].x) * u, marks[j].y + (marks[j + 1].y - marks[j].y) * u, feat);
  }
  return map;
}

const fc = JSON.parse(readFileSync(resolve(ROOT, 'data/maps/synthetic.geojson'), 'utf8'));
const venue: VenueMap = loadVenue(fc, fc.properties?.origin ?? { lat: 52.2297, lon: 21.0122 });
const magmap = buildMagMap();

function run(seed: number, mm: MagMap | null, vn: VenueMap | null, n = 1000) {
  const { samples, truth } = generate({ seed });
  const pipe = new Pipeline({ pf: { n } });
  if (mm) pipe.attachMagMap(mm);
  if (vn) pipe.attachVenue(vn);
  pipe.start(truth[0].x, truth[0].y, Math.atan2(truth[20].x - truth[0].x, truth[20].y - truth[0].y));
  const t0 = Date.now();
  for (const s of samples) pipe.push(s);
  return { pipe, truth, ms: Date.now() - t0 };
}
const rawSeries = (pipe: Pipeline) => pipe.rawPDR.map(p => ({ ...p, cov: [0, 0, 0] as [number, number, number], r68: 0, heading: 0, nEff: 0, survival: 1, source: 'pdr' as const }));
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

// ---- 1. ablacja ----
const CONFIGS = [
  { key: 'pdr',      label: 'Step counter only (PDR)',   mm: null,   vn: null,   pf: false },
  { key: 'pf',       label: 'Particle filter, no maps',  mm: null,   vn: null,   pf: true },
  { key: 'walls',    label: '+ building geometry',       mm: null,   vn: venue,  pf: true },
  { key: 'mag',      label: '+ magnetic map',            mm: magmap, vn: null,   pf: true },
  { key: 'both',     label: '+ both maps',               mm: magmap, vn: venue,  pf: true },
];
const ablation = CONFIGS.map(c => {
  const ms = EVAL_SEEDS.map(s => {
    const { pipe, truth } = run(s, c.mm, c.vn);
    return evaluate(c.pf ? pipe.fixes : rawSeries(pipe), truth);
  });
  return {
    key: c.key, label: c.label,
    rmse: +mean(ms.map(m => m.rmse)).toFixed(2),
    cep50: +mean(ms.map(m => m.cep50)).toFixed(2),
    cep95: +mean(ms.map(m => m.cep95)).toFixed(2),
    maxErr: +mean(ms.map(m => m.maxErr)).toFixed(2),
    closure: +mean(ms.map(m => m.closureErr)).toFixed(2),
    closurePct: +mean(ms.map(m => m.closurePct)).toFixed(1),
    calibration: c.pf ? +(mean(ms.map(m => m.calibration)) * 100).toFixed(0) : null,
    rmseSpread: [+Math.min(...ms.map(m => m.rmse)).toFixed(2), +Math.max(...ms.map(m => m.rmse)).toFixed(2)],
  };
});

// ---- 2. błąd w funkcji przebytej drogi (seed 23) + 3. trajektoria ----
const EV = 23;
const full = run(EV, magmap, venue);
const pdrOnly = run(EV, null, null);
const stepLen = DEFAULT_SYNTH.stepLength;
const errorVsDistance = full.pipe.fixes.map((f, i) => {
  const g = interpTruth(full.truth as Truth[], f.t)!;
  const r = pdrOnly.pipe.rawPDR[i + 1] ?? pdrOnly.pipe.rawPDR.at(-1)!;
  const gr = interpTruth(pdrOnly.truth as Truth[], pdrOnly.pipe.steps[i]?.t ?? f.t)!;
  return {
    d: +((i + 1) * stepLen).toFixed(1),
    pdr: +Math.hypot(r.x - gr.x, r.y - gr.y).toFixed(2),
    pf: +Math.hypot(f.x - g.x, f.y - g.y).toFixed(2),
    r68: +f.r68.toFixed(2),
  };
});
const trajectory = {
  truth: full.truth.filter((_, i) => i % 48 === 0).map(p => [+p.x.toFixed(2), +p.y.toFixed(2)]),
  pdr: pdrOnly.pipe.rawPDR.map(p => [+p.x.toFixed(2), +p.y.toFixed(2)]),
  pf: full.pipe.fixes.map(f => [+f.x.toFixed(2), +f.y.toFixed(2), +f.r68.toFixed(2)]),
  walls: venue.walls.map(w => [+w.ax.toFixed(1), +w.ay.toFixed(1), +w.bx.toFixed(1), +w.by.toFixed(1)]),
  havens: venue.havens.map(h => ({ name: h.name, x: +h.x.toFixed(1), y: +h.y.toFixed(1) })),
};

// ---- 4. dystrybuanta błędu (CDF) ----
function errs(mm: MagMap | null, vn: VenueMap | null, pf: boolean): number[] {
  const out: number[] = [];
  for (const s of EVAL_SEEDS) {
    const { pipe, truth } = run(s, mm, vn);
    const series = pf ? pipe.fixes : rawSeries(pipe);
    for (const f of series) { const g = interpTruth(truth as Truth[], f.t); if (g) out.push(Math.hypot(f.x - g.x, f.y - g.y)); }
  }
  return out.sort((a, b) => a - b);
}
const cdfOf = (xs: number[]) => Array.from({ length: 51 }, (_, i) => {
  const p = i / 50;
  return [+xs[Math.min(xs.length - 1, Math.floor(p * xs.length))].toFixed(2), +(p * 100).toFixed(0)];
});
const cdf = { pdr: cdfOf(errs(null, null, false)), walls: cdfOf(errs(null, venue, true)), both: cdfOf(errs(magmap, venue, true)) };

// ---- 5. kalibracja niepewności ----
const calPoints: { k: number; expected: number; actual: number }[] = [];
for (const k of [0.5, 1, 1.5, 2, 2.5, 3]) {
  let inside = 0, tot = 0;
  for (const s of EVAL_SEEDS) {
    const { pipe, truth } = run(s, magmap, venue);
    for (const f of pipe.fixes) {
      const g = interpTruth(truth as Truth[], f.t); if (!g) continue;
      tot++; if (Math.hypot(f.x - g.x, f.y - g.y) <= k * f.r68) inside++;
    }
  }
  // 2D Rayleigh: P(r <= k*sigma) = 1 - exp(-k^2/2)
  calPoints.push({ k, expected: +((1 - Math.exp(-(k * k) / 2)) * 100).toFixed(1), actual: +((inside / tot) * 100).toFixed(1) });
}

// ---- 6. wpływ wagi obserwacji magnetycznej ----
const magWeightSweep = [0, 0.25, 0.5, 1, 2, 4].map(w => {
  const ms = EVAL_SEEDS.map(s => {
    const { samples, truth } = generate({ seed: s });
    const pipe = new Pipeline({ pf: { n: 1000, magWeight: w } });
    pipe.attachMagMap(magmap); pipe.attachVenue(venue);
    pipe.start(truth[0].x, truth[0].y, Math.atan2(truth[20].x - truth[0].x, truth[20].y - truth[0].y));
    for (const sm of samples) pipe.push(sm);
    return evaluate(pipe.fixes, truth);
  });
  return { w, rmse: +mean(ms.map(m => m.rmse)).toFixed(2), cep95: +mean(ms.map(m => m.cep95)).toFixed(2) };
});

// ---- 7. liczba cząstek: dokładność vs koszt ----
const particleSweep = [200, 400, 800, 1500, 3000].map(n => {
  const rs = EVAL_SEEDS.map(s => { const r = run(s, magmap, venue, n); return { m: evaluate(r.pipe.fixes, r.truth), ms: r.ms, steps: r.pipe.steps.length }; });
  return { n, rmse: +mean(rs.map(r => r.m.rmse)).toFixed(2), cep95: +mean(rs.map(r => r.m.cep95)).toFixed(2), msPerStep: +(mean(rs.map(r => r.ms / r.steps))).toFixed(2) };
});

// ---- 8. metadane ----
let dist = 0;
for (let i = 1; i < full.truth.length; i++) dist += Math.hypot(full.truth[i].x - full.truth[i - 1].x, full.truth[i].y - full.truth[i - 1].y);
const meta = {
  generated: new Date().toISOString().slice(0, 10),
  loopLengthM: +dist.toFixed(1),
  steps: full.pipe.steps.length,
  trueStepLengthM: stepLen,
  gyroBiasRadS: DEFAULT_SYNTH.gyroBias.z,
  gyroBiasDegMin: +((DEFAULT_SYNTH.gyroBias.z * 180 / Math.PI) * 60).toFixed(0),
  imuRateHz: DEFAULT_SYNTH.rate,
  anomalyAmpUT: DEFAULT_SYNTH.anomalyAmp,
  surveySeed: SURVEY_SEED,
  evalSeeds: EVAL_SEEDS,
  magCells: magmap.size,
  magCoverageM2: +magmap.coverageM2().toFixed(0),
  particles: 1000,
  walkSpeedMs: DEFAULT_SYNTH.speed,
};

mkdirSync(resolve(ROOT, 'data/out'), { recursive: true });
writeFileSync(resolve(ROOT, 'data/out/report-data.json'), JSON.stringify({ meta, ablation, errorVsDistance, trajectory, cdf, calPoints, magWeightSweep, particleSweep }, null, 1));
console.log(`OK  ablacja ${ablation.length} konfiguracji · ${meta.evalSeeds.length} przejść oceniających · mapa ${meta.magCells} komórek`);
console.log('   -> data/out/report-data.json');
