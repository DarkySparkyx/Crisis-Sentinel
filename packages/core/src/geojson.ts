import { VenueMap, type Seg } from './graph.ts';
import { toENU, type Origin } from './geo.ts';

/**
 * Ładowanie mapy obiektu z GeoJSON do lokalnego układu ENU.
 *
 * Konwencje `properties.kind`:
 *   "wall"     — LineString/Polygon: nieprzekraczalna przeszkoda
 *   "walkable" — LineString: oś korytarza/ścieżki (miękkie przyciąganie)
 *   "haven"    — Point: punkt bezpieczny / wyjście ewakuacyjne
 *   "anchor"   — Point: znany punkt kontrolny (kod QR / naklejka na podłodze)
 *
 * Dodatkowo, jeśli feature nie ma `kind`, stosujemy heurystykę na tagach OSM:
 *   building=* -> wall, highway=footway|corridor|steps|path -> walkable
 */
export interface GeoJSONFeature {
  type: 'Feature';
  geometry: { type: string; coordinates: any };
  properties: Record<string, any> | null;
}
export interface GeoJSONFC { type: 'FeatureCollection'; features: GeoJSONFeature[] }

export function loadVenue(fc: GeoJSONFC, origin: Origin): VenueMap {
  const v = new VenueMap();
  const P = (c: number[]) => toENU(origin, c[1], c[0]);

  for (const f of fc.features) {
    const p = f.properties ?? {};
    const kind = String(p.kind ?? inferKind(p));
    const g = f.geometry;
    if (!g) continue;

    if (kind === 'haven' && g.type === 'Point') {
      const q = P(g.coordinates);
      v.havens.push({ id: String(p.id ?? p.ref ?? v.havens.length), name: String(p.name ?? 'Safe Haven'), x: q.x, y: q.y });
      continue;
    }
    const lines: number[][][] = [];
    if (g.type === 'LineString') lines.push(g.coordinates);
    else if (g.type === 'MultiLineString') lines.push(...g.coordinates);
    else if (g.type === 'Polygon') lines.push(...g.coordinates);
    else if (g.type === 'MultiPolygon') for (const poly of g.coordinates) lines.push(...poly);
    else continue;

    for (const line of lines) {
      for (let i = 0; i + 1 < line.length; i++) {
        const a = P(line[i]), b = P(line[i + 1]);
        const seg: Seg = { ax: a.x, ay: a.y, bx: b.x, by: b.y };
        if (kind === 'walkable') v.walkable.push(seg);
        else if (kind === 'wall') v.addWall(seg);
      }
    }
  }
  v.index();
  return v;
}

function inferKind(p: Record<string, any>): string {
  if (p.building || p.barrier || p.wall) return 'wall';
  const hw = String(p.highway ?? '');
  if (['footway', 'corridor', 'steps', 'path', 'pedestrian', 'living_street', 'service'].includes(hw)) return 'walkable';
  if (p.emergency === 'assembly_point' || p.amenity === 'shelter') return 'haven';
  return 'other';
}
