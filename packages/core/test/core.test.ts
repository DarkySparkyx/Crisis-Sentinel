import test from 'node:test';
import assert from 'node:assert/strict';
import { qFromRotVec, qRotate, wrapPi, norm, v3, qYaw } from '../src/vec.ts';
import { toENU, toWGS, baroAltitude } from '../src/geo.ts';
import { AttitudeFilter } from '../src/attitude.ts';
import { magFeature, fitHardIron } from '../src/magfeat.ts';
import { MagMap } from '../src/magmap.ts';
import { VenueMap, segIntersect, pointSegDist } from '../src/graph.ts';
import { loadVenue } from '../src/geojson.ts';

test('qRotate: obrót o 90 st. wokół Z', () => {
  const q = qFromRotVec(v3(0, 0, Math.PI / 2));
  const r = qRotate(q, v3(1, 0, 0));
  assert.ok(Math.abs(r.x) < 1e-9 && Math.abs(r.y - 1) < 1e-9);
  assert.ok(Math.abs(qYaw(q) - Math.PI / 2) < 1e-9);
});

test('qRotate zachowuje długość wektora', () => {
  const q = qFromRotVec(v3(0.3, -0.7, 1.1));
  const v = v3(3, -4, 12);
  assert.ok(Math.abs(norm(qRotate(q, v)) - norm(v)) < 1e-9);
});

test('wrapPi normalizuje do (-pi, pi]', () => {
  assert.ok(Math.abs(wrapPi(3 * Math.PI) - Math.PI) < 1e-9);
  assert.ok(Math.abs(wrapPi(-3 * Math.PI) - Math.PI) < 1e-9);
  assert.ok(Math.abs(wrapPi(0.4) - 0.4) < 1e-12);
});

test('ENU <-> WGS84 roundtrip < 1 mm', () => {
  const o = { lat: 52.2297, lon: 21.0122 };
  for (const [dx, dy] of [[0, 0], [120, -340], [-2500, 1800]]) {
    const g = toWGS(o, dx, dy);
    const e = toENU(o, g.lat, g.lon);
    assert.ok(Math.hypot(e.x - dx, e.y - dy) < 1e-3, `błąd ${Math.hypot(e.x - dx, e.y - dy)}`);
  }
});

test('baroAltitude: 1 hPa ~ 8.3 m przy poziomie morza', () => {
  const h = baroAltitude(1012, 1013);
  assert.ok(h > 8 && h < 9, `h=${h}`);
});

test('AttitudeFilter: stały obrót żyroskopu daje poprawny kurs', () => {
  const a = new AttitudeFilter();
  const dt = 10; // ms
  // 0.5 rad/s wokół -Z urządzenia => kurs rośnie (zgodnie z ruchem wskazówek) o 0.5 rad/s
  for (let i = 0; i < 200; i++) {
    const t = i * dt;
    a.onAccel(t, v3(0, 0, 9.81));
    a.onGyro(t, v3(0, 0, -0.5));
  }
  // 199 kroków * 0.01 s * 0.5 rad/s = 0.995 rad
  assert.ok(Math.abs(a.heading - 0.995) < 0.03, `heading=${a.heading}`);
});

test('AttitudeFilter: ZARU estymuje bias żyroskopu w bezruchu', () => {
  const a = new AttitudeFilter();
  const bias = v3(0.01, -0.02, 0.03);
  for (let i = 0; i < 3000; i++) {
    a.onAccel(i * 10, v3(0, 0, 9.81));
    a.onGyro(i * 10, bias);
  }
  assert.ok(Math.abs(a.bias.z - 0.03) < 0.005, `bias.z=${a.bias.z}`);
  assert.ok(Math.abs(a.heading) < 0.05, `kurs nie powinien uciec: ${a.heading}`);
  assert.equal(a.stationary, true);
});

test('magFeature: cechy niezmiennicze względem obrotu telefonu wokół pionu', () => {
  const nav = v3(0, 19.3, -45.5); // pole ziemskie: North + w dół
  const feats = [0, 0.7, 2.1, -1.4].map(yaw => {
    const q = qFromRotVec(v3(0, 0, yaw));
    const inv = qFromRotVec(v3(0, 0, -yaw));
    const dev = qRotate(inv, nav); // odczyt w ramie urządzenia
    return magFeature(q, dev);
  });
  for (const f of feats) {
    assert.ok(Math.abs(f.f - feats[0].f) < 1e-6);
    assert.ok(Math.abs(f.z - feats[0].z) < 1e-6);
    assert.ok(Math.abs(f.h - feats[0].h) < 1e-6);
  }
  assert.equal(feats[0].clean, true, 'pole ziemskie powinno być uznane za czyste');
});

test('magFeature: silna anomalia NIE jest uznana za czyste pole', () => {
  const q = qFromRotVec(v3(0, 0, 0));
  const f = magFeature(q, v3(30, 25, -60));
  assert.equal(f.clean, false);
});

test('fitHardIron odzyskuje przesunięcie sfery', () => {
  const bias = v3(12, -7, 3.5);
  const pts = [];
  for (let i = 0; i < 200; i++) {
    const th = (i * 2.399963), ph = Math.acos(1 - (2 * (i + 0.5)) / 200);
    pts.push(v3(bias.x + 48 * Math.sin(ph) * Math.cos(th), bias.y + 48 * Math.sin(ph) * Math.sin(th), bias.z + 48 * Math.cos(ph)));
  }
  const est = fitHardIron(pts);
  assert.ok(Math.hypot(est.x - bias.x, est.y - bias.y, est.z - bias.z) < 0.5, JSON.stringify(est));
});

test('MagMap: zapis/odczyt i serializacja', () => {
  const m = new MagMap('t', 1, { lat: 0, lon: 0 });
  for (let i = 0; i < 5; i++) m.add(3.2, 4.8, { f: 50 + i * 0.1, z: -45, h: 19, clean: false });
  assert.ok(m.get(3.9, 4.1) !== null);
  const m2 = MagMap.fromJSON(JSON.parse(JSON.stringify(m.toJSON())));
  assert.equal(m2.size, m.size);
  const a = m.logLikelihood(3.2, 4.8, { f: 50.2, z: -45, h: 19, clean: false });
  const b = m2.logLikelihood(3.2, 4.8, { f: 50.2, z: -45, h: 19, clean: false });
  assert.ok(Math.abs(a - b) < 1e-6);
});

test('MagMap: nieznane miejsce dostaje karę, nie premię', () => {
  const m = new MagMap('t', 1, { lat: 0, lon: 0 });
  m.searchRadius = 0;
  for (let i = 0; i < 5; i++) m.add(0.5, 0.5, { f: 50, z: -45, h: 19, clean: false });
  const perfect = m.logLikelihood(0.5, 0.5, { f: 50, z: -45, h: 19, clean: false });
  const unknown = m.logLikelihood(500, 500, { f: 50, z: -45, h: 19, clean: false });
  assert.ok(unknown < perfect, 'nieznane miejsce nie może być lepsze niż idealne dopasowanie');
  assert.ok(unknown > -10, 'ale też nie może zabijać cząstek');
});

test('geometria: przecięcia odcinków i odległość punkt-odcinek', () => {
  assert.equal(segIntersect(0, 0, 10, 0, 5, -5, 5, 5), true);
  assert.equal(segIntersect(0, 0, 10, 0, 5, 1, 5, 5), false);
  assert.ok(Math.abs(pointSegDist(5, 3, { ax: 0, ay: 0, bx: 10, by: 0 }) - 3) < 1e-9);
  assert.ok(Math.abs(pointSegDist(-4, 0, { ax: 0, ay: 0, bx: 10, by: 0 }) - 4) < 1e-9);
});

test('VenueMap: ograniczenie ścianą blokuje przejście', () => {
  const v = new VenueMap();
  v.addWall({ ax: 5, ay: -10, bx: 5, by: 10 });
  v.index();
  assert.equal(v.crossesWall(0, 0, 10, 0), true);
  assert.equal(v.crossesWall(0, 0, 4, 0), false);
});

test('loadVenue czyta GeoJSON i rozpoznaje kind', () => {
  const o = { lat: 52.0, lon: 21.0 };
  const p = (x: number, y: number) => { const g = toWGS(o, x, y); return [g.lon, g.lat]; };
  const fc = {
    type: 'FeatureCollection' as const,
    features: [
      { type: 'Feature' as const, properties: { kind: 'wall' }, geometry: { type: 'LineString', coordinates: [p(0, 0), p(0, 20)] } },
      { type: 'Feature' as const, properties: { kind: 'walkable' }, geometry: { type: 'LineString', coordinates: [p(2, 0), p(2, 20)] } },
      { type: 'Feature' as const, properties: { kind: 'haven', name: 'Wyjscie A' }, geometry: { type: 'Point', coordinates: p(2, 20) } },
    ],
  };
  const v = loadVenue(fc, o);
  assert.equal(v.walls.length, 1);
  assert.equal(v.walkable.length, 1);
  assert.equal(v.havens.length, 1);
  assert.ok(Math.abs(v.havens[0].y - 20) < 0.01);
  assert.equal(v.crossesWall(-1, 10, 1, 10), true);
});
