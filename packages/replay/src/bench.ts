#!/usr/bin/env node
/**
 * Odtwarza tabelę ablacji z dokumentacji, z UCZCIWYM podziałem danych:
 * mapa magnetyczna budowana jest z przejścia kalibracyjnego (seed A),
 * a oceniana na INNYM przejściu (seed B). Bez tego podziału wyniki są
 * bezwartościowe — mierzyłyby zdolność algorytmu do zapamiętania szumu.
 *
 *   node packages/replay/src/bench.ts [--seeds 11,23,37,41,53]
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pipeline } from '../../core/src/pipeline.ts';
import { MagMap } from '../../core/src/magmap.ts';
import { loadVenue } from '../../core/src/geojson.ts';
import { VenueMap } from '../../core/src/graph.ts';
import { generate, trueField, DEFAULT_SYNTH } from './synth.ts';
import { evaluate, type Metrics } from './metrics.ts';

const args = process.argv.slice(2);
const flag = (n: string, d: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const evalSeeds = flag('seeds', '11,23,37,41,53').split(',').map(Number);
const SURVEY_SEED = 7;

/** Mapa magnetyczna z przejścia kalibracyjnego seed=7, pozycje z punktów kontrolnych. */
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

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

function loadSyntheticVenue(): VenueMap | null {
  const p = resolve(ROOT, 'data/maps/synthetic.geojson');
  if (!existsSync(p)) return null;
  const fc = JSON.parse(readFileSync(p, 'utf8'));
  return loadVenue(fc, fc.properties?.origin ?? { lat: 52.2297, lon: 21.0122 });
}

function run(seed: number, magmap: MagMap | null, venue: VenueMap | null, pf: boolean): Metrics {
  const { samples, truth } = generate({ seed });
  const pipe = new Pipeline({ pf: { n: 1000 } });
  if (magmap) pipe.attachMagMap(magmap);
  if (venue) pipe.attachVenue(venue);
  pipe.start(truth[0].x, truth[0].y, Math.atan2(truth[20].x - truth[0].x, truth[20].y - truth[0].y));
  for (const s of samples) pipe.push(s);
  const series = pf
    ? pipe.fixes
    : pipe.rawPDR.map(p => ({ ...p, cov: [0, 0, 0] as [number, number, number], r68: 0, heading: 0, nEff: 0, survival: 1, source: 'pdr' as const }));
  return evaluate(series, truth);
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const magmap = buildMagMap();
const venue = loadSyntheticVenue();
if (!venue) console.error('UWAGA: brak data/maps/synthetic.geojson — uruchom `node tools/make_venue.ts`\n       (albo po prostu `npm run bench`, który robi to sam) dla pełnej tabeli.\n');

const rows: [string, Metrics[]][] = [
  ['sam krokomierz (PDR)', evalSeeds.map(s => run(s, null, null, false))],
  ['filtr bez map', evalSeeds.map(s => run(s, null, null, true))],
  ...(venue ? [['+ geometria budynku', evalSeeds.map(s => run(s, null, venue, true))] as [string, Metrics[]]] : []),
  ['+ mapa magnetyczna', evalSeeds.map(s => run(s, magmap, null, true))],
  ...(venue ? [['+ obie mapy', evalSeeds.map(s => run(s, magmap, venue, true))] as [string, Metrics[]]] : []),
];

console.log(`\nAblacja — mapa magnetyczna z seed=${SURVEY_SEED}, ocena na seed=${evalSeeds.join(',')}`);
console.log(`Mapa magnetyczna: ${magmap.size} komórek, pokrycie ${magmap.coverageM2().toFixed(0)} m2\n`);
console.log('konfiguracja'.padEnd(24) + 'RMSE'.padStart(9) + 'CEP50'.padStart(9) + 'CEP95'.padStart(9) + 'zamkniecie'.padStart(18) + 'kalibracja'.padStart(12));
console.log('-'.repeat(81));
for (const [label, ms] of rows) {
  console.log(
    label.padEnd(24) +
    `${mean(ms.map(m => m.rmse)).toFixed(2)} m`.padStart(9) +
    `${mean(ms.map(m => m.cep50)).toFixed(2)} m`.padStart(9) +
    `${mean(ms.map(m => m.cep95)).toFixed(2)} m`.padStart(9) +
    `${mean(ms.map(m => m.closureErr)).toFixed(2)} m (${mean(ms.map(m => m.closurePct)).toFixed(1)}%)`.padStart(18) +
    `${(mean(ms.map(m => m.calibration)) * 100).toFixed(0)}%`.padStart(12),
  );
}
console.log('\nUWAGA: dane syntetyczne. Do slajdu używaj liczb z prawdziwych przejść.\n');
