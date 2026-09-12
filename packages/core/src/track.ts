/**
 * KODEK ŚLADU — pakuje pozycję i przebytą trasę w pakiet mieszczący się
 * w JEDNEJ wiadomości SMS.
 *
 * Po co: w Polsce turysta bez zasięgu nie ma żadnej drogi przekazania swojej
 * pozycji. Emergency SOS przez satelitę u Apple nie obejmuje Polski, SMS na 112
 * dla ogółu nie istnieje, a aplikacja RATUNEK wymaga sieci. Jedyne, na co można
 * liczyć, to kilkusekundowe okno zasięgu na grani albo cudzy telefon w promieniu
 * stu metrów. W takim oknie przejdzie jedna wiadomość — i musi się w niej zmieścić
 * wszystko, co ratownikom jest potrzebne.
 *
 * Budżet: SMS w alfabecie GSM-7 to 160 znaków. Używamy 64-znakowego podzbioru
 * (A-Z a-z 0-9 . -), który jest bezpieczny w GSM-7 i w URL-u, po 6 bitów na znak:
 *      160 znaków x 6 bitów = 960 bitów = 120 bajtów ładunku.
 *
 * Kolejność ma znaczenie: najpierw bieżąca pozycja z pełną precyzją, potem trasa
 * WSTECZ od teraz. Dzięki temu pakiet obcięty w połowie nadal niesie to, co
 * najważniejsze — gdzie jesteś teraz i skąd przyszedłeś ostatnio.
 */

import { toENU, toWGS, type Origin } from './geo.ts';

export const SMS_PAYLOAD_BYTES = 120;
/** Podzbiór GSM-7 bezpieczny też w URL-ach i w plikach tekstowych. */
export const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.-';
/**
 * Epoka formatu. Pole czasu ma 24 bity minut, co daje zakres ~31 lat od tej daty.
 * (Pierwsza wersja miała 21 bitów od 2020 r. — zakres kończył się w 2024 i pole
 *  się przepełniało. Test `metadane przeżywają kodowanie` to wyłapał.)
 */
const EPOCH_MS = Date.UTC(2024, 0, 1);

export type BeaconState = 'ok' | 'help' | 'sos';
const STATES: BeaconState[] = ['ok', 'help', 'sos'];

export interface TrackPoint { lat: number; lon: number }

export interface Beacon {
  /** Bieżąca pozycja — jedyna kodowana z pełną precyzją. */
  lat: number;
  lon: number;
  /** Czas ostatniego fixa (ms epoch). */
  t: number;
  /** Stan baterii 0-100 [%]. */
  battery: number;
  /** Szacowana niepewność pozycji [m]. */
  accuracy: number;
  state: BeaconState;
  /** Wysokość n.p.m. [m] — w górach niesie dużo informacji na małej liczbie bitów. */
  alt: number;
  /** Trasa, od najstarszego do najnowszego punktu. Ostatni = pozycja bieżąca. */
  track: TrackPoint[];
}

export interface EncodeResult {
  bytes: Uint8Array;
  sms: string;
  /** Ile punktów trasy faktycznie weszło do pakietu. */
  pointsEncoded: number;
  /** Tolerancja upraszczania [m], którą trzeba było przyjąć, żeby się zmieścić. */
  toleranceM: number;
  /** Kwant delty [m] — dolna granica błędu odtworzenia. */
  quantM: number;
}

/* ------------------------------------------------------------------ */
/* strumień bitowy                                                     */
/* ------------------------------------------------------------------ */

class BitWriter {
  private buf: number[] = [];
  private cur = 0;
  private n = 0;
  write(value: number, bits: number): void {
    for (let i = bits - 1; i >= 0; i--) {
      this.cur = (this.cur << 1) | ((value >>> i) & 1);
      if (++this.n === 8) { this.buf.push(this.cur); this.cur = 0; this.n = 0; }
    }
  }
  get bitLength(): number { return this.buf.length * 8 + this.n; }
  bytes(): Uint8Array {
    const out = [...this.buf];
    if (this.n) out.push(this.cur << (8 - this.n));
    return Uint8Array.from(out);
  }
}

class BitReader {
  private i = 0;
  private b: Uint8Array;
  // Uwaga: parametry-właściwości (`constructor(private b)`) NIE działają przy
  // natywnym uruchamianiu .ts przez Node (strip-only mode) — stąd jawne pole.
  constructor(b: Uint8Array) { this.b = b; }
  read(bits: number): number {
    let v = 0;
    for (let k = 0; k < bits; k++) {
      const byte = this.b[this.i >> 3] ?? 0;
      v = (v << 1) | ((byte >> (7 - (this.i & 7))) & 1);
      this.i++;
    }
    return v >>> 0;
  }
  get remainingBits(): number { return this.b.length * 8 - this.i; }
}

const zig = (v: number): number => (v << 1) ^ (v >> 31);
const unzig = (v: number): number => (v >>> 1) ^ -(v & 1);

/* ------------------------------------------------------------------ */
/* upraszczanie trasy (Douglas-Peucker w metrach)                      */
/* ------------------------------------------------------------------ */

/** Zachowuje kształt trasy przy zadanej tolerancji; zawsze zostawia oba końce. */
export function simplify(pts: { x: number; y: number }[], tol: number): number[] {
  if (pts.length <= 2) return pts.map((_, i) => i);
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let best = -1, bestD = tol;
    const ax = pts[a].x, ay = pts[a].y, bx = pts[b].x, by = pts[b].y;
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      const wx = pts[i].x - ax, wy = pts[i].y - ay;
      const t = L2 < 1e-9 ? 0 : Math.max(0, Math.min(1, (wx * dx + wy * dy) / L2));
      const d = Math.hypot(wx - t * dx, wy - t * dy);
      if (d > bestD) { bestD = d; best = i; }
    }
    if (best >= 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  const idx: number[] = [];
  for (let i = 0; i < pts.length; i++) if (keep[i]) idx.push(i);
  return idx;
}

/* ------------------------------------------------------------------ */
/* kodowanie                                                           */
/* ------------------------------------------------------------------ */

/** Nagłówek: wersja, pozycja, czas, bateria, dokładność, stan, wysokość, parametry trasy. */
const HDR_BITS = 4 + 25 + 26 + 24 + 5 + 4 + 2 + 13 + 4 + 4 + 8; // = 119 bitów = 15 B

function writeHeader(w: BitWriter, b: Beacon, quantBits: number, quantIdx: number, n: number): void {
  w.write(1, 4);                                                       // wersja formatu
  w.write(Math.round((b.lat + 90) * 1e5) & 0x1ffffff, 25);             // ~1,1 m
  w.write(Math.round((b.lon + 180) * 1e5) & 0x3ffffff, 26);            // ~0,7 m w PL
  w.write(Math.max(0, Math.round((b.t - EPOCH_MS) / 60000)) & 0xffffff, 24); // minuty, zakres ~31 lat
  w.write(Math.max(0, Math.min(31, Math.round(b.battery / 3.23))), 5);
  w.write(accCode(b.accuracy), 4);
  w.write(Math.max(0, STATES.indexOf(b.state)), 2);
  w.write(Math.max(0, Math.min(8191, Math.round(b.alt + 500))), 13);   // -500..7692 m n.p.m.
  w.write(quantBits - 4, 4);                                           // 4..19 bitów na oś
  w.write(quantIdx, 4);                                                // indeks kwantu
  w.write(Math.min(255, n), 8);                                        // liczba punktów trasy
}

const QUANTS = [2, 3, 5, 8, 12, 20, 30, 50, 80, 120, 200, 300, 500, 800, 1200, 2000];
const ACC = [3, 5, 8, 12, 20, 30, 50, 80, 120, 200, 300, 500, 800, 1200, 2000, 5000];
const accCode = (m: number): number => { const i = ACC.findIndex(v => m <= v); return i < 0 ? 15 : i; };

/**
 * Pakuje beacon w zadany budżet bajtów. Automatycznie dobiera tolerancję
 * upraszczania i kwant delty tak, by zmieścić jak najwięcej trasy.
 */
export function encodeBeacon(b: Beacon, budgetBytes = SMS_PAYLOAD_BYTES): EncodeResult {
  const origin: Origin = { lat: b.lat, lon: b.lon };
  const xy = b.track.map(p => toENU(origin, p.lat, p.lon));
  const budgetBits = budgetBytes * 8;

  /**
   * Wybór parametrów. Kryterium jest tu subtelne i łatwo je postawić źle:
   * naiwne „upakuj jak najwięcej punktów" wybiera najdrobniejszy raster ostatnich
   * kilkuset metrów i gubi resztę dnia. Ratownikom potrzebny jest KSZTAŁT CAŁEJ
   * trasy, nie centymetry ostatniego odcinka. Szukamy więc najmniejszej tolerancji
   * upraszczania, przy której cała trasa — od startu do teraz — mieści się w budżecie.
   */
  const TOLS = [2, 5, 10, 15, 25, 40, 60, 100, 160, 250, 400, 650, 1000, 1600];
  let best: EncodeResult | null = null;
  let bestErr = Infinity;

  for (const tol of TOLS) {
    const keep = simplify(xy, tol);
    const pts = keep.map(i => xy[i]).reverse();           // najnowszy pierwszy
    const n = pts.length - 1;                             // punkt 0 siedzi w nagłówku
    if (n > 255) continue;
    let maxD = 0;
    for (let i = 1; i < pts.length; i++)
      maxD = Math.max(maxD, Math.abs(pts[i].x - pts[i - 1].x), Math.abs(pts[i].y - pts[i - 1].y));

    for (let qi = 0; qi < QUANTS.length; qi++) {
      const q = QUANTS[qi];
      const bits = Math.max(4, Math.min(19, Math.ceil(Math.log2(2 * (maxD / q + 2))) + 1));
      if (HDR_BITS + 2 * bits * n > budgetBits) continue;
      // Dwa niezależne źródła błędu: uproszczenie kształtu (tol) i kwantyzacja
      // delty (RMS ~ 0,41*q w 2D). Sumujemy je kwadratowo i wybieramy minimum —
      // inaczej algorytm potrafi wybrać gęstą siatkę punktów zapisanych tak
      // grubym kwantem, że wynik jest gorszy niż mniej punktów zapisanych dokładnie.
      const err = Math.hypot(tol, 0.41 * q);
      if (err < bestErr) { bestErr = err; best = pack(b, pts, n, q, qi, bits, tol); }
    }
  }

  // Awaryjnie: nawet najgrubsze uproszczenie się nie mieści (bardzo długa trasa).
  // Wtedy oddajemy najświeższy fragment — lepszy kawałek niż nic.
  if (!best) {
    const q = QUANTS[QUANTS.length - 1], qi = QUANTS.length - 1, bits = 12;
    const pts = simplify(xy, 1600).map(i => xy[i]).reverse();
    const n = Math.min(pts.length - 1, Math.floor((budgetBits - HDR_BITS) / (2 * bits)));
    best = pack(b, pts, Math.max(0, n), q, qi, bits, 1600);
  }
  return best;
}

function pack(
  b: Beacon, pts: { x: number; y: number }[], n: number,
  q: number, qi: number, bits: number, tol: number,
): EncodeResult {
  const w = new BitWriter();
  writeHeader(w, b, bits, qi, n);
  let px = 0, py = 0;
  for (let i = 1; i <= n; i++) {
    const cx = clampZig(Math.round((pts[i].x - px) / q), bits);
    const cy = clampZig(Math.round((pts[i].y - py) / q), bits);
    w.write(zig(cx), bits); w.write(zig(cy), bits);
    px += cx * q; py += cy * q;
  }
  const bytes = w.bytes();
  return { bytes, sms: toSms(bytes), pointsEncoded: n + 1, toleranceM: tol, quantM: q };
}

function clampZig(v: number, bits: number): number {
  const lim = (1 << (bits - 1)) - 1;
  return Math.max(-lim, Math.min(lim, v));
}

export function decodeBeacon(bytes: Uint8Array): Beacon {
  const r = new BitReader(bytes);
  const version = r.read(4);
  if (version !== 1) throw new Error(`nieobsługiwana wersja pakietu: ${version}`);
  const lat = r.read(25) / 1e5 - 90;
  const lon = r.read(26) / 1e5 - 180;
  const t = r.read(24) * 60000 + EPOCH_MS;
  const battery = Math.round(r.read(5) * 3.23);
  const accuracy = ACC[r.read(4)];
  const state = STATES[r.read(2)] ?? 'ok';
  const alt = r.read(13) - 500;
  const bits = r.read(4) + 4;
  const q = QUANTS[r.read(4)];
  const n = r.read(8);

  const origin: Origin = { lat, lon };
  const back: TrackPoint[] = [{ lat, lon }];
  let px = 0, py = 0;
  for (let i = 0; i < n; i++) {
    if (r.remainingBits < 2 * bits) break;              // pakiet obcięty — zwracamy, co mamy
    px += unzig(r.read(bits)) * q;
    py += unzig(r.read(bits)) * q;
    back.push(toWGS(origin, px, py));
  }
  return { lat, lon, t, battery, accuracy, state, alt, track: back.reverse() };
}

/* ------------------------------------------------------------------ */
/* pakowanie do treści SMS                                             */
/* ------------------------------------------------------------------ */

export function toSms(bytes: Uint8Array): string {
  let out = '', acc = 0, n = 0;
  for (const b of bytes) {
    acc = (acc << 8) | b; n += 8;
    while (n >= 6) { out += ALPHABET[(acc >> (n - 6)) & 63]; n -= 6; }
  }
  if (n) out += ALPHABET[(acc << (6 - n)) & 63];
  return out;
}

export function fromSms(s: string): Uint8Array {
  const out: number[] = [];
  let acc = 0, n = 0;
  for (const ch of s.trim()) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) continue;
    acc = (acc << 6) | v; n += 6;
    if (n >= 8) { out.push((acc >> (n - 8)) & 255); n -= 8; }
  }
  return Uint8Array.from(out);
}
