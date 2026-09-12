import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeBeacon, decodeBeacon, toSms, fromSms, simplify, ALPHABET, SMS_PAYLOAD_BYTES, type Beacon, type TrackPoint } from '../src/track.ts';
import { toENU, toWGS } from '../src/geo.ts';

const O = { lat: 49.27, lon: 19.98 };

/** Syntetyczny szlak: serpentyny z przewyższeniem, `km` kilometrów. */
function trail(km: number): TrackPoint[] {
  const pts: TrackPoint[] = [];
  const n = Math.round(km * 1000 / 6);
  let x = 0, y = 0, hdg = 0.8;
  for (let i = 0; i < n; i++) {
    hdg += Math.sin(i / 13) * 0.4;
    x += 6 * Math.sin(hdg); y += 6 * Math.cos(hdg);
    pts.push(toWGS(O, x, y));
  }
  return pts;
}

const beacon = (track: TrackPoint[]): Beacon => ({
  lat: track.at(-1)!.lat, lon: track.at(-1)!.lon, t: Date.UTC(2026, 8, 12, 14, 32),
  battery: 23, accuracy: 8, state: 'help', alt: 1847, track,
});

const posErr = (a: { lat: number; lon: number }, b: { lat: number; lon: number }): number => {
  const e = toENU({ lat: a.lat, lon: a.lon }, b.lat, b.lon);
  return Math.hypot(e.x, e.y);
};

test('pakiet mieści się w jednej wiadomości SMS', () => {
  for (const km of [1, 5, 12, 20, 40]) {
    const e = encodeBeacon(beacon(trail(km)));
    assert.ok(e.bytes.length <= SMS_PAYLOAD_BYTES, `${km} km: ${e.bytes.length} B`);
    assert.ok(e.sms.length <= 160, `${km} km: ${e.sms.length} znaków SMS`);
  }
});

test('alfabet SMS ma dokładnie 64 znaki i jest bezpieczny w GSM-7', () => {
  assert.equal(ALPHABET.length, 64);
  assert.equal(new Set(ALPHABET).size, 64, 'znaki nie mogą się powtarzać');
  assert.ok(/^[A-Za-z0-9.-]+$/.test(ALPHABET));
});

test('pozycja bieżąca odtwarza się z dokładnością lepszą niż 2 m', () => {
  const b = beacon(trail(12));
  const d = decodeBeacon(encodeBeacon(b).bytes);
  assert.ok(posErr(b, d) < 2, `błąd pozycji ${posErr(b, d).toFixed(2)} m`);
});

test('metadane przeżywają kodowanie', () => {
  const b = beacon(trail(8));
  const d = decodeBeacon(encodeBeacon(b).bytes);
  assert.equal(d.state, 'help');
  assert.ok(Math.abs(d.battery - b.battery) <= 4, `bateria ${d.battery}%`);
  assert.ok(Math.abs(d.alt - b.alt) <= 1, `wysokość ${d.alt} m`);
  assert.ok(d.accuracy >= b.accuracy, 'dokładność zaokrąglana w górę (konserwatywnie)');
  assert.ok(Math.abs(d.t - b.t) < 60000, 'czas z dokładnością do minuty');
});

test('kształt 20-kilometrowej trasy odtwarza się poniżej 60 m w p95', () => {
  const track = trail(20);
  const d = decodeBeacon(encodeBeacon(beacon(track)).bytes);
  const B = d.track.map(p => toENU(O, p.lat, p.lon));
  const errs = track.map(p => {
    const a = toENU(O, p.lat, p.lon);
    let best = Infinity;
    for (let i = 0; i + 1 < B.length; i++) {
      const vx = B[i + 1].x - B[i].x, vy = B[i + 1].y - B[i].y;
      const wx = a.x - B[i].x, wy = a.y - B[i].y;
      const L2 = vx * vx + vy * vy;
      const t = L2 < 1e-9 ? 0 : Math.max(0, Math.min(1, (wx * vx + wy * vy) / L2));
      best = Math.min(best, Math.hypot(a.x - (B[i].x + t * vx), a.y - (B[i].y + t * vy)));
    }
    return best;
  }).sort((x, y) => x - y);
  const p95 = errs[Math.floor(0.95 * errs.length)];
  assert.ok(p95 < 60, `p95 = ${p95.toFixed(1)} m`);
});

test('pakiet obcięty w transmisji nadal daje pozycję bieżącą', () => {
  const b = beacon(trail(12));
  const e = encodeBeacon(b);
  for (const frac of [0.15, 0.5, 0.9]) {
    const cut = e.bytes.slice(0, Math.max(15, Math.round(e.bytes.length * frac)));
    const d = decodeBeacon(cut);
    assert.ok(posErr(b, d) < 2, `przy ${frac * 100}%: błąd ${posErr(b, d).toFixed(2)} m`);
    assert.ok(d.track.length >= 1);
  }
});

test('treść SMS-a koduje i dekoduje się bez straty', () => {
  const e = encodeBeacon(beacon(trail(5)));
  const back = fromSms(e.sms);
  assert.deepEqual([...back.slice(0, e.bytes.length)], [...e.bytes]);
  assert.equal(decodeBeacon(back).state, 'help');
});

test('sam ping pozycyjny działa bez trasy', () => {
  const b: Beacon = { lat: 49.2321, lon: 19.9812, t: Date.now(), battery: 7, accuracy: 30, state: 'sos', alt: 1987, track: [] };
  const d = decodeBeacon(encodeBeacon(b).bytes);
  assert.equal(d.state, 'sos');
  assert.ok(posErr(b, d) < 2);
});

test('upraszczanie zachowuje oba końce trasy', () => {
  const pts = Array.from({ length: 200 }, (_, i) => ({ x: i, y: Math.sin(i / 9) * 30 }));
  const idx = simplify(pts, 5);
  assert.equal(idx[0], 0);
  assert.equal(idx.at(-1), pts.length - 1);
  assert.ok(idx.length < pts.length / 3, `zostało ${idx.length} z ${pts.length}`);
});

test('odrzuca pakiet o nieznanej wersji formatu', () => {
  const e = encodeBeacon(beacon(trail(2)));
  const bad = Uint8Array.from(e.bytes);
  bad[0] = (bad[0] & 0x0f) | 0x90;              // wersja 9
  assert.throws(() => decodeBeacon(bad), /wersja/);
});
