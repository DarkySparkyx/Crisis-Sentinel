#!/usr/bin/env node
/**
 * Generuje GeoJSON korytarza (ściany + oś + punkty bezpieczne) wokół zadanej
 * łamanej. Służy do (a) mapy dla scenariusza syntetycznego, (b) szybkiego
 * odwzorowania realnego korytarza na hakatonie bez rysowania w edytorze.
 *
 *   node tools/make_venue.ts --width 2.6 --out data/maps/synthetic.geojson
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toWGS } from '../packages/core/src/geo.ts';

const args = process.argv.slice(2);
const flag = (n: string, d?: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const quiet = args.includes('--quiet');
/** Ścieżki liczymy od korzenia repo, nie od bieżącego katalogu — skrypt ma
 *  działać tak samo uruchomiony z korzenia, z tools/ i przez npm. */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const abs = (p: string) => (p.startsWith('/') ? p : resolve(ROOT, p));

const origin = { lat: Number(flag('lat', '52.2297')), lon: Number(flag('lon', '21.0122')) };
const width = Number(flag('width', '2.6'));
const out = abs(flag('out', 'data/maps/synthetic.geojson')!);
const wps: { x: number; y: number }[] = JSON.parse(
  flag('waypoints', '[[0,0],[30,0],[30,18],[0,18],[0,0]]')!,
).map(([x, y]: number[]) => ({ x, y }));

const P = (x: number, y: number): number[] => { const g = toWGS(origin, x, y); return [round(g.lon), round(g.lat)]; };
const round = (v: number) => Math.round(v * 1e8) / 1e8;

/** Odsunięcie łamanej o d (w lewo dla d>0). Prosty offset per-segment — wystarcza dla korytarzy. */
function offset(pts: { x: number; y: number }[], d: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1];
    const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = -(b.y - a.y) / L, ny = (b.x - a.x) / L;
    out.push({ x: a.x + nx * d, y: a.y + ny * d });
    out.push({ x: b.x + nx * d, y: b.y + ny * d });
  }
  return out;
}

const feat = (kind: string, geom: any, props: Record<string, any> = {}) =>
  ({ type: 'Feature', properties: { kind, ...props }, geometry: geom });
const line = (pts: { x: number; y: number }[]) => ({ type: 'LineString', coordinates: pts.map(p => P(p.x, p.y)) });

const fc = {
  type: 'FeatureCollection',
  properties: { origin, generated_by: 'tools/make_venue.ts', corridor_width_m: width },
  features: [
    feat('walkable', line(wps), { name: 'oś korytarza' }),
    feat('wall', line(offset(wps, width / 2)), { side: 'left' }),
    feat('wall', line(offset(wps, -width / 2)), { side: 'right' }),
    feat('haven', { type: 'Point', coordinates: P(wps[0].x, wps[0].y) }, { id: 'H1', name: 'Wejście / punkt zborny' }),
    feat('haven', { type: 'Point', coordinates: P(wps[Math.floor(wps.length / 2)].x, wps[Math.floor(wps.length / 2)].y) }, { id: 'H2', name: 'Klatka schodowa B' }),
  ],
};
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(fc, null, 1));
if (!quiet) console.log(`OK  ${fc.features.length} obiektów -> ${out}  (origin ${origin.lat},${origin.lon})`);
