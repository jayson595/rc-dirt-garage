// "Signalroost Palmhelm" wheel-and-trigger RC car transmitter held by two lofted human hands.
// Seen from the operator's right-rear quarter: electronics housing on top, side steering wheel on the
// right (face toward the player), handgrip with a short finger trigger, display, broad base.
// Moving parts keep separate pivots (wheel, trigger, steering hand, index finger) so a rigged model can
// replace this later while keeping the same anchors and pose() API.
// Overlay space: x right, y up, z toward the viewer. ~1 unit ≈ 80 CSS px at 390 px width.
import * as THREE from 'three';
import { WHEEL_STOP_DEG } from '../core/gestures';
import { Hand, skinMaterials } from './handModel';
import { surface } from './materials';

const STOP = THREE.MathUtils.degToRad(WHEEL_STOP_DEG);
const TRIGGER_TRAVEL = 0.36; // radians of lever swing at full pull

export interface TransmitterRig {
  root: THREE.Group;
  /** Projection anchors used for hit regions. */
  anchors: { wheelCenter: THREE.Object3D; wheelRim: THREE.Object3D; trigger: THREE.Object3D; grip: THREE.Object3D };
  /** Current rotations of the moving parts (radians), for checks/debugging. */
  state: { wheel: number; trigger: number; hand: number };
  /** steer -1..1, throttle -1..1 (positive = pulled). */
  pose(steer: number, throttle: number, dt: number, idle: number): void;
}

const std = (color: number, rough = 0.6, metal = 0) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });

function materials() {
  return {
    housing: surface('plastic', { color: 0x35383d, roughness: 0.62, normalScale: 0.4, repeat: [3, 3] }),
    panel: surface('plastic', { color: 0x3b3e44, roughness: 0.5, normalScale: 0.3, repeat: [3, 3] }),
    cover: surface('plastic', { color: 0x9aa1aa, roughness: 0.42, normalScale: 0.3, repeat: [3, 3] }),
    grip: surface('rubber', { color: 0x1a1a1c, roughness: 1, normalScale: 1.4, repeat: [5, 5] }),
    foam: surface('rubber', { color: 0x151516, roughness: 1, normalScale: 2.2, repeat: [24, 2] }),
    dark: std(0x101113, 0.7),
    metal: std(0xb8bec6, 0.28, 0.9),
    accent: std(0xd8432f, 0.45),
    mark: new THREE.MeshStandardMaterial({ color: 0xffd43b, emissive: 0x8a6a00, emissiveIntensity: 0.5, roughness: 0.4 }),
  };
}

/** Extrude a side profile drawn in (forward, up) and turn it so it spans the transmitter's width (x). */
function sideExtrude(shape: THREE.Shape, width: number, bevel: number, mat: THREE.Material, parent: THREE.Object3D, curveSegments = 14) {
  const depth = Math.max(0.001, width - bevel * 2);
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.9, bevelSegments: 4, curveSegments });
  geo.rotateY(Math.PI / 2);         // shape x (forward) -> -z, extrusion -> +x
  geo.translate(-depth / 2, 0, 0);
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat);
  parent.add(m);
  return m;
}

function mesh(geo: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D, pos: [number, number, number] = [0, 0, 0], rot: [number, number, number] = [0, 0, 0]) {
  const o = new THREE.Mesh(geo, m);
  o.position.set(...pos); o.rotation.set(...rot);
  parent.add(o);
  return o;
}

function displayTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 160;
  const g = c.getContext('2d')!;
  const gr = g.createLinearGradient(0, 0, 0, 160); gr.addColorStop(0, '#163a52'); gr.addColorStop(1, '#0c2233');
  g.fillStyle = gr; g.fillRect(0, 0, 256, 160);
  g.fillStyle = '#9fe0ff'; g.font = '700 30px system-ui, sans-serif'; g.fillText('PALMHELM', 18, 44);
  g.fillStyle = 'rgba(159,224,255,.7)'; g.font = '600 20px system-ui, sans-serif'; g.fillText('MODEL 01 · DIRT DART', 18, 76);
  // signal bars + transmitter battery
  for (let i = 0; i < 4; i++) { g.fillStyle = '#9fe0ff'; g.fillRect(20 + i * 14, 140 - i * 9, 9, 8 + i * 9); }
  g.strokeStyle = '#9fe0ff'; g.lineWidth = 3; g.strokeRect(150, 112, 70, 28); g.fillRect(220, 120, 6, 12);
  g.fillStyle = '#7ce38b'; g.fillRect(155, 117, 52, 18);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

/** The transmitter itself (no hands). Frame: x = right side (wheel side), y = up, z = rear. ~1 unit = 5 cm. */
export function buildTransmitterBody(M = materials()) {
  const tx = new THREE.Group();
  tx.name = 'transmitter';
  // ---------------- electronics housing: one moulded side profile, bevelled all round
  const hp = new THREE.Shape();
  hp.moveTo(-0.95, 0.04);
  hp.quadraticCurveTo(-1.1, 0.08, -1.06, 0.32);
  hp.lineTo(-1.0, 0.54);
  hp.quadraticCurveTo(-0.96, 0.62, -0.84, 0.64);
  hp.lineTo(-0.5, 0.74);
  hp.quadraticCurveTo(-0.3, 0.76, 0.0, 0.7);
  hp.lineTo(0.9, 0.6);
  hp.quadraticCurveTo(1.5, 0.56, 1.72, 0.36);
  hp.quadraticCurveTo(1.86, 0.16, 1.68, 0.0);
  hp.quadraticCurveTo(1.3, -0.1, 0.8, -0.1);
  hp.quadraticCurveTo(0.3, -0.12, -0.1, -0.05);
  hp.lineTo(-0.95, 0.04);
  sideExtrude(hp, 0.8, 0.1, M.housing, tx, 18);
  // contrasting side cover on the wheel side (panel division) + screws
  const cover = new THREE.Shape();
  cover.moveTo(-0.7, 0.12); cover.quadraticCurveTo(-0.85, 0.14, -0.82, 0.4);
  cover.quadraticCurveTo(-0.6, 0.6, 0.0, 0.58); cover.lineTo(1.2, 0.5);
  cover.quadraticCurveTo(1.55, 0.42, 1.55, 0.2); cover.quadraticCurveTo(1.4, 0.04, 1.0, 0.03); cover.lineTo(-0.7, 0.12);
  const coverMesh = sideExtrude(cover, 0.06, 0.02, M.cover, tx, 14);
  coverMesh.position.x = 0.42;
  for (const [f, u] of [[-0.6, 0.2], [-0.55, 0.48], [1.3, 0.12], [1.3, 0.4], [0.4, 0.5]] as const) {
    mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.02, 10), M.metal, tx, [0.455, u, -f], [0, 0, Math.PI / 2]);
  }
  // accent pin-stripe along the side cover
  mesh(new THREE.BoxGeometry(0.01, 0.025, 1.9), M.accent, tx, [0.457, 0.09, -0.45]);

  // display on the rear slope, angled toward the operator
  const disp = new THREE.Group();
  disp.position.set(0, 0.7, 0.67);
  disp.rotation.x = -1.28;
  tx.add(disp);
  mesh(new THREE.BoxGeometry(0.56, 0.36, 0.03), M.dark, disp, [0, 0, -0.005]);
  mesh(new THREE.PlaneGeometry(0.48, 0.3), new THREE.MeshStandardMaterial({ map: displayTexture(), emissive: 0xffffff, emissiveMap: displayTexture(), emissiveIntensity: 0.55, roughness: 0.25 }), disp, [0, 0, 0.012]);
  // trim buttons, power switch, toggle
  for (let i = 0; i < 4; i++) mesh(new THREE.CapsuleGeometry(0.022, 0.06, 3, 8), M.panel, tx, [-0.24 + i * 0.16, 0.73, 0.18], [Math.PI / 2, 0, 0]);
  mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 16), M.accent, tx, [0.22, 0.7, 0.42]);
  mesh(new THREE.CylinderGeometry(0.012, 0.016, 0.12, 8), M.metal, tx, [-0.22, 0.73, -0.1], [-0.4, 0, 0]);
  mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.03, 14), M.dark, tx, [-0.22, 0.69, -0.1]);
  // short antenna stub at the rear corner
  const ant = mesh(new THREE.CylinderGeometry(0.045, 0.07, 0.5, 14), M.housing, tx, [-0.25, 0.96, 0.62], [0.35, 0, -0.1]);
  mesh(new THREE.SphereGeometry(0.045, 12, 8), M.panel, ant, [0, 0.25, 0]);

  // ---------------- handgrip (rubber, finger grooves) leaning back, and a broad base
  const gp = new THREE.Shape();
  gp.moveTo(-0.14, 0.06);
  gp.bezierCurveTo(-0.17, -0.2, -0.13, -0.32, -0.2, -0.45);
  gp.bezierCurveTo(-0.26, -0.56, -0.19, -0.7, -0.26, -0.82);
  gp.bezierCurveTo(-0.32, -0.94, -0.26, -1.06, -0.34, -1.2);
  gp.lineTo(-0.98, -1.22);
  gp.bezierCurveTo(-1.08, -0.8, -1.02, -0.3, -0.9, 0.06);
  gp.lineTo(-0.14, 0.06);
  sideExtrude(gp, 0.44, 0.13, M.grip, tx, 16);
  const base = new THREE.Shape();
  base.moveTo(-0.05, -1.14); base.quadraticCurveTo(0.08, -1.3, 0.0, -1.42);
  base.lineTo(-1.2, -1.46); base.quadraticCurveTo(-1.32, -1.3, -1.12, -1.12); base.lineTo(-0.05, -1.14);
  sideExtrude(base, 0.98, 0.1, M.housing, tx, 12);
  mesh(new THREE.BoxGeometry(0.012, 0.12, 0.8), M.panel, tx, [0.495, -1.3, 0.6]); // battery door seam
  const gripAnchor = new THREE.Object3D(); gripAnchor.position.set(0.2, -0.55, 0.6); tx.add(gripAnchor);

  // ---------------- trigger: pivots inside the housing, short curved lever in front of the grip
  const triggerPivot = new THREE.Group();
  triggerPivot.position.set(0, -0.02, 0.0);
  tx.add(triggerPivot);
  const tp = new THREE.Shape();
  tp.moveTo(-0.06, 0.04);
  tp.quadraticCurveTo(0.06, -0.26, -0.03, -0.5);
  tp.quadraticCurveTo(0.04, -0.62, 0.16, -0.54);
  tp.quadraticCurveTo(0.24, -0.26, 0.12, 0.04);
  tp.lineTo(-0.06, 0.04);
  sideExtrude(tp, 0.16, 0.04, M.accent, triggerPivot, 12);
  mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.2, 12), M.metal, triggerPivot, [0, 0, 0], [0, 0, Math.PI / 2]);
  // recessed slot the lever travels in
  mesh(new THREE.BoxGeometry(0.2, 0.05, 0.5), M.dark, tx, [0, -0.08, -0.02]);
  const triggerContact = new THREE.Object3D(); triggerContact.position.set(0, -0.36, 0.05); triggerPivot.add(triggerContact);

  // ---------------- steering wheel on the right side; built in a "face frame" (x right, y up, z out of the wheel face)
  const wheelMount = new THREE.Group();
  wheelMount.position.set(0.62, 0.16, -1.32);
  wheelMount.rotation.y = Math.PI / 2;
  tx.add(wheelMount);
  // mounting boss from the housing side
  mesh(new THREE.CylinderGeometry(0.17, 0.2, 0.24, 20), M.housing, wheelMount, [0, 0, -0.15], [Math.PI / 2, 0, 0]);
  // fixed range arc with mechanical stop ticks behind the wheel
  mesh(new THREE.TorusGeometry(0.83, 0.016, 5, 48, STOP * 2), M.metal, wheelMount, [0, 0, -0.08], [0, 0, Math.PI / 2 - STOP]);
  for (const s of [-1, 1]) {
    const a = Math.PI / 2 + s * STOP;
    mesh(new THREE.BoxGeometry(0.05, 0.14, 0.04), M.accent, wheelMount, [Math.cos(a) * 0.83, Math.sin(a) * 0.83, -0.07], [0, 0, a - Math.PI / 2]);
  }
  mesh(new THREE.BoxGeometry(0.035, 0.11, 0.04), M.mark, wheelMount, [0, 0.83, -0.07]); // centre index
  const wheel = new THREE.Group();
  wheelMount.add(wheel);
  // foam tire: lathed cross-section swept round (fat, soft, slightly flattened), knurled by the normal map
  const foamGeo = new THREE.TorusGeometry(0.62, 0.11, 16, 64);
  foamGeo.scale(1, 1, 1.25);
  mesh(foamGeo, M.foam, wheel);
  // dished three-spoke centre
  const dish = new THREE.Shape();
  dish.absarc(0, 0, 0.55, 0, Math.PI * 2, false);
  for (let i = 0; i < 3; i++) {
    const a0 = Math.PI / 2 + (i * Math.PI * 2) / 3 + 0.36, a1 = a0 + (Math.PI * 2) / 3 - 0.72;
    const h = new THREE.Path();
    h.absarc(0, 0, 0.45, a0, a1, false);
    h.absarc(0, 0, 0.17, a1 - 0.18, a0 + 0.18, true);
    dish.holes.push(h);
  }
  const dishGeo = new THREE.ExtrudeGeometry(dish, { depth: 0.04, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.025, bevelSegments: 3, curveSegments: 40 });
  mesh(dishGeo, M.panel, wheel, [0, 0, -0.03]);
  mesh(new THREE.CylinderGeometry(0.15, 0.17, 0.1, 24), M.metal, wheel, [0, 0, 0.05], [Math.PI / 2, 0, 0]);
  mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.02, 16), M.accent, wheel, [0, 0, 0.105], [Math.PI / 2, 0, 0]);
  // high-contrast rotation cues: nub on top of the rim + stripe on the top spoke
  mesh(new THREE.CapsuleGeometry(0.06, 0.08, 4, 10), M.mark, wheel, [0, 0.66, 0.06], [Math.PI / 2, 0, 0]);
  mesh(new THREE.BoxGeometry(0.05, 0.24, 0.02), M.mark, wheel, [0, 0.33, 0.035]);
  const wheelCenter = new THREE.Object3D(); wheelMount.add(wheelCenter);
  const wheelRim = new THREE.Object3D(); wheelRim.position.set(0, 0.73, 0); wheelMount.add(wheelRim);

  return { tx, wheel, wheelMount, triggerPivot, triggerContact, gripAnchor, wheelCenter, wheelRim };
}

export function createTransmitter(): TransmitterRig {
  const M = materials();
  const root = new THREE.Group();
  root.name = 'transmitter-overlay';
  const { tx, wheel, wheelMount, triggerPivot, triggerContact, gripAnchor, wheelCenter, wheelRim } = buildTransmitterBody(M);
  tx.rotation.set(0.16, -1.2, 0.04, 'YXZ');
  tx.position.set(-0.78, 0.05, 0);
  root.add(tx);

  // ---------------- hands
  const skin = skinMaterials();
  const HAND_SCALE = 1.32;
  const orient = (h: Hand, holder: THREE.Group, wrist: THREE.Vector3, f: THREE.Vector3, n: THREE.Vector3) => {
    const F = f.clone().normalize();
    const N = n.clone().addScaledVector(F, -n.dot(F)).normalize();
    const S = new THREE.Vector3().crossVectors(F, N);
    holder.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(F, N, S));
    holder.position.copy(wrist);
    holder.scale.setScalar(HAND_SCALE);
    holder.add(h.group);
  };
  const toHand = (h: Hand, p: THREE.Vector3) => { h.group.updateMatrixWorld(true); return h.group.worldToLocal(p.clone()); };

  // left hand wraps the grip: palm on the far (left) side, fingers round the front, index on the trigger,
  // thumb resting up along the housing
  const left = new Hand('left', skin);
  const leftHolder = new THREE.Group(); tx.add(leftHolder);
  orient(left, leftHolder, new THREE.Vector3(-0.44, -0.62, 1.5), new THREE.Vector3(0, -0.1, -1), new THREE.Vector3(1, 0, 0));
  left.setFinger(1, [1.45, 1.25, 0.55], 0.02);
  left.setFinger(2, [1.5, 1.25, 0.5], -0.02);
  left.setFinger(3, [1.55, 1.2, 0.5], -0.06);
  left.setThumb(0.55, [0.15, 0.1], 0.2);
  const leftElbowTx = new THREE.Vector3(-0.7, -2.9, 3.4);

  // right hand on the wheel: back of the hand toward the player at about five o'clock, fingers over the
  // tire, thumb on the face near the rim (the top marker stays clear)
  const handPivot = new THREE.Group();
  wheelMount.add(handPivot);
  const right = new Hand('right', skin);
  const rightHolder = new THREE.Group(); handPivot.add(rightHolder);
  {
    // grasp at about half past four: knuckles just outside the foam tire, fingers hook over its front face.
    // Each finger is fitted so it rests on the tire without sinking in (the tire is round, so the fit holds
    // at every wheel angle); the hand backs off outward until all four fingers sit on the surface.
    const a = THREE.MathUtils.degToRad(-50);
    const rr = new THREE.Vector3(Math.cos(a), Math.sin(a), 0), tz = new THREE.Vector3(0, 0, 1);
    const f = tz.clone().multiplyScalar(0.6).addScaledVector(rr, -0.42).normalize();
    const tireSdf = (p: THREE.Vector3) => Math.hypot(Math.hypot(p.x, p.y) - 0.62, p.z / 1.25) - 0.11;
    const base: [number, number, number][] = [[0.85, 1.4, 0.8], [0.8, 1.45, 0.8], [0.85, 1.45, 0.75], [0.95, 1.4, 0.7]];
    const splays = [0.06, 0, -0.06, -0.12];
    const fitAt = (kr: number, kz: number, apply: boolean) => {
      const knuckles = rr.clone().multiplyScalar(kr).add(new THREE.Vector3(0, 0, kz));
      orient(right, rightHolder, knuckles.clone().addScaledVector(f, -0.9 * HAND_SCALE), f, rr.clone().negate());
      root.updateMatrixWorld(true);
      const toFace = new THREE.Matrix4().copy(wheelMount.matrixWorld).invert().multiply(right.group.matrixWorld);
      let total = 0;
      for (let i = 0; i < 4; i++) {
        let best = 1, bestScore = Infinity;
        for (let m = 0.85; m <= 1.4001; m += 0.05) {
          const { pts, r } = right.fingerChain(i, base[i].map((v) => v * m) as [number, number, number], splays[i]);
          let minD = Infinity;
          for (let k = 0; k < 3; k++) for (let u = 0; u <= 1.0001; u += 0.125) {
            minD = Math.min(minD, tireSdf(pts[k].clone().lerp(pts[k + 1], u).applyMatrix4(toFace)) - r * HAND_SCALE * 0.92);
          }
          const tip = pts[3].clone().applyMatrix4(toFace);
          // touching (not inside, not floating) and the fingertip ends over the tire, not over the hub
          const score = (minD < 0 ? -minD * 30 : minD * 3) + Math.max(0, 0.5 - Math.hypot(tip.x, tip.y)) * 2;
          if (score < bestScore) { bestScore = score; best = m; }
        }
        total += bestScore;
        if (apply) right.setFinger(i, base[i].map((v) => v * best) as [number, number, number], splays[i]);
      }
      return total + kr * 0.05;
    };
    let bestCfg = [0.97, -0.03], bestTotal = Infinity;
    for (let kr = 0.82; kr <= 1.1; kr += 0.04) for (let kz = -0.06; kz <= 0.3; kz += 0.06) {
      const t = fitAt(kr, kz, false);
      if (t < bestTotal) { bestTotal = t; bestCfg = [kr, kz]; }
    }
    fitAt(bestCfg[0], bestCfg[1], true);
  }
  right.setThumb(0.15, [0.35, 0.35], 0.0);
  const rightElbowRoot = new THREE.Vector3(3.3, -3.0, 0.6);

  for (const o of [root]) o.traverse((m) => { (m as THREE.Mesh).castShadow = false; (m as THREE.Mesh).receiveShadow = false; });

  const contact = new THREE.Vector3(), tmp = new THREE.Vector3();
  let shownSteer = 0, shownThrottle = 0;
  root.updateMatrixWorld(true);
  const leftElbow = toHand(left, tx.localToWorld(leftElbowTx.clone()));
  left.setForearm(leftElbow);

  /** Curl the index finger so its pad stays on the trigger as the lever moves. */
  function solveIndex() {
    triggerContact.getWorldPosition(contact);
    const target = toHand(left, contact);
    // 1-D search over a curl blend; the finger's pad (end segment) lands on the lever face
    let best = 0, bestD = Infinity;
    const curlsAt = (c: number): [number, number, number] => [0.15 + c * 0.95, 0.45 + c * 0.85, 0.3 + c * 0.35];
    for (let i = 0; i <= 30; i++) {
      const c = i / 30;
      const d = left.fingerPad(0, curlsAt(c), 0.08).distanceTo(target);
      if (d < bestD) { bestD = d; best = c; }
    }
    left.setFinger(0, curlsAt(best), 0.08);
  }

  function pose(steer: number, throttle: number, dt: number, idle: number) {
    // visual follows input quickly but not instantly, so motion reads as mechanical
    shownSteer += (steer - shownSteer) * (1 - Math.exp(-dt * 30));
    shownThrottle += (throttle - shownThrottle) * (1 - Math.exp(-dt * 40));
    // clockwise on screen for positive steer (rotation about +z toward viewer is counter-clockwise)
    wheel.rotation.z = -shownSteer * STOP;
    handPivot.rotation.z = -shownSteer * STOP * 0.35;
    triggerPivot.rotation.x = -shownThrottle * TRIGGER_TRAVEL;
    // a little breathing sway, disabled with reduced motion
    root.position.y = Math.sin(idle * 1.4) * 0.01;
    root.updateMatrixWorld(true);
    solveIndex();
    tmp.copy(rightElbowRoot); root.localToWorld(tmp);
    right.setForearm(toHand(right, tmp));
  }
  pose(0, 0, 1, 0);

  return {
    // same sign conventions as before: wheel < 0 for right steer, trigger < 0 when pulled
    get state() { return { wheel: wheel.rotation.z, trigger: -shownThrottle * 0.55, hand: handPivot.rotation.z }; },
    root,
    anchors: { wheelCenter, wheelRim, trigger: triggerContact, grip: gripAnchor },
    pose,
  };
}
