#!/usr/bin/env node
/**
 * ariadna-replay — narzędzie #1 zespołu algorytmicznego.
 *
 *   node src/cli.ts synth  [--out data/recordings/synth.jsonl] [--bias 0.008] [--seed 7]
 *   node src/cli.ts run    <recording.jsonl> [--venue data/maps/x.geojson] [--magmap data/magmaps/x.json]
 *                          [--survey] [--svg out.svg] [--particles 800]
 *   node src/cli.ts sweep  <recording.jsonl>   # strojenie parametrów siatką
 *
 * Cały cykl strojenia algorytmu odbywa się tutaj, w sekundach, bez telefonu.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pipeline } from '../../core/src/pipeline.ts';
import { MagMap } from '../../core/src/magmap.ts';
import { loadVenue } from '../../core/src/geojson.ts';
import type { Sample, RecordingHeader } from '../../core/src/types.ts';
import { generate, DEFAULT_SYNTH } from './synth.ts';
import { evaluate, fmt, type Truth } from './metrics.ts';

/** Kurs początkowy z ground truth (pierwsze ~2 m trasy) lub z flagi --heading [stopnie]. */
function initialHeading(truth: Truth[]): number {
  const h = flag('heading');
  if (h !== undefined) return (Number(h) * Math.PI) / 180;
  if (truth.length < 2) return 0;
  const a = truth[0];
  const b = truth.find(p => Math.hypot(p.x - a.x, p.y - a.y) > 2) ?? truth[truth.length - 1];
  return Math.atan2(b.x - a.x, b.y - a.y);
}
import { renderSVG } from './svg.ts';

const args = process.argv.slice(2);
const cmd = args[0];
/** Korzeń repo — żeby domyślne ścieżki działały niezależnie od katalogu uruchomienia. */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
/**
 * Rozwiązanie ścieżki: najpierw względem bieżącego katalogu (bo tego oczekuje
 * człowiek piszący w terminalu), a jeśli tam nie ma pliku — względem korzenia
 * repo (bo tak działają skrypty npm uruchamiane z dowolnego miejsca).
 */
const abs = (p: string): string => {
  if (!p) return p;
  if (p.startsWith('/')) return p;
  const fromCwd = resolve(process.cwd(), p);
  if (existsSync(fromCwd)) return fromCwd;
  return resolve(ROOT, p);
};

/** Kończy działanie z czytelnym komunikatem zamiast stosu wywołań Node. */
function die(msg: string, hint?: string): never {
  console.error(`\nBŁĄD: ${msg}`);
  if (hint) console.error(`\n${hint}`);
  console.error('');
  process.exit(2);
}

/** Ścieżka do nagrania z walidacją — najczęstsze źródło błędów przy pierwszym uruchomieniu. */
function recordingArg(): string {
  const a = args[1];
  if (!a || a.startsWith('--')) {
    die('nie podano pliku nagrania.',
      'Przykład:\n  npm run replay -- data/recordings/synth.jsonl\n' +
      'Nie masz żadnego nagrania? Wygeneruj syntetyczne:\n  npm run synth');
  }
  const p = abs(a);
  if (!existsSync(p)) {
    const hint = existsSync(resolve(ROOT, 'data/recordings'))
      ? `Dostępne nagrania w data/recordings:\n` +
        (readdirSafe(resolve(ROOT, 'data/recordings')).filter(f => f.endsWith('.jsonl')).map(f => '  ' + f).join('\n') || '  (brak — uruchom: npm run synth)')
      : 'Uruchom najpierw: npm run synth';
    die(`nie znaleziono pliku nagrania: ${a}`, hint);
  }
  return p;
}
function readdirSafe(d: string): string[] {
  try { return readdirSync(d); } catch { return []; }
}
const flag = (name: string, def?: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const has = (name: string): boolean => args.includes(`--${name}`);

function writeJSONL(path: string, header: RecordingHeader, samples: Sample[], truth?: Truth[]): void {
  mkdirSync(dirname(path), { recursive: true });
  const lines = [JSON.stringify(header), ...samples.map(s => JSON.stringify(s))];
  writeFileSync(path, lines.join('\n') + '\n');
  if (truth) writeFileSync(path.replace(/\.jsonl$/, '.truth.json'), JSON.stringify(truth));
}

function readJSONL(path: string): { header: RecordingHeader; samples: Sample[]; truth: Truth[] } {
  const raw = readFileSync(path, 'utf8').trim().split('\n');
  const header = JSON.parse(raw[0]) as RecordingHeader;
  const samples = raw.slice(1).map(l => JSON.parse(l) as Sample);
  let truth: Truth[] = [];
  try { truth = JSON.parse(readFileSync(path.replace(/\.jsonl$/, '.truth.json'), 'utf8')); } catch { /* brak GT */ }
  if (!truth.length) {
    truth = samples.filter(s => s.type === 'mark' && s.x !== undefined)
      .map(s => ({ t: s.t, x: (s as any).x, y: (s as any).y }));
  }
  return { header, samples, truth };
}

function build(recPath: string) {
  const { header, samples, truth } = readJSONL(recPath);
  const venuePath = flag('venue');
  const magmapPath = flag('magmap');
  const pipe = new Pipeline({
    mode: has('survey') ? 'SURVEY' : 'NAV',
    anchorOnMark: has('survey') || has('anchors'),
    pf: { n: Number(flag('particles', '800')) },
  });
  if (venuePath) {
    if (!existsSync(abs(venuePath))) die(`nie znaleziono mapy obiektu: ${venuePath}`,
      'Wygeneruj przykładową:\n  node tools/make_venue.ts --out data/maps/synthetic.geojson');
    const fc = JSON.parse(readFileSync(abs(venuePath), 'utf8'));
    pipe.attachVenue(loadVenue(fc, header.origin ?? { lat: 0, lon: 0 }));
  }
  if (magmapPath) {
    if (!existsSync(abs(magmapPath))) die(`nie znaleziono mapy magnetycznej: ${magmapPath}`,
      'Zbuduj ją z przejścia kalibracyjnego:\n  npm run replay -- <nagranie> ... albo:\n  node packages/replay/src/cli.ts survey <nagranie> --out data/magmaps/venue.json');
    pipe.attachMagMap(MagMap.fromJSON(JSON.parse(readFileSync(abs(magmapPath), 'utf8'))));
  }
  else if (has('survey')) pipe.attachMagMap(new MagMap(header.venue ?? 'unknown', 1.0, header.origin ?? { lat: 0, lon: 0 }));
  return { pipe, header, samples, truth };
}

if (cmd === 'synth') {
  const out = abs(flag('out', 'data/recordings/synth.jsonl')!);
  const bias = Number(flag('bias', String(DEFAULT_SYNTH.gyroBias.z)));
  const seed = Number(flag('seed', '7'));
  const { header, samples, truth } = generate({ seed, gyroBias: { ...DEFAULT_SYNTH.gyroBias, z: bias } });
  writeJSONL(out, header, samples, truth);
  console.log(`OK  ${samples.length} próbek, ${truth.length} pkt ground truth -> ${out}`);
} else if (cmd === 'run') {
  const recPath = recordingArg();
  const { pipe, samples, truth } = build(recPath);
  pipe.start(truth[0]?.x ?? 0, truth[0]?.y ?? 0, initialHeading(truth));
  const t0 = Date.now();
  for (const s of samples) pipe.push(s);
  const ms = Date.now() - t0;

  const rawFixes = pipe.rawPDR.map(p => ({ ...p, cov: [0, 0, 0] as [number, number, number], r68: 0, heading: 0, nEff: 0, survival: 1, source: 'pdr' as const }));
  console.log(`\n${recPath}`);
  console.log(`  kroki=${pipe.steps.length}  fixy=${pipe.fixes.length}  czas=${ms} ms  (${(samples.length / Math.max(ms, 1) * 1000 / 1000).toFixed(0)}k próbek/s)`);
  if (truth.length) {
    console.log(fmt(evaluate(rawFixes, truth), 'czyste PDR'));
    console.log(fmt(evaluate(pipe.fixes, truth), 'filtr cząsteczkowy'));
  }
  if (pipe.magmap) {
    const mp = flag('save-magmap');
    console.log(`  mapa magnetyczna: ${pipe.magmap.size} komórek, pokrycie ${pipe.magmap.coverageM2().toFixed(0)} m2`);
    if (mp) { mkdirSync(dirname(abs(mp)), { recursive: true }); writeFileSync(abs(mp), JSON.stringify(pipe.magmap.toJSON())); console.log(`  zapisano -> ${abs(mp)}`); }
  }
  const svg = flag('svg');
  if (svg) {
    mkdirSync(dirname(abs(svg)), { recursive: true });
    writeFileSync(abs(svg), renderSVG(truth, pipe.rawPDR, pipe.fixes, pipe.venue, recPath.split('/').pop()!));
    console.log(`  wykres -> ${abs(svg)}`);
  }
} else if (cmd === 'survey') {
  // ---------------------------------------------------------------
  // Budowa mapy magnetycznej z przejścia kalibracyjnego.
  // Pozycja NIE pochodzi z filtru (który dryfuje), tylko z interpolacji
  // między znanymi punktami kontrolnymi ('mark') w przestrzeni KROKÓW —
  // to odpowiada realnej procedurze: operator idzie po wyznaczonej linii
  // od znacznika do znacznika i taguje każdy z nich w aplikacji.
  // ---------------------------------------------------------------
  const recPath = recordingArg();
  const { header, samples } = readJSONL(recPath);
  const out = abs(flag('out', 'data/magmaps/survey.json')!);
  const cell = Number(flag('cell', '1.0'));

  const pass1 = new Pipeline({ pf: { n: 200 } });
  pass1.start(0, 0, 0);
  const stepTimes: number[] = [];
  for (const s2 of samples) { const f = pass1.push(s2); if (f) stepTimes.push(f.t); }

  const marks = samples.filter(s2 => s2.type === 'mark' && (s2 as any).x !== undefined)
    .map(s2 => ({ t: s2.t, x: (s2 as any).x as number, y: (s2 as any).y as number }));
  if (marks.length < 2) die('przejście kalibracyjne wymaga co najmniej 2 znaczników (mark) z pozycją.',
    'W aplikacji: naciśnij CHECKPOINT stojąc na każdym zmierzonym znaczniku na podłodze.\n' +
    'Do testu wygeneruj dane syntetyczne (mają znaczniki): npm run synth');
  const stepIdxAt = (t: number): number => {
    let lo = 0, hi = stepTimes.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (stepTimes[mid] <= t) lo = mid + 1; else hi = mid; }
    return lo;
  };
  const markSteps = marks.map(m => stepIdxAt(m.t));

  const map = new MagMap(header.venue ?? 'unknown', cell, header.origin ?? { lat: 0, lon: 0 });
  const pass2 = new Pipeline({ mode: 'NAV', pf: { n: 50 } });
  pass2.start(marks[0].x, marks[0].y, 0);
  let added = 0, k = 0;
  for (const s2 of samples) {
    pass2.push(s2);
    if (s2.type !== 'mag' && s2.type !== 'magu') continue;
    if (k++ % 3 !== 0) continue;
    const si = stepIdxAt(s2.t);
    let j = 0;
    while (j + 1 < markSteps.length && markSteps[j + 1] < si) j++;
    if (j + 1 >= marks.length) continue;
    const span = Math.max(1, markSteps[j + 1] - markSteps[j]);
    const u = Math.max(0, Math.min(1, (si - markSteps[j]) / span));
    const px = marks[j].x + (marks[j + 1].x - marks[j].x) * u;
    const py = marks[j].y + (marks[j + 1].y - marks[j].y) * u;
    const feat = (pass2 as any).lastFeature;
    if (feat) { map.add(px, py, feat); added++; }
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(map.toJSON()));
  console.log(`OK  ${added} odczytów -> ${map.size} komórek (${map.coverageM2().toFixed(0)} m2, siatka ${cell} m) -> ${out}`);
} else if (cmd === 'sweep') {
  const recPath = recordingArg();
  if (!flag('magmap')) {
    console.error('UWAGA: nie podano --magmap, więc kolumna magW nic nie zmienia (brak obserwacji');
    console.error('       magnetycznej). Zbuduj mapę: `node packages/replay/src/cli.ts survey <nagranie>`\n');
  }
  if (!flag('venue')) console.error('UWAGA: nie podano --venue — filtr działa bez ograniczeń geometrycznych.\n');
  console.log('sigmaTurn  sigmaLen  magW   RMSE[m]  CEP95[m]  zamkniecie[m]');
  for (const sigmaTurn of [0.04, 0.08, 0.15]) {
    for (const sigmaLen of [0.08, 0.12, 0.20]) {
      for (const magWeight of [0, 0.5, 1.0, 2.0]) {
        const { pipe, samples, truth } = build(recPath);
        pipe.pf.opts.sigmaTurn = sigmaTurn;
        pipe.pf.opts.sigmaLen = sigmaLen;
        pipe.pf.opts.magWeight = magWeight;
        pipe.start(truth[0]?.x ?? 0, truth[0]?.y ?? 0, initialHeading(truth));
        for (const s of samples) pipe.push(s);
        const m = evaluate(pipe.fixes, truth);
        console.log(
          `${sigmaTurn.toFixed(2).padStart(9)}  ${sigmaLen.toFixed(2).padStart(8)}  ${magWeight.toFixed(1).padStart(4)}  ` +
          `${m.rmse.toFixed(2).padStart(7)}  ${m.cep95.toFixed(2).padStart(8)}  ${m.closureErr.toFixed(2).padStart(12)}`,
        );
      }
    }
  }
} else {
  if (cmd && !['synth', 'run', 'survey', 'sweep'].includes(cmd)) console.error(`\nNieznana komenda: ${cmd}\n`);
  console.log(`
ariadna-replay — narzędzie do rozwoju i strojenia algorytmu

  synth    wygeneruj syntetyczny spacer z ground truth
           node packages/replay/src/cli.ts synth [--out PLIK] [--seed 7] [--bias 0.008]

  run      przelicz nagranie i pokaż metryki
           node packages/replay/src/cli.ts run PLIK.jsonl
                [--venue MAPA.geojson] [--magmap MAGMAPA.json]
                [--particles 800] [--heading STOPNIE] [--anchors]
                [--survey --save-magmap PLIK] [--svg WYKRES.svg]

  survey   zbuduj mapę magnetyczną z przejścia kalibracyjnego (wymaga >= 2 znaczników)
           node packages/replay/src/cli.ts survey PLIK.jsonl [--out MAGMAPA.json] [--cell 1.0]

  sweep    przeszukaj siatkę parametrów filtru
           node packages/replay/src/cli.ts sweep PLIK.jsonl [--venue ...] [--magmap ...]

Szybki start:
  npm run synth && npm run replay -- data/recordings/synth.jsonl
  npm run bench          # pełna tabela ablacji
`);
  process.exit(cmd ? 1 : 0);
}
