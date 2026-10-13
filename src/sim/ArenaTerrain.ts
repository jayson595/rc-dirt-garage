// Grindstone Bowl: an indoor-style dirt stadium for the monster truck. Jumps are laid out along x so the
// stands (at +z) see them side-on. Dirt shapes (ramps, mound, kicker, walls) form the ground; junk cars
// and buses are stamped on top for the physics and can be crushed (their footprint re-bakes lower).
import * as THREE from 'three';
import { CRAWLER_SPEC, TruckSpec } from './CrawlerSim';

export const ARENA_NAME = 'Grindstone Bowl';
export const FAIR_NAME = 'Hayfield County Fair';
export type ArenaLayout = 'bowl' | 'fair';
export const arenaName = (l: ArenaLayout) => l === 'fair' ? FAIR_NAME : ARENA_NAME;

/** How far the centre of mass sits below the model's frame origin (m). */
export const MONSTER_CG_DROP = 0.045;

/** Cragweld Mudhammer: a 1/10 solid-axle monster truck (tube chassis, 4-link, long coil-overs). */
export const MONSTER_SPEC: TruckSpec = {
  ...CRAWLER_SPEC,
  name: 'Cragweld Mudhammer',
  mass: 3.6,
  wheelbase: 0.35,
  track: 0.33,
  wheelR: 0.082,
  restLen: 0.1,
  travel: 0.07,
  k: 290,
  c: 30,
  maxFwd: 10.5,
  maxRev: 4,
  driveGain: 30,
  lateralGain: 55,
  mu: 0.82,
  maxSteer: 0.52,
  servoRate: 4.5,
  // Centre of mass sits low (heavy axles, wheels and battery tray): mounts are MONSTER_CG_DROP above the
  // model's original frame, and every hull point moves up by the same amount relative to the CG.
  mountY: 0.03 + MONSTER_CG_DROP,
  inertia: [0.085, 0.19, 0.115],
  hull: ([[0, -0.03, 0], [0.12, -0.025, 0], [-0.12, -0.025, 0], [0.28, 0.01, 0], [-0.27, 0.01, 0],
    [0.12, 0.09, 0.15], [0.12, 0.09, -0.15], [-0.12, 0.09, 0.15], [-0.12, 0.09, -0.15],
    [0.0, 0.24, 0.1], [0.0, 0.24, -0.1], [-0.09, 0.24, 0.1], [-0.09, 0.24, -0.1], [0.2, 0.14, 0.13], [0.2, 0.14, -0.13]] as [number, number, number][])
    .map(([x, y, z]) => [x, y + MONSTER_CG_DROP, z] as [number, number, number]),
  coast: true,
  maxForce: 13.5,
  airPitch: 0.03,
  steerTaper: 0.5,
  contactK: 8000,
  contactC: 40,
  bumpK: 14000,
  torqueReact: 0,
  hullK: 9000,
  hullC: 70,
  contactMax: 45,
  treadDriveMax: 1e9,
  treadLift: 0,         // monster: keep the tuned V23 contact behaviour
  pitchDamp: 0,
  rearSteer: 0.7,
  twist: 0,
  brakeMul: 1.1,
  maxCompRate: 4,
  maxSpin: 14,
  suspMax: 170,
  tyreAngles: [0.75, 1.2, 1.57, -0.75, -1.2],  // no near-patch points: big tyres on ramps would chatter
};

const smooth = (e0: number, e1: number, x: number) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

export interface JunkCar { x: number; z: number; len: number; wid: number; h: number; crushed: boolean; color: number; rot: number }
export interface Bus { x: number; z: number; len: number; wid: number; h: number }
/** A ramp running along +x (or -x when dir = -1): rises over `up`, flat `top`, falls over `down`. */
export interface Ramp { x0: number; z: number; width: number; up: number; top: number; down: number; h: number; dir: 1 | -1; curve: number }

export class ArenaTerrain {
  readonly hx = 17.6; readonly hz = 11.6;   // grid half-extents (floor is ±17 × ±11 inside the walls)
  readonly res = 0.04;
  readonly nx: number; readonly nz: number;
  readonly heights: Float32Array;
  readonly ramps: Ramp[] = [];
  readonly cars: JunkCar[] = [];
  readonly buses: Bus[] = [];
  readonly mound = { x: -2.6, z: -4, r: 1.5, h: 0.32 };
  readonly donut = { x: -2.5, z: 4.2, r: 2.1 };
  /** Race gates in order; lap = pass all, back through gate 0. */
  readonly gates: { x: number; z: number; r: number }[] = [
    { x: -14.6, z: -4, r: 2.2 }, { x: -2.6, z: -4, r: 2.4 }, { x: 12.5, z: -4, r: 2.4 }, { x: 15, z: 0.2, r: 2.6 },
    { x: 7.5, z: 4, r: 2.4 }, { x: -2.5, z: 4.2, r: 2.6 }, { x: -14.8, z: 1.5, r: 2.8 },
  ];
  readonly spawnFree = { x: -14.5, z: 0.5, heading: 0 };
  readonly spawnRace = { x: -16, z: -4, heading: 0 };
  /** The signature jump: take off inside [x0, x1] near z, land past `land` → bonus trick. */
  readonly bigJump = { z: -4, x0: 3, x1: 5.2, land: 7.2, label: 'BUS JUMP', pts: 200 };
  /** Mud pit (fair): ellipse with lower grip; null in the bowl. */
  readonly mud: { x: number; z: number; rx: number; rz: number; depth: number } | null = null;

  constructor(readonly layout: ArenaLayout = 'bowl') {
    if (layout === 'fair') this.layoutFair(); else this.layoutBowl();
    this.nx = Math.round((this.hx * 2) / this.res) + 1;
    this.nz = Math.round((this.hz * 2) / this.res) + 1;
    this.heights = new Float32Array(this.nx * this.nz);
    this.bake(-this.hx, this.hx, -this.hz, this.hz);
  }

  private layoutBowl() {
    // ramp pair A (gap jump), dirt mound, ramp pair B with the bus jump in the gap, a car-crush row with a
    // small kicker, and a steep backflip kicker in the north-west corner
    this.ramps.push({ x0: -13.6, z: -4, width: 2.4, up: 1.8, top: 0.25, down: 0.05, h: 0.42, dir: 1, curve: 1.12 });
    this.ramps.push({ x0: -10.1, z: -4, width: 2.4, up: 0.05, top: 0.3, down: 2.6, h: 0.42, dir: 1, curve: 1 });
    this.ramps.push({ x0: 2.2, z: -4, width: 2.6, up: 2.2, top: 0.3, down: 0.05, h: 0.55, dir: 1, curve: 1.12 });
    this.ramps.push({ x0: 7.9, z: -4, width: 2.6, up: 0.05, top: 0.4, down: 3.0, h: 0.55, dir: 1, curve: 1 });
    this.ramps.push({ x0: 8.6, z: 4, width: 1.8, up: 1.2, top: 0.12, down: 0.05, h: 0.1, dir: -1, curve: 1 });
    this.ramps.push({ x0: 5.65, z: 4, width: 1.8, up: 0.05, top: 0.05, down: 1.0, h: 0.1, dir: -1, curve: 1 });
    this.ramps.push({ x0: -8.4, z: 8, width: 2.0, up: 1.3, top: 0.12, down: 0.05, h: 0.62, dir: -1, curve: 2.0 });
    this.ramps.push({ x0: -11.0, z: 8, width: 2.0, up: 1.6, top: 0.0, down: 0.0, h: 0.62, dir: 1, curve: 1 }); // gentle back side
    for (let i = 0; i < 3; i++) this.buses.push({ x: 4.95 + i * 0.8, z: -4, len: 1.15, wid: 0.27, h: 0.3 });
    const cols = [0x6a7f8c, 0x8a3a2a, 0x3f5a3a, 0xb8a87a, 0x2a3d6a, 0x7a6a5a];
    for (let i = 0; i < 6; i++) this.cars.push({ x: 7.05 - i * 0.215, z: 4 + (i % 2 ? 0.03 : -0.03), len: 0.46, wid: 0.2, h: 0.12, crushed: false, color: cols[i], rot: (i % 2 ? 0.04 : -0.05) });

  }

  /** Hayfield County Fair: an outdoor dirt arena — a step-up, a car-pile double, a mud pit for donuts,
   *  a volcano mound and a corner launch ramp. Same footprint as the bowl. */
  private layoutFair() {
    const self = this as unknown as { mound: ArenaTerrain['mound']; donut: ArenaTerrain['donut']; gates: ArenaTerrain['gates']; spawnFree: ArenaTerrain['spawnFree']; spawnRace: ArenaTerrain['spawnRace']; bigJump: ArenaTerrain['bigJump']; mud: ArenaTerrain['mud'] };
    // step-up on the south straight: kicker onto a high table
    this.ramps.push({ x0: -12.6, z: -4.2, width: 2.6, up: 1.6, top: 0.15, down: 0.05, h: 0.36, dir: 1, curve: 1.15 });
    this.ramps.push({ x0: -9.5, z: -4.2, width: 2.6, up: 0.08, top: 2.6, down: 2.4, h: 0.58, dir: 1, curve: 1 });
    // the car-pile double: take-off, eight junk cars in the gap, landing
    this.ramps.push({ x0: 1.4, z: -4.2, width: 2.6, up: 2.0, top: 0.25, down: 0.05, h: 0.5, dir: 1, curve: 1.12 });
    this.ramps.push({ x0: 6.6, z: -4.2, width: 2.6, up: 0.05, top: 0.35, down: 3.0, h: 0.5, dir: 1, curve: 1 });
    const cols = [0x8a3a2a, 0x2a3d6a, 0xb8a87a, 0x3f5a3a, 0x6a7f8c, 0x7a6a5a, 0xa8642a, 0x4a4a52];
    for (let i = 0; i < 8; i++) this.cars.push({ x: 4.0 + i * 0.32, z: -4.2 + (i % 2 ? 0.04 : -0.04), len: 0.46, wid: 0.2, h: 0.12, crushed: false, color: cols[i], rot: Math.PI / 2 + (i % 2 ? 0.05 : -0.06) });
    // crush row on the north straight (driven over, nose to tail)
    for (let i = 0; i < 5; i++) this.cars.push({ x: 6.6 - i * 0.215, z: 7.4 + (i % 2 ? 0.03 : -0.03), len: 0.46, wid: 0.2, h: 0.12, crushed: false, color: cols[(i + 3) % 8], rot: (i % 2 ? 0.04 : -0.05) });
    this.ramps.push({ x0: 8.2, z: 7.4, width: 1.8, up: 1.2, top: 0.12, down: 0.05, h: 0.1, dir: -1, curve: 1 });
    this.ramps.push({ x0: 5.2, z: 7.4, width: 1.8, up: 0.05, top: 0.05, down: 1.0, h: 0.1, dir: -1, curve: 1 });
    // corner launch ramp (NE) for flips
    this.ramps.push({ x0: -6.0, z: 7.4, width: 2.0, up: 1.4, top: 0.1, down: 0.05, h: 0.66, dir: -1, curve: 2.0 });
    this.ramps.push({ x0: -8.9, z: 7.4, width: 2.0, up: 1.7, top: 0.0, down: 0.0, h: 0.66, dir: 1, curve: 1 });
    self.mound = { x: 11.5, z: 2.0, r: 1.9, h: 0.45 };   // the volcano
    self.mud = { x: -3.5, z: 2.6, rx: 3.2, rz: 1.8, depth: 0.06 };
    self.donut = { x: -3.5, z: 2.6, r: 1.7 };
    self.gates = [
      { x: -14.6, z: -4.2, r: 2.2 }, { x: -6, z: -4.2, r: 2.6 }, { x: 11.8, z: -4.2, r: 2.6 }, { x: 14.5, z: 2, r: 2.6 },
      { x: 7.4, z: 7.4, r: 2.4 }, { x: -3.5, z: 2.6, r: 2.8 }, { x: -14.8, z: 1.5, r: 2.8 },
    ];
    self.spawnFree = { x: -14.5, z: 0.8, heading: 0 };
    self.spawnRace = { x: -16, z: -4.2, heading: 0 };
    self.bigJump = { z: -4.2, x0: 2.2, x1: 4.2, land: 6.5, label: 'CAR-PILE DOUBLE', pts: 220 };
  }

  /** Surface grip (the fair's mud pit is slick). */
  gripAt(x: number, z: number) {
    const m = this.mud; if (!m) return 1;
    const q = Math.hypot((x - m.x) / m.rx, (z - m.z) / m.rz);
    return q < 1 ? 0.55 + 0.45 * smooth(0.75, 1, q) : 1;
  }

  /** Dirt surface: floor, ramps, mound, perimeter wall banks (no cars or buses). */
  groundAt(x: number, z: number) {
    let h = 0.006 * Math.sin(x * 2.3 + Math.sin(z * 1.7)) * Math.cos(z * 2.9);
    if (this.mud) { const m = this.mud, q = Math.hypot((x - m.x) / m.rx, (z - m.z) / m.rz); if (q < 1.15) h -= m.depth * (1 - smooth(0.7, 1.15, q)) + 0.008 * Math.sin(x * 9) * Math.cos(z * 7) * (q < 1 ? 1 : 0); }
    for (const r of this.ramps) h = Math.max(h, rampHeight(r, x, z));
    const m = this.mound, d = Math.hypot((x - m.x) / 1.3, z - m.z);
    if (d < m.r) h = Math.max(h, m.h * 0.5 * (1 + Math.cos((d / m.r) * Math.PI)));
    // perimeter: a low, rounded dirt berm in front of the boards (scrubs speed, doesn't launch you)
    const ex = Math.abs(x) - 16.2, ez = Math.abs(z) - 10.2;
    const e = Math.max(ex, ez);
    if (e > 0) h = Math.max(h, 0.1 * smooth(0, 0.6, e));
    return h;
  }

  /** Junk cars and buses on top of the dirt. */
  objectsAt(x: number, z: number) {
    let top = 0;
    for (const b of this.buses) {
      const u = Math.abs(x - b.x) / (b.wid / 2), v = Math.abs(z - b.z) / (b.len / 2);
      if (u >= 1 || v >= 1) continue;
      top = Math.max(top, b.h * (1 - Math.pow(u, 8)) * (1 - Math.pow(v, 12)));
    }
    for (const c of this.cars) top = Math.max(top, carHeight(c, x, z));
    return top;
  }

  private bake(x0: number, x1: number, z0: number, z1: number) {
    const i0 = Math.max(0, Math.floor((x0 + this.hx) / this.res)), i1 = Math.min(this.nx - 1, Math.ceil((x1 + this.hx) / this.res));
    const j0 = Math.max(0, Math.floor((z0 + this.hz) / this.res)), j1 = Math.min(this.nz - 1, Math.ceil((z1 + this.hz) / this.res));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = i * this.res - this.hx, z = j * this.res - this.hz;
      this.heights[j * this.nx + i] = this.groundAt(x, z) + this.objectsAt(x, z);
    }
  }

  /** Flatten a junk car (first crush): lower its roof and re-bake its footprint. */
  crush(i: number) {
    const c = this.cars[i];
    if (!c || c.crushed) return false;
    c.crushed = true;
    this.bake(c.x - c.wid, c.x + c.wid, c.z - c.len, c.z + c.len);
    return true;
  }

  /** Restore every car (new run). */
  resetCars() {
    let any = false;
    for (const c of this.cars) if (c.crushed) { c.crushed = false; any = true; }
    if (any) for (const c of this.cars) this.bake(c.x - c.wid, c.x + c.wid, c.z - c.len, c.z + c.len);
  }

  heightAt(x: number, z: number) {
    const fx = THREE.MathUtils.clamp((x + this.hx) / this.res, 0, this.nx - 1.001);
    const fz = THREE.MathUtils.clamp((z + this.hz) / this.res, 0, this.nz - 1.001);
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    const H = this.heights, n = this.nx, k = j * n + i;
    return (H[k] * (1 - u) + H[k + 1] * u) * (1 - v) + (H[k + n] * (1 - u) + H[k + n + 1] * u) * v;
  }

  normalAt(x: number, z: number, out = new THREE.Vector3()) {
    const e = this.res;
    const hx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const hz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    return out.set(-hx, 2 * e, -hz).normalize();
  }
}

/** Ramp height at a point: concave climb (curve > 1 kicks up at the lip), flat top, convex run-out. */
export function rampHeight(r: Ramp, x: number, z: number) {
  const across = Math.abs(z - r.z) - r.width / 2;
  if (across > 0.35) return 0;
  const u = (x - r.x0) * r.dir, L = r.up + r.top + r.down;
  if (u < 0 || u > L) return 0;
  let h: number;
  if (u < r.up) h = r.h * Math.pow(u / r.up, r.curve);
  else if (u < r.up + r.top) h = r.h;
  else h = r.h * (1 - Math.pow((u - r.up - r.top) / r.down, 1 / Math.max(1, r.curve * 0.8)) );
  // sloped dirt sides
  if (across > 0) h *= 1 - smooth(0, 0.35, across);
  return Math.max(0, h);
}

/** Junk sedan footprint height: low hood and boot, roof in the middle; crushed cars are half height. */
export function carHeight(c: JunkCar, x: number, z: number) {
  const cr = Math.cos(c.rot), sr = Math.sin(c.rot);
  const dx = x - c.x, dz = z - c.z;
  const a = (dx * cr + dz * sr) / (c.wid / 2), l = (-dx * sr + dz * cr) / (c.len / 2);
  if (Math.abs(a) >= 1 || Math.abs(l) >= 1) return 0;
  const side = 1 - Math.pow(Math.abs(a), 10);
  const ends = 1 - Math.pow(Math.abs(l), 10);
  const cabin = Math.abs(l) < 0.42 ? 1 : Math.abs(l) < 0.6 ? 1 - (Math.abs(l) - 0.42) / 0.18 * 0.25 : 0.75;
  return c.h * side * ends * cabin * (c.crushed ? 0.45 : 1);
}
