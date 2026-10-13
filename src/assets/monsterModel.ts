// Cragweld Mudhammer: a 1/10 solid-axle monster truck after the Axial SMT10 / Monster-Jam school.
// Tall tube chassis, 4-link solid axles, long coil-overs, huge chevron-lug tyres on beadlocks, and a
// sculpted pickup body (one lofted shell, painted flames, window nets, tonneau'd bed) sitting high on top.
// Body frame matches the sim: x forward, y up, z right; origin at the centre of mass.
import * as THREE from 'three';
import { batchStatic } from './staticBatch';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MONSTER_CG_DROP, MONSTER_SPEC } from '../sim/ArenaTerrain';
import { TruckSpec } from '../sim/CrawlerSim';
import { MonsterSlot, monsterSpecFor } from '../sim/monsterUpgrades';
import { lathe, rimGeometry, roundedBox, surface } from './materials';
import { bentTube, endCap, hex3, loftShell, Painter, profile, ShellSpec, smax, sstep } from './crawlerBodies';

export const MONSTER_COLORS = { body: 0x1f6fd1, flame1: 0xf7d23a, flame2: 0xf0782a, flame3: 0xd2321e };

export interface MonsterModel {
  root: THREE.Group;
  pose(sim: { pos: THREE.Vector3; q: THREE.Quaternion; susp: number[]; spin: number[]; steer: number; rearSteerNow?: number }): void;
  rest(): void;
  /** Height of the model origin above the floor in the rest pose. */
  restHeight: number;
}

const mat = (color: number, rough = 0.5, metal = 0.2) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });

/** Huge monster tyre: rounded carcass + chevron lugs (V pointing forward), axis = y. */
export function monsterTire(R: number, W: number, lugs = 18) {
  const w = W / 2, sh = R * 0.22, r0 = R * 0.55;
  const parts: THREE.BufferGeometry[] = [lathe([
    [r0, -w], [R - sh, -w], [R - sh * 0.35, -w + sh * 0.3], [R - sh * 0.08, -w + sh * 0.8], [R - sh * 0.08, w - sh * 0.8],
    [R - sh * 0.35, w - sh * 0.3], [R - sh, w], [r0, w]], 48).toNonIndexed()];
  const lugH = R * 0.075, lugT = R * 0.11;
  for (let k = 0; k < lugs; k++) {
    const a = (k / lugs) * Math.PI * 2;
    for (const side of [-1, 1]) {
      const len = w * 0.95;
      const g = new THREE.BoxGeometry(lugT, len, lugH);   // x = around, y = across (axle), z = radial
      g.rotateZ(side * 0.55);                              // chevron angle
      g.translate(side * len * 0.27, side * len * 0.5, R - sh * 0.08 + lugH * 0.4);
      g.rotateY(a);
      parts.push(g.toNonIndexed());
    }
    // shoulder lug wrapping onto the sidewall
    for (const side of [-1, 1]) {
      const g = new THREE.BoxGeometry(lugT * 0.9, sh * 0.9, lugH * 0.9);
      g.translate(0, side * (w - sh * 0.35), R - sh * 0.45);
      g.rotateY(a + Math.PI / lugs);
      parts.push(g.toNonIndexed());
    }
  }
  const geo = mergeGeometries(parts, false)!;
  geo.computeVertexNormals();
  return geo;
}

/** Rigid link re-aimed between two points each frame. */
class Rod {
  mesh: THREE.Mesh;
  constructor(parent: THREE.Object3D, r: number, m: THREE.Material, seg = 10, geo?: THREE.BufferGeometry) {
    this.mesh = new THREE.Mesh(geo ?? new THREE.CylinderGeometry(r, r, 1, seg).translate(0, 0.5, 0), m); this.mesh.castShadow = true;
    parent.add(this.mesh);
  }
  aim(a: THREE.Vector3, b: THREE.Vector3) {
    const d = b.clone().sub(a), len = Math.max(1e-4, d.length());
    this.mesh.position.copy(a); this.mesh.scale.set(1, len, 1);
    this.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  }
}

/** The sculpted body shell (lofted pickup with flames). Exported so the arena can reuse the painter idea. */
function buildBody(shell: THREE.Group, colors = MONSTER_COLORS) {
  const W = 0.15, XF = 0.3, XR = -0.285, yb = 0.05;
  const AR = { x: 0.175, y: 0.0, r: 0.112 };
  const archTop = (x: number) => { let t = -1; for (const ax of [AR.x, -AR.x]) { const dx = x - ax; if (Math.abs(dx) < AR.r) t = Math.max(t, AR.y + Math.sqrt(AR.r * AR.r - dx * dx)); } return t; };
  const belt = profile([[XF, 0.13], [0.26, 0.145], [0.18, 0.152], [0.08, 0.158], [0.06, 0.156], [-0.09, 0.152], [-0.1, 0.15], [XR, 0.148]]);
  const top = profile([[XF, 0.135], [0.27, 0.15], [0.2, 0.16], [0.1, 0.166], [0.078, 0.168], [0.04, 0.236], [0.03, 0.242], [-0.075, 0.242], [-0.085, 0.236], [-0.092, 0.17], [-0.1, 0.158], [XR, 0.156]], 2);
  const cab = (x: number) => sstep(0.085, 0.07, x) * (1 - sstep(-0.09, -0.1, x));
  const bot = (x: number) => { let b = yb + (x > 0.25 ? (x - 0.25) * 0.6 : x < -0.25 ? (-0.25 - x) * 0.5 : 0); const at = archTop(x); if (at > -1) b = smax(b, at, 0.01); return b; };
  const flare = (x: number, y: number) => {
    let f = 0;
    for (const ax of [AR.x, -AR.x]) { const d = Math.hypot(x - ax, y - AR.y); f = Math.max(f, Math.exp(-Math.pow((d - AR.r - 0.008) / 0.022, 2))); }
    return 0.018 * f * (1 - sstep(0.12, 0.15, y));
  };
  const spec: ShellSpec = {
    xF: XF, xR: XR, endRound: 0.014,
    half(x) {
      const b = bot(x), bl = belt(x), t = top(x), c = cab(x);
      const wTop = THREE.MathUtils.lerp(W - 0.012, 0.118, c);
      const y1 = THREE.MathUtils.lerp(b, bl, 0.5), y2 = bl - 0.016;
      return [
        [W + flare(x, b) + 0.003, b], [W + flare(x, y1) + 0.002, y1], [W + flare(x, y2) + 0.003, y2], [W, bl],
        [THREE.MathUtils.lerp(W - 0.003, wTop + 0.004, c), Math.min(bl + 0.005, t - 0.005)],
        [wTop, t - THREE.MathUtils.lerp(0.004, 0.016, c)], [wTop - 0.018, t], [0, t + THREE.MathUtils.lerp(0.006, 0.003, c)],
      ];
    },
  };
  const body = hex3(colors.body), f1 = hex3(colors.flame1), f2 = hex3(colors.flame2), f3 = hex3(colors.flame3);
  const black: [number, number, number] = [0.06, 0.06, 0.07], glass: [number, number, number] = [0.04, 0.05, 0.06], white: [number, number, number] = [0.94, 0.93, 0.9];
  // name decal sampled from a canvas
  const nc = document.createElement('canvas'); nc.width = 512; nc.height = 96; const ng = nc.getContext('2d', { willReadFrequently: true })!;
  ng.fillStyle = '#fff'; ng.font = 'italic 900 80px "Barlow Condensed", "Arial Narrow", sans-serif'; { const w = ng.measureText('MUDHAMMER').width; ng.save(); ng.scale(Math.min(1, 496 / w), 1); ng.fillText('MUDHAMMER', 6, 78); ng.restore(); }
  const nd = ng.getImageData(0, 0, 512, 96).data;
  const nameAt = (x: number, y: number, z: number) => { const u = z > 0 ? (x + 0.27) / 0.2 : (-0.07 - x) / 0.2, v = 1 - (y - 0.088) / 0.036; if (u < 0 || u >= 1 || v < 0 || v >= 1) return 0; return nd[(Math.floor(v * 96) * 512 + Math.floor(u * 512)) * 4 + 3] / 255; };
  // flames: licks that run back from the nose along hood and flanks
  const flameAt = (x: number, y: number, z: number, side: boolean) => {
    const pos = side ? y : Math.abs(z);
    // licks: alternating long and short tongues of flame reaching back from the nose
    const lick = Math.pow(Math.abs(Math.sin(pos * 95 + 0.7)), 0.6);
    const tip = 0.24 - 0.17 * lick * (0.75 + 0.25 * Math.sin(pos * 31));
    const d = x - tip; // > 0 = inside the flame (towards the nose)
    return d;
  };
  const paint: Painter = (x, y, z, o) => {
    const az = Math.abs(z), bl = belt(x), t = top(x), c = cab(x);
    const wTop = THREE.MathUtils.lerp(W - 0.012, 0.118, c);
    o.c = body; o.r = 0.28; o.m = 0.25;
    const side = az > W - 0.006;
    if (y > bl + 0.004 && c > 0.5) {
      // cab: black roof band, glass all round with white window nets on the sides
      o.c = black; o.r = 0.35; o.m = 0.1;
      const onSide = az > wTop - 0.008 && y < t - 0.01;
      if (onSide && y > bl + 0.01 && y < t - 0.016 && x < 0.062 - (y - bl) * 0.55 && x > -0.082) {
        o.c = glass; o.r = 0.06; o.m = 0.3;
        if (Math.abs(Math.sin(x * 260)) < 0.12 || Math.abs(Math.sin(y * 260)) < 0.12) { o.c = white; o.r = 0.6; o.m = 0; }
      }
      if (!onSide && x > 0.04 && x < 0.074 && az < wTop - 0.014) { o.c = glass; o.r = 0.05; o.m = 0.35; }
      if (x < -0.086 && az < wTop - 0.014 && y < t - 0.012 && y > bl + 0.012) { o.c = glass; o.r = 0.05; o.m = 0.35; }
      return;
    }
    // flames on hood + front flanks
    const fd = flameAt(x, y, z, side);
    if (fd > 0) { const k = Math.min(1, fd / 0.05); o.c = k < 0.3 ? f3 : k < 0.65 ? f2 : f1; o.r = 0.25; }
    else if (fd > -0.004) { o.c = black; o.r = 0.4; }
    if (side) {
      if (y < bot(x) + 0.012 && archTop(x) < 0) { o.c = black; o.r = 0.6; }
      const n = nameAt(x, y, z); if (n > 0.45 && fd <= 0) { o.c = white; o.r = 0.3; }
      else if (n > 0.08 && fd <= 0) { o.c = black; }
      if (x < -0.095 && x > -0.27 && Math.abs(y - (bl - 0.004)) < 0.003) { o.c = black; o.r = 0.5; } // bed rail line
    } else if (x < -0.1 && x > -0.27) {
      // tonneau cover: ribbed black
      o.c = Math.sin(x * 400) > 0.6 ? [0.12, 0.12, 0.13] : black; o.r = 0.7; o.m = 0.05;
    }
  };
  const L = loftShell(spec, paint, { U: 96, V: 62, TW: 1024, TH: 512 });
  shell.add(L.outer, L.inner);
  const hexC = `#${colors.body.toString(16).padStart(6, '0')}`;
  shell.add(endCap(L.front, XF, 1, (g, P) => {
    g.fillStyle = hexC; g.fillRect(0, 0, 4096, 4096);
    const [gx0, gy0] = P(-0.1, 0.13), [gx1, gy1] = P(0.1, 0.075);
    g.fillStyle = '#121214'; g.beginPath(); g.roundRect(Math.min(gx0, gx1), gy0, Math.abs(gx1 - gx0), gy1 - gy0, 10); g.fill();
    g.strokeStyle = '#c9ced4'; g.lineWidth = 6; for (let i = 1; i < 6; i++) { const [lx] = P(-0.1 + i * 0.0333, 0); g.beginPath(); g.moveTo(lx, gy0 + 6); g.lineTo(lx, gy1 - 6); g.stroke(); }
    for (const s of [-1, 1]) { const [lx, ly] = P(s * 0.118, 0.105); g.fillStyle = '#f4f1e6'; g.beginPath(); g.ellipse(lx, ly, 26, 18, 0, 0, Math.PI * 2); g.fill(); g.strokeStyle = '#111'; g.lineWidth = 5; g.stroke(); }
  }, (g, P) => { g.fillStyle = '#000'; g.fillRect(0, 0, 4096, 4096); for (const s of [-1, 1]) { const [lx, ly] = P(s * 0.118, 0.105); g.fillStyle = '#fff0c8'; g.beginPath(); g.ellipse(lx, ly, 22, 14, 0, 0, Math.PI * 2); g.fill(); } }));
  shell.add(endCap(L.rear, XR, -1, (g, P) => {
    g.fillStyle = hexC; g.fillRect(0, 0, 4096, 4096);
    for (const s of [-1, 1]) { const [tx, ty] = P(s * 0.12, 0.12); g.fillStyle = '#c8231b'; g.fillRect(tx - 14, ty - 22, 28, 44); }
    const [, ry] = P(0, 0.09); g.fillStyle = '#121214'; g.fillRect(0, ry, 4096, 6);
  }, (g, P) => { g.fillStyle = '#000'; g.fillRect(0, 0, 4096, 4096); for (const s of [-1, 1]) { const [tx, ty] = P(s * 0.12, 0.12); g.fillStyle = '#6a0a06'; g.fillRect(tx - 14, ty - 22, 28, 44); } }));
  // roof light pod + antenna, mirrors
  const blk = mat(0x141416, 0.45, 0.3);
  const pod = lathe([[0.001, -0.07], [0.008, -0.07], [0.009, -0.066], [0.009, 0.066], [0.008, 0.07], [0.001, 0.07]], 12); pod.rotateX(Math.PI / 2);
  const pm = new THREE.Mesh(pod, blk); pm.position.set(0.02, 0.252, 0); shell.add(pm);
  const lens = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff0cc, emissiveIntensity: 1.1, roughness: 0.1 });
  for (let i = 0; i < 5; i++) { const d = new THREE.Mesh(new THREE.CircleGeometry(0.0055, 14).rotateY(Math.PI / 2), lens); d.position.set(0.0292, 0.252, -0.052 + i * 0.026); shell.add(d); }
  for (const s of [-1, 1]) {
    shell.add(bentTube([new THREE.Vector3(0.07, 0.16, s * 0.12), new THREE.Vector3(0.075, 0.172, s * 0.142)], 0.0022, 0, blk));
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.012, 14, 10), blk); head.scale.set(0.5, 0.75, 1); head.position.set(0.075, 0.178, s * 0.148); shell.add(head);
  }
}

export function createMonster(colors = MONSTER_COLORS, fitted: Partial<Record<MonsterSlot, string>> = {}): MonsterModel {
  const S: TruckSpec = Object.keys(fitted).length ? monsterSpecFor(fitted) : MONSTER_SPEC;
  const has = (id: string) => Object.values(fitted).includes(id);
  const p4 = has('mt-power-4s'), p6 = has('mt-power-6s'), bigBore = has('mt-shocks-bigbore'), soft = has('mt-tyres-soft'), mega = has('mt-tyres-mega');
  const root = new THREE.Group(); root.name = 'monster';
  const chassis = new THREE.Group(); root.add(chassis);
  const tube = new THREE.MeshPhysicalMaterial({ color: 0x1c1d20, roughness: 0.35, metalness: 0.6, clearcoat: 0.4 });
  const alu = mat(0xb9bec4, 0.3, 0.85), red = mat(0xc92a1f, 0.35, 0.5), blue = mat(0x2a6ad6, 0.35, 0.5), dark = mat(0x18191b, 0.6, 0.15);
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  // ---- tube chassis: side rails that kick up at the ends, shock hoops, body-mount cross tubes
  for (const s of [-1, 1]) {
    chassis.add(bentTube([V(0.28, 0.03, s * 0.06), V(0.2, -0.01, s * 0.07), V(-0.2, -0.01, s * 0.07), V(-0.27, 0.03, s * 0.06)], 0.0055, 0.03, tube));
    chassis.add(bentTube([V(0.22, 0.0, s * 0.07), V(0.15, 0.15, s * 0.09), V(0.08, 0.02, s * 0.07)], 0.0045, 0.02, tube));    // front shock hoop
    chassis.add(bentTube([V(-0.08, 0.02, s * 0.07), V(-0.15, 0.15, s * 0.09), V(-0.22, 0.0, s * 0.07)], 0.0045, 0.02, tube)); // rear shock hoop
    chassis.add(bentTube([V(0.15, 0.15, s * 0.09), V(0.0, 0.06, s * 0.075), V(-0.15, 0.15, s * 0.09)], 0.0035, 0.03, tube)); // top truss
  }
  for (const x of [0.25, 0.15, 0.0, -0.15, -0.25]) chassis.add(bentTube([V(x, x === 0.15 || x === -0.15 ? 0.15 : 0.0, -0.08), V(x, x === 0.15 || x === -0.15 ? 0.15 : 0.0, 0.08)], 0.004, 0, tube));
  // drivetrain + electronics: centre transmission, can motor with finned heatsink, battery, ESC, receiver
  const trans = new THREE.Mesh(roundedBox(0.075, 0.06, 0.06, 0.012), dark); trans.position.set(0.0, 0.01, 0); chassis.add(trans);
  const motorCol = p6 ? 0x8a8f96 : p4 ? 0x1f4fa8 : 0x3b3e44, finM = p6 ? mat(0xf07a1a, 0.35, 0.5) : p4 ? mat(0x2fa8d8, 0.35, 0.5) : red;
  const motor = new THREE.Mesh(lathe([[0.001, 0], [0.019, 0], [0.02, 0.004], [0.02, 0.05], [0.017, 0.055], [0.001, 0.055]], 22), mat(motorCol, 0.3, 0.8)); motor.rotation.z = -Math.PI / 2; motor.position.set(0.035, 0.04, 0); chassis.add(motor);
  if (p6) motor.scale.set(1.18, 1.1, 1.18);
  for (let i = 0; i < 6; i++) { const fin = new THREE.Mesh(new THREE.TorusGeometry(0.0205 * (p6 ? 1.18 : 1), 0.0015, 4, 20), finM); fin.rotation.y = Math.PI / 2; fin.position.set(0.045 + i * 0.007, 0.04, 0); chassis.add(fin); }
  const packM = p6 ? mat(0x2a2c30, 0.4, 0.2) : p4 ? mat(0x1f3f8a, 0.4, 0.2) : mat(0x1d1d1f, 0.45, 0.1);
  for (const z of p6 ? [-0.035, 0.035] : [-0.035]) { const bat = new THREE.Mesh(roundedBox(0.14, 0.026, 0.048, 0.006), packM); bat.position.set(-0.04, 0.035, z); chassis.add(bat); }
  const esc = new THREE.Mesh(roundedBox(0.04, 0.02, 0.035, 0.005), p4 || p6 ? mat(0x141416, 0.4, 0.3) : blue); esc.position.set(0.1, 0.03, 0.04); chassis.add(esc);
  if (p4 || p6) { // brushless ESC: finned heatsink + fan
    for (let i = 0; i < 5; i++) { const fin = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.008, 0.0015), alu); fin.position.set(0.1, 0.044, 0.026 + i * 0.007); chassis.add(fin); }
    const fan = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.004, 16), finM); fan.position.set(0.1, 0.05, 0.04); chassis.add(fan);
  }
  // air-control flywheel: a guarded disc on the chassis, spun from the wheel speed in pose()
  let flyDisc: THREE.Object3D | null = null;
  if (has('mt-fly-gyro')) {
    const g = new THREE.Group(); g.position.set(-0.03, 0.075, 0.0); g.rotation.x = Math.PI / 2; chassis.add(g);
    g.add(new THREE.Mesh(lathe([[0.034, -0.008], [0.036, -0.008], [0.036, 0.008], [0.034, 0.008]], 32), mat(0xc92a1f, 0.35, 0.5)));
    flyDisc = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.008, 28), mat(0xd2d6db, 0.2, 0.95));
    const mark = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.0085, 0.004), mat(0x141416, 0.5, 0.2)); flyDisc.add(mark);
    g.add(flyDisc);
  }
  // wheelie bar: two struts from the rear of the chassis to a pair of little wheels
  if (has('mt-bar')) {
    const by = -0.075 + 0.012; // roller centres (model frame; the sim's contact is the roller bottom)
    for (const z of [-0.05, 0.05]) {
      chassis.add(bentTube([V(-0.24, 0.0, z * 1.2), V(-0.42, by, z)], 0.0035, 0, alu));
      chassis.add(bentTube([V(-0.2, 0.06, z * 1.2), V(-0.41, by + 0.004, z)], 0.0028, 0, alu));
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.01, 18), mat(0x161616, 0.8, 0.1)); w.rotation.x = Math.PI / 2; w.position.set(-0.43, by, z * 1.25); chassis.add(w);
    }
    chassis.add(bentTube([V(-0.42, by, -0.05), V(-0.42, by, 0.05)], 0.003, 0, alu));
  }
  // driveshafts (re-aimed each frame)
  const driveF = new Rod(root, 0.004, alu), driveR = new Rod(root, 0.004, alu);
  // ---- body shell on posts
  const shell = new THREE.Group(); root.add(shell);
  buildBody(shell, colors);
  for (const x of [0.17, -0.17]) for (const s of [-1, 1]) chassis.add(bentTube([V(x, 0.0, s * 0.07), V(x, 0.07, s * 0.07)], 0.003, 0, alu));
  // ---- unsprung: wheels, axles, links, coil-overs, steering
  const tW = mega ? 0.098 : 0.088;
  const tGeo = monsterTire(S.wheelR, tW, mega ? 20 : 18); tGeo.rotateX(Math.PI / 2);
  const tireM = surface('rubber', { color: soft ? 0x1f1d1b : 0x161616, repeat: [2, 2], normalScale: 1.5 });
  const rimG = rimGeometry(S.wheelR * 0.56, tW - 0.008); rimG.rotateX(Math.PI / 2);
  const rimM = mega ? mat(0x1a1b1d, 0.3, 0.7) : soft ? mat(0xf2c230, 0.3, 0.7) : mat(0xc9ced4, 0.25, 0.9);
  const ring = new THREE.TorusGeometry(S.wheelR * 0.55, 0.004, 6, 32);
  const wheels: { steer: THREE.Group; spin: THREE.Group }[] = [];
  for (let i = 0; i < 4; i++) {
    const steer = new THREE.Group(); root.add(steer);
    const spin = new THREE.Group(); steer.add(spin);
    const out = new THREE.Group(); if (i % 2 === 0) out.rotation.y = Math.PI; spin.add(out);
    out.add(new THREE.Mesh(tGeo, tireM)); out.add(new THREE.Mesh(rimG, rimM));
    const rg = new THREE.Mesh(ring, mega ? mat(0xf07a1a, 0.35, 0.5) : red); rg.position.z = tW / 2 - 0.004; out.add(rg);
    for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; const b = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.002, 0.004, 6), alu); b.rotation.x = Math.PI / 2; b.position.set(Math.cos(a) * S.wheelR * 0.55, Math.sin(a) * S.wheelR * 0.55, tW / 2 - 0.001); out.add(b); }
    wheels.push({ steer, spin });
  }
  const axleM = mat(0x2a2c30, 0.4, 0.55);
  const axleTube = [new Rod(root, 0.011, axleM, 14), new Rod(root, 0.011, axleM, 14)];
  const pumpkin = [0, 1].map(() => {
    const g = new THREE.Group(); root.add(g);
    const p = new THREE.Mesh(lathe([[0.001, -0.02], [0.022, -0.016], [0.03, 0], [0.024, 0.018], [0.012, 0.024], [0.001, 0.024]], 20), axleM); p.rotation.x = Math.PI / 2; g.add(p);
    const cover = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.006, 18), alu); cover.rotation.x = Math.PI / 2; cover.position.z = -0.022; g.add(cover);
    return g;
  });
  const links: Rod[] = []; for (let i = 0; i < 8; i++) links.push(new Rod(root, 0.0035, alu));
  const coilPts: THREE.Vector3[] = [];
  for (let k = 0; k <= 200; k++) { const t = k / 200, a = t * Math.PI * 2 * 11; coilPts.push(new THREE.Vector3(Math.cos(a) * 0.012, t, Math.sin(a) * 0.012)); }
  const springGeo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(coilPts), 200, 0.0018, 5, false);
  const shockBody: Rod[] = [], shockShaft: Rod[] = [], spring: Rod[] = [];
  for (let i = 0; i < 4; i++) {
    shockBody.push(new Rod(root, bigBore ? 0.0105 : 0.0075, bigBore ? mat(0xc9a23a, 0.25, 0.85) : i < 2 ? red : blue, 14));
    shockShaft.push(new Rod(root, 0.0028, alu));
    spring.push(new Rod(root, 0, mat(0xf2c230, 0.35, 0.6), 0, springGeo));
  }
  const tieRod = new Rod(root, 0.003, alu);
  const dual = has('mt-steer-dual');
  const servo = new THREE.Mesh(roundedBox(0.035, 0.02, 0.02, 0.004), dual ? mat(0x1f4fa8, 0.35, 0.6) : dark); root.add(servo);
  const servo2 = dual ? new THREE.Mesh(roundedBox(0.035, 0.02, 0.02, 0.004), mat(0x1f4fa8, 0.35, 0.6)) : null; if (servo2) root.add(servo2);

  const MY = S.mountY - MONSTER_CG_DROP; // mounts in the model's own frame
  const mounts = [V(S.wheelbase / 2, MY, -S.track / 2), V(S.wheelbase / 2, MY, S.track / 2), V(-S.wheelbase / 2, MY, -S.track / 2), V(-S.wheelbase / 2, MY, S.track / 2)];
  const centres = [0, 1, 2, 3].map(() => new THREE.Vector3());
  let rearSteer = 0;
  function poseLocal(susp: number[], spin: number[], steer: number) {
    for (let i = 0; i < 4; i++) {
      centres[i].copy(mounts[i]).y -= susp[i];
      wheels[i].steer.position.copy(centres[i]);
      wheels[i].steer.rotation.y = i < 2 ? -steer : steer * rearSteer;
      wheels[i].spin.rotation.z = -spin[i];
    }
    for (let a = 0; a < 2; a++) {
      const L = centres[a * 2], R = centres[a * 2 + 1];
      axleTube[a].aim(L.clone().lerp(R, 0.1), R.clone().lerp(L, 0.1));
      const mid = L.clone().lerp(R, 0.45);
      pumpkin[a].position.copy(mid);
      pumpkin[a].quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), R.clone().sub(L).normalize());
      const sx = a === 0 ? 1 : -1;
      for (let k = 0; k < 4; k++) {
        const side = k % 2 ? 1 : -1, upper = k >= 2;
        const onAxle = L.clone().lerp(R, 0.5 + side * (upper ? 0.12 : 0.24)).add(V(0, upper ? 0.022 : -0.016, 0));
        const onFrame = V(sx * (upper ? 0.07 : 0.05), upper ? 0.05 : -0.01, side * (upper ? 0.03 : 0.06));
        links[a * 4 + k].aim(onAxle, onFrame);
      }
      (a === 0 ? driveF : driveR).aim(V(sx * 0.035, 0.0, 0), mid);
    }
    for (let i = 0; i < 4; i++) {
      const sx = i < 2 ? 1 : -1, sz = i % 2 ? 1 : -1;
      const topP = V(sx * 0.15, 0.15, sz * 0.09);
      const axleEnd = centres[i].clone().lerp(centres[i ^ 1], 0.14).add(V(-sx * 0.02, 0.018, 0));
      const mid = topP.clone().lerp(axleEnd, 0.55);
      shockBody[i].aim(topP, mid); shockShaft[i].aim(mid, axleEnd);
      spring[i].aim(topP.clone().lerp(axleEnd, 0.08), topP.clone().lerp(axleEnd, 0.86));
    }
    const fl = centres[0], fr = centres[1];
    servo.position.copy(fl.clone().lerp(fr, 0.62)).add(V(0.02, 0.035, 0));
    if (servo2) servo2.position.copy(fl.clone().lerp(fr, 0.38)).add(V(0.02, 0.035, 0));
    if (flyDisc) flyDisc.rotation.y = (spin[2] + spin[3]) * 2.5;
    tieRod.aim(fl.clone().lerp(fr, 0.08).add(V(0.03, 0.01, 0)), fr.clone().lerp(fl, 0.08).add(V(0.03, 0.01, 0)));
  }
  const restR = S.restLen + S.travel * 0.25;
  const rest = () => poseLocal([restR, restR, restR, restR], [0, 0, 0, 0], 0);
  rest();
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  // fewer draw calls: merge the rigid chassis, body and wheel assemblies (the flywheel disc keeps spinning on its own)
  batchStatic(chassis, (o) => o === flyDisc); batchStatic(shell, () => false);
  for (const w of wheels) batchStatic(w.spin, () => false);
  return {
    root,
    pose(sim) { root.quaternion.copy(sim.q); root.position.set(0, MONSTER_CG_DROP, 0).applyQuaternion(sim.q).add(sim.pos); rearSteer = sim.rearSteerNow ?? 0; poseLocal(sim.susp, sim.spin, sim.steer); },
    rest,
    restHeight: -(MY - restR - S.wheelR),
  };
}
