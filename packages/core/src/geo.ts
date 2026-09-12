// Lokalny układ ENU (East-North-Up) zaczepiony w punkcie origin.
// Dla obszaru < 5 km płaska aproksymacja jest dokładna do ~cm — nie potrzeba proj4/turf.

const R = 6378137; // promień równikowy WGS84 [m]

export interface Origin { lat: number; lon: number }

/** WGS84 -> lokalne metry (x = Wschód, y = Północ). */
export function toENU(o: Origin, lat: number, lon: number): { x: number; y: number } {
  const latRad = (o.lat * Math.PI) / 180;
  const dLat = ((lat - o.lat) * Math.PI) / 180;
  const dLon = ((lon - o.lon) * Math.PI) / 180;
  return { x: dLon * R * Math.cos(latRad), y: dLat * R };
}

/** Lokalne metry -> WGS84. */
export function toWGS(o: Origin, x: number, y: number): { lat: number; lon: number } {
  const latRad = (o.lat * Math.PI) / 180;
  return {
    lat: o.lat + ((y / R) * 180) / Math.PI,
    lon: o.lon + ((x / (R * Math.cos(latRad))) * 180) / Math.PI,
  };
}

export const dist2 = (ax: number, ay: number, bx: number, by: number): number => {
  const dx = ax - bx, dy = ay - by;
  return dx * dx + dy * dy;
};
export const dist = (ax: number, ay: number, bx: number, by: number): number =>
  Math.sqrt(dist2(ax, ay, bx, by));

/** Ciśnienie [hPa] -> wysokość względna [m] (formuła barometryczna, dla małych różnic). */
export function baroAltitude(p: number, p0: number): number {
  return 44330 * (1 - Math.pow(p / p0, 1 / 5.255));
}
