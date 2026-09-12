import type { MagFeature } from './types.ts';

/**
 * Mapa anomalii magnetycznych: regularna siatka w lokalnym układzie ENU.
 * Każda komórka trzyma statystyki online (Welford) trzech cech: f, z, h.
 *
 * Rozmiar komórki: 1.0 m to dobry kompromis. Mniejsza = więcej szczegółu,
 * ale potrzeba dużo więcej przejść, by ją zapełnić.
 */

export interface CellStats { n: number; mean: number; m2: number }
export interface MagCell { f: CellStats; z: CellStats; h: CellStats }

export interface MagMapJSON {
  schema_version: 2;
  venue: string;
  cell: number;
  origin: { lat: number; lon: number };
  /** Klucz: "ix,iy". */
  cells: Record<string, [number, number, number, number, number, number, number]>;
  // [n, f_mean, f_std, z_mean, z_std, h_mean, h_std]
}

const newStats = (): CellStats => ({ n: 0, mean: 0, m2: 0 });
function push(s: CellStats, x: number): void {
  s.n++;
  const d = x - s.mean;
  s.mean += d / s.n;
  s.m2 += d * (x - s.mean);
}
const std = (s: CellStats): number => (s.n > 1 ? Math.sqrt(s.m2 / (s.n - 1)) : 0);

export class MagMap {
  cell: number;
  venue: string;
  origin: { lat: number; lon: number };
  private g = new Map<string, MagCell>();
  /** Minimalna liczba próbek, by komórka była brana pod uwagę przy lokalizacji. */
  minSamples = 2;
  /** Dolna granica sigma w modelu obserwacji [uT] — chroni przed przepewnością. */
  sigmaFloor = 2.0;
  /**
   * Log-wiarygodność przypisywana miejscu, którego mapa NIE zna.
   *
   * UWAGA, to jest pułapka, na którą łatwo się nadziać: jeśli nieznane miejsce
   * dostanie 0, to znaczy wiarygodność 1 — czyli WIĘCEJ niż idealne dopasowanie
   * (które daje ok. exp(-1.5) dla trzech cech). Filtr zacząłby wtedy aktywnie
   * uciekać poza mapę. Wartość -1.5 = E[-0.5*d^2] dla 3 cech przy poprawnym
   * modelu, czyli "nieznane jest tak samo dobre jak przeciętne trafienie".
   */
  unknownLogLik = -1.5;
  /** Maksymalna kara za pojedynczą cechę — chroni przed zabiciem filtru przez outlier. */
  maxTermPenalty = 6;
  /** Promień wyszukiwania w komórkach, gdy trafiona komórka jest pusta. */
  searchRadius = 1;

  constructor(venue = 'unknown', cell = 1.0, origin = { lat: 0, lon: 0 }) {
    this.venue = venue; this.cell = cell; this.origin = origin;
  }

  private key(x: number, y: number): string {
    return `${Math.floor(x / this.cell)},${Math.floor(y / this.cell)}`;
  }

  /** Tryb SURVEY: dodaj obserwację w znanej pozycji. */
  add(x: number, y: number, m: MagFeature): void {
    const k = this.key(x, y);
    let c = this.g.get(k);
    if (!c) { c = { f: newStats(), z: newStats(), h: newStats() }; this.g.set(k, c); }
    push(c.f, m.f); push(c.z, m.z); push(c.h, m.h);
  }

  get(x: number, y: number): MagCell | null {
    const c = this.g.get(this.key(x, y));
    if (c && c.f.n >= this.minSamples) return c;
    // Fallback: najbliższa zapełniona komórka w promieniu searchRadius.
    // Rozszerza efektywną szerokość zmapowanego korytarza i zapobiega
    // "głodzeniu" filtru tuż obok przejścia kalibracyjnego.
    const ix = Math.floor(x / this.cell), iy = Math.floor(y / this.cell);
    let best: MagCell | null = null, bd = Infinity;
    for (let dx = -this.searchRadius; dx <= this.searchRadius; dx++) {
      for (let dy = -this.searchRadius; dy <= this.searchRadius; dy++) {
        if (dx === 0 && dy === 0) continue;
        const cc = this.g.get(`${ix + dx},${iy + dy}`);
        if (!cc || cc.f.n < this.minSamples) continue;
        const d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = cc; }
      }
    }
    return best;
  }

  get size(): number { return this.g.size; }

  /**
   * Log-wiarygodność obserwacji `m` dla hipotezy pozycji (x, y).
   * Zwraca 0 (neutralnie), gdy mapa nie zna tego miejsca — filtr degraduje się
   * wtedy łagodnie do czystego PDR + ograniczeń mapy budynku zamiast losowo
   * karać cząstki. To świadoma decyzja projektowa.
   */
  logLikelihood(x: number, y: number, m: MagFeature): number {
    const c = this.get(x, y);
    if (!c) return this.unknownLogLik;
    let ll = 0;
    ll += this.term(m.f, c.f);
    ll += this.term(m.z, c.z);
    ll += this.term(m.h, c.h);
    return ll;
  }

  private term(obs: number, s: CellStats): number {
    const sd = Math.max(std(s), this.sigmaFloor);
    const d = (obs - s.mean) / sd;
    return Math.max(-this.maxTermPenalty, -0.5 * d * d);
  }

  /** Pokrycie mapy w metrach kwadratowych (komórki z wystarczającą liczbą próbek). */
  coverageM2(): number {
    let n = 0;
    for (const c of this.g.values()) if (c.f.n >= this.minSamples) n++;
    return n * this.cell * this.cell;
  }

  toJSON(): MagMapJSON {
    const cells: MagMapJSON['cells'] = {};
    for (const [k, c] of this.g) {
      cells[k] = [c.f.n, r(c.f.mean), r(std(c.f)), r(c.z.mean), r(std(c.z)), r(c.h.mean), r(std(c.h))];
    }
    return { schema_version: 2, venue: this.venue, cell: this.cell, origin: this.origin, cells };
  }

  static fromJSON(j: MagMapJSON): MagMap {
    const m = new MagMap(j.venue, j.cell, j.origin);
    for (const [k, v] of Object.entries(j.cells)) {
      const [n, fm, fs, zm, zs, hm, hs] = v;
      m.g.set(k, {
        f: { n, mean: fm, m2: fs * fs * Math.max(n - 1, 1) },
        z: { n, mean: zm, m2: zs * zs * Math.max(n - 1, 1) },
        h: { n, mean: hm, m2: hs * hs * Math.max(n - 1, 1) },
      });
    }
    return m;
  }
}

const r = (x: number): number => Math.round(x * 100) / 100;
