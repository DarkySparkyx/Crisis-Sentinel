import test from 'node:test';
import assert from 'node:assert/strict';
import { Pipeline } from '../../core/src/pipeline.ts';
import { MagMap } from '../../core/src/magmap.ts';
import { VenueMap } from '../../core/src/graph.ts';
import { generate, trueField, DEFAULT_SYNTH } from '../src/synth.ts';
import { evaluate } from '../src/metrics.ts';

/** Mapa magnetyczna zbudowana wprost z modelu pola — imituje idealne przejście kalibracyjne. */
function referenceMagMap(cell = 1.0): MagMap {
  const m = new MagMap('synthetic', cell, { lat: 0, lon: 0 });
  const wps = DEFAULT_SYNTH.waypoints;
  for (let i = 0; i + 1 < wps.length; i++) {
    const a = wps[i], b = wps[i + 1];
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    for (let s = 0; s <= L; s += 0.25) {
      const u = s / L;
      const x = a.x + (b.x - a.x) * u, y = a.y + (b.y - a.y) * u;
      const F = trueField(x, y, DEFAULT_SYNTH.anomalyAmp);
      for (let k = 0; k < 3; k++) m.add(x, y, { ...F, clean: false });
    }
  }
  return m;
}

function run(seed: number, opts: { magmap?: MagMap; venue?: VenueMap; n?: number } = {}) {
  const { samples, truth } = generate({ seed });
  const pipe = new Pipeline({ pf: { n: opts.n ?? 1000 } });
  if (opts.magmap) pipe.attachMagMap(opts.magmap);
  if (opts.venue) pipe.attachVenue(opts.venue);
  const h0 = Math.atan2(truth[20].x - truth[0].x, truth[20].y - truth[0].y);
  pipe.start(truth[0].x, truth[0].y, h0);
  for (const s of samples) pipe.push(s);
  const raw = pipe.rawPDR.map(p => ({ ...p, cov: [0, 0, 0] as [number, number, number], r68: 0, heading: 0, nEff: 0, survival: 1, source: 'pdr' as const }));
  return { pipe, truth, pf: evaluate(pipe.fixes, truth), raw: evaluate(raw, truth) };
}

test('detektor kroku liczy kroki z błędem < 5%', () => {
  const { pipe, truth } = run(5);
  let d = 0;
  for (let i = 1; i < truth.length; i++) d += Math.hypot(truth[i].x - truth[i - 1].x, truth[i].y - truth[i - 1].y);
  const expected = d / DEFAULT_SYNTH.stepLength;
  const err = Math.abs(pipe.steps.length - expected) / expected;
  assert.ok(err < 0.05, `kroki=${pipe.steps.length}, oczekiwane=${expected.toFixed(0)}, błąd=${(err * 100).toFixed(1)}%`);
});

test('czyste PDR dryfuje: błąd zamknięcia > 5% drogi przy realnym biasie żyroskopu', () => {
  const { raw } = run(5);
  assert.ok(raw.closurePct > 5, `oczekiwano dryfu, dostano ${raw.closurePct.toFixed(1)}%`);
});

test('mapa magnetyczna + filtr cząsteczkowy bije czyste PDR co najmniej 2x na RMSE', () => {
  const map = referenceMagMap();
  for (const seed of [5, 13, 29]) {
    const { pf, raw } = run(seed, { magmap: map });
    assert.ok(pf.rmse * 2 < raw.rmse, `seed=${seed}: PF RMSE=${pf.rmse.toFixed(2)} vs PDR ${raw.rmse.toFixed(2)}`);
    assert.ok(pf.closureErr < 3, `seed=${seed}: błąd zamknięcia PF = ${pf.closureErr.toFixed(2)} m`);
  }
});

test('filtr raportuje uczciwą niepewność (r68 pokrywa 50-100% przypadków)', () => {
  const { pf } = run(5, { magmap: referenceMagMap() });
  assert.ok(pf.calibration > 0.5, `pokrycie r68 = ${(pf.calibration * 100).toFixed(0)}%`);
});

test('wydajność: pełny przebieg 96 m liczy się < 1500 ms (zapas na telefon)', () => {
  const t0 = Date.now();
  run(5, { magmap: referenceMagMap(), n: 1000 });
  const ms = Date.now() - t0;
  assert.ok(ms < 1500, `${ms} ms`);
});

test('brak mapy = brak awarii: system degraduje się do PDR', () => {
  const { pf } = run(5);
  assert.ok(Number.isFinite(pf.rmse) && pf.rmse < 25, `RMSE=${pf.rmse}`);
});
