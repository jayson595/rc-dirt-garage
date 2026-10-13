// Dirt course definition: centerline spline, features (jumps, berms, rollers) and fast queries.
// World units are meters. x = right as seen from the driver's stand, z = toward the stand, y = up.
import * as THREE from 'three';

export interface TrackSample {
  x: number; z: number; s: number;
  tx: number; tz: number; // unit tangent
  nx: number; nz: number; // unit normal pointing to the right of travel
  curv: number;           // signed curvature (rad/m), + = turning right
}

export interface TrackQuery {
  idx: number; s: number; d: number;
  tx: number; tz: number; nx: number; nz: number;
}

type Feature =
  | { kind: 'table'; s: number; up: number; top: number; down: number; h: number }
  | { kind: 'kicker'; s: number; up: number; h: number; drop: number }
  | { kind: 'rollers'; s: number; count: number; wave: number; h: number };

/** Control points for the closed loop (meters). Inspired by the board's top-view panel. */
export const COURSE_POINTS: [number, number][] = [
  [-10, 8], [0, 8.6], [10, 8], [15.5, 6], [17, 1], [16.2, -5], [13, -9.6], [8.2, -10],
  [5.2, -6.2], [3, -2.2], [0, -0.6], [-3, -2.2], [-5.2, -6.2], [-8.2, -10], [-13, -9.6],
  [-16.5, -5], [-17, 1], [-15.5, 6],
];

/** Proving loop for the sandbox: a wide oval inside the same venue footprint. */
export const PROVING_POINTS: [number, number][] = [
  [-14, 7.2], [0, 7.6], [14, 7.2], [17.4, 2], [17, -5], [14, -9.4], [0, -9.9], [-14, -9.4], [-17, -5], [-17.4, 2],
];
/** Hilltop Clay: a tight, technical night track on tacky clay. */
export const CLAY_POINTS: [number, number][] = [
  [-14, 8], [0, 8.4], [12, 8], [15.5, 5], [14, 1.5], [9, 1.8], [5.5, 3.6], [2, 3.2], [0.5, 0], [3.5, -3.5], [9, -4], [14.5, -6], [15, -10],
  [9, -10.6], [0, -9.8], [-6, -10.2], [-12, -10], [-16, -7], [-14.5, -3], [-9, -3.2], [-6, -0.5], [-9.5, 2.6], [-15, 3], [-17, 6],
];
/** Dune Run: fast, flowing sand track with a big double and sand whoops. */
export const DUNES_POINTS: [number, number][] = [
  [-15, 7.6], [-3, 8.6], [9, 8.2], [15.8, 5], [16.8, -1], [15, -7], [9, -10.3], [0, -10.5], [-8, -10.3], [-12.5, -9], [-13, -5.5], [-9, -4],
  [-3, -4.5], [3, -3.6], [6.5, -1], [4.5, 2.6], [-1.5, 3.4], [-7, 2], [-11.5, 0.5], [-16, 1.5], [-16.8, 5],
];
export type TrackLayout = 'course' | 'proving' | 'clay' | 'dunes';
/** The race tracks you can pick (the proving loop is sandbox-only). */
export const RACE_TRACKS: { id: Exclude<TrackLayout, 'proving'>; name: string; blurb: string }[] = [
  { id: 'course', name: 'Dirt Classic', blurb: 'Sunny packed dirt: big table, kicker and rollers' },
  { id: 'clay', name: 'Hilltop Clay', blurb: 'Night race under the lights: tight and technical on grippy clay, step-up and a triple' },
  { id: 'dunes', name: 'Dune Run', blurb: 'Fast desert sand: long sweepers, a big double and sand whoops — loose and slidey' },
];
export const trackPoints = (l: TrackLayout) => l === 'proving' ? PROVING_POINTS : l === 'clay' ? CLAY_POINTS : l === 'dunes' ? DUNES_POINTS : COURSE_POINTS;

export class Track {
  readonly halfWidth = 1.75;
  /** Surface grip multiplier (clay bites, sand slides). */
  readonly grip: number;
  readonly samples: TrackSample[] = [];
  readonly length: number;
  readonly features: Feature[] = [];
  /** s of the start/finish line. */
  readonly startS: number;
  /** Ordered checkpoint s-values (excluding the finish line). */
  readonly checkpoints: number[] = [];
  private readonly ds: number;
  private smoothCurv: Float32Array;

  constructor(points = COURSE_POINTS, n = 900, readonly layout: TrackLayout = 'course') {
    const curve = new THREE.CatmullRomCurve3(points.map(([x, z]) => new THREE.Vector3(x, 0, z)), true, 'centripetal');
    const pts = curve.getSpacedPoints(n).slice(0, n);
    let s = 0;
    for (let i = 0; i < n; i++) {
      const p = pts[i];
      if (i > 0) s += Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z);
      this.samples.push({ x: p.x, z: p.z, s, tx: 0, tz: 0, nx: 0, nz: 0, curv: 0 });
    }
    const last = pts[n - 1], first = pts[0];
    this.length = s + Math.hypot(first.x - last.x, first.z - last.z);
    this.ds = this.length / n;

    for (let i = 0; i < n; i++) {
      const a = this.samples[(i - 1 + n) % n], b = this.samples[(i + 1) % n], c = this.samples[i];
      let tx = b.x - a.x, tz = b.z - a.z;
      const l = Math.hypot(tx, tz) || 1;
      tx /= l; tz /= l;
      c.tx = tx; c.tz = tz;
      c.nx = -tz; c.nz = tx;
    }
    const raw = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = this.samples[i], b = this.samples[(i + 1) % n];
      let dh = Math.atan2(b.tz, b.tx) - Math.atan2(a.tz, a.tx);
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      raw[i] = dh / this.ds;
    }
    // Smooth curvature over ~2.5 m so berms blend in and out.
    this.smoothCurv = new Float32Array(n);
    const win = Math.round(1.25 / this.ds);
    for (let i = 0; i < n; i++) {
      let acc = 0;
      for (let k = -win; k <= win; k++) acc += raw[(i + k + n) % n];
      this.smoothCurv[i] = acc / (win * 2 + 1);
      this.samples[i].curv = this.smoothCurv[i];
    }

    this.grip = layout === 'clay' ? 1.08 : layout === 'dunes' ? 0.9 : 1;
    // Start line on the front straight (left of the stand), features placed by world location.
    if (layout === 'clay') {
      this.startS = this.nearestS(-8, 8.2);
      this.features.push({ kind: 'kicker', s: this.nearestS(1.5, 8.4), up: 1.1, h: 0.24, drop: 0.5 });          // step-up: kick…
      this.features.push({ kind: 'table', s: this.nearestS(3.4, 8.4), up: 0.5, top: 2.2, down: 2.4, h: 0.4 });   // …onto the high table
      this.features.push({ kind: 'rollers', s: this.nearestS(13, -10.5), count: 3, wave: 1.7, h: 0.2 }); // the triple (back straight)
      this.features.push({ kind: 'rollers', s: this.nearestS(-3, -10), count: 7, wave: 0.85, h: 0.07 });          // whoops
      this.features.push({ kind: 'kicker', s: this.nearestS(-12.5, -3.2), up: 1.0, h: 0.2, drop: 1.6 });
    } else if (layout === 'dunes') {
      this.startS = this.nearestS(-10, 8.1);
      this.features.push({ kind: 'kicker', s: this.nearestS(9.5, -10.2), up: 1.3, h: 0.3, drop: 0.45 });         // the double: take-off…
      this.features.push({ kind: 'table', s: this.nearestS(5.2, -10.4), up: 0.55, top: 0.6, down: 3.2, h: 0.3 });   // …and the landing
      this.features.push({ kind: 'rollers', s: this.nearestS(16.6, 2.5), count: 5, wave: 2.0, h: 0.1 });         // sand whoops on the sweeper
      this.features.push({ kind: 'table', s: this.nearestS(-2.5, 3.3), up: 1.4, top: 1.8, down: 2.2, h: 0.28 });
      this.features.push({ kind: 'kicker', s: this.nearestS(1, 8.5), up: 1.2, h: 0.24, drop: 2.2 });
    } else if (layout === 'proving') {
      // front straight (nearest the stand): graded kickers small → big; back straight: whoops then a step-up table
      this.startS = this.nearestS(-12.5, 7.3);
      this.features.push({ kind: 'kicker', s: this.nearestS(-8.5, 7.5), up: 0.9, h: 0.12, drop: 1.4 });
      this.features.push({ kind: 'kicker', s: this.nearestS(-3, 7.6), up: 1.1, h: 0.22, drop: 2.0 });
      this.features.push({ kind: 'kicker', s: this.nearestS(3.5, 7.6), up: 1.3, h: 0.34, drop: 2.6 });
      this.features.push({ kind: 'rollers', s: this.nearestS(8, -9.7), count: 8, wave: 1.1, h: 0.08 });
      this.features.push({ kind: 'table', s: this.nearestS(-3, -9.9), up: 1.6, top: 2.6, down: 3.0, h: 0.3 });
      this.features.push({ kind: 'rollers', s: this.nearestS(-17.2, -1.5), count: 3, wave: 1.8, h: 0.12 });
    } else {
      this.startS = this.nearestS(-7, 8.3);
      this.features.push({ kind: 'table', s: this.nearestS(3.2, 8.5), up: 1.8, top: 2.8, down: 3.2, h: 0.36 });
      this.features.push({ kind: 'kicker', s: this.nearestS(-16.9, -2.2), up: 1.3, h: 0.32, drop: 2.4 });
      this.features.push({ kind: 'rollers', s: this.nearestS(16.9, -1.8), count: 3, wave: 1.8, h: 0.07 });
    }

    const cpCount = 6;
    for (let k = 1; k <= cpCount; k++) this.checkpoints.push(this.wrapS(this.startS + (this.length * k) / (cpCount + 1)));
  }

  wrapS(s: number) {
    const L = this.length;
    return ((s % L) + L) % L;
  }

  /** Signed shortest delta from a to b along the loop. */
  deltaS(a: number, b: number) {
    let d = b - a;
    const L = this.length;
    if (d > L / 2) d -= L;
    if (d < -L / 2) d += L;
    return d;
  }

  /** Position relative to the start line, 0..L. */
  lapS(s: number) { return this.wrapS(s - this.startS); }

  nearestS(x: number, z: number) { return this.queryGlobal(x, z).s; }

  sampleAt(s: number): TrackSample {
    const n = this.samples.length;
    const f = this.wrapS(s) / this.ds;
    const i0 = Math.floor(f) % n, i1 = (i0 + 1) % n, t = f - Math.floor(f);
    const a = this.samples[i0], b = this.samples[i1];
    const tx = a.tx + (b.tx - a.tx) * t, tz = a.tz + (b.tz - a.tz) * t;
    const l = Math.hypot(tx, tz) || 1;
    return {
      x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, s: this.wrapS(s),
      tx: tx / l, tz: tz / l, nx: -tz / l, nz: tx / l, curv: a.curv + (b.curv - a.curv) * t,
    };
  }

  pointAt(s: number, d: number) {
    const p = this.sampleAt(s);
    return { x: p.x + p.nx * d, z: p.z + p.nz * d, heading: Math.atan2(p.tz, p.tx) };
  }

  private refine(i: number, x: number, z: number): TrackQuery {
    const n = this.samples.length;
    const a = this.samples[i];
    // project onto the segment towards whichever neighbour is closer along the tangent
    const along = (x - a.x) * a.tx + (z - a.z) * a.tz;
    const s = this.wrapS(a.s + along);
    const p = this.sampleAt(s);
    const d = (x - p.x) * p.nx + (z - p.z) * p.nz;
    return { idx: ((Math.round(s / this.ds) % n) + n) % n, s, d, tx: p.tx, tz: p.tz, nx: p.nx, nz: p.nz };
  }

  queryGlobal(x: number, z: number): TrackQuery {
    let best = 0, bd = Infinity;
    const S = this.samples;
    for (let i = 0; i < S.length; i++) {
      const dx = S[i].x - x, dz = S[i].z - z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bd) { bd = d2; best = i; }
    }
    return this.refine(best, x, z);
  }

  /** Local search around a hint index: keeps the tracker on the right section where the course doubles back. */
  queryLocal(x: number, z: number, hint: number, window = 28): TrackQuery {
    const S = this.samples, n = S.length;
    let best = hint, bd = Infinity;
    for (let k = -window; k <= window; k++) {
      const i = (hint + k + n) % n;
      const dx = S[i].x - x, dz = S[i].z - z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bd) { bd = d2; best = i; }
    }
    if (bd > 36) return this.queryGlobal(x, z);
    return this.refine(best, x, z);
  }

  curvatureAt(s: number) {
    const n = this.samples.length;
    const i = Math.round(this.wrapS(s) / this.ds) % n;
    return this.smoothCurv[i];
  }

  /** Feature height along the route at s (before lateral taper). */
  private featureHeight(s: number) {
    let h = 0;
    for (const f of this.features) {
      const x = this.deltaS(f.s, s);
      if (f.kind === 'table') {
        const total = f.up + f.top + f.down;
        if (x < 0 || x > total) continue;
        if (x < f.up) h = Math.max(h, f.h * smooth(x / f.up));
        else if (x < f.up + f.top) h = Math.max(h, f.h);
        else h = Math.max(h, f.h * (1 - smooth((x - f.up - f.top) / f.down)));
      } else if (f.kind === 'kicker') {
        if (x < 0 || x > f.up + f.drop) continue;
        if (x < f.up) h = Math.max(h, f.h * Math.pow(x / f.up, 1.3));
        else h = Math.max(h, f.h * (1 - smooth((x - f.up) / f.drop)));
      } else {
        const len = f.count * f.wave;
        if (x < 0 || x > len) continue;
        h = Math.max(h, f.h * 0.5 * (1 - Math.cos((x / f.wave) * Math.PI * 2)));
      }
    }
    return h;
  }

  /** Ground height in track coordinates. Used by both physics and the terrain mesh. */
  heightAt(s: number, d: number) {
    const hw = this.halfWidth;
    const ad = Math.abs(d);
    let h = 0;
    const fh = this.featureHeight(s);
    if (fh > 0) h += fh * (1 - smooth((ad - hw) / 0.9));

    const k = this.curvatureAt(s);
    const bermH = Math.min(0.38, Math.abs(k) * 1.15);
    if (bermH > 0.04) {
      const outside = -Math.sign(k) * d; // outside of the turn
      if (outside > 0) {
        if (outside < hw) h += bermH * smooth(outside / hw) * 0.75;
        else h += bermH * (0.75 + 0.45 * Math.max(0, 1 - Math.abs(outside - hw - 0.4) / 1.1));
      }
    }
    // Infield/off-track sits a touch higher so the racing line reads as a groove.
    if (ad > hw + 0.35) h += 0.05 * Math.min(1, (ad - hw - 0.35) / 0.6);
    return h;
  }

  /** Height + gradient (in world x/z) at a tracked position. */
  groundAt(q: TrackQuery) {
    const e = 0.08;
    const h = this.heightAt(q.s, q.d);
    const dhds = (this.heightAt(q.s + e, q.d) - this.heightAt(q.s - e, q.d)) / (2 * e);
    const dhdd = (this.heightAt(q.s, q.d + e) - this.heightAt(q.s, q.d - e)) / (2 * e);
    return { h, gx: dhds * q.tx + dhdd * q.nx, gz: dhds * q.tz + dhdd * q.nz };
  }
}

function smooth(t: number) {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}
