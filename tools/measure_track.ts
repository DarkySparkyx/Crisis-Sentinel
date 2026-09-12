/**
 * Pomiar kodeka śladu: ile trasy mieści się w jednym SMS-ie i z jaką wiernością.
 *
 *   node tools/measure_track.ts
 *
 * Wyniki z tego skryptu są cytowane w docs/10-ANALIZA-PRZYPADKOW.md §3.
 */
import { encodeBeacon, decodeBeacon, fromSms, toSms, type Beacon, type TrackPoint } from '../packages/core/src/track.ts';
import { toENU, toWGS } from '../packages/core/src/geo.ts';

/** Realistyczna trasa górska: dolina, serpentyny, grań. Kuźnice -> Kasprowy (z grubsza). */
function hike(km: number, seed = 3): { pts: TrackPoint[]; alt: number[] } {
  let s = seed >>> 0 || 1;
  const rnd = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const O = { lat: 49.2700, lon: 19.9800 };
  const pts: TrackPoint[] = []; const alt: number[] = [];
  const step = 1.2 * 5;                       // 1,2 m/s, fix co 5 s -> 6 m
  const n = Math.round((km * 1000) / step);
  let x = 0, y = 0, h = 1010, hdg = Math.PI / 4;
  for (let i = 0; i < n; i++) {
    const u = i / n;
    // trzy fazy: dolina (prosto), serpentyny (zygzak), grań (łagodny łuk)
    if (u < 0.35) hdg += (rnd() - 0.5) * 0.06;
    else if (u < 0.75) hdg += Math.sin(i / 14) * 0.55 + (rnd() - 0.5) * 0.1;   // serpentyny
    else hdg += 0.012 + (rnd() - 0.5) * 0.05;
    x += step * Math.sin(hdg); y += step * Math.cos(hdg);
    h += (u < 0.35 ? 0.35 : u < 0.75 ? 1.15 : 0.5) + (rnd() - 0.5) * 0.25;    // przewyższenie
    const g = toWGS(O, x, y);
    pts.push(g); alt.push(h);
  }
  return { pts, alt };
}

/** Odległość każdego punktu oryginału od odtworzonej łamanej [m]. */
function fidelity(orig: TrackPoint[], rec: TrackPoint[]): { mean: number; p95: number; max: number } {
  const O = orig[0];
  const A = orig.map(p => toENU(O, p.lat, p.lon));
  const B = rec.map(p => toENU(O, p.lat, p.lon));
  const d: number[] = [];
  for (const a of A) {
    let best = Infinity;
    for (let i = 0; i + 1 < B.length; i++) {
      const vx = B[i + 1].x - B[i].x, vy = B[i + 1].y - B[i].y;
      const wx = a.x - B[i].x, wy = a.y - B[i].y;
      const L2 = vx * vx + vy * vy;
      const t = L2 < 1e-9 ? 0 : Math.max(0, Math.min(1, (wx * vx + wy * vy) / L2));
      best = Math.min(best, Math.hypot(a.x - (B[i].x + t * vx), a.y - (B[i].y + t * vy)));
    }
    d.push(best);
  }
  d.sort((p, q) => p - q);
  return { mean: d.reduce((p, q) => p + q, 0) / d.length, p95: d[Math.floor(0.95 * d.length)], max: d[d.length - 1] };
}

const beaconFor = (h: ReturnType<typeof hike>): Beacon => ({
  lat: h.pts.at(-1)!.lat, lon: h.pts.at(-1)!.lon, t: Date.now(),
  battery: 23, accuracy: 8, state: 'help', alt: Math.round(h.alt.at(-1)!), track: h.pts,
});

console.log('\n=== ILE TRASY MIEŚCI SIĘ W JEDNYM SMS-ie (120 bajtów) ===\n');
console.log('trasa    pkt GPS   zakod.  tolerancja  kwant   błąd śr.   p95      max     SMS znaków');
console.log('-'.repeat(88));
for (const km of [1, 2, 5, 8, 12, 20, 40]) {
  const h = hike(km);
  const b = beaconFor(h);
  const e = encodeBeacon(b, 120);
  const back = decodeBeacon(e.bytes);
  const f = fidelity(h.pts, back.track);
  console.log(
    `${(km + ' km').padEnd(9)}${String(h.pts.length).padStart(7)}${String(e.pointsEncoded).padStart(9)}` +
    `${(e.toleranceM + ' m').padStart(12)}${(e.quantM + ' m').padStart(8)}` +
    `${(f.mean.toFixed(1) + ' m').padStart(11)}${(f.p95.toFixed(1) + ' m').padStart(9)}${(f.max.toFixed(1) + ' m').padStart(9)}` +
    `${String(e.sms.length).padStart(12)}`);
}

console.log('\n=== TEN SAM SZLAK 12 km PRZY RÓŻNYCH BUDŻETACH ===\n');
console.log('budżet         kanał                       pkt   błąd śr.   p95      max');
console.log('-'.repeat(76));
const h12 = hike(12);
for (const [bytes, label] of [[20, 'ping (sama pozycja)'], [60, 'pół SMS-a'], [120, '1 SMS'], [240, '2 SMS-y'], [480, '4 SMS-y / pakiet BLE']] as [number, string][]) {
  const e = encodeBeacon(beaconFor(h12), bytes);
  const f = fidelity(h12.pts, decodeBeacon(e.bytes).track);
  console.log(`${(bytes + ' B').padEnd(15)}${label.padEnd(28)}${String(e.pointsEncoded).padStart(5)}` +
    `${(f.mean.toFixed(1) + ' m').padStart(11)}${(f.p95.toFixed(1) + ' m').padStart(9)}${(f.max.toFixed(1) + ' m').padStart(9)}`);
}

console.log('\n=== ODPORNOŚĆ: PAKIET OBCIĘTY W TRANSMISJI ===\n');
const e12 = encodeBeacon(beaconFor(h12), 120);
console.log('dotarło   pkt odtworzonych   pozycja bieżąca       błąd pozycji');
console.log('-'.repeat(66));
for (const frac of [0.15, 0.3, 0.5, 0.75, 1]) {
  const cut = e12.bytes.slice(0, Math.max(15, Math.round(e12.bytes.length * frac)));
  try {
    const d = decodeBeacon(cut);
    const err = Math.hypot(...Object.values(toENU({ lat: h12.pts.at(-1)!.lat, lon: h12.pts.at(-1)!.lon }, d.lat, d.lon)));
    console.log(`${(Math.round(frac * 100) + '%').padEnd(10)}${String(d.track.length).padStart(17)}   ` +
      `${d.lat.toFixed(5)}, ${d.lon.toFixed(5)}${(err.toFixed(1) + ' m').padStart(16)}`);
  } catch (err) { console.log(`${(Math.round(frac * 100) + '%').padEnd(10)}BŁĄD: ${err}`); }
}

console.log('\n=== PRZYKŁADOWA TREŚĆ SMS-a (12 km szlaku, bateria 23%, stan: help) ===\n');
console.log(e12.sms);
console.log(`\n${e12.sms.length} znaków z 160 dostępnych w jednej wiadomości GSM-7.\n`);
