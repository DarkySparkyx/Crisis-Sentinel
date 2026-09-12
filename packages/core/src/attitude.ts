import type { Vec3, Quat } from './types.ts';
import { add, cross, normalize, norm, qFromRotVec, qMul, qNormalize, qRotate, qYaw, scale, sub, v3, wrapPi } from './vec.ts';

/**
 * Filtr komplementarny orientacji (accel + gyro), BEZ magnetometru.
 *
 * DLACZEGO bez magnetometru: cały pomysł produktu opiera się na tym, że wewnątrz
 * budynków pole magnetyczne jest zniekształcone przez konstrukcję. To samo
 * zniekształcenie, które jest naszym SYGNAŁEM lokalizacyjnym, jest ZABÓJCZE dla
 * kompasu (błędy 30-90 st.). Kurs bierzemy więc z żyroskopu (przyrostowo),
 * a magnetometru używamy do korekty kursu WYŁĄCZNIE gdy pole wygląda na ziemskie
 * (patrz magfeat.ts -> clean).
 *
 * Rama nawigacyjna: x = Wschód, y = Północ, z = Góra.
 * Yaw = 0 na starcie (kurs względny); wyrównanie do Północy robi się osobno
 * (fix GNSS przed wejściem / kompas na otwartym terenie / ręczne wskazanie).
 */
export class AttitudeFilter {
  q: Quat = { w: 1, x: 0, y: 0, z: 0 };
  bias: Vec3 = v3(0, 0, 0);
  /** Waga korekty pionu z akcelerometru. 0.02 = ok. 1 s stałej czasowej przy 50 Hz. */
  kAccel = 0.02;
  /** Wzmocnienie estymacji biasu żyroskopu podczas bezruchu. */
  kBias = 0.01;
  private lastT: number | null = null;
  private accLp: Vec3 = v3(0, 0, 9.81);
  private gyroMagLp = 0;
  private accVarLp = 0;
  private initialized = false;
  /** true gdy urządzenie stoi (podstawa ZUPT/ZARU). */
  stationary = false;
  /** Skumulowany czas bezruchu [ms] — do wyzwalania ZUPT. */
  stillMs = 0;

  /**
   * Kurs w radianach: kierunek, w którym wskazuje oś +Y urządzenia (góra ekranu),
   * liczony od Północy zgodnie z ruchem wskazówek zegara.
   * To dokładnie ta sama konwencja co azimuth z SensorManager.getOrientation() na Androidzie.
   * Uwaga: na starcie 0 = kierunek startowy, NIE Północ (patrz alignHeading).
   */
  get heading(): number {
    return wrapPi(-qYaw(this.q));
  }

  /** Wektor grawitacji w ramie urządzenia (znormalizowany). */
  get gravityDev(): Vec3 { return normalize(this.accLp); }

  onAccel(t: number, a: Vec3): void {
    const alpha = 0.08;
    this.accLp = add(scale(this.accLp, 1 - alpha), scale(a, alpha));
    const dev = Math.abs(norm(a) - 9.81);
    this.accVarLp = this.accVarLp * 0.9 + dev * 0.1;
    if (!this.initialized) {
      this.q = quatFromGravity(this.accLp);
      this.initialized = true;
    }
    this.updateStationary(t);
  }

  onGyro(t: number, g: Vec3): void {
    if (this.lastT === null) { this.lastT = t; return; }
    const dt = Math.min((t - this.lastT) / 1000, 0.1);
    this.lastT = t;
    if (dt <= 0) return;

    const gm = norm(g);
    this.gyroMagLp = this.gyroMagLp * 0.9 + gm * 0.1;

    // ZARU: w bezruchu odczyt żyroskopu to czysty bias -> uśredniamy.
    if (this.stationary) {
      this.bias = add(scale(this.bias, 1 - this.kBias), scale(g, this.kBias));
    }

    const gc = sub(g, this.bias);
    this.q = qNormalize(qMul(this.q, qFromRotVec(scale(gc, dt))));

    // Korekta pionu: gdzie kwaternion "myśli", że jest grawitacja, vs gdzie faktycznie jest.
    const gUpPredicted = qRotate(this.q, normalize(this.accLp)); // powinno dać (0,0,1)
    const err = cross(gUpPredicted, v3(0, 0, 1));
    // Korekta tylko gdy przyspieszenie ~= g (inaczej korygowalibyśmy pionem wg przyspieszenia ruchu)
    const trust = Math.exp(-Math.pow(this.accVarLp / 1.5, 2));
    const k = this.kAccel * trust;
    this.q = qNormalize(qMul(qFromRotVec(scale(err, k)), this.q));
  }

  /** Zewnętrzne wyrównanie kursu do Północy (np. z GNSS przed wejściem do budynku). */
  alignHeading(trueHeading: number): void {
    const dh = wrapPi(trueHeading - this.heading);
    // obrót wokół osi Z ramy nawigacyjnej (kurs kompasowy rośnie zgodnie z ruchem wskazówek -> -dh w mat. konwencji)
    const half = -dh / 2;
    this.q = qNormalize(qMul({ w: Math.cos(half), x: 0, y: 0, z: Math.sin(half) }, this.q));
  }

  private updateStationary(t: number): void {
    const wasStill = this.stationary;
    this.stationary = this.accVarLp < 0.35 && this.gyroMagLp < 0.12;
    if (this.stationary && wasStill && this.lastT !== null) this.stillMs += 20;
    if (!this.stationary) this.stillMs = 0;
  }
}

/** Kwaternion urządzenie->nawigacja z samego wektora grawitacji (yaw = 0). */
export function quatFromGravity(acc: Vec3): Quat {
  const g = normalize(acc);            // grawitacja w ramie urządzenia (w górę, bo akcelerometr)
  const up = v3(0, 0, 1);
  const axis = cross(g, up);
  const c = Math.max(-1, Math.min(1, g.x * up.x + g.y * up.y + g.z * up.z));
  const angle = Math.acos(c);
  const n = norm(axis);
  if (n < 1e-9) return angle < 1 ? { w: 1, x: 0, y: 0, z: 0 } : { w: 0, x: 1, y: 0, z: 0 };
  return qFromRotVec(scale(axis, angle / n));
}
