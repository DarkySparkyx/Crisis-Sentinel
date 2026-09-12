import type { Vec3, Quat } from './types.ts';

export const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
export const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
export const norm = (a: Vec3): number => Math.sqrt(dot(a, a));
export const normalize = (a: Vec3): Vec3 => {
  const n = norm(a);
  return n < 1e-12 ? v3(0, 0, 0) : scale(a, 1 / n);
};

export const qIdentity = (): Quat => ({ w: 1, x: 0, y: 0, z: 0 });

export const qMul = (a: Quat, b: Quat): Quat => ({
  w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
  y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
  z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
});

export const qNormalize = (q: Quat): Quat => {
  const n = Math.sqrt(q.w * q.w + q.x * q.x + q.y * q.y + q.z * q.z);
  return n < 1e-12 ? qIdentity() : { w: q.w / n, x: q.x / n, y: q.y / n, z: q.z / n };
};

export const qConj = (q: Quat): Quat => ({ w: q.w, x: -q.x, y: -q.y, z: -q.z });

/** Obrót wektora z ramy urządzenia do ramy nawigacyjnej: v_nav = q * v_dev * q^-1 */
export const qRotate = (q: Quat, v: Vec3): Vec3 => {
  const t = scale(cross(v3(q.x, q.y, q.z), v), 2);
  return add(add(v, scale(t, q.w)), cross(v3(q.x, q.y, q.z), t));
};

/** Kwaternion z małego obrotu (wektor prędkości kątowej * dt). */
export const qFromRotVec = (r: Vec3): Quat => {
  const a = norm(r);
  if (a < 1e-9) return qNormalize({ w: 1, x: r.x / 2, y: r.y / 2, z: r.z / 2 });
  const s = Math.sin(a / 2) / a;
  return { w: Math.cos(a / 2), x: r.x * s, y: r.y * s, z: r.z * s };
};

/** Yaw (obrót wokół osi Z ramy nawigacyjnej) z kwaternionu, w radianach. */
export const qYaw = (q: Quat): number =>
  Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z));

/** Normalizuje kąt do (-pi, pi]. */
export const wrapPi = (a: number): number => {
  let x = a;
  while (x > Math.PI) x -= 2 * Math.PI;
  while (x <= -Math.PI) x += 2 * Math.PI;
  return x;
};

export const deg = (r: number): number => (r * 180) / Math.PI;
export const rad = (d: number): number => (d * Math.PI) / 180;
