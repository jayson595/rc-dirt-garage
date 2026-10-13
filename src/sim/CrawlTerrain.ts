// Mossknuckle Ridge: a woodland rock trail for the crawler. One height function (gentle hills + trail
// profile + rocks, ledges and logs) is baked into a fine grid that both the physics and the visuals use.
import * as THREE from 'three';

export interface Rock { x: number; z: number; rx: number; rz: number; h: number; rot: number; p: number; seed: number; slab: boolean; block?: boolean }
export interface Log { x: number; z: number; len: number; r: number; rot: number }

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const smooth = (e0: number, e1: number, x: number) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

export const TRAIL_NAME = 'Mossknuckle Ridge';
export const YARD_NAME = 'Crawler test yard';
export const PILE_NAME = 'The Rock Pile';
export const COMP_NAME = 'Granite Gulch comp course';
export type CrawlLayout = 'trail' | 'yard' | 'pile' | 'comp';
/** Competition gate: trail distance, gate number, marker half-spacing. */
export interface CompGate { s: number; n: number; half: number; label: string }
const D2R = Math.PI / 180;

export class CrawlTerrain {
  readonly half = 14;            // the course spans -14..14 m in x and z
  readonly res = 0.04;           // physics grid spacing (m)
  readonly n: number;
  readonly heights: Float32Array;
  readonly rocks: Rock[] = [];
  readonly logs: Log[] = [];
  /** Trail centreline, evenly spaced every 0.1 m. */
  readonly trail: THREE.Vector3[] = [];
  readonly trailLength: number;
  readonly checkpoints: number[] = [];
  readonly trailHalfWidth = 0.7;
  /** Side of the trail the operator walks on (+1 = right of travel). */
  readonly walkSide = 1;
  private nearS: Float32Array;   // coarse 0.1 m grid: trail distance along + signed offset
  private nearD: Float32Array;
  private readonly cn: number;
  private readonly cres = 0.1;

  /** Labelled test stations (yard layout): trail distance + sign text. */
  readonly stations: { s: number; label: string }[] = [];
  /** Optional big-log challenge beside the lane (yard). */
  bigLog: { s: number; d: number; r: number } | null = null;
  /** Ramps in the yard: trail distance where the climb starts, height, face angle (deg), top length. */
  readonly ramps: { s: number; h: number; deg: number; top: number }[] = [];
  /** Axle-twister humps (yard): centre, height, spread. */
  readonly humps: { x: number; z: number; h: number; s: number; d: number }[] = [];
  /** Side-slope deck extent along the trail (yard). */
  readonly slope = { s0: 27.5, s1: 34.5, deg: 20 };
  /** Rock pile: summit point (finish anywhere you get there from). */
  summit: { x: number; z: number; r: number } | null = null;
  /** Competition course gates in order (the last one is the finish gate). */
  readonly gates: CompGate[] = [];
  /** Comp course boundary: half-width of the taped lane around the course line. */
  readonly compBound = 1.25;
  /** Surface grip multiplier on a 0.1 m grid (rock grips best, bark and gravel least). */
  private grip: Float32Array;

  constructor(readonly layout: CrawlLayout = 'trail') {
    const spiral = () => {
      const pts: [number, number][] = [];
      const turns = 1.7, N = 26;
      for (let i = 0; i <= N; i++) { const t = i / N, a = -Math.PI * 0.75 + t * turns * Math.PI * 2, r = 7.2 - t * 6.5; pts.push([Math.cos(a) * r, Math.sin(a) * r]); }
      return pts;
    };
    const ctrl: [number, number][] = layout === 'pile' ? spiral()
      : layout === 'comp' ? ([[-9.5, -9], [-5, -9.6], [-0.5, -8.2], [1, -4.5], [-2.5, -3], [-6.2, -2], [-8.2, 1.5], [-6.2, 4.6], [-2.2, 4], [1, 1], [4.5, -1], [8, -3.6], [9.6, 0], [8.2, 3.6], [5, 6.2], [1.8, 8.6], [-2.5, 9.6]] as [number, number][]).map(([x, z]) => [x * 0.64, z * 0.64] as [number, number])
      : layout === 'yard'
      ? [[-10, 10], [-3, 10.2], [4, 10], [10, 9.5], [11, 4], [10.5, -3], [10, -9.5], [3, -10], [-4, -10.2], [-10, -9.5], [-11, -3], [-10.5, 3], [-8.5, 7]]
      : [[-11.5, 10.5], [-9, 7.5], [-9.5, 3.5], [-7, 0], [-3.5, -2], [-1, -6], [3, -9], [7.5, -8], [9.5, -4.5], [7, -0.5], [4, 2.5], [5.5, 6.5], [9.5, 9.5], [11.5, 11]];
    const curve = new THREE.CatmullRomCurve3(ctrl.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal');
    const L = curve.getLength();
    const count = Math.round(L / 0.1);
    for (const p of curve.getSpacedPoints(count)) this.trail.push(p);
    this.trailLength = (this.trail.length - 1) * 0.1;
    if (layout === 'yard') {
      this.ramps = [{ s: 9, h: 0.25, deg: 20, top: 1.2 }, { s: 13.5, h: 0.25, deg: 30, top: 1.0 }, { s: 24.5, h: 0.2, deg: 40, top: 0.8 }];
      // straights: s 0-18, 23-37, 43-57, 63-71 (stations sit on the straights)
      const st: [number, string][] = [[2.5, 'STEP 5 cm'], [4.5, 'STEP 10 cm'], [6.5, 'STEP 15 cm'], [9.6, 'RAMP 20°'], [13.9, 'RAMP 30°'], [24.7, 'RAMP 40°'],
        [30.5, 'SIDE SLOPE 20°'], [46, 'AXLE TWISTER'], [51, 'LOG 10 cm'], [54.5, 'ROCK GARDEN'], [63.6, 'BIG LOG 20 cm'], [66, 'LEDGE 22 cm']];
      for (const [sv, label] of st) { this.stations.push({ s: sv, label }); this.checkpoints.push(sv + 0.6); }
    } else if (layout === 'comp') {
      // gates on the course features (the last is the finish gate)
      const L = this.trailLength;
      const g: [number, string, number][] = [[2.6, 'Warm-up rocks', 0.36], [6.2, 'Step up', 0.36], [9.6, 'Rock garden', 0.34], [13.4, 'Staircase', 0.36], [17.2, 'Off-camber', 0.36],
        [21, 'The squeeze', 0.3], [24.8, 'Crack', 0.36], [28.6, 'Ledge drop', 0.38], [32.6, 'Log', 0.36], [36.6, 'Hairpin', 0.34], [L - 1.2, 'Finish', 0.42]];
      g.forEach(([sv, label, hf], i) => { if (sv < L - 0.8) this.gates.push({ s: sv, n: i + 1, half: hf, label }); });
      for (const gt of this.gates) this.checkpoints.push(gt.s);
    } else if (layout === 'pile') {
      for (let s = 4; s < this.trailLength - 2; s += 4) this.checkpoints.push(s);
      this.checkpoints.push(this.trailLength - 0.6);
    } else for (let s = 5; s < this.trailLength - 2; s += 5) this.checkpoints.push(s);
    if (layout !== 'comp' && layout !== 'pile') this.checkpoints.push(this.trailLength - 1.2); // finish gate

    // nearest-trail field (stamped, not brute force)
    this.cn = Math.round((this.half * 2) / this.cres) + 1;
    this.nearS = new Float32Array(this.cn * this.cn).fill(-1);
    this.nearD = new Float32Array(this.cn * this.cn).fill(99);
    const rad = 4.0;
    for (let i = 0; i < this.trail.length; i++) {
      const p = this.trail[i];
      const t = this.tangentIdx(i);
      const i0 = Math.max(0, Math.floor((p.x - rad + this.half) / this.cres)), i1 = Math.min(this.cn - 1, Math.ceil((p.x + rad + this.half) / this.cres));
      const j0 = Math.max(0, Math.floor((p.z - rad + this.half) / this.cres)), j1 = Math.min(this.cn - 1, Math.ceil((p.z + rad + this.half) / this.cres));
      for (let j = j0; j <= j1; j++) for (let ii = i0; ii <= i1; ii++) {
        const x = ii * this.cres - this.half, z = j * this.cres - this.half;
        const dx = x - p.x, dz = z - p.z;
        const dist = Math.hypot(dx, dz);
        const k = j * this.cn + ii;
        if (dist < Math.abs(this.nearD[k])) {
          // signed: + on the right of travel (right = (-tz, tx))
          const side = -t.z * dx + t.x * dz >= 0 ? 1 : -1;
          this.nearD[k] = dist * side; this.nearS[k] = i * 0.1;
        }
      }
    }

    this.layoutObstacles();

    // bake the full height field
    this.n = Math.round((this.half * 2) / this.res) + 1;
    this.heights = new Float32Array(this.n * this.n);
    const feat = new Float32Array(this.n * this.n);
    const stamp = (cx: number, cz: number, R: number, f: (x: number, z: number) => number) => {
      const i0 = Math.max(0, Math.floor((cx - R + this.half) / this.res)), i1 = Math.min(this.n - 1, Math.ceil((cx + R + this.half) / this.res));
      const j0 = Math.max(0, Math.floor((cz - R + this.half) / this.res)), j1 = Math.min(this.n - 1, Math.ceil((cz + R + this.half) / this.res));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const v = f(i * this.res - this.half, j * this.res - this.half);
        const k = j * this.n + i;
        if (v > feat[k]) feat[k] = v;
      }
    };
    for (const r of this.rocks) stamp(r.x, r.z, Math.max(r.rx, r.rz), (x, z) => rockHeight(r, x - r.x, z - r.z));
    for (const l of this.logs) {
      const c = Math.cos(l.rot), sn = Math.sin(l.rot);
      stamp(l.x, l.z, l.len / 2 + l.r, (x, z) => {
        const u = dx(l, x, z, c, sn), v = dzz(l, x, z, c, sn);
        if (Math.abs(u) > l.len / 2 || Math.abs(v) >= l.r) return 0;
        const end = 1 - smooth(l.len / 2 - 0.05, l.len / 2, Math.abs(u));
        return (l.r + Math.sqrt(l.r * l.r - v * v)) * end;
      });
    }
    for (let j = 0; j < this.n; j++) for (let i = 0; i < this.n; i++) {
      const k = j * this.n + i;
      this.heights[k] = this.groundAt(i * this.res - this.half, j * this.res - this.half) + feat[k];
    }
    // surface grip map
    this.grip = new Float32Array(this.cn * this.cn);
    const yard = layout === 'yard';
    for (let j = 0; j < this.cn; j++) for (let i = 0; i < this.cn; i++) {
      const x = i * this.cres - this.half, z = j * this.cres - this.half;
      const k = j * this.cn + i, sd = { s: this.nearS[k], d: this.nearD[k] };
      let g = yard ? 0.82 : layout === 'pile' ? 0.9 : layout === 'comp' ? 0.88 : 0.95;  // loose gravel / dirt / granite grit / sand
      if (yard && sd.s >= 0 && Math.abs(sd.d) < 1.05) {
        g = 0.88;                                                   // compacted test lane
        if (this.ramps.some((r) => sd.s > r.s && sd.s < r.s + 2 * r.h / Math.tan(r.deg * Math.PI / 180) + r.top)) g = 0.98; // grippy plywood
        if (sd.s > this.slope.s0 && sd.s < this.slope.s1) g = 0.98;
        if (this.humps.some((hp) => Math.hypot(x - hp.x, z - hp.z) < 0.35)) g = 0.9;  // painted humps
      }
      for (const r of this.rocks) {
        if (Math.abs(x - r.x) > r.rx + r.rz || Math.abs(z - r.z) > r.rx + r.rz) continue;
        if (rockHeight(r, x - r.x, z - r.z) > 0.004) g = r.block ? 0.95 : 1.2;   // timber/concrete blocks vs grippy rock
      }
      for (const l of this.logs) {
        const c = Math.cos(l.rot), sn = Math.sin(l.rot);
        if (Math.abs(dx(l, x, z, c, sn)) < l.len / 2 && Math.abs(dzz(l, x, z, c, sn)) < l.r) g = 0.92;  // bark
      }
      this.grip[k] = g;
    }
  }

  /** Human-readable surface under (x, z), for telemetry. */
  surfaceAt(x: number, z: number) {
    const g = this.gripAt(x, z);
    return g >= 1.1 ? 'rock' : g >= 0.97 ? 'plywood' : g >= 0.94 ? (this.layout === 'yard' ? 'timber' : 'dirt') : g >= 0.91 ? 'bark' : g >= 0.89 ? 'rubber hump' : g >= 0.86 ? 'packed lane' : 'gravel';
  }

  /** Grip multiplier for the surface at (x, z). */
  gripAt(x: number, z: number) {
    const i = Math.round((x + this.half) / this.cres), j = Math.round((z + this.half) / this.cres);
    if (i < 0 || j < 0 || i >= this.cn || j >= this.cn) return 0.9;
    return this.grip[j * this.cn + i];
  }

  private tangentIdx(i: number) {
    const a = this.trail[Math.max(0, i - 1)], b = this.trail[Math.min(this.trail.length - 1, i + 1)];
    return new THREE.Vector3(b.x - a.x, 0, b.z - a.z).normalize();
  }

  /** Trail coordinates (distance along, signed offset; + = right of travel) for a point. */
  nearest(x: number, z: number) {
    const i = Math.round((x + this.half) / this.cres), j = Math.round((z + this.half) / this.cres);
    if (i < 0 || j < 0 || i >= this.cn || j >= this.cn) return { s: -1, d: 99 };
    const k = j * this.cn + i;
    return { s: this.nearS[k], d: this.nearD[k] };
  }

  pointAt(s: number) {
    const f = THREE.MathUtils.clamp(s / 0.1, 0, this.trail.length - 1);
    const i = Math.floor(f), u = f - i;
    const a = this.trail[i], b = this.trail[Math.min(this.trail.length - 1, i + 1)];
    return new THREE.Vector3(a.x + (b.x - a.x) * u, 0, a.z + (b.z - a.z) * u);
  }
  tangentAt(s: number) { return this.tangentIdx(Math.round(THREE.MathUtils.clamp(s / 0.1, 0, this.trail.length - 1))); }
  /** Right-of-travel unit vector. */
  rightAt(s: number) { const t = this.tangentAt(s); return new THREE.Vector3(-t.z, 0, t.x); }

  /** Rolling woodland ground plus the trail's own profile (climbs, descents, off-camber), without rocks. */
  groundAt(x: number, z: number) {
    if (this.layout === 'yard') return this.yardGround(x, z);
    if (this.layout === 'pile') return this.pileGround(x, z);
    if (this.layout === 'comp') return this.compGround(x, z);
    let h = 0.32 * Math.sin(0.21 * x + 0.5) * Math.cos(0.17 * z) + 0.22 * Math.sin(0.11 * x - 0.13 * z + 1.2) + 0.08 * Math.sin(0.55 * x + 0.9 * Math.sin(0.4 * z));
    const { s, d } = this.nearest(x, z);
    if (s >= 0) {
      const band = 1 - smooth(1.2, 3.2, Math.abs(d));
      // trail profile along its length: a hill climb, a summit, off-camber traverse, a final climb
      const prof = 0.6 * smooth(16, 23, s) - 0.45 * smooth(36, 41, s) + 0.4 * smooth(47, 52, s);
      const camber = (s > 28 && s < 34 ? Math.sin(((s - 28) / 6) * Math.PI) : 0) * 0.22 * THREE.MathUtils.clamp(d, -1.5, 1.5);
      h += band * (prof + camber);
      // a shallow worn groove on the trail itself
      h -= 0.025 * Math.exp(-Math.pow(d / 0.55, 2));
    }
    return h;
  }

  /** Rock pile: a big granite mound in a crawler park (the boulders sit on top of it). */
  private pileGround(x: number, z: number) {
    const r = Math.hypot(x, z);
    const mound = r < 6.4 ? 1.05 * 0.5 * (1 + Math.cos(Math.PI * r / 6.4)) : 0;
    return mound + 0.03 * Math.sin(0.7 * x + 1) * Math.cos(0.6 * z) + 0.012 * Math.sin(2.3 * x - 1.7 * z);
  }

  /** Comp course: a dry granite gulch, gently rolling, with a climb and an off-camber built in. */
  private compGround(x: number, z: number) {
    let h = 0.12 * Math.sin(0.25 * x + 0.4) * Math.cos(0.21 * z) + 0.05 * Math.sin(0.6 * x - 0.5 * z);
    const { s, d } = this.nearest(x, z);
    if (s >= 0) {
      const band = 1 - smooth(1.4, 3.0, Math.abs(d));
      const prof = 0.28 * smooth(11.5, 14.5, s) - 0.28 * smooth(27.5, 30, s);   // climb to a bench, then back down
      const camber = (s > 15.5 && s < 19.5 ? Math.sin(((s - 15.5) / 4) * Math.PI) : 0) * 0.26 * THREE.MathUtils.clamp(d, -1.3, 1.3);
      h += band * (prof + camber);
    }
    return h;
  }

  /** Test yard: level gravel with the measured stations built into the trail. */
  private yardGround(x: number, z: number) {
    let h = 0.004 * Math.sin(x * 3.1) * Math.cos(z * 2.7);
    const { s, d } = this.nearest(x, z);
    if (s < 0) return h;
    const ad = Math.abs(d), band = 1 - smooth(0.95, 1.05, ad);
    // ramps: exact face angle up, flat top, same angle down; vertical sides
    for (const r of this.ramps) {
      const run = r.h / Math.tan(r.deg * D2R), u = s - r.s;
      let rh = 0;
      if (u > 0 && u < run) rh = u * Math.tan(r.deg * D2R);
      else if (u >= run && u <= run + r.top) rh = r.h;
      else if (u > run + r.top && u < run * 2 + r.top) rh = r.h - (u - run - r.top) * Math.tan(r.deg * D2R);
      h += rh * band;
    }
    // side slope: 20 degrees across the trail, eased in and out along its length
    const ss = smooth(this.slope.s0, this.slope.s0 + 1, s) * (1 - smooth(this.slope.s1 - 1, this.slope.s1, s));
    h += ss * Math.tan(20 * D2R) * (THREE.MathUtils.clamp(d, -1.0, 1.0) + 1) * (1 - smooth(1.2, 1.6, ad));
    // axle twister: alternating mounds left and right
    for (let k = 0; k < 7; k++) { const sk = 44 + k * 0.75, side = k % 2 ? 0.3 : -0.3; h += 0.09 * Math.exp(-(Math.pow(s - sk, 2) + Math.pow(d - side, 2)) / 0.035); }
    return h;
  }

  /** Rocks, ledges and logs on top of the ground. */
  featureAt(x: number, z: number) {
    let top = 0;
    for (const r of this.rocks) {
      const dx = x - r.x, dz = z - r.z;
      if (Math.abs(dx) > r.rx + r.rz || Math.abs(dz) > r.rx + r.rz) continue;
      top = Math.max(top, rockHeight(r, dx, dz));
    }
    for (const l of this.logs) {
      const c = Math.cos(l.rot), s = Math.sin(l.rot);
      const u = dx(l, x, z, c, s), v = dzz(l, x, z, c, s);
      if (Math.abs(u) > l.len / 2 || Math.abs(v) >= l.r) continue;
      const end = 1 - smooth(l.len / 2 - 0.05, l.len / 2, Math.abs(u));
      top = Math.max(top, (l.r + Math.sqrt(l.r * l.r - v * v)) * end);
    }
    return top;
  }

  private layoutObstacles() {
    if (this.layout === 'yard') return this.layoutYard();
    if (this.layout === 'pile') return this.layoutPile();
    if (this.layout === 'comp') return this.layoutComp();
    const rnd = mulberry(1337);
    const at = (s: number, d: number) => { const p = this.pointAt(s), r = this.rightAt(s); return { x: p.x + r.x * d, z: p.z + r.z * d, rot: Math.atan2(this.tangentAt(s).z, this.tangentAt(s).x) }; };
    const rock = (s: number, d: number, rx: number, rz: number, h: number, p = 2.6, slab = false, rotOff = 0) => {
      const q = at(s, d);
      this.rocks.push({ x: q.x, z: q.z, rx, rz, h, rot: q.rot + rotOff, p, seed: Math.floor(rnd() * 1e6), slab });
    };
    const garden = (s0: number, s1: number, n: number, hmin: number, hmax: number) => {
      for (let i = 0; i < n; i++) {
        const s = s0 + rnd() * (s1 - s0), d = (rnd() - 0.5) * 1.6;
        const sz = 0.12 + rnd() * 0.2;
        rock(s, d, sz * (1 + rnd() * 0.6), sz, hmin + rnd() * (hmax - hmin), 2.2 + rnd(), false, rnd() * 3);
      }
    };
    garden(3, 6, 8, 0.05, 0.1);                         // warm-up rock garden
    const log = (s: number, len: number, r: number) => { const q = at(s, 0); this.logs.push({ x: q.x, z: q.z, len, r, rot: q.rot + Math.PI / 2 + (rnd() - 0.5) * 0.3 }); };
    log(8.5, 2.0, 0.065);                                 // log crossing
    rock(12.5, 0, 0.9, 0.85, 0.13, 7, true);              // ledge step up onto a slab
    garden(17, 23, 14, 0.06, 0.16);                       // rocky hill climb
    rock(25.5, -0.2, 0.35, 0.3, 0.2, 2.4);              // big boulders: thread the line between
    rock(26.3, 0.45, 0.3, 0.32, 0.19, 2.4);
    rock(27.2, -0.35, 0.28, 0.25, 0.17, 2.4);
    garden(29, 33, 6, 0.04, 0.07);                        // off-camber traverse
    rock(35.2, 0, 0.6, 0.85, 0.11, 7, true);             // double ledge
    rock(36.4, 0, 0.6, 0.85, 0.22, 7, true);
    log(40.5, 2.2, 0.075);                                // descent + log
    garden(42, 46, 16, 0.07, 0.17);                       // boulder field
    garden(48, 51, 9, 0.06, 0.14);                         // final climb
    rock(this.trailLength - 2.4, 0, 1.0, 0.95, 0.07, 6, true); // the summit slab
    // scatter boulders away from the trail (decor, still solid)
    for (let i = 0; i < 70; i++) {
      const x = (rnd() - 0.5) * 26, z = (rnd() - 0.5) * 26;
      const { d } = this.nearest(x, z);
      if (Math.abs(d) < 2.2) continue;
      const sz = 0.2 + rnd() * 0.6;
      this.rocks.push({ x, z, rx: sz * (1 + rnd() * 0.7), rz: sz, h: sz * (0.4 + rnd() * 0.5), rot: rnd() * 6.28, p: 2.2 + rnd(), seed: Math.floor(rnd() * 1e6), slab: false });
    }
  }

  private layoutYard() {
    const rnd = mulberry(77);
    const at = (s: number, d: number) => { const p = this.pointAt(s), r = this.rightAt(s), t = this.tangentAt(s); return { x: p.x + r.x * d, z: p.z + r.z * d, rot: Math.atan2(t.z, t.x) }; };
    const block = (s: number, len: number, h: number) => { const q = at(s, 0); this.rocks.push({ x: q.x, z: q.z, rx: len / 2, rz: 0.95, h, rot: q.rot, p: 12, seed: 1, slab: true, block: true }); };
    for (let k = 0; k < 7; k++) { const sk = 44 + k * 0.75, side = k % 2 ? 0.3 : -0.3, q2 = at(sk, side); this.humps.push({ x: q2.x, z: q2.z, h: 0.09, s: sk, d: side }); }
    block(2.8, 0.6, 0.05); block(4.8, 0.6, 0.1); block(6.8, 0.6, 0.15);
    const q = at(51.3, 0); this.logs.push({ x: q.x, z: q.z, len: 2.2, r: 0.05, rot: q.rot + Math.PI / 2 });
    for (let i = 0; i < 14; i++) {
      const sv = 53 + rnd() * 3.6, d = (rnd() - 0.5) * 1.5, sz = 0.13 + rnd() * 0.18, g = at(sv, d);
      this.rocks.push({ x: g.x, z: g.z, rx: sz * (1 + rnd() * 0.5), rz: sz, h: 0.06 + rnd() * 0.1, rot: rnd() * 6.28, p: 2.2 + rnd(), seed: Math.floor(rnd() * 1e6), slab: false });
    }
    { const b = at(64.2, -0.55); this.logs.push({ x: b.x, z: b.z, len: 0.8, r: 0.1, rot: b.rot + Math.PI / 2 }); this.bigLog = { s: 64.2, d: -0.55, r: 0.1 }; }  // the big log (left half of the lane): needs upgrades
    block(66.6, 1.4, 0.22);
  }

  private layoutPile() {
    const rnd = mulberry(4242);
    const at = (s: number, d: number) => { const p = this.pointAt(s), r = this.rightAt(s), t = this.tangentAt(s); return { x: p.x + r.x * d, z: p.z + r.z * d, rot: Math.atan2(t.z, t.x) }; };
    const rock = (x: number, z: number, rx: number, rz: number, h: number, rot: number, p = 2.4, slab = false) =>
      this.rocks.push({ x, z, rx, rz, h, rot, p, seed: Math.floor(rnd() * 1e6), slab });
    // the pile itself: big granite boulders heaped on the mound, thinned along the marked (easier) line
    for (let i = 0; i < 260; i++) {
      const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 6.2, x = Math.cos(a) * r, z = Math.sin(a) * r;
      const { d } = this.nearest(x, z);
      const onLine = Math.abs(d) < 0.55;
      const sz = onLine ? 0.14 + rnd() * 0.16 : 0.26 + rnd() * 0.36;
      const h = onLine ? 0.05 + rnd() * 0.08 : 0.1 + rnd() * 0.2 * (1 - r / 9);
      if (onLine && rnd() < 0.55) continue;
      rock(x, z, sz * (1 + rnd() * 0.6), sz, h, rnd() * 6.28, 2.2 + rnd() * 0.8);
    }
    // line features: two ledges and a boulder choke on the marked line
    for (const [sv, h] of [[9, 0.11], [21, 0.15]] as [number, number][]) { const q = at(sv, 0); rock(q.x, q.z, 0.45, 0.75, h, q.rot, 7, true); }
    { const q1 = at(15, -0.42), q2 = at(15.3, 0.42); rock(q1.x, q1.z, 0.32, 0.28, 0.22, rnd() * 3); rock(q2.x, q2.z, 0.3, 0.3, 0.2, rnd() * 3); }
    // summit slab and flag spot
    const e = this.pointAt(this.trailLength);
    rock(e.x, e.z, 0.75, 0.7, 0.09, 0.4, 6, true);
    this.summit = { x: e.x, z: e.z, r: 0.55 };
    // loose scree around the base
    for (let i = 0; i < 70; i++) {
      const a = rnd() * Math.PI * 2, r = 6.5 + rnd() * 5, sz = 0.1 + rnd() * 0.25;
      rock(Math.cos(a) * r, Math.sin(a) * r, sz * 1.3, sz, 0.04 + rnd() * 0.12, rnd() * 6.28);
    }
  }

  private layoutComp() {
    const rnd = mulberry(9001);
    const at = (s: number, d: number) => { const p = this.pointAt(s), r = this.rightAt(s), t = this.tangentAt(s); return { x: p.x + r.x * d, z: p.z + r.z * d, rot: Math.atan2(t.z, t.x) }; };
    const rock = (s: number, d: number, rx: number, rz: number, h: number, rotOff = 0, p = 2.4, slab = false) => {
      const q = at(s, d); this.rocks.push({ x: q.x, z: q.z, rx, rz, h, rot: q.rot + rotOff, p, seed: Math.floor(rnd() * 1e6), slab });
    };
    const garden = (s0: number, s1: number, n: number, hmin: number, hmax: number, spread = 1.4) => {
      for (let i = 0; i < n; i++) { const sz = 0.12 + rnd() * 0.16; rock(s0 + rnd() * (s1 - s0), (rnd() - 0.5) * spread, sz * (1 + rnd() * 0.5), sz, hmin + rnd() * (hmax - hmin), rnd() * 3, 2.2 + rnd()); }
    };
    garden(1.6, 3.2, 7, 0.04, 0.09);                                   // G1 warm-up rocks
    rock(5.7, 0, 0.4, 0.8, 0.12, 0, 7, true);                          // G2 step up onto a slab
    garden(8.4, 10.4, 14, 0.06, 0.15, 1.2);                            // G3 rock garden
    rock(12.6, 0, 0.35, 0.8, 0.13, 0, 7, true); rock(13.3, 0, 0.35, 0.8, 0.24, 0, 7, true); // G4 staircase on the climb
    garden(16, 18.4, 8, 0.05, 0.11, 1.6);                              // G5 off-camber with rocks
    rock(20.9, -0.62, 0.32, 0.3, 0.26, 0, 2.4); rock(21.1, 0.6, 0.3, 0.32, 0.24, 0, 2.4); garden(20.2, 21.6, 4, 0.05, 0.09, 0.5); // G6 squeeze
    rock(24.3, -0.3, 0.55, 0.26, 0.15, 0, 7, true); rock(24.3, 0.3, 0.55, 0.26, 0.15, 0, 7, true); // G7 crack between two slabs
    rock(27.6, 0, 0.55, 0.85, 0.2, 0, 7, true);                        // G8 ledge drop off the bench
    { const q = at(32.3, 0); this.logs.push({ x: q.x, z: q.z, len: 1.8, r: 0.06, rot: q.rot + Math.PI / 2 + 0.15 }); } garden(31.4, 33.4, 6, 0.04, 0.1); // G9 log
    garden(35.4, 37.4, 9, 0.05, 0.12, 1.3);                            // G10 hairpin rocks
    // outside the tape: granite boulders and ridges (decor, still solid)
    for (let i = 0; i < 90; i++) {
      const x = (rnd() - 0.5) * 26, z = (rnd() - 0.5) * 26;
      const { d } = this.nearest(x, z);
      if (Math.abs(d) < this.compBound + 0.6) continue;
      const sz = 0.2 + rnd() * 0.6;
      this.rocks.push({ x, z, rx: sz * (1 + rnd() * 0.7), rz: sz, h: sz * (0.4 + rnd() * 0.6), rot: rnd() * 6.28, p: 2.2 + rnd(), seed: Math.floor(rnd() * 1e6), slab: false });
    }
  }

  /** World position of a comp gate marker (side -1 = left, +1 = right). */
  gateMarker(g: CompGate, side: number) {
    const p = this.pointAt(g.s).addScaledVector(this.rightAt(g.s), side * g.half);
    p.y = this.heightAt(p.x, p.z);
    return p;
  }

  /** Bilinear height from the baked grid. */
  heightAt(x: number, z: number) {
    const fx = THREE.MathUtils.clamp((x + this.half) / this.res, 0, this.n - 1.001);
    const fz = THREE.MathUtils.clamp((z + this.half) / this.res, 0, this.n - 1.001);
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    const H = this.heights, n = this.n, k = j * n + i;
    return (H[k] * (1 - u) + H[k + 1] * u) * (1 - v) + (H[k + n] * (1 - u) + H[k + n + 1] * u) * v;
  }

  normalAt(x: number, z: number, out = new THREE.Vector3()) {
    const e = this.res;
    const hx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const hz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    return out.set(-hx, 2 * e, -hz).normalize();
  }

  /** Where the operator stands for trail distance `s`: on a footpath beside the trail. */
  walkPoint(s: number) {
    const p = this.pointAt(s).addScaledVector(this.rightAt(s), this.walkSide * 1.9);
    p.y = this.groundAt(p.x, p.z);
    return p;
  }
}

function dx(l: Log, x: number, z: number, c: number, s: number) { return (x - l.x) * c + (z - l.z) * s; }
function dzz(l: Log, x: number, z: number, c: number, s: number) { return -(x - l.x) * s + (z - l.z) * c; }

/** Height of a rock above its base at local offset (dx, dz). */
export function rockHeight(r: Rock, dx: number, dz: number) {
  const c = Math.cos(r.rot), s = Math.sin(r.rot);
  const u = (dx * c + dz * s) / r.rx, v = (-dx * s + dz * c) / r.rz;
  const q = Math.pow(Math.pow(Math.abs(u), r.p) + Math.pow(Math.abs(v), r.p), 1 / r.p);
  if (q >= 1) return 0;
  // flat-topped slabs with steep edges, or domed boulders with craggy noise
  const shape = r.slab ? Math.pow(1 - Math.pow(q, 10), 0.25) : Math.pow(1 - Math.pow(q, 2.2), 0.5);
  const n = Math.sin(u * 7.3 + r.seed) * Math.cos(v * 6.1 + r.seed * 0.7) * 0.07 + Math.sin(u * 15 + v * 11 + r.seed) * 0.03;
  return r.h * shape * (1 + (r.slab ? n * 0.3 : n));
}
