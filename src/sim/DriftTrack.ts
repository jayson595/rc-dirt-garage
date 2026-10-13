// Kanjo Hall: an indoor RC drift circuit on polished P-tile. The lane is a closed centreline with a
// (varying) half-width; the outer edge is a wall of board barriers, the inner edge a low kerb onto the
// carpeted infield islands. Clipping points (inner posts) and outer zones (painted boxes on the wall
// side) mark the line judges look for, so practice has something to aim at.
import * as THREE from 'three';

export const DRIFT_TRACK_NAME = 'Kanjo Hall';
export const LOT_NAME = 'Bayside Car Park';
export type DriftLayout = 'hall' | 'lot';
export const driftVenueName = (l: DriftLayout) => l === 'lot' ? LOT_NAME : DRIFT_TRACK_NAME;

export interface DriftSample { x: number; z: number; s: number; tx: number; tz: number; nx: number; nz: number; hw: number; curv: number }
export interface ClipZone { kind: 'inner' | 'outer'; s: number; side: 1 | -1; len: number; label: string }
export interface DriftQuery { idx: number; s: number; d: number; nx: number; nz: number; hw: number }

/** Centreline control points (x, z, half-width). Runs anticlockwise from above past the driver's stand (+z). */
const HALL_CTRL: [number, number, number][] = [
  [-5.2, 4.3, 1.2], [-1.0, 4.45, 1.25], [3.2, 4.3, 1.25], [6.5, 3.5, 1.3], [8.1, 1.2, 1.35], [7.8, -1.9, 1.3],
  [6.0, -4.0, 1.25], [3.2, -4.6, 1.2], [1.7, -4.1, 1.15], [0.5, -2.0, 1.1], [-1.7, -0.9, 1.05], [-3.8, -1.8, 1.15],
  [-4.9, -3.8, 1.2], [-6.7, -4.7, 1.2], [-8.6, -3.7, 1.2], [-9.0, -0.8, 1.25], [-7.6, 2.8, 1.2],
];

/** Bayside Car Park: a night lot laid out with barriers — long fast sweeper, a hairpin and a chicane. */
const LOT_CTRL: [number, number, number][] = [
  [-7, 4.3, 1.3], [-2, 4.5, 1.35], [3, 4.4, 1.35], [7.5, 3.6, 1.4], [9.3, 1, 1.45], [9, -2.5, 1.4], [6.8, -4.8, 1.35], [3.5, -5.2, 1.3],
  [0.2, -4.8, 1.25], [-2.0, -3.2, 1.2], [-1.9, -0.6, 1.2], [-3.8, 1.0, 1.2], [-6.3, 0.1, 1.2], [-6.9, -2.4, 1.25], [-8.1, -4.6, 1.3], [-10.3, -4.9, 1.3], [-11.5, -2.3, 1.3], [-10.6, 1.6, 1.3],
];

export class DriftTrack {
  readonly samples: DriftSample[] = [];
  readonly length: number;
  readonly step = 0.05;
  readonly zones: ClipZone[] = [];
  /** Building interior half-extents (floor) and the driver's stand. */
  readonly hall: { hx: number; hz: number };
  readonly stand = { x: -0.5, z: 6.55, w: 7.4, deck: 1.15 };
  readonly start = { s: 1.0 };

  constructor(readonly layout: DriftLayout = 'hall') {
    const CTRL = layout === 'lot' ? LOT_CTRL : HALL_CTRL;
    this.hall = layout === 'lot' ? { hx: 13.5, hz: 8.2 } : { hx: 11.5, hz: 7.6 };
    const curve = new THREE.CatmullRomCurve3(CTRL.map(([x, z]) => new THREE.Vector3(x, 0, z)), true, 'centripetal', 0.5);
    // sample, then relax (Laplacian smoothing) so the spline's knots don't leave curvature spikes,
    // and re-space evenly by arc length
    let raw = curve.getSpacedPoints(Math.round(curve.getLength() / this.step)).slice(0, -1).map((p) => [p.x, p.z]);
    for (let it = 0; it < 260; it++) {
      const m = raw.length;
      raw = raw.map((p, i) => { const a = raw[(i - 1 + m) % m], b = raw[(i + 1) % m]; return [p[0] * 0.5 + (a[0] + b[0]) * 0.25, p[1] * 0.5 + (a[1] + b[1]) * 0.25]; });
    }
    const relaxed = new THREE.CatmullRomCurve3(raw.map(([x, z]) => new THREE.Vector3(x, 0, z)), true, 'centripetal');
    const L = relaxed.getLength(), n = Math.round(L / this.step);
    this.length = L;
    const pts = relaxed.getSpacedPoints(n);
    // width follows the control points along the curve (by nearest-parameter blend)
    const ctrlS = CTRL.map(([x, z]) => { let best = 0, bd = 1e9; pts.forEach((p, i) => { const d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < bd) { bd = d; best = i; } }); return best; });
    const hwAt = (i: number) => {
      const m = CTRL.length;
      for (let k = 0; k < m; k++) {
        const a = ctrlS[k], b = ctrlS[(k + 1) % m], span = (b - a + n) % n, off = (i - a + n) % n;
        if (off <= span) { const t = span ? off / span : 0, e = t * t * (3 - 2 * t); return CTRL[k][2] * (1 - e) + CTRL[(k + 1) % m][2] * e; }
      }
      return 1.2;
    };
    for (let i = 0; i < n; i++) {
      const p = pts[i], a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
      let tx = b.x - a.x, tz = b.z - a.z; const tl = Math.hypot(tx, tz); tx /= tl; tz /= tl;
      this.samples.push({ x: p.x, z: p.z, s: i * (L / n), tx, tz, nx: -tz, nz: tx, hw: hwAt(i), curv: 0 });
    }
    for (let i = 0; i < n; i++) {
      const a = this.samples[(i - 2 + n) % n], b = this.samples[(i + 2) % n];
      const dth = Math.atan2(a.tx * b.tz - a.tz * b.tx, a.tx * b.tx + a.tz * b.tz);
      this.samples[i].curv = dth / (4 * (L / n));
    }
    // clipping points and zones (s along the lane); side +1 = right of travel (n), −1 = left
    const z = (kind: ClipZone['kind'], s: number, len: number, label: string) => {
      const q = this.sampleAt(s); this.zones.push({ kind, s, len, label, side: (kind === 'inner' ? Math.sign(q.curv) : -Math.sign(q.curv)) as 1 | -1 });
    };
    const sOf = (x: number, zz: number) => this.query(x, zz).s;
    if (layout === 'lot') {
      z('outer', sOf(9.2, 0.8), 2.4, 'OZ 1');
      z('inner', sOf(5.2, -4.4), 0.4, 'CP 1');
      z('inner', sOf(-1.2, -2.2), 0.4, 'CP 2');
      z('outer', sOf(-4.4, 0.7), 1.8, 'OZ 2');
      z('inner', sOf(-9.2, -3.6), 0.4, 'CP 3');
      z('outer', sOf(-10, 0.2), 2.0, 'OZ 3');
      return;
    }
    z('outer', sOf(7.4, 2.4), 2.2, 'OZ 1');
    z('inner', sOf(7.5, -1.2), 0.4, 'CP 1');
    z('outer', sOf(4.5, -4.3), 2.0, 'OZ 2');
    z('inner', sOf(0.2, -2.0), 0.4, 'CP 2');
    z('outer', sOf(-2.7, -1.0), 1.8, 'OZ 3');
    z('inner', sOf(-7.9, -3.6), 0.4, 'CP 3');
    z('outer', sOf(-8.4, 0.6), 2.0, 'OZ 4');
  }

  sampleAt(s: number) {
    const n = this.samples.length, i = Math.round((((s % this.length) + this.length) % this.length) / (this.length / n)) % n;
    return this.samples[i];
  }

  /** Lane position: the local frame at s with lateral offset d (+ = towards n). */
  pointAt(s: number, d = 0) {
    const p = this.sampleAt(s);
    return { x: p.x + p.nx * d, z: p.z + p.nz * d, heading: Math.atan2(p.tz, p.tx) };
  }

  /** Nearest centreline sample; local search from a hint (falls back to a full scan). */
  query(x: number, z: number, hint = -1): DriftQuery {
    const S = this.samples, n = S.length;
    let best = 0, bd = Infinity;
    if (hint >= 0) {
      for (let k = -60; k <= 60; k++) { const i = (hint + k + n) % n, d = (S[i].x - x) ** 2 + (S[i].z - z) ** 2; if (d < bd) { bd = d; best = i; } }
      if (bd > 2.5 * 2.5) hint = -1;
    }
    if (hint < 0) { bd = Infinity; for (let i = 0; i < n; i += 2) { const d = (S[i].x - x) ** 2 + (S[i].z - z) ** 2; if (d < bd) { bd = d; best = i; } } for (let k = -3; k <= 3; k++) { const i = (best + k + n) % n, d = (S[i].x - x) ** 2 + (S[i].z - z) ** 2; if (d < bd) { bd = d; best = i; } } }
    const p = S[best];
    const along = (x - p.x) * p.tx + (z - p.z) * p.tz;
    return { idx: best, s: p.s + along, d: (x - p.x) * p.nx + (z - p.z) * p.nz, nx: p.nx, nz: p.nz, hw: p.hw };
  }

  /** Signed distance travelled from s0 to s1 along the loop (shortest way round). */
  deltaS(s0: number, s1: number) {
    let d = s1 - s0; const L = this.length;
    if (d > L / 2) d -= L; else if (d < -L / 2) d += L;
    return d;
  }
}
