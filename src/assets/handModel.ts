// Procedural human hand + forearm built from lofted surfaces (palm, five jointed fingers with a
// proper opposable thumb, nails, knuckle swelling) so it reads as one continuous hand.
// Local frame: origin at the wrist; +x toward the fingers, +y out of the palm, +z toward the thumb.
import * as THREE from 'three';
import { Loft } from './loft';
import { surface } from './materials';

/** Central, editable skin appearance (appearance options can be added later). */
export const SKIN_TONE = { color: 0xd6a184, nail: 0xe9c3b4, sleeve: 0x2d3846 };

export function skinMaterials() {
  const skin = surface('skin', { color: SKIN_TONE.color, roughness: 0.72, normalScale: 0.12, repeat: [2, 2] });
  skin.vertexColors = true; // joint creases + warmer fingertips are painted per vertex
  const nail = new THREE.MeshStandardMaterial({ color: SKIN_TONE.nail, roughness: 0.32 });
  const sleeve = surface('fabric', { color: SKIN_TONE.sleeve, roughness: 1, repeat: [3, 3], side: THREE.DoubleSide });
  return { skin, nail, sleeve };
}

interface FingerSpec { base: THREE.Vector3; len: [number, number, number]; r: number }

const PALM_LEN = 0.9;
// index, middle, ring, little
const FINGERS: FingerSpec[] = [
  { base: new THREE.Vector3(PALM_LEN, -0.015, 0.285), len: [0.38, 0.24, 0.19], r: 0.1 },
  { base: new THREE.Vector3(PALM_LEN + 0.03, -0.02, 0.095), len: [0.42, 0.27, 0.2], r: 0.104 },
  { base: new THREE.Vector3(PALM_LEN + 0.005, -0.015, -0.095), len: [0.39, 0.25, 0.19], r: 0.098 },
  { base: new THREE.Vector3(PALM_LEN - 0.07, -0.005, -0.27), len: [0.3, 0.19, 0.17], r: 0.086 },
];

const band = (t: number, at: number, w: number) => Math.exp(-Math.pow((t - at) / w, 2));
/** Finger tint: flexion creases (deeper on the palm side), knuckle wrinkles on the back, warm pads. */
function fingerShade(t: number, a: number, o: [number, number, number]) {
  const palmSide = Math.sin(a) > 0 ? 1 : 0.45;
  const crease = band(t, 0.5, 0.018) + band(t, 0.833, 0.016) + 0.6 * band(t, 0.2, 0.025);
  const d = 1 - 0.16 * crease * palmSide;
  const pad = Math.max(0, (t - 0.86) / 0.14) * (Math.sin(a) > 0 ? 1 : 0.4);
  o[0] = d * (1 + 0.05 * pad); o[1] = d * (1 - 0.03 * pad); o[2] = d * (1 - 0.03 * pad);
}
function thumbShade(t: number, a: number, o: [number, number, number]) {
  const palmSide = Math.sin(a) > 0 ? 1 : 0.45;
  const d = 1 - 0.15 * band(t, 0.8, 0.02) * palmSide - 0.06 * band(t, 0.6, 0.03);
  const pad = Math.max(0, (t - 0.88) / 0.12);
  o[0] = d * (1 + 0.04 * pad); o[1] = d * (1 - 0.03 * pad); o[2] = d * (1 - 0.03 * pad);
}
/** Palm tint: wrist crease, slightly darker palm lines on the palm side, lighter palm. */
function palmShade(t: number, a: number, o: [number, number, number]) {
  const palmSide = Math.sin(a) > 0;
  const d = 1 - 0.08 * band(t, 0.2, 0.03) - (palmSide ? 0.08 * (band(t, 0.6, 0.015) + band(t, 0.72, 0.015)) : 0);
  const lift = palmSide ? 1.03 : 1;
  o[0] = d * lift; o[1] = d * lift * 0.995; o[2] = d * lift * 0.99;
}

export class Hand {
  group = new THREE.Group();
  private fingers: Loft[] = [];
  private nails: THREE.Mesh[] = [];
  private thumb: Loft;
  private forearm: Loft;
  private sleeve: Loft;
  private zs: number;

  /** side: 'left' mirrors the hand so +z is still the thumb side in local space. */
  constructor(public side: 'left' | 'right', mats = skinMaterials()) {
    this.zs = 1;
    const palm = new Loft(mats.skin, { samples: 14, segments: 22, capStart: false, capEnd: true, squareness: 2.6 });
    palm.shade = palmShade;
    // wrist -> knuckles; widest across the knuckles, thickest at the thenar/hypothenar pads
    palm.set(
      [new THREE.Vector3(-0.2, 0, 0), new THREE.Vector3(0.08, 0.005, 0.0), new THREE.Vector3(0.42, 0.01, 0.005), new THREE.Vector3(0.74, 0.0, 0.005), new THREE.Vector3(0.93, -0.015, 0.0)],
      [[0.26, 0.15], [0.33, 0.16], [0.4, 0.155], [0.41, 0.13], [0.39, 0.1]],
      new THREE.Vector3(0, 0, 1),
    );
    this.group.add(palm.mesh);
    for (let i = 0; i < 4; i++) {
      const f = new Loft(mats.skin, { samples: 20, segments: 14, capStart: false, capEnd: true, squareness: 2.2 });
      f.shade = fingerShade;
      this.fingers.push(f); this.group.add(f.mesh);
      // knuckle (MCP) swelling on the back of the hand
      const s = FINGERS[i];
      const k = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), mats.skin);
      k.geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(k.geometry.attributes.position.count * 3).fill(0.97), 3));
      k.position.set(s.base.x - 0.06, -0.072, s.base.z); k.scale.set(0.12, 0.034, s.r * 0.95);
      this.group.add(k);
      const nail = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), mats.nail);
      this.nails.push(nail); this.group.add(nail);
    }
    this.thumb = new Loft(mats.skin, { samples: 18, segments: 14, capStart: false, capEnd: true, squareness: 2.2 });
    this.thumb.shade = thumbShade;
    this.group.add(this.thumb.mesh);
    const tn = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), mats.nail);
    this.nails.push(tn); this.group.add(tn);
    this.forearm = new Loft(mats.skin, { samples: 10, segments: 16, capStart: false, capEnd: false, squareness: 2.2 });
    this.forearm.shade = (t, _a, o) => { const w = Math.exp(-Math.pow((t - 0.75) / 0.03, 2)); o[0] = o[1] = o[2] = 1 - 0.05 * w; };
    this.sleeve = new Loft(mats.sleeve, { samples: 6, segments: 16, capStart: false, capEnd: false, squareness: 2 });
    this.group.add(this.forearm.mesh, this.sleeve.mesh);
    for (let i = 0; i < 4; i++) this.setFinger(i, [0.2, 0.25, 0.15]);
    this.setThumb(0.3, [0.2, 0.2]);
    this.setForearm(new THREE.Vector3(-2.2, 0, 0));
    if (side === 'left') {
      // mirror across z (three.js flips the winding for negative-scale objects automatically)
      this.group.scale.z = -1;
    }
    void this.zs;
  }

  /** curls (radians) at the base, middle and end joints; splay rotates the finger sideways. */
  setFinger(i: number, curls: [number, number, number], splay = 0) {
    const s = FINGERS[i];
    const d0 = new THREE.Vector3(Math.cos(splay), 0, Math.sin(splay));
    const sideAx = new THREE.Vector3(-Math.sin(splay), 0, Math.cos(splay));
    const up = new THREE.Vector3(0, 1, 0);
    const dir = (a: number) => d0.clone().multiplyScalar(Math.cos(a)).addScaledVector(up, Math.sin(a));
    let a = curls[0];
    const K = s.base.clone();
    const pts = [K.clone().addScaledVector(d0, -0.16), K.clone()];
    const j1 = K.clone().addScaledVector(dir(a), s.len[0]); a += curls[1];
    const j2 = j1.clone().addScaledVector(dir(a), s.len[1]); a += curls[2];
    const d3 = dir(a);
    const tip = j2.clone().addScaledVector(d3, s.len[2]);
    pts.push(K.clone().lerp(j1, 0.5), j1, j1.clone().lerp(j2, 0.5), j2, tip);
    const r = s.r;
    // slight swelling at each knuckle, tapering to a rounded pad
    this.fingers[i].set(pts, [[r * 1.15, r * 0.95], [r * 1.12, r * 0.98], [r * 1.0, r * 0.88], [r * 1.02, r * 0.9], [r * 0.9, r * 0.8], [r * 0.92, r * 0.8], [r * 0.8, r * 0.7]], sideAx);
    this.placeNail(this.nails[i], j2, tip, sideAx, r * 0.78, r * 0.7);
  }

  /** Joint positions (knuckle, two middle joints, tip) and radius for a pose, without applying it. */
  fingerChain(i: number, curls: [number, number, number], splay = 0) {
    const s = FINGERS[i];
    const d0 = new THREE.Vector3(Math.cos(splay), 0, Math.sin(splay));
    const up = new THREE.Vector3(0, 1, 0);
    const dir = (a: number) => d0.clone().multiplyScalar(Math.cos(a)).addScaledVector(up, Math.sin(a));
    let a = curls[0];
    const K = s.base.clone();
    const j1 = K.clone().addScaledVector(dir(a), s.len[0]); a += curls[1];
    const j2 = j1.clone().addScaledVector(dir(a), s.len[1]); a += curls[2];
    const tip = j2.clone().addScaledVector(dir(a), s.len[2]);
    return { pts: [K, j1, j2, tip], r: s.r };
  }

  /** Where the finger's pad (palm side of the last segment) would be for a pose, without applying it. */
  fingerPad(i: number, curls: [number, number, number], splay = 0) {
    const s = FINGERS[i];
    const d0 = new THREE.Vector3(Math.cos(splay), 0, Math.sin(splay));
    const up = new THREE.Vector3(0, 1, 0);
    const dir = (a: number) => d0.clone().multiplyScalar(Math.cos(a)).addScaledVector(up, Math.sin(a));
    let a = curls[0];
    const p = s.base.clone().addScaledVector(dir(a), s.len[0]); a += curls[1];
    p.addScaledVector(dir(a), s.len[1]); a += curls[2];
    const d3 = dir(a);
    p.addScaledVector(d3, s.len[2] * 0.6);
    // pad sits on the palm side of the segment
    const palmar = new THREE.Vector3(-d3.y * Math.cos(splay), d3.x, 0).normalize();
    return p.addScaledVector(palmar, s.r * 0.8);
  }

  /** Thumb: abduction swings it away from the palm; flex bends the two outer joints across. */
  setThumb(abduct: number, flex: [number, number], roll = 0) {
    const base = new THREE.Vector3(0.1, 0.035, 0.18);
    // opposition: the thumb leaves the palm forward, toward the thumb side and out of the palm plane
    const d0 = new THREE.Vector3(0.78, 0.18 + abduct * 0.55, 0.55 - abduct * 0.12).normalize();
    const bendTo = new THREE.Vector3(0.1, 0.55 + roll, -0.8).normalize();
    bendTo.addScaledVector(d0, -bendTo.dot(d0)).normalize();
    const sideAx = new THREE.Vector3().crossVectors(d0, bendTo).normalize();
    const dir = (a: number) => d0.clone().multiplyScalar(Math.cos(a)).addScaledVector(bendTo, Math.sin(a));
    const m1 = base.clone().addScaledVector(d0, 0.44);
    let a = flex[0];
    const j1 = m1.clone().addScaledVector(dir(a), 0.28); a += flex[1];
    const tip = j1.clone().addScaledVector(dir(a), 0.24);
    const pts = [base.clone().addScaledVector(d0, -0.14).add(new THREE.Vector3(0, 0.05, 0)), base, base.clone().lerp(m1, 0.55), m1, j1, tip];
    // fat metacarpal (thenar pad) tapering into the thumb
    this.thumb.set(pts, [[0.15, 0.13], [0.17, 0.145], [0.145, 0.12], [0.112, 0.1], [0.102, 0.09], [0.09, 0.076]], sideAx);
    this.placeNail(this.nails[4], j1, tip, sideAx, 0.074, 0.07);
  }

  setForearm(elbow: THREE.Vector3) {
    const w = new THREE.Vector3(-0.12, 0, 0);
    const mid = elbow.clone().lerp(w, 0.55);
    const near = new THREE.Vector3(-0.42, 0, 0);
    this.forearm.set([elbow, mid, near, w, new THREE.Vector3(0.05, 0, 0)], [[0.34, 0.29], [0.31, 0.26], [0.26, 0.19], [0.25, 0.155], [0.25, 0.15]], new THREE.Vector3(0, 0, 1));
    const cuff = elbow.clone().lerp(w, 0.42);
    this.sleeve.set([elbow.clone().addScaledVector(elbow.clone().sub(w).normalize(), 0.3), elbow.clone().lerp(cuff, 0.5), cuff], [[0.38, 0.34], [0.36, 0.32], [0.34, 0.3]], new THREE.Vector3(0, 0, 1));
  }

  private placeNail(nail: THREE.Mesh, j: THREE.Vector3, tip: THREE.Vector3, sideAx: THREE.Vector3, w: number, t: number) {
    const d = tip.clone().sub(j).normalize();
    const palmar = new THREE.Vector3().crossVectors(sideAx, d).normalize();
    const dorsal = palmar.clone().negate();
    const sx = new THREE.Vector3().crossVectors(dorsal, d).normalize();
    const m = new THREE.Matrix4().makeBasis(sx, dorsal, d);
    nail.quaternion.setFromRotationMatrix(m);
    nail.position.copy(j).lerp(tip, 0.58).addScaledVector(dorsal, t * 0.74);
    nail.scale.set(w * 0.74, t * 0.24, tip.distanceTo(j) * 0.5);
  }
}
