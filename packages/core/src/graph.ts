/**
 * Warstwa mapy budynku/terenu: ściany (twarde ograniczenia) i ścieżki chodzenia
 * (miękkie przyciąganie). Wejście: zwykły GeoJSON — patrz docs/03-FORMATY-DANYCH.md
 *
 * Ograniczenie ścianami to NAJTAŃSZY duży zysk dokładności w całym systemie:
 * eliminuje dryf boczny za darmo, bez żadnej dodatkowej infrastruktury.
 */

export interface Seg { ax: number; ay: number; bx: number; by: number }
export interface Haven { id: string; name: string; x: number; y: number }

export class VenueMap {
  walls: Seg[] = [];
  walkable: Seg[] = [];
  havens: Haven[] = [];
  private grid = new Map<string, number[]>();
  private cell = 5;

  addWall(s: Seg): void { this.walls.push(s); }

  /** Buduje indeks przestrzenny ścian — bez tego 500 cząstek x 2000 ścian zabije telefon. */
  index(): void {
    this.grid.clear();
    this.walls.forEach((s, i) => {
      const x0 = Math.floor(Math.min(s.ax, s.bx) / this.cell);
      const x1 = Math.floor(Math.max(s.ax, s.bx) / this.cell);
      const y0 = Math.floor(Math.min(s.ay, s.by) / this.cell);
      const y1 = Math.floor(Math.max(s.ay, s.by) / this.cell);
      for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
          const k = `${x},${y}`;
          const arr = this.grid.get(k);
          if (arr) arr.push(i); else this.grid.set(k, [i]);
        }
      }
    });
  }

  /** Czy odcinek ruchu przecina ścianę? */
  crossesWall(ax: number, ay: number, bx: number, by: number): boolean {
    if (!this.walls.length) return false;
    const x0 = Math.floor(Math.min(ax, bx) / this.cell);
    const x1 = Math.floor(Math.max(ax, bx) / this.cell);
    const y0 = Math.floor(Math.min(ay, by) / this.cell);
    const y1 = Math.floor(Math.max(ay, by) / this.cell);
    const seen = new Set<number>();
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const arr = this.grid.get(`${x},${y}`);
        if (!arr) continue;
        for (const i of arr) {
          if (seen.has(i)) continue;
          seen.add(i);
          const w = this.walls[i];
          if (segIntersect(ax, ay, bx, by, w.ax, w.ay, w.bx, w.by)) return true;
        }
      }
    }
    return false;
  }

  /** Odległość do najbliższej ścieżki chodzenia [m]; Infinity gdy brak ścieżek. */
  distToWalkable(x: number, y: number): number {
    if (!this.walkable.length) return Infinity;
    let best = Infinity;
    for (const s of this.walkable) best = Math.min(best, pointSegDist(x, y, s));
    return best;
  }

  nearestHaven(x: number, y: number): { haven: Haven; dist: number } | null {
    if (!this.havens.length) return null;
    let best: Haven | null = null; let bd = Infinity;
    for (const h of this.havens) {
      const d = Math.hypot(h.x - x, h.y - y);
      if (d < bd) { bd = d; best = h; }
    }
    return best ? { haven: best, dist: bd } : null;
  }
}

export function segIntersect(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number,
): boolean {
  const d1 = cr(cx, cy, dx, dy, ax, ay);
  const d2 = cr(cx, cy, dx, dy, bx, by);
  const d3 = cr(ax, ay, bx, by, cx, cy);
  const d4 = cr(ax, ay, bx, by, dx, dy);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}
const cr = (ax: number, ay: number, bx: number, by: number, px: number, py: number): number =>
  (bx - ax) * (py - ay) - (by - ay) * (px - ax);

export function pointSegDist(px: number, py: number, s: Seg): number {
  const vx = s.bx - s.ax, vy = s.by - s.ay;
  const wx = px - s.ax, wy = py - s.ay;
  const L2 = vx * vx + vy * vy;
  const t = L2 < 1e-9 ? 0 : Math.max(0, Math.min(1, (wx * vx + wy * vy) / L2));
  return Math.hypot(px - (s.ax + t * vx), py - (s.ay + t * vy));
}
