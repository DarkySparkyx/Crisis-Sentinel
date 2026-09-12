import type { Sample, RecordingHeader } from '../../core/src/types.ts';

/**
 * GENERATOR SYNTETYCZNEGO SPACERU.
 *
 * To jest najważniejsze narzędzie deweloperskie w całym projekcie: pozwala
 * rozwijać i stroić algorytm ZANIM ktokolwiek wyjdzie z telefonem na korytarz,
 * i daje ground truth co do centymetra. Bez tego każda iteracja algorytmu
 * kosztuje spacer po budynku.
 *
 * Model telefonu: trzymany płasko, ekranem do góry, osią +Y w kierunku marszu
 * (konwencja Androida: azimuth = kierunek osi +Y).
 */

export interface SynthOpts {
  /** Punkty trasy w lokalnym ENU [m]. */
  waypoints: { x: number; y: number }[];
  /** Prędkość marszu [m/s]. */
  speed: number;
  /** Rzeczywista długość kroku [m]. */
  stepLength: number;
  /** Częstotliwość próbkowania IMU [Hz]. */
  rate: number;
  /** Bias żyroskopu [rad/s] — główne źródło dryfu kursu w prawdziwym świecie. */
  gyroBias: { x: number; y: number; z: number };
  /** Szum akcelerometru [m/s^2 RMS]. */
  accNoise: number;
  /** Szum żyroskopu [rad/s RMS]. */
  gyroNoise: number;
  /** Szum magnetometru [uT RMS]. */
  magNoise: number;
  /** Amplituda anomalii magnetycznej [uT]. */
  anomalyAmp: number;
  /** Pauza na każdym waypointcie [s] — generuje okresy bezruchu (ZUPT/ZARU). */
  pauseS: number;
  seed: number;
}

export const DEFAULT_SYNTH: SynthOpts = {
  waypoints: [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 18 }, { x: 0, y: 18 }, { x: 0, y: 0 }],
  speed: 1.35,
  stepLength: 0.70,
  rate: 100,
  gyroBias: { x: 0.002, y: -0.003, z: 0.008 }, // 0.008 rad/s ~ 0.46 st./s -> 27 st./min dryfu!
  accNoise: 0.12,
  gyroNoise: 0.01,
  magNoise: 0.4,
  anomalyAmp: 18,
  pauseS: 1.5,
  seed: 7,
};

/**
 * Deterministyczna "prawdziwa" mapa anomalii magnetycznych.
 * Suma kilku gaussowskich garbów + periodyczna struktura (imituje zbrojenie stropu).
 * Ta sama funkcja służy do generowania obserwacji i do weryfikacji mapy zbudowanej
 * przez algorytm.
 */
export function trueField(x: number, y: number, amp: number): { f: number; z: number; h: number } {
  const bumps = [
    { x: 8, y: 2, s: 3.0, a: 1.0 },
    { x: 22, y: 1, s: 2.2, a: -0.8 },
    { x: 30, y: 9, s: 3.5, a: 1.3 },
    { x: 17, y: 18, s: 2.8, a: -1.1 },
    { x: 2, y: 11, s: 3.2, a: 0.9 },
  ];
  let d = 0;
  for (const b of bumps) {
    const r2 = (x - b.x) ** 2 + (y - b.y) ** 2;
    d += b.a * Math.exp(-r2 / (2 * b.s * b.s));
  }
  d += 0.25 * Math.sin(x / 2.1) * Math.cos(y / 1.7);
  const F = 49.5 + amp * d;
  const dip = (67 * Math.PI) / 180 + 0.12 * d;
  return { f: F, z: -F * Math.sin(dip), h: F * Math.cos(dip) };
}

export function generate(opts: Partial<SynthOpts> = {}): {
  header: RecordingHeader;
  samples: Sample[];
  truth: { t: number; x: number; y: number; heading: number }[];
} {
  const o = { ...DEFAULT_SYNTH, ...opts };
  const rnd = mulberry32(o.seed);
  const gauss = makeGauss(rnd);
  const dt = 1 / o.rate;

  const samples: Sample[] = [];
  const truth: { t: number; x: number; y: number; heading: number }[] = [];

  let t = 0;
  let px = o.waypoints[0].x, py = o.waypoints[0].y;
  let heading = bearing(o.waypoints[0], o.waypoints[1]);
  let stepPhase = 0;
  // Skumulowany błąd kursu wnoszony przez bias żyroskopu jest generowany
  // naturalnie: symulujemy PRAWDZIWY ruch, a do żyroskopu dokładamy bias.

  const emitIMU = (moving: boolean, hdg: number, x: number, y: number, omegaZ: number) => {
    // f = 2 * speed / stepLength kroków/s -> pionowe kołysanie
    const fStep = moving ? o.speed / o.stepLength : 0;
    stepPhase += 2 * Math.PI * fStep * dt;
    const bob = moving ? 1.5 * Math.sin(stepPhase) + 0.5 * Math.sin(2 * stepPhase + 0.7) : 0;

    // Akcelerometr w ramie urządzenia (płasko, +Z do góry):
    // reakcja na grawitację = +9.81 na Z, plus kołysanie pionowe, plus szum.
    samples.push({
      t: Math.round(t * 1000), type: 'acc',
      x: gauss() * o.accNoise + (moving ? 0.4 * Math.sin(stepPhase + 1.1) : 0),
      y: gauss() * o.accNoise + (moving ? 0.6 * Math.sin(stepPhase + 2.3) : 0),
      z: 9.81 + bob + gauss() * o.accNoise,
    });
    // Żyroskop: obrót wokół osi Z urządzenia. Kurs kompasowy rośnie zgodnie z ruchem
    // wskazówek zegara, a obrót wokół +Z jest przeciwny do ruchu wskazówek -> znak minus.
    samples.push({
      t: Math.round(t * 1000), type: 'gyr',
      x: o.gyroBias.x + gauss() * o.gyroNoise,
      y: o.gyroBias.y + gauss() * o.gyroNoise,
      z: -omegaZ + o.gyroBias.z + gauss() * o.gyroNoise,
    });
    // Magnetometr: pole w ramie nawigacyjnej obrócone do ramy urządzenia.
    const F = trueField(x, y, o.anomalyAmp);
    // nav: (E, N, U) = (0, h, z) po obrocie o kurs -> dev
    const ch = Math.cos(hdg), sh = Math.sin(hdg);
    // wektor pola w nav: North = F.h, East = 0, Up = F.z
    const mE = 0, mN = F.h, mU = F.z;
    // dev.y = kierunek marszu (kurs hdg) -> rzut na dev.y = mE*sin(h)+mN*cos(h)
    samples.push({
      t: Math.round(t * 1000), type: 'mag',
      x: mE * ch - mN * sh + gauss() * o.magNoise,
      y: mE * sh + mN * ch + gauss() * o.magNoise,
      z: mU + gauss() * o.magNoise,
    });
  };

  // Pauza startowa — pozwala filtrowi oszacować bias żyroskopu (ZARU).
  for (let i = 0; i < o.rate * 3; i++) { emitIMU(false, heading, px, py, 0); t += dt; }

  for (let wi = 0; wi + 1 < o.waypoints.length; wi++) {
    const a = o.waypoints[wi], b = o.waypoints[wi + 1];
    const target = bearing(a, b);

    // Obrót w miejscu do nowego kursu (1.2 rad/s).
    let dh = wrap(target - heading);
    const turnRate = 1.2 * Math.sign(dh || 1);
    while (Math.abs(dh) > 1e-3) {
      const d = Math.max(-Math.abs(dh), Math.min(Math.abs(dh), turnRate * dt));
      heading = wrap(heading + d);
      dh = wrap(target - heading);
      emitIMU(false, heading, px, py, turnRate);
      t += dt;
    }

    // Marsz po odcinku.
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(1, Math.round(L / (o.speed * dt)));
    for (let i = 1; i <= n; i++) {
      const u = i / n;
      px = a.x + (b.x - a.x) * u;
      py = a.y + (b.y - a.y) * u;
      emitIMU(true, heading, px, py, 0);
      truth.push({ t: Math.round(t * 1000), x: px, y: py, heading });
      t += dt;
    }

    // Znacznik ground truth na waypointcie + pauza.
    samples.push({ t: Math.round(t * 1000), type: 'mark', id: `WP${wi + 1}`, x: px, y: py });
    for (let i = 0; i < o.rate * o.pauseS; i++) { emitIMU(false, heading, px, py, 0); t += dt; }
  }

  const header: RecordingHeader = {
    schema_version: 2,
    session_id: `synth-${o.seed}`,
    started_at: new Date(0).toISOString(),
    device: 'SYNTHETIC',
    venue: 'synthetic',
    origin: { lat: 52.2297, lon: 21.0122 },
    notes: `synthetic walk, ${o.waypoints.length} waypoints, bias_z=${o.gyroBias.z} rad/s`,
  };
  return { header, samples, truth };
}

const bearing = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
  Math.atan2(b.x - a.x, b.y - a.y); // uwaga: (East, North) -> kurs kompasowy
const wrap = (a: number): number => {
  let x = a;
  while (x > Math.PI) x -= 2 * Math.PI;
  while (x <= -Math.PI) x += 2 * Math.PI;
  return x;
};

export function mulberry32(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function makeGauss(rnd: () => number): () => number {
  let spare: number | null = null;
  return () => {
    if (spare !== null) { const s = spare; spare = null; return s; }
    let u = 0, v = 0, s = 0;
    do { u = rnd() * 2 - 1; v = rnd() * 2 - 1; s = u * u + v * v; } while (s === 0 || s >= 1);
    const f = Math.sqrt((-2 * Math.log(s)) / s);
    spare = v * f;
    return u * f;
  };
}
