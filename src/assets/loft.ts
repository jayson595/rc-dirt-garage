// Lofted tube with a varying (super-)elliptical cross-section along a smooth path.
// Used for organic shapes (fingers, palms, forearms, grips, cables) so they read as one
// continuous surface instead of stacked primitives. Re-posable: call set() again each frame.
import * as THREE from 'three';

export interface LoftOpts {
  /** Rings sampled along the path (excluding caps). */
  samples?: number;
  /** Vertices around each ring. */
  segments?: number;
  /** Rounded end cap at the start / end of the path. */
  capStart?: boolean;
  capEnd?: boolean;
  /** 2 = ellipse; larger = squarer cross-section. */
  squareness?: number;
}

const CAP = 4;

export class Loft {
  geometry = new THREE.BufferGeometry();
  mesh: THREE.Mesh;
  private o: Required<LoftOpts>;
  private pos: Float32Array;
  private col: Float32Array;
  private rings: number;
  /** Optional per-vertex tint (t along the path 0..1, angle around the ring; sin > 0 is the "N" side). */
  shade: ((t: number, angle: number, out: [number, number, number]) => void) | null = null;

  constructor(material: THREE.Material, opts: LoftOpts = {}) {
    this.o = { samples: 12, segments: 14, capStart: false, capEnd: true, squareness: 2, ...opts };
    const { samples, segments, capStart, capEnd } = this.o;
    this.rings = samples + 1 + (capStart ? CAP : 0) + (capEnd ? CAP : 0);
    this.pos = new Float32Array(this.rings * segments * 3);
    this.col = new Float32Array(this.rings * segments * 3).fill(1);
    const uv = new Float32Array(this.rings * segments * 2);
    for (let r = 0; r < this.rings; r++) for (let j = 0; j < segments; j++) {
      uv[(r * segments + j) * 2] = j / segments;
      uv[(r * segments + j) * 2 + 1] = r / (this.rings - 1);
    }
    const idx: number[] = [];
    for (let r = 0; r < this.rings - 1; r++) for (let j = 0; j < segments; j++) {
      const a = r * segments + j, b = r * segments + ((j + 1) % segments);
      const c = a + segments, d = b + segments;
      idx.push(a, c, b, b, c, d);
    }
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.geometry.setIndex(idx);
    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.frustumCulled = false;
  }

  /**
   * points: path; radii: [width, thickness] half-sizes per point; side: reference axis for the
   * width direction (e.g. the bending axis of a finger), kept perpendicular to the path.
   */
  set(points: THREE.Vector3[], radii: [number, number][], side: THREE.Vector3) {
    const { samples, segments, capStart, capEnd, squareness } = this.o;
    const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal', 0.5);
    const P = new THREE.Vector3(), T = new THREE.Vector3(), B = new THREE.Vector3(), N = new THREE.Vector3();
    const e = 2 / squareness;
    const sp = (x: number) => Math.sign(x) * Math.pow(Math.abs(x), e);
    let ring = 0;
    const lastB = side.clone().normalize();
    const tint: [number, number, number] = [1, 1, 1];
    const writeRing = (c: THREE.Vector3, t: THREE.Vector3, rx: number, ry: number, pt = 0) => {
      B.copy(side).addScaledVector(t, -t.dot(side));
      if (B.lengthSq() < 1e-8) B.copy(lastB); else B.normalize();
      lastB.copy(B);
      N.crossVectors(B, t).normalize();
      for (let j = 0; j < segments; j++) {
        const a = (j / segments) * Math.PI * 2;
        const cx = sp(Math.cos(a)) * rx, cy = sp(Math.sin(a)) * ry;
        const k = (ring * segments + j) * 3;
        this.pos[k] = c.x + B.x * cx + N.x * cy;
        this.pos[k + 1] = c.y + B.y * cx + N.y * cy;
        this.pos[k + 2] = c.z + B.z * cx + N.z * cy;
        if (this.shade) { tint[0] = tint[1] = tint[2] = 1; this.shade(pt, a, tint); this.col[k] = tint[0]; this.col[k + 1] = tint[1]; this.col[k + 2] = tint[2]; }
      }
      ring++;
    };
    const rAt = (t: number): [number, number] => {
      const f = t * (radii.length - 1), i = Math.min(radii.length - 2, Math.floor(f)), u = f - i;
      const s = u * u * (3 - 2 * u);
      return [radii[i][0] + (radii[i + 1][0] - radii[i][0]) * s, radii[i][1] + (radii[i + 1][1] - radii[i][1]) * s];
    };
    if (capStart) {
      const c0 = curve.getPoint(0), t0 = curve.getTangent(0).normalize();
      const [rx, ry] = rAt(0);
      const ext = Math.min(rx, ry) * 0.9;
      for (let k = CAP; k >= 1; k--) {
        const a = (k / CAP) * (Math.PI / 2);
        const s = Math.max(0.02, Math.cos(a));
        writeRing(P.copy(c0).addScaledVector(t0, -Math.sin(a) * ext), t0, rx * s, ry * s, 0);
      }
    }
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      curve.getPoint(t, P); curve.getTangent(t, T).normalize();
      const [rx, ry] = rAt(t);
      writeRing(P, T, rx, ry, t);
    }
    if (capEnd) {
      const c1 = curve.getPoint(1), t1 = curve.getTangent(1).normalize();
      const [rx, ry] = rAt(1);
      const ext = Math.min(rx, ry) * 0.95;
      for (let k = 1; k <= CAP; k++) {
        const a = (k / CAP) * (Math.PI / 2);
        const s = Math.max(0.02, Math.cos(a));
        writeRing(P.copy(c1).addScaledVector(t1, Math.sin(a) * ext), t1, rx * s, ry * s, 1);
      }
    }
    (this.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    this.geometry.computeVertexNormals();
    this.geometry.computeBoundingSphere();
    return this;
  }
}
