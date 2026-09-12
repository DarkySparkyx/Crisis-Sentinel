import type { MagFeature, Vec3 } from './types.ts';
import { norm, qRotate } from './vec.ts';
import type { Quat } from './types.ts';

/**
 * Zamiana surowego odczytu magnetometru (rama urządzenia) na cechę
 * NIEZALEŻNĄ od obrotu telefonu wokół pionu.
 *
 * Dlaczego to jest sedno projektu:
 *  - surowe (x,y,z) w ramie telefonu zmieniają się, gdy tylko obrócisz telefon
 *    w ręce — są bezużyteczne jako "odcisk palca" miejsca,
 *  - |B| (moduł) jest niezmiennikiem KAŻDEGO obrotu,
 *  - B_up (składowa pionowa po obrocie do ramy nawigacyjnej) oraz |B_h|
 *    (moduł składowej poziomej) są niezmiennikami obrotu wokół pionu,
 *    a niosą DUŻO więcej informacji niż samo |B|.
 * Używamy trójki (f, z, h) jako 3-wymiarowego odcisku palca miejsca.
 */

/** Typowy moduł pola ziemskiego w Polsce ~49-50 uT; inklinacja ~66-68 st. */
export const EARTH_F_UT = 49.5;
export const EARTH_DIP_DEG = 67;

export interface MagFeatOpts {
  earthF: number;
  earthDipDeg: number;
  /** Dopuszczalne odchylenie modułu, by uznać pole za "czyste" [uT]. */
  fTol: number;
  /** Dopuszczalne odchylenie inklinacji [st.]. */
  dipTol: number;
}

export const DEFAULT_MAGFEAT_OPTS: MagFeatOpts = {
  earthF: EARTH_F_UT,
  earthDipDeg: EARTH_DIP_DEG,
  fTol: 4,
  dipTol: 8,
};

/**
 * @param q kwaternion urządzenie->nawigacja z AttitudeFilter
 * @param m odczyt magnetometru w ramie urządzenia [uT]
 */
export function magFeature(q: Quat, m: Vec3, opts: MagFeatOpts = DEFAULT_MAGFEAT_OPTS): MagFeature {
  const nav = qRotate(q, m);
  const f = norm(nav);
  const z = nav.z;
  const h = Math.hypot(nav.x, nav.y);
  const dip = (Math.atan2(-z, h) * 180) / Math.PI;
  const clean =
    Math.abs(f - opts.earthF) < opts.fTol &&
    Math.abs(dip - opts.earthDipDeg) < opts.dipTol;
  return { f, z, h, clean };
}

/**
 * Kalibracja hard-iron: środek sfery dopasowanej do chmury punktów (x,y,z)
 * zebranej przy obracaniu telefonem we wszystkich osiach ("ósemka").
 * Metoda: liniowe najmniejsze kwadraty dla równania sfery.
 * @returns bias [uT] do odjęcia od surowych odczytów
 */
export function fitHardIron(samples: Vec3[]): Vec3 {
  const n = samples.length;
  if (n < 12) return { x: 0, y: 0, z: 0 };
  // |p - c|^2 = r^2  ->  2*px*cx + 2*py*cy + 2*pz*cz + (r^2 - |c|^2) = |p|^2
  // A * [cx, cy, cz, k]^T = b
  const ata = Array.from({ length: 4 }, () => new Float64Array(4));
  const atb = new Float64Array(4);
  for (const p of samples) {
    const row = [2 * p.x, 2 * p.y, 2 * p.z, 1];
    const bi = p.x * p.x + p.y * p.y + p.z * p.z;
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) ata[i][j] += row[i] * row[j];
      atb[i] += row[i] * bi;
    }
  }
  const sol = solve4(ata, atb);
  return sol ? { x: sol[0], y: sol[1], z: sol[2] } : { x: 0, y: 0, z: 0 };
}

function solve4(a: Float64Array[], b: Float64Array): number[] | null {
  const m = a.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < 4; c++) {
    let piv = c;
    for (let r = c + 1; r < 4; r++) if (Math.abs(m[r][c]) > Math.abs(m[piv][c])) piv = r;
    if (Math.abs(m[piv][c]) < 1e-12) return null;
    [m[c], m[piv]] = [m[piv], m[c]];
    for (let r = 0; r < 4; r++) {
      if (r === c) continue;
      const f = m[r][c] / m[c][c];
      for (let k = c; k <= 4; k++) m[r][k] -= f * m[c][k];
    }
  }
  return [m[0][4] / m[0][0], m[1][4] / m[1][1], m[2][4] / m[2][2], m[3][4] / m[3][3]];
}
