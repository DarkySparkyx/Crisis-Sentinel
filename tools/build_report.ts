#!/usr/bin/env node
/**
 * Składa stronę raportu: szablon + świeże dane pomiarowe -> docs/report.html
 *
 *   node tools/export_report_data.ts    # 1. policz metryki  -> data/out/report-data.json
 *   node tools/build_report.ts          # 2. wstrzyknij do szablonu -> docs/report.html
 *
 * Albo jednym poleceniem:  npm run report
 *
 * Szablon (docs/report.template.html) zawiera cały układ, style i kod wykresów.
 * Jedyne miejsce, w które trafiają liczby, to placeholder __DATA__ — dzięki temu
 * po zebraniu prawdziwych przejść z korytarza wystarczy przeliczyć dane i strona
 * sama się zaktualizuje, bez dotykania HTML-a.
 */
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TPL = resolve(ROOT, 'docs/report.template.html');
const DATA = resolve(ROOT, 'data/out/report-data.json');
const OUT = resolve(ROOT, 'docs/report.html');

function die(msg: string, hint: string): never {
  console.error(`\nBŁĄD: ${msg}\n\n${hint}\n`);
  process.exit(2);
}

if (!existsSync(TPL)) die(`brak szablonu: docs/report.template.html`, 'Szablon jest w repo — sprawdź, czy plik nie został przypadkiem usunięty.');
if (!existsSync(DATA)) die('brak danych pomiarowych: data/out/report-data.json',
  'Policz je najpierw:\n  node tools/export_report_data.ts\nAlbo uruchom oba kroki naraz:\n  npm run report');

const tpl = readFileSync(TPL, 'utf8');
if (!tpl.includes('__DATA__')) die('szablon nie zawiera placeholdera __DATA__', 'Linia z danymi w szablonie musi wyglądać tak:\n  const D = __DATA__;');

const raw = readFileSync(DATA, 'utf8');
let doc: any;
try { doc = JSON.parse(raw); } catch (e) { die(`data/out/report-data.json nie jest poprawnym JSON-em (${e})`, 'Przelicz dane od nowa: node tools/export_report_data.ts'); }
for (const k of ['meta', 'ablation', 'errorVsDistance', 'trajectory', 'cdf', 'calPoints', 'magWeightSweep', 'particleSweep'])
  if (!doc[k]) die(`w danych brakuje sekcji "${k}"`, 'Przelicz dane od nowa: node tools/export_report_data.ts');

// </script> w danych rozerwałoby stronę — w JSON-ie jest to niemożliwe, ale kosztuje zero.
const compact = JSON.stringify(doc).replace(/<\//g, '<\\/');
writeFileSync(OUT, tpl.replace('__DATA__', compact));

const kb = (n: number) => (n / 1024).toFixed(0) + ' kB';
console.log(`OK  docs/report.html  (${kb(statSync(OUT).size)}, w tym ${kb(compact.length)} danych)`);
console.log(`    dane z ${doc.meta.generated} · ${doc.meta.evalSeeds.length} przejść oceniających · pętla ${doc.meta.loopLengthM} m`);
console.log(`    otwórz:  xdg-open docs/report.html`);
