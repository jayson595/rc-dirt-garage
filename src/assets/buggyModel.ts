// Procedural 1/8 off-road buggy. PLACEHOLDER: every part is its own named group so a finished
// GLTF model can replace it piece by piece (keep the same part ids and wheel pivots).
// Nose points along +x. Origin is on the ground under the chassis centre. Size ≈ 0.5 m long.
import * as THREE from 'three';
import { batchStatic } from './staticBatch';
import { BUGGY_CLASSES, BuggyId, PartId, TIRE_COMPOUNDS, TireCompound } from '../data/specs';
import { buildSCTBody, buildStadiumBody } from './buggyBodies';
import { ParametricGeometry } from 'three/examples/jsm/geometries/ParametricGeometry.js';
import { rimGeometry, roundedBox, surface, tireGeometry } from './materials';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { bakeGeometry, matKey } from './staticBatch';

export interface WheelRig { steer: THREE.Group; spin: THREE.Group; stripe: THREE.MeshStandardMaterial }

export interface BuggyModel {
  root: THREE.Group;
  body: THREE.Group;           // sprung mass (pitches/rolls/dips)
  shell: THREE.Group;
  wheels: WheelRig[];          // fl, fr, rl, rr
  parts: Map<PartId, THREE.Mesh[]>;
  batteryMesh: THREE.Mesh;
  setShell(on: boolean): void;
  setTires(c: TireCompound, condition: number): void;
  setBatteryVisible(v: boolean): void;
  highlight(part: PartId | null, t: number): void;
  /** For the driven car only: merge the rigid body into a few meshes (no more picking/highlighting). */
  freeze(): void;
}

export const WHEEL_RADIUS = 0.06;

/** Geometry of each buggy-class vehicle in "1/8 units" (the Dirt Dart's frame); the whole model is then
 *  scaled by k. Wheel centres sit at (±hx, r, ±tz). */
export interface BuggyLayout {
  k: number; hx: number; tz: number;
  rF: number; rR: number; wF: number; wR: number;
  treadF: 'pin' | 'rib' | 'block' | 'stadium'; treadR: 'pin' | 'block' | 'stadium';
  ride: number;          // extra chassis height above the stock buggy (trucks sit higher)
  tower: number;         // shock tower height scale
  body: 'buggy' | '2wd' | 'truggy' | 'sct' | 'stadium';
  wing: 'buggy' | 'small' | 'big' | 'stadium' | 'none';
  drive: '4wd' | '2wd';
}
export const BUGGY_LAYOUTS: Record<BuggyId, BuggyLayout> = {
  buggy:    { k: 1,    hx: 0.165, tz: 0.125, rF: 0.06,  rR: 0.06,  wF: 0.046, wR: 0.046, treadF: 'pin', treadR: 'pin', ride: 0, tower: 1, body: 'buggy', wing: 'buggy', drive: '4wd' },
  buggy2wd: { k: 0.82, hx: 0.175, tz: 0.124, rF: 0.053, rR: 0.058, wF: 0.03, wR: 0.052, treadF: 'rib', treadR: 'pin', ride: 0, tower: 1.05, body: '2wd', wing: 'small', drive: '2wd' },
  stadium:  { k: 0.86, hx: 0.17,  tz: 0.157, rF: 0.072, rR: 0.072, wF: 0.058, wR: 0.062, treadF: 'stadium', treadR: 'stadium', ride: 0.018, tower: 1.35, body: 'stadium', wing: 'stadium', drive: '2wd' },
  sct:      { k: 0.9,  hx: 0.18,  tz: 0.142, rF: 0.068, rR: 0.068, wF: 0.055, wR: 0.055, treadF: 'block', treadR: 'block', ride: 0.02, tower: 1.3, body: 'sct', wing: 'none', drive: '4wd' },
  truggy:   { k: 1,    hx: 0.195, tz: 0.16,  rF: 0.076, rR: 0.076, wF: 0.066, wR: 0.066, treadF: 'pin', treadR: 'pin', ride: 0.02, tower: 1.35, body: 'truggy', wing: 'big', drive: '4wd' },
};

/** How a particular car looks: paint, livery and the visible hop-ups. */
export interface BuggyLook { body: number; accent: number; livery: number; motor: 0 | 1 | 2; bigBore: boolean; sway: boolean }
export function lookFor(v: { id: BuggyId; paint?: { body: number; accent: number; livery: number }; fitted?: Record<string, string> }): BuggyLook {
  const f = v.fitted ?? {};
  return {
    body: v.paint?.body ?? BUGGY_CLASSES[v.id].color, accent: v.paint?.accent ?? BUGGY_CLASSES[v.id].accent, livery: v.paint?.livery ?? 0,
    motor: f.motor === 'motor-pro' ? 2 : f.motor === 'motor-sport' ? 1 : 0,
    bigBore: f.shocks === 'shocks-bigbore', sway: f.chassis === 'chassis-sway' || f.chassis === 'chassis-alloy',
  };
}
export const lookKey = (cls: BuggyId, l: BuggyLook) => `${cls}|${l.body}|${l.accent}|${l.livery}|${l.motor}|${+l.bigBore}|${+l.sway}`;

export function createBuggy(cls_: BuggyId = 'buggy', lookIn?: Partial<BuggyLook>): BuggyModel {
  const L = BUGGY_LAYOUTS[cls_];
  const look: BuggyLook = { ...lookFor({ id: cls_ }), ...lookIn };
  const colors = { body: look.body, accent: look.accent };
  const livery = look.livery;
  const root = new THREE.Group();
  root.name = 'buggy';
  root.userData.buggyClass = cls_;
  root.userData.lookKey = lookKey(cls_, look);
  root.scale.setScalar(L.k);
  const body = new THREE.Group();
  body.name = 'buggy-body';
  root.add(body);
  // everything sprung is built in the stock buggy's frame inside this group, lifted for bigger wheels / ride
  const ch = new THREE.Group();
  ch.name = 'buggy-chassis';
  ch.position.y = (Math.max(L.rF, L.rR) - 0.06) + L.ride;
  body.add(ch);
  const HX = L.hx, TZ = L.tz, TOW = L.tower, RMAX = Math.max(L.rF, L.rR);
  /** Wheel-centre height in the chassis frame for the front (sx = 1) or rear axle. */
  const hubY = (sx: number) => (sx > 0 ? L.rF : L.rR) - RMAX + 0.06 - L.ride;
  const towerTop = 0.044 + 0.046 * TOW;
  const parts = new Map<PartId, THREE.Mesh[]>();

  const mat = (color: number, rough = 0.6, metal = 0.1) =>
    new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });

  const rb = (w: number, h: number, d: number) => roundedBox(w, h, d, Math.min(w, h, d) * 0.3);
  const add = (part: PartId, geo: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D, pos: [number, number, number], rot?: [number, number, number]) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(...pos);
    if (rot) mesh.rotation.set(...rot);
    mesh.castShadow = true;
    mesh.userData.partId = part;
    parent.add(mesh);
    if (!parts.has(part)) parts.set(part, []);
    parts.get(part)!.push(mesh);
    return mesh;
  };

  // --- chassis: woven-carbon plate with lightening slots, side guards, carbon towers, moulded A-arms
  const carbon = surface('fabric', { color: 0x2e2e33, roughness: 0.42, metalness: 0.25, repeat: [26, 8], normalScale: 0.5 });
  const alu = mat(0x9aa0a8, 0.35, 0.7);
  const nylon = surface('plastic', { color: 0x1c1c1e, roughness: 0.55 });
  /** Flat part from a plan-view shape (x forward, y = z sideways), `t` thick, bottom at y = 0. */
  const plan = (shape: THREE.Shape, t: number, bevel = 0.0015) => {
    const g = new THREE.ExtrudeGeometry(shape, { depth: t - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 10 });
    g.translate(0, 0, bevel); g.rotateX(-Math.PI / 2); g.computeVertexNormals();
    return g;
  };
  /** Upright part from a side shape (u = sideways z, v = up), `t` thick along x. */
  const upright = (shape: THREE.Shape, t: number, bevel = 0.0012) => {
    const g = new THREE.ExtrudeGeometry(shape, { depth: t - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 10 });
    g.translate(0, 0, -t / 2 + bevel); g.rotateY(Math.PI / 2); g.computeVertexNormals();
    return g;
  };
  const slot = (cx: number, cz: number, l: number, w: number) => {
    const p = new THREE.Path();
    p.absarc(cx - l / 2, cz, w / 2, Math.PI / 2, Math.PI * 1.5, false);
    p.absarc(cx + l / 2, cz, w / 2, -Math.PI / 2, Math.PI / 2, false);
    return p;
  };
  const plate = new THREE.Shape();
  plate.moveTo(0.215, -0.034); plate.quadraticCurveTo(0.2, -0.055, 0.165, -0.056); plate.lineTo(-0.17, -0.056);
  plate.quadraticCurveTo(-0.2, -0.054, -0.202, -0.04); plate.lineTo(-0.202, 0.04); plate.quadraticCurveTo(-0.2, 0.054, -0.17, 0.056);
  plate.lineTo(0.165, 0.056); plate.quadraticCurveTo(0.2, 0.055, 0.215, 0.034); plate.lineTo(0.215, -0.034);
  for (const x of [-0.13, -0.075, 0.075, 0.13]) for (const z of [-0.046, 0.046]) plate.holes.push(slot(x, z, 0.028, 0.008));
  add('chassis', plan(plate, 0.006), carbon, ch, [0, 0.035, 0]);
  for (const z of [-0.056, 0.056]) add('chassis', rb(0.3, 0.012, 0.004), nylon, ch, [0, 0.046, z]); // side guards
  // front bumper: moulded wedge
  const bump = new THREE.Shape();
  bump.moveTo(0, -0.045); bump.quadraticCurveTo(0.04, -0.045, 0.045, -0.02); bump.lineTo(0.045, 0.02); bump.quadraticCurveTo(0.04, 0.045, 0, 0.045); bump.lineTo(0, -0.045);
  add('chassis', plan(bump, 0.018, 0.004), nylon, ch, [HX + 0.035, 0.04, 0]);
  // shock towers with mounting holes
  const tower = new THREE.Shape();
  tower.moveTo(-0.048, 0); tower.lineTo(0.048, 0); tower.lineTo(0.066, 0.04); tower.quadraticCurveTo(0.068, 0.05, 0.06, 0.051);
  tower.lineTo(-0.06, 0.051); tower.quadraticCurveTo(-0.068, 0.05, -0.066, 0.04); tower.lineTo(-0.048, 0);
  for (const u of [-0.045, -0.03, 0.03, 0.045]) { const h = new THREE.Path(); h.absarc(u, 0.042, 0.0028, 0, Math.PI * 2, true); tower.holes.push(h); }
  { const h = new THREE.Path(); h.absarc(0, 0.022, 0.012, 0, Math.PI * 2, true); tower.holes.push(h); }
  const towerGeo = upright(tower, 0.007); towerGeo.scale(1, TOW, 1);
  const armLen = TZ - 0.125 + 0.078;
  for (const sx of [1, -1]) {
    add('chassis', towerGeo, carbon, ch, [sx * (HX - 0.025), 0.044, 0]);
    for (const sz of [1, -1]) {
      // A-arm (plan view), mirrored per side; pivot pin along the chassis edge
      const arm = new THREE.Shape();
      arm.moveTo(-0.032, 0); arm.lineTo(0.032, 0); arm.lineTo(0.012, sz * 0.07); arm.quadraticCurveTo(0, sz * 0.078, -0.012, sz * 0.07); arm.lineTo(-0.032, 0);
      const hole = new THREE.Path(); hole.moveTo(-0.016, sz * 0.012); hole.lineTo(0.016, sz * 0.012); hole.lineTo(0, sz * 0.05); hole.lineTo(-0.016, sz * 0.012);
      arm.holes.push(hole);
      const armGeo = plan(arm, 0.008); armGeo.scale(1, 1, armLen / 0.078);
      const drop = 0.052 - hubY(sx);   // arms angle down to the hubs on the taller trucks
      add('chassis', armGeo, nylon, ch, [sx * HX, 0.047, sz * 0.05], [sz * Math.atan2(drop, armLen), 0, 0]);
      add('chassis', new THREE.CylinderGeometry(0.003, 0.003, 0.07, 8), alu, ch, [sx * HX, 0.051, sz * 0.05], [0, 0, Math.PI / 2]);
      // hub carrier at the outer end
      add('chassis', new THREE.CylinderGeometry(0.013, 0.013, 0.018, 14), nylon, ch, [sx * HX, hubY(sx) - 0.004, sz * (TZ - 0.013)], [Math.PI / 2, 0, 0]);
    }
  }
  add('chassis', new THREE.CylinderGeometry(0.0055, 0.0055, 2 * (HX - 0.03), 12), alu, ch, [0, 0.086, 0], [0, 0, Math.PI / 2]); // top brace
  for (const x of [-0.11, 0.11]) add('chassis', rb(0.012, 0.042, 0.012), alu, ch, [x, 0.063, 0]); // brace posts

  // --- drivetrain + electronics
  const blueAno = mat([0x2b6fd6, 0xc0322a, 0xd4a62a][look.motor], 0.3, 0.75);
  const lathe = (pts: [number, number][], seg = 20) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);
  // brushless motor: lathed can with cooling fins, endbell and solder tabs (axis along x)
  add('motor', lathe([[0.001, -0.031], [0.016, -0.031], [0.02, -0.027], [0.02, 0.025], [0.018, 0.029], [0.018, 0.032], [0.008, 0.034], [0.001, 0.034]], 24), blueAno, ch, [-0.07, 0.065, 0.035], [0, 0, Math.PI / 2]);
  for (let i = 0; i < 5; i++) add('motor', new THREE.TorusGeometry(0.0205, 0.0022, 5, 24), blueAno, ch, [-0.088 + i * 0.009, 0.065, 0.035], [0, Math.PI / 2, 0]);
  add('motor', new THREE.CylinderGeometry(0.012, 0.012, 0.012, 16), alu, ch, [-0.034, 0.065, 0.035], [0, 0, Math.PI / 2]);
  for (let i = 0; i < 3; i++) add('motor', rb(0.006, 0.008, 0.004), mat(0xc9a23a, 0.35, 0.8), ch, [-0.105, 0.072 - i * 0.007, 0.035 + (i - 1) * 0.008]);
  // ESC: case, finned heatsink, fan, power switch
  add('esc', rb(0.045, 0.02, 0.04), mat(0xc0322a, 0.5), ch, [0.035, 0.054, 0.04]);
  for (let i = 0; i < 6; i++) add('esc', rb(0.04, 0.008, 0.0025), mat(0xb8bec6, 0.3, 0.85), ch, [0.035, 0.068, 0.025 + i * 0.006]);
  add('esc', new THREE.TorusGeometry(0.011, 0.0022, 6, 20), mat(0x111111, 0.5), ch, [0.035, 0.074, 0.04], [Math.PI / 2, 0, 0]);
  add('esc', new THREE.CylinderGeometry(0.004, 0.004, 0.004, 10), mat(0x111111, 0.5), ch, [0.035, 0.074, 0.04]);
  for (let i = 0; i < 2; i++) add('esc', rb(0.02, 0.0015, 0.004), mat(0x111111, 0.5), ch, [0.035, 0.0745, 0.04], [0, i * Math.PI / 2 + 0.4, 0]);
  add('esc', rb(0.012, 0.008, 0.016), mat(0x111111, 0.5), ch, [0.06, 0.05, 0.07]);
  // battery: hard case + printed wrap
  const batteryMesh = add('battery', rb(0.15, 0.026, 0.045), mat(0x1d1d1d, 0.45), ch, [0.0, 0.055, -0.038]);
  add('battery', rb(0.152, 0.008, 0.047), mat(0xd63a2f, 0.5), ch, [0.0, 0.061, -0.038]);
  // servo with mounting ears and a servo saver
  add('servo', rb(0.03, 0.026, 0.02), mat(0x151515, 0.5), ch, [0.1, 0.055, 0.0]);
  add('servo', rb(0.04, 0.004, 0.021), mat(0x151515, 0.5), ch, [0.1, 0.063, 0.0]);
  add('servo', new THREE.CylinderGeometry(0.008, 0.008, 0.006, 14), mat(0xc0322a, 0.5), ch, [0.108, 0.071, 0.0]);
  add('servo', rb(0.006, 0.004, 0.03), mat(0xc0322a, 0.5), ch, [0.108, 0.074, 0.0]);
  // spur gear (moulded teeth, lightening holes) + steel pinion
  const spur = new THREE.Shape();
  const T = 40;
  for (let i = 0; i <= T * 2; i++) {
    const a = (i / (T * 2)) * Math.PI * 2, r = i % 2 ? 0.0262 : 0.0242;
    if (i === 0) spur.moveTo(Math.cos(a) * r, Math.sin(a) * r); else spur.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  for (let i = 0; i < 5; i++) { const h = new THREE.Path(); const a = (i / 5) * Math.PI * 2; h.absarc(Math.cos(a) * 0.014, Math.sin(a) * 0.014, 0.005, 0, Math.PI * 2, true); spur.holes.push(h); }
  { const h = new THREE.Path(); h.absarc(0, 0, 0.003, 0, Math.PI * 2, true); spur.holes.push(h); }
  const spurGeo = new THREE.ExtrudeGeometry(spur, { depth: 0.005, bevelEnabled: false, curveSegments: 4 });
  spurGeo.translate(0, 0, -0.0025);
  add('gears', spurGeo, surface('plastic', { color: 0xe9e4d8, roughness: 0.45 }), ch, [-0.02, 0.07, 0.03]);
  add('gears', new THREE.CylinderGeometry(0.008, 0.008, 0.008, 12), mat(0xb8bec6, 0.3, 0.9), ch, [-0.045, 0.07, 0.035], [Math.PI / 2, 0, 0]);
  // gearboxes: lathed bell housings on moulded mounts (axle along z)
  const diffMat = surface('plastic', { color: 0x3c3f45, roughness: 0.5 });
  const bell = lathe([[0.006, -0.032], [0.013, -0.031], [0.019, -0.022], [0.021, 0.0], [0.019, 0.02], [0.013, 0.03], [0.006, 0.032]], 20);
  bell.rotateX(Math.PI / 2);
  for (const x of [HX + 0.005, -HX - 0.005]) {
    add('diff', bell, diffMat, ch, [x, 0.062, 0]);
    add('diff', rb(0.04, 0.018, 0.042), diffMat, ch, [x, 0.049, 0]);
  }
  add('diff', lathe([[0.005, -0.016], [0.012, -0.015], [0.015, 0], [0.012, 0.015], [0.005, 0.016]], 16).rotateX(Math.PI / 2), diffMat, ch, [0.02, 0.05, -0.0]);
  // drive shaft
  if (L.drive === '4wd') add('diff', new THREE.CylinderGeometry(0.004, 0.004, 2 * HX + 0.01, 8), alu, ch, [0, 0.05, 0.0], [0, 0, Math.PI / 2]);

  // --- shocks: threaded blue bodies with caps, adjuster collars, chrome shafts, gold springs with
  // retainer cups, rod ends and mounting bolts (each shock is built along its own axis)
  const shockBodyMat = mat(look.bigBore ? 0x5d636b : 0x2a63d4, 0.25, 0.85);
  const springMat = mat(0xd4a62a, 0.32, 0.75);
  const chrome = mat(0xe2e5e8, 0.12, 1);
  const black = mat(0x141416, 0.5, 0.1);
  const lathe0 = (pts: [number, number][], seg = 16) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);
  const shockBodyGeo = lathe0([[0.001, -0.004], [0.0092, -0.004], [0.0096, -0.006], [0.0096, -0.009], [0.0084, -0.0095], [0.0084, -0.031], [0.0078, -0.034], [0.003, -0.035], [0.001, -0.035]], 18);
  for (const sx of [1, -1]) for (const sz of [1, -1]) {
    const top = new THREE.Vector3(sx * (HX - 0.022), towerTop, sz * 0.045);
    const bot = new THREE.Vector3(sx * HX, hubY(sx) - 0.004, sz * (TZ - 0.039));
    const len = top.distanceTo(bot);
    const sh = new THREE.Group();
    sh.position.copy(top);
    sh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), top.clone().sub(bot).normalize());
    ch.add(sh);
    add('shocks', new THREE.TorusGeometry(0.0038, 0.0014, 6, 12), black, sh, [0, 0, 0]);                     // top rod end
    add('shocks', new THREE.CylinderGeometry(0.0098, 0.0098, 0.004, 18), mat(0xd63a2f, 0.3, 0.75), sh, [0, -0.005, 0]); // cap
    add('shocks', look.bigBore ? shockBodyGeo.clone().scale(1.35, 1, 1.35) : shockBodyGeo, shockBodyMat, sh, [0, -0.003, 0]);
    add('shocks', new THREE.CylinderGeometry(0.0102, 0.0102, 0.003, 18), mat(0xb8bec6, 0.25, 0.9), sh, [0, -0.015, 0]); // adjuster collar
    add('shocks', new THREE.CylinderGeometry(0.0118, 0.0118, 0.0014, 18), springMat, sh, [0, -0.0168, 0]);              // upper cup
    add('shocks', new THREE.CylinderGeometry(0.0023, 0.0023, len - 0.04, 10), chrome, sh, [0, -0.038 - (len - 0.04) / 2 + 0.002, 0]); // shaft
    add('shocks', new THREE.CylinderGeometry(0.0112, 0.0112, 0.0014, 18), springMat, sh, [0, -len + 0.007, 0]);         // lower cup
    const springLen = len - 0.025;
    const hm = add('shocks', new THREE.TubeGeometry(new HelixCurve(0.0106, springLen, 7), 70, 0.0017, 6, false), springMat, sh, [0, -0.0168 - springLen / 2 + 0.001, 0]);
    hm.castShadow = false;
    add('shocks', new THREE.CapsuleGeometry(0.0034, 0.004, 4, 8), black, sh, [0, -len + 0.003, 0]);                     // lower rod end
    // mounting bolts through the tower and the arm
    add('chassis', new THREE.CylinderGeometry(0.0022, 0.0022, 0.014, 8), chrome, ch, [top.x, top.y, top.z], [0, 0, Math.PI / 2]);
    add('chassis', new THREE.CylinderGeometry(0.0022, 0.0022, 0.012, 8), chrome, ch, [bot.x, bot.y, bot.z], [0, 0, Math.PI / 2]);
  }

  /** Rod between two points with ball rod-ends (turnbuckles, steering links, camber links). */
  const link = (part: PartId, a: THREE.Vector3, b: THREE.Vector3, r = 0.0022, m: THREE.Material = mat(0xb8bec6, 0.25, 0.9)) => {
    const l = add(part, new THREE.CylinderGeometry(r, r, a.distanceTo(b) - 0.008, 8), m, ch, [(a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2]);
    l.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    for (const p of [a, b]) add(part, new THREE.SphereGeometry(0.0042, 10, 8), black, ch, [p.x, p.y, p.z]);
  };
  for (const sx of [1, -1]) for (const sz of [1, -1]) {
    // camber link from the tower to the top of the hub carrier
    link('chassis', new THREE.Vector3(sx * (HX - 0.028), 0.044 + 0.04 * TOW, sz * 0.012), new THREE.Vector3(sx * (HX - 0.002), hubY(sx) + 0.009, sz * (TZ - 0.025)));
    if (sx > 0 && L.drive === '2wd') continue; // 2WD: no front drive shafts
    // dogbone drive shaft with rubber boot from the gearbox out to the wheel
    const d0 = new THREE.Vector3(sx * (HX + 0.005), 0.062, sz * 0.032), d1 = new THREE.Vector3(sx * (HX + 0.001), hubY(sx), sz * (TZ - 0.021));
    const ds = add('diff', new THREE.CylinderGeometry(0.0028, 0.0028, d0.distanceTo(d1), 10), mat(0x6d7178, 0.3, 0.9), ch, [(d0.x + d1.x) / 2, (d0.y + d1.y) / 2, (d0.z + d1.z) / 2]);
    ds.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d1.clone().sub(d0).normalize());
    const boot = add('diff', lathe0([[0.003, 0], [0.0075, 0.002], [0.0062, 0.004], [0.0078, 0.006], [0.0062, 0.008], [0.0074, 0.01], [0.003, 0.013]], 14), black, ch, [d0.x, d0.y, d0.z + sz * 0.004]);
    boot.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d1.clone().sub(d0).normalize());
  }
  // sway bars (hop-up): a bent spring-steel wire across each end, linked down to the arms
  if (look.sway) {
    const wire = mat(0xc8ccd2, 0.25, 0.95);
    for (const sx of [1, -1]) {
      const x = sx * (HX - 0.05);
      const pts = [new THREE.Vector3(x - sx * 0.02, 0.05, -0.05), new THREE.Vector3(x, 0.05, -0.04), new THREE.Vector3(x, 0.05, 0.04), new THREE.Vector3(x - sx * 0.02, 0.05, 0.05)];
      add('chassis', new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.0016, 6, false), wire, ch, [0, 0, 0]);
      for (const sz of [1, -1]) link('chassis', new THREE.Vector3(x - sx * 0.02, 0.05, sz * 0.05), new THREE.Vector3(sx * HX - sx * 0.01, 0.052, sz * (0.05 + (TZ - 0.125) * 0.5 + 0.03)), 0.0012, wire);
    }
  }
  // countersunk chassis screws round the plate, towers and bumper (one merged mesh)
  {
    const heads: THREE.BufferGeometry[] = [];
    const spots: [number, number][] = [];
    for (const x of [-0.19, -0.105, -0.02, 0.06, 0.15, 0.2]) for (const z of [-0.05, 0.05]) spots.push([x, z]);
    for (const sx of [1, -1]) for (const z of [-0.035, 0.035]) spots.push([sx * 0.128, z]);
    for (const [x, z] of spots) {
      heads.push(new THREE.CylinderGeometry(0.0029, 0.0024, 0.0012, 10).translate(x, 0.0416, z));
    }
    const merged = mergeGeometries(heads)!;
    add('chassis', merged, mat(0x3a3d42, 0.35, 0.9), ch, [0, 0, 0]);
    const sockets: THREE.BufferGeometry[] = spots.map(([x, z]) => new THREE.CylinderGeometry(0.0012, 0.0012, 0.0004, 6).translate(x, 0.0423, z));
    add('chassis', mergeGeometries(sockets)!, black, ch, [0, 0, 0]);
  }
  // centre brake disc + caliper on the centre diff
  add('diff', new THREE.CylinderGeometry(0.014, 0.014, 0.0016, 24), mat(0xb8bec6, 0.3, 0.95), ch, [0.02, 0.05, -0.022], [Math.PI / 2, 0, 0]);
  add('diff', rb(0.012, 0.012, 0.008), mat(0xd63a2f, 0.4, 0.4), ch, [0.02, 0.063, -0.022]);
  // ESC capacitor bank
  for (const dz of [0.0, 0.009]) {
    add('esc', new THREE.CylinderGeometry(0.0045, 0.0045, 0.016, 12), mat(0x1d1d22, 0.5), ch, [0.066, 0.056, 0.026 + dz], [0, 0, Math.PI / 2]);
    add('esc', new THREE.CylinderGeometry(0.0046, 0.0046, 0.0016, 12), mat(0xb8bec6, 0.3, 0.9), ch, [0.075, 0.056, 0.026 + dz], [0, 0, Math.PI / 2]);
  }
  // receiver lid + bound-status LED
  add('esc', rb(0.026, 0.003, 0.022), mat(0x3a3d42, 0.45), ch, [0.095, 0.0595, -0.04]);
  add('esc', new THREE.SphereGeometry(0.0016, 6, 4), new THREE.MeshStandardMaterial({ color: 0x46ff7a, emissive: 0x2bd45a, emissiveIntensity: 1 }), ch, [0.083, 0.06, -0.033]);

  // --- details that make the chassis read as a hobby-grade buggy with the body off
  const strapMat = mat(0x111111, 0.85);
  for (const x of [-0.045, 0.045]) add('battery', rb(0.012, 0.032, 0.054), strapMat, ch, [x, 0.058, -0.038]);
  // receiver + antenna tube
  add('esc', rb(0.03, 0.02, 0.026), mat(0x2a2a2e, 0.5), ch, [0.095, 0.048, -0.04]);
  // antenna tube pokes up through the body, as on a real car
  add('esc', new THREE.CylinderGeometry(0.0022, 0.0022, 0.06, 6), mat(0x111111, 0.5), ch, [0.09, 0.085, -0.035]);
  add('esc', new THREE.SphereGeometry(0.0035, 8, 6), mat(0xd63a2f, 0.5), ch, [0.09, 0.116, -0.035]);
  // power + motor wires (red/black), routed between battery, ESC and motor
  const wire = (pts: [number, number, number][], color: number) => {
    const curve = new THREE.CatmullRomCurve3(pts.map((q) => new THREE.Vector3(...q)));
    add('esc', new THREE.TubeGeometry(curve, 16, 0.0028, 5, false), mat(color, 0.6), ch, [0, 0, 0]);
  };
  wire([[0.075, 0.06, -0.03], [0.07, 0.075, 0.0], [0.04, 0.07, 0.025]], 0xc0322a);
  wire([[0.075, 0.056, -0.045], [0.065, 0.07, -0.005], [0.03, 0.068, 0.025]], 0x111111);
  for (const [dz, c] of [[0.0, 0x2b6fd6], [0.01, 0x1d1d1d], [0.02, 0xc9a23a]] as const) wire([[0.015, 0.065, 0.035 + dz * 0.3], [-0.01, 0.08, 0.04 + dz], [-0.04, 0.072, 0.03 + dz]], c);
  wire([[0.095, 0.058, 0.0], [0.1, 0.064, -0.015], [0.095, 0.056, -0.028]], 0x8a6a2a);
  // steering links (turnbuckles) from the servo saver to the front hubs
  for (const sz of [1, -1]) link('servo', new THREE.Vector3(0.108, 0.064, 0.0), new THREE.Vector3(HX - 0.002, hubY(1) - 0.002, sz * (TZ - 0.025)), 0.0025);
  // battery strap buckles
  for (const x of [-0.045, 0.045]) add('battery', rb(0.014, 0.004, 0.012), mat(0xb8bec6, 0.3, 0.9), ch, [x, 0.075, -0.012]);
  // body posts + clips (stay with the chassis when the shell is off)
  for (const [x, h] of [[0.095, 0.04], [-0.108, 0.052]] as const) {
    add('chassis', new THREE.CylinderGeometry(0.004, 0.004, h, 6), mat(0x222222, 0.5), ch, [x, 0.04 + h / 2, 0]);
    add('chassis', new THREE.TorusGeometry(0.008, 0.0018, 4, 10), mat(0xc8ccd2, 0.25, 0.9), ch, [x, 0.035 + h, 0.006], [0, Math.PI / 2, 0]);
  }

  // --- shell: a modern 1/8 race body — long, low, cab-forward. It starts just behind the front shock tower
  // and ends just ahead of the rear one (both towers and the shocks stay exposed, as on the real thing).
  // Wide side pods over the electronics, a waist before the rear wheels, a moulded cockpit pod with painted
  // windows, a raised engine deck and an open tail cut-out. The wing is mounted to the chassis, not the body.
  const shell = new THREE.Group();
  shell.name = 'shell';
  ch.add(shell);
  if (L.body === 'buggy' || L.body === '2wd' || L.body === 'truggy') {
  const y0 = 0.044;
  type P2 = [number, number][];
  const PODS: Record<'buggy' | '2wd' | 'truggy', { XN: number; XT: number; W: P2; Hp: P2; Hs: P2; Sw: P2 }> = {
    buggy: { XN: 0.132, XT: -0.135,
      W: [[0.132, 0.02], [0.12, 0.045], [0.1, 0.062], [0.075, 0.078], [0.04, 0.09], [0.0, 0.095], [-0.04, 0.093], [-0.08, 0.084], [-0.11, 0.074], [-0.135, 0.07]],
      Hp: [[0.132, 0.012], [0.12, 0.028], [0.1, 0.034], [0.075, 0.038], [0.04, 0.041], [0.0, 0.042], [-0.04, 0.042], [-0.08, 0.042], [-0.11, 0.04], [-0.135, 0.038]],
      Hs: [[0.132, 0.006], [0.12, 0.017], [0.1, 0.024], [0.075, 0.028], [0.05, 0.032], [0.02, 0.03], [-0.01, 0.028], [-0.04, 0.03], [-0.075, 0.03], [-0.105, 0.026], [-0.135, 0.02]],
      Sw: [[0.132, 0.5], [0.05, 0.44], [0.0, 0.55], [-0.04, 0.62], [-0.08, 0.7], [-0.135, 0.72]] },
    // 1/10 2WD: long pointed nose over the front end, slim pods, low cockpit
    '2wd': { XN: 0.205, XT: -0.15,
      W: [[0.205, 0.014], [0.18, 0.03], [0.14, 0.046], [0.09, 0.06], [0.03, 0.07], [-0.03, 0.073], [-0.08, 0.071], [-0.12, 0.066], [-0.15, 0.062]],
      Hp: [[0.205, 0.006], [0.18, 0.016], [0.14, 0.024], [0.09, 0.032], [0.03, 0.04], [-0.03, 0.046], [-0.08, 0.048], [-0.12, 0.045], [-0.15, 0.04]],
      Hs: [[0.205, 0.003], [0.17, 0.01], [0.12, 0.017], [0.08, 0.026], [0.05, 0.033], [0.01, 0.031], [-0.03, 0.028], [-0.08, 0.03], [-0.12, 0.026], [-0.15, 0.02]],
      Sw: [[0.205, 0.42], [0.06, 0.42], [0.0, 0.5], [-0.06, 0.6], [-0.15, 0.7]] },
    // 1/8 truggy: wide, tall pods and a big cab bubble
    truggy: { XN: 0.17, XT: -0.17,
      W: [[0.17, 0.03], [0.15, 0.062], [0.12, 0.086], [0.08, 0.1], [0.03, 0.112], [-0.03, 0.115], [-0.08, 0.112], [-0.12, 0.104], [-0.17, 0.098]],
      Hp: [[0.17, 0.016], [0.15, 0.034], [0.12, 0.044], [0.08, 0.05], [0.03, 0.054], [-0.03, 0.055], [-0.08, 0.054], [-0.12, 0.05], [-0.17, 0.046]],
      Hs: [[0.17, 0.008], [0.15, 0.02], [0.12, 0.028], [0.08, 0.037], [0.05, 0.043], [0.02, 0.041], [-0.02, 0.038], [-0.06, 0.04], [-0.1, 0.036], [-0.13, 0.03], [-0.17, 0.024]],
      Sw: [[0.17, 0.5], [0.05, 0.44], [0.0, 0.55], [-0.05, 0.62], [-0.1, 0.7], [-0.17, 0.72]] },
  };
  const podKey = L.body === '2wd' ? '2wd' : L.body === 'truggy' ? 'truggy' : 'buggy';
  const PD = PODS[podKey];
  const XN = PD.XN, XT = PD.XT;          // nose tip, tail cut-out
  /** Map a position on the stock buggy body onto this pod (livery and clips scale with the body). */
  const bx = (x: number) => XN + (x - 0.132) * ((XN - XT) / 0.267);
  const cls = BUGGY_CLASSES[cls_];
  const smoothProfile = (pts: [number, number][]) => {
    const curve = new THREE.SplineCurve(pts.map(([x, v]) => new THREE.Vector2(x, v)));
    const samples = curve.getPoints(120);
    return (x: number) => {
      for (let k = 1; k < samples.length; k++) {
        const a = samples[k - 1], b = samples[k];
        if ((x - a.x) * (x - b.x) <= 0) return a.y + (b.y - a.y) * ((x - a.x) / ((b.x - a.x) || 1));
      }
      return samples[x > samples[0].x ? 0 : samples.length - 1].y;
    };
  };
  // half-width at the lower edge, side-pod height, cockpit/spine height and spine width along the car
  const W = smoothProfile(PD.W), Hp = smoothProfile(PD.Hp), Hs = smoothProfile(PD.Hs), Sw = smoothProfile(PD.Sw);
  const shellFunc = (u: number, v: number, t: THREE.Vector3) => {
    const x = XN - u * (XN - XT);
    const th = v * Math.PI;
    const sc = Math.cos(th), sa = Math.abs(sc);
    // flat-topped pods that roll over at the edge, plus a narrow raised spine/cockpit in the middle
    const pod = Math.sqrt(Math.max(0, 1 - Math.pow(sa, 3.2)));
    const spine = Math.exp(-Math.pow(sa / Sw(x), 2) * 2.2);
    const flare = 1 + 0.05 * Math.pow(sa, 6); // slight outward flare at the lower edge
    t.set(x, y0 + Hp(x) * pod + Hs(x) * spine, sc * W(x) * flare);
  };
  const shellGeo = new ParametricGeometry(shellFunc, 64, 40);
  shellGeo.computeVertexNormals();
  const uOf = (x: number) => (XN - x) / (XN - XT);
  const liveryTex = (() => {
    // 1024 x 512: canvas x runs nose -> tail, canvas y runs across the body (canvas top = the -z side's lower
    // edge, middle = the spine, bottom = the +z side's lower edge)
    const c = document.createElement('canvas'); c.width = 1024; c.height = 512;
    const g = c.getContext('2d')!;
    const col = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
    const X = (x: number) => (x === XT || x === XN ? uOf(x) : uOf(bx(x))) * 1024;
    g.fillStyle = col(colors.body); g.fillRect(0, 0, 1024, 512);
    // fade toward the lower edges
    const shade = g.createLinearGradient(0, 0, 0, 512);
    shade.addColorStop(0, 'rgba(0,0,0,.42)'); shade.addColorStop(0.22, 'rgba(0,0,0,0)'); shade.addColorStop(0.78, 'rgba(0,0,0,0)'); shade.addColorStop(1, 'rgba(0,0,0,.42)');
    g.fillStyle = shade; g.fillRect(0, 0, 1024, 512);
    // sharp yellow graphic sweeping back along each pod, with black + white keylines
    for (const top of [true, false]) {
      const Y = (y: number) => (top ? y : 512 - y);
      g.fillStyle = col(colors.accent);
      if (look.livery === 0) {          // Sweep: a sharp graphic sweeping back along each pod with keylines
        g.beginPath(); g.moveTo(X(0.12), Y(150)); g.lineTo(X(-0.02), Y(40)); g.lineTo(X(XT) + 20, Y(20)); g.lineTo(X(XT) + 20, Y(110)); g.lineTo(X(-0.03), Y(120)); g.closePath(); g.fill();
        g.strokeStyle = '#111418'; g.lineWidth = 7;
        g.beginPath(); g.moveTo(X(0.12), Y(160)); g.lineTo(X(-0.03), Y(130)); g.lineTo(X(XT) + 20, Y(122)); g.stroke();
        g.strokeStyle = '#f4efe6'; g.lineWidth = 3;
        g.beginPath(); g.moveTo(X(0.12), Y(170)); g.lineTo(X(-0.03), Y(140)); g.lineTo(X(XT) + 20, Y(132)); g.stroke();
      } else if (livery === 1) {        // Split: accent front half, diagonal break, body colour behind
        g.beginPath(); g.moveTo(0, Y(0)); g.lineTo(X(0.02), Y(0)); g.lineTo(X(-0.03), Y(256)); g.lineTo(0, Y(256)); g.closePath(); g.fill();
        g.strokeStyle = '#111418'; g.lineWidth = 9; g.beginPath(); g.moveTo(X(0.02), Y(0)); g.lineTo(X(-0.03), Y(256)); g.stroke();
      } else {                          // Pinstripe: twin thin stripes down the pods
        g.fillRect(X(0.13), Y(top ? 118 : 128), X(XT) - X(0.13), 7); g.fillRect(X(0.13), Y(top ? 134 : 144), X(XT) - X(0.13), 4);
      }
      // moulded side scoop (dark intake) ahead of the rear wheel + motor vent holes on the engine deck
      g.fillStyle = '#0b0d10';
      g.beginPath(); g.moveTo(X(-0.06), Y(26)); g.lineTo(X(-0.1), Y(22)); g.lineTo(X(-0.1), Y(62)); g.quadraticCurveTo(X(-0.07), Y(66), X(-0.06), Y(26)); g.fill();
      for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) { g.beginPath(); g.arc(X(-0.075 - i * 0.017), Y(185 + j * 22), 7, 0, Math.PI * 2); g.fill(); }
    }
    // painted cockpit windows: windscreen on the front of the pod + side windows, white outline
    const win = (pts: [number, number][]) => {
      g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(X(x), y) : g.moveTo(X(x), y))); g.closePath();
      g.fillStyle = '#0d1116'; g.fill(); g.strokeStyle = '#f4efe6'; g.lineWidth = 6; g.stroke();
    };
    win([[0.1, 210], [0.1, 302], [0.062, 318], [0.062, 194]]);                       // windscreen
    win([[0.058, 168], [0.058, 194], [0.002, 204], [-0.008, 184]]);                          // left side window
    win([[0.058, 344], [0.058, 318], [0.002, 308], [-0.008, 328]]);                          // right side window
    // roof stripe behind the cockpit, nose number plate
    g.fillStyle = '#f4efe6'; g.fillRect(X(0.0), 240, X(XT) - X(0.0), 32);
    g.fillStyle = '#111418'; g.fillRect(X(0.0), 250, X(XT) - X(0.0), 12);
    g.fillStyle = '#f4efe6'; g.beginPath(); g.roundRect(4, 196, X(0.106) - 4, 120, 14); g.fill();
    g.save(); g.translate((4 + X(0.106)) / 2, 256); g.rotate(-Math.PI / 2); g.fillStyle = '#111418'; g.font = '900 74px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(podKey === '2wd' ? '3' : podKey === 'truggy' ? '8' : '7', 0, 4); g.restore();
    // side decals (fictional), oriented to read correctly on each side
    const sideText = (text: string, x: number, y: number, size: number, color: string, bg: string | null, top: boolean) => {
      g.save(); g.translate(X(x), top ? y : 512 - y);
      if (top) g.scale(1, -1); else g.scale(-1, 1);
      g.font = `900 ${size}px "Barlow Condensed", "Arial Narrow", system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      if (bg) { const w = g.measureText(text).width + size * 0.6; g.fillStyle = bg; g.beginPath(); g.roundRect(-w / 2, -size * 0.62, w, size * 1.24, size * 0.2); g.fill(); }
      g.fillStyle = color; g.fillText(text, 0, 2);
      g.restore();
    };
    for (const top of [true, false]) {
      sideText('RUTTWORKS', 0.035, 78, 40, '#f4efe6', '#111418', top);
      sideText(cls.short.toUpperCase(), -0.075, 80, 30, '#111418', null, top);
      sideText('BRACKENBANK MC', 0.075, 120, 18, '#f4efe6', 'rgba(0,0,0,.55)', top);
      // small tech stickers + barcode
      g.fillStyle = '#f4efe6'; g.fillRect(X(0.098), top ? 52 : 512 - 76, 54, 24);
      g.fillStyle = '#111418'; for (let i = 0; i < 9; i++) g.fillRect(X(0.098) + 5 + i * 5, top ? 55 : 512 - 73, i % 3 ? 2 : 3, 18);
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    return t;
  })();
  const shellMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: liveryTex, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.08, side: THREE.DoubleSide });
  add('shell', shellGeo, shellMat, shell, [0, 0, 0]);
  const shellPoint = (u: number, v: number) => { const p = new THREE.Vector3(); shellFunc(u, v, p); return p; };
  // trimmed Lexan edges: rolled lip along both lower edges and round the open tail
  const edgeMat = mat(0x0d2a66, 0.4, 0.2);
  for (const v of [0, 1]) {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 50; i++) pts.push(shellPoint(i / 50, v));
    add('shell', new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 100, 0.0015, 5, false), edgeMat, shell, [0, 0, 0]);
  }
  {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 40; i++) pts.push(shellPoint(1, i / 40));
    add('shell', new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, 0.0015, 5, false), edgeMat, shell, [0, 0, 0]);
  }
  // body clips through the shell over the posts (hole + bent pin)
  const topAt = (x: number) => { const p = new THREE.Vector3(); shellFunc(uOf(x), 0.5, p); return p.y; };
  for (const x0 of [0.095, -0.108]) {
    const x = bx(x0), y = topAt(x);
    add('shell', new THREE.CylinderGeometry(0.0035, 0.0035, 0.0012, 12), black, shell, [x, y + 0.0004, 0]);
    add('shell', new THREE.TorusGeometry(0.0062, 0.0012, 5, 14, Math.PI * 1.6), mat(0xc8ccd2, 0.25, 0.9), shell, [x, y + 0.0045, 0.002], [0, Math.PI / 2, 0.4]);
  }

  } else {
    const BL = { hx: HX, tz: TZ, rF: L.rF, rR: L.rR, wF: L.wF, wR: L.wR, ride: L.ride };
    if (L.body === 'sct') buildSCTBody(shell, colors, BL); else buildStadiumBody(shell, colors, BL);
    shell.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.userData.partId = 'shell'; m.castShadow = true; if (!parts.has('shell')) parts.set('shell', []); parts.get('shell')!.push(m); } });
  }

  // --- wing: wide, nearly flat 1/8-style wing with a gurney lip, decal, tall end plates; bolted to a mount on
  // the rear of the chassis, so it stays on the car when the body comes off
  const wingDark = new THREE.MeshPhysicalMaterial({ color: 0x15161a, roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.2 });
  const WINGS = { buggy: [-0.19, 0.168, 0.235, 0.105], small: [-(HX + 0.03), 0.15, 0.2, 0.09], big: [-(HX + 0.025), 0.205, 0.28, 0.12], stadium: [-(HX + 0.02), 0.215, 0.24, 0.11], none: [-0.19, 0.168, 0.235, 0.105] } as const;
  const [WX, WY, SPAN, CH] = WINGS[L.wing];
  const wingOn = L.wing !== 'none';
  const foil = new THREE.Shape();
  foil.moveTo(0, 0); foil.quadraticCurveTo(0.03, 0.008, CH * 0.75, 0.006); foil.lineTo(CH, 0.002);
  foil.lineTo(CH + 0.001, 0.013); foil.lineTo(CH + 0.004, 0.013); foil.lineTo(CH + 0.003, -0.002);
  foil.lineTo(0.02, -0.002); foil.quadraticCurveTo(0.003, -0.002, 0, 0);
  const foilGeo = new THREE.ExtrudeGeometry(foil, { depth: SPAN, bevelEnabled: false, curveSegments: 8 });
  foilGeo.translate(0, 0, -SPAN / 2); foilGeo.rotateY(Math.PI); // chord runs toward the tail (-x)
  const wingG = new THREE.Group(); wingG.position.set(WX, WY, 0); wingG.rotation.z = -0.1; if (wingOn) ch.add(wingG);
  add('chassis', foilGeo, wingDark, wingG, [0, 0, 0]);
  const wingDecal = (() => {
    const c = document.createElement('canvas'); c.width = 512; c.height = 256;
    const g = c.getContext('2d')!;
    g.fillStyle = '#15161a'; g.fillRect(0, 0, 512, 256);
    g.fillStyle = `#${colors.accent.toString(16).padStart(6, '0')}`;
    g.beginPath(); g.moveTo(0, 0); g.lineTo(110, 0); g.lineTo(60, 256); g.lineTo(0, 256); g.fill();
    g.beginPath(); g.moveTo(512, 0); g.lineTo(402, 0); g.lineTo(452, 256); g.lineTo(512, 256); g.fill();
    g.save(); g.translate(256, 128); g.scale(-1, -1); // reads correctly from behind the car (the operator's view)
    g.fillStyle = '#f4efe6'; g.font = '900 96px "Barlow Condensed", "Arial Narrow", system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('RUTTWORKS', 0, 4); g.restore();
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
  })();
  const decalGeo = new THREE.PlaneGeometry(SPAN * 0.94, CH * 0.8);
  decalGeo.rotateX(-Math.PI / 2); decalGeo.rotateY(-Math.PI / 2); // span along z, text readable from behind
  add('chassis', decalGeo, new THREE.MeshStandardMaterial({ map: wingDecal, roughness: 0.4, polygonOffset: true, polygonOffsetFactor: -2 }), wingG, [-CH * 0.45, 0.0078, 0]);
  // tall end plates with a cut-out
  const endPlate = new THREE.Shape();
  endPlate.moveTo(-0.004, -0.018); endPlate.lineTo(CH + 0.01, -0.024); endPlate.quadraticCurveTo(CH + 0.02, 0.01, CH + 0.012, 0.05);
  endPlate.lineTo(0.03, 0.055); endPlate.quadraticCurveTo(-0.01, 0.04, -0.004, -0.018);
  const cutHole = new THREE.Path(); cutHole.moveTo(0.045, 0.02); cutHole.lineTo(0.09, 0.016); cutHole.quadraticCurveTo(0.097, 0.03, 0.09, 0.04); cutHole.lineTo(0.05, 0.042); cutHole.quadraticCurveTo(0.04, 0.032, 0.045, 0.02);
  endPlate.holes.push(cutHole);
  const plateGeo = new THREE.ExtrudeGeometry(endPlate, { depth: 0.003, bevelEnabled: true, bevelThickness: 0.0008, bevelSize: 0.0008, bevelSegments: 1 });
  plateGeo.translate(0, 0, -0.0015); plateGeo.rotateY(Math.PI);
  for (const sz of [1, -1]) add('chassis', plateGeo, mat(colors.accent, 0.4), wingG, [0, -0.004, sz * (SPAN / 2 + 0.002)]);
  // wing mount: twin uprights from the rear of the chassis, cross brace, aluminium wing buttons
  const mountShape = new THREE.Shape();
  mountShape.moveTo(-0.01, 0); mountShape.lineTo(0.008, 0); mountShape.lineTo(-0.008, 0.115); mountShape.lineTo(-0.024, 0.115); mountShape.lineTo(-0.01, 0);
  for (const y of [0.03, 0.06, 0.088]) { const h = new THREE.Path(); h.absarc(-0.008, y, 0.0035, 0, Math.PI * 2, true); mountShape.holes.push(h); }
  const mountGeo = new THREE.ExtrudeGeometry(mountShape, { depth: 0.004, bevelEnabled: true, bevelThickness: 0.0006, bevelSize: 0.0006, bevelSegments: 1 });
  mountGeo.scale(1, (WY - 0.05) / 0.118, 1);
  if (wingOn) {
    for (const sz of [1, -1]) {
      add('chassis', mountGeo, wingDark, ch, [WX + 0.002, 0.05, sz * 0.032 - 0.002]);
      add('chassis', new THREE.CylinderGeometry(0.0058, 0.0058, 0.003, 14), mat(0xc8ccd2, 0.25, 0.9), ch, [WX - 0.016, WY + 0.0085, sz * 0.032], [0, 0, -0.1]);
    }
    add('chassis', rb(0.008, 0.006, 0.07), wingDark, ch, [WX - 0.006, 0.05 + (WY - 0.05) * 0.52, 0]);
  }

  // --- wheels: knobby tires on dished five-spoke rims, compound stripe on the sidewall
  const wheels: WheelRig[] = [];
  const tyreFor = (r: number, w: number, tread: BuggyLayout['treadF']) => {
    const g = tread === 'rib' ? ribTire(r, w) : tread === 'block' ? tireGeometry(r, w, 4, 22) : tread === 'stadium' ? tireGeometry(r, w, 5, 28) : tireGeometry(r, w, w > 0.06 ? 6 : w > 0.05 ? 5 : 4, w > 0.06 ? 32 : 24);
    g.rotateX(Math.PI / 2); return g;
  };
  const axles = { f: { r: L.rF, w: L.wF, tread: L.treadF }, r: { r: L.rR, w: L.wR, tread: L.treadR } };
  const geos = Object.fromEntries(Object.entries(axles).map(([k, a]) => {
    const rim = rimGeometry(a.r * 0.65, a.w * 0.96); rim.rotateX(Math.PI / 2);
    return [k, { tyre: tyreFor(a.r, a.w, a.tread), rim, stripe: new THREE.TorusGeometry(a.r * 0.77, 0.0028, 6, 32) }];
  })) as unknown as Record<'f' | 'r', { tyre: THREE.BufferGeometry; rim: THREE.BufferGeometry; stripe: THREE.BufferGeometry }>;
  const rimColor = L.body === 'sct' ? 0xd8dbe0 : L.body === 'stadium' ? 0xf2c230 : L.body === 'truggy' ? 0xf1f0ec : 0x26262a;
  const positions: [number, number, 'f' | 'r'][] = [[HX, TZ, 'f'], [HX, -TZ, 'f'], [-HX, TZ, 'r'], [-HX, -TZ, 'r']];
  for (const [x, z, ax] of positions) {
    const A = axles[ax], G = geos[ax];
    const steer = new THREE.Group();
    steer.position.set(x, A.r, z);
    root.add(steer);
    const spin = new THREE.Group();
    steer.add(spin);
    const outward = new THREE.Group();          // rims face outward on both sides
    if (z < 0) outward.rotation.y = Math.PI;
    spin.add(outward);
    const tireMat = surface('rubber', { color: 0xffffff, repeat: [2, 2] });
    tireMat.color.setHex(0x1c1c1c);
    add('tires', G.tyre, tireMat, outward, [0, 0, 0]);
    add('tires', G.rim, mat(rimColor, 0.35, rimColor === 0xd8dbe0 ? 0.8 : 0.3), outward, [0, 0, 0]);
    const stripe = mat(TIRE_COMPOUNDS.pin.stripe, 0.6);
    add('tires', G.stripe, stripe, outward, [0, 0, A.w / 2 + 0.0005]);
    // hex hub + flanged wheel nut
    add('tires', new THREE.CylinderGeometry(0.0085, 0.0085, 0.006, 6), mat(0x2a63d4, 0.3, 0.8), outward, [0, 0, A.w / 2 - 0.002], [Math.PI / 2, 0, 0]);
    add('tires', new THREE.CylinderGeometry(0.0055, 0.0065, 0.006, 6), mat(0xc8ccd2, 0.25, 0.9), outward, [0, 0, A.w / 2 + 0.003], [Math.PI / 2, 0, 0]);
    wheels.push({ steer, spin, stripe });
  }

  // Merge small pieces that share a part, a parent and an equivalent material into one mesh each, so the
  // detailed model stays a modest number of draw calls (the battery and wheels stay separate).
  for (const [id, list] of parts) {
    if (id === 'battery' || id === 'tires') continue;
    const groups = new Map<string, THREE.Mesh[]>();
    for (const m of list) {
      if (!m.parent || m === batteryMesh) continue;
      const k = `${m.parent.uuid}|${matKey(m.material as THREE.Material)}|${m.castShadow}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(m);
    }
    const keep: THREE.Mesh[] = list.filter((m) => !m.parent);
    for (const g of groups.values()) {
      if (g.length === 1) { keep.push(g[0]); continue; }
      const geos = g.map((m) => { m.updateMatrix(); return bakeGeometry(m.geometry, m.matrix); });
      const merged = new THREE.Mesh(mergeGeometries(geos)!, g[0].material);
      merged.castShadow = g[0].castShadow; merged.userData.partId = id;
      g[0].parent!.add(merged);
      for (const m of g) m.removeFromParent();
      keep.push(merged);
    }
    for (const m of list) if (m === batteryMesh) keep.push(m);
    parts.set(id, keep);
  }

  // Each mesh owns its material, plus a hidden back-face "outline" shell used for highlighting.
  const outlineMat = new THREE.MeshBasicMaterial({ color: 0xffd43b, side: THREE.BackSide, transparent: true, opacity: 0.95, depthWrite: false });
  const outlines = new Map<PartId, THREE.Mesh[]>();
  for (const [id, list] of parts) {
    for (const m of list) {
      m.material = (m.material as THREE.Material).clone();
      // open surfaces (the moulded shell, wing blade) highlight with glow only: an outline copy would cover them
      if ((m.material as THREE.Material).side !== THREE.FrontSide) continue;
      const g2 = m.geometry.clone();
      g2.computeBoundingBox();
      const bb = g2.boundingBox!;
      const c = bb.getCenter(new THREE.Vector3()), size = bb.getSize(new THREE.Vector3());
      const pad = 0.006;
      g2.translate(-c.x, -c.y, -c.z);
      g2.scale((size.x + pad) / Math.max(size.x, 1e-4), (size.y + pad) / Math.max(size.y, 1e-4), (size.z + pad) / Math.max(size.z, 1e-4));
      g2.translate(c.x, c.y, c.z);
      const o = new THREE.Mesh(g2, outlineMat);
      o.visible = false;
      o.renderOrder = 2;
      o.raycast = () => {};
      m.add(o);
      if (!outlines.has(id)) outlines.set(id, []);
      outlines.get(id)!.push(o);
    }
  }
  for (const w of wheels) w.stripe = (w.spin.children[0].children[2] as THREE.Mesh).material as THREE.MeshStandardMaterial;

  return {
    root, body, shell, wheels, parts, batteryMesh,
    setShell(on) { shell.visible = on; },
    setTires(c, condition) {
      const col = TIRE_COMPOUNDS[c].stripe;
      for (const w of wheels) w.stripe.color.setHex(col);
      // worn tires look dusty/grey
      const wear = 1 - condition / 100;
      for (const w of wheels) {
        const tm = (w.spin.children[0].children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;
        // fresh rubber is near-black; worn tread goes dusty brown-grey
        tm.color.setRGB(0.03 + wear * 0.2, 0.03 + wear * 0.17, 0.03 + wear * 0.12);
      }
    },
    setBatteryVisible(v) {
      for (const m of parts.get('battery') ?? []) m.visible = v;
    },
    freeze() {
      if (body.userData.frozen) return;
      body.userData.frozen = true;
      for (const list of outlines.values()) for (const o of list) o.removeFromParent();
      batchStatic(body, () => false);
    },
    highlight(part, t) {
      // yellow outline plus a gentle warm glow on the selected part
      const pulse = 0.05 + 0.05 * Math.sin(t * 5);
      outlineMat.opacity = 0.65 + 0.3 * Math.sin(t * 5);
      for (const [id, list] of parts) {
        const on = id === part;
        for (const m of list) (m.material as THREE.MeshStandardMaterial).emissive?.setRGB(on ? pulse : 0, on ? pulse * 0.8 : 0, on ? pulse * 0.2 : 0);
        for (const o of outlines.get(id) ?? []) o.visible = on;
      }
    },
  };
}

/** Ribbed front tyre for 2WD buggies: a smooth carcass with raised circumferential ribs (axis = y). */
function ribTire(radius: number, width: number) {
  const w = width / 2, r0 = radius * 0.62, sh = radius * 0.12;
  const prof: [number, number][] = [[r0, -w], [radius - sh, -w], [radius - sh * 0.3, -w + sh * 0.3]];
  const ribs = 3;
  for (let i = 0; i < ribs; i++) {
    const y0 = -w + sh * 0.6 + (i / ribs) * (width - sh * 1.2), y1 = -w + sh * 0.6 + ((i + 1) / ribs) * (width - sh * 1.2);
    const m = (y0 + y1) / 2, gw = (y1 - y0) * 0.18;
    prof.push([radius - 0.0035, y0 + gw], [radius, y0 + gw * 1.6], [radius, y1 - gw * 1.6], [radius - 0.0035, y1 - gw]);
    void m;
  }
  prof.push([radius - sh * 0.3, w - sh * 0.3], [radius - sh, w], [r0, w]);
  return mergeGeometries([new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 40).toNonIndexed()], false)!;
}

class HelixCurve extends THREE.Curve<THREE.Vector3> {
  constructor(private r: number, private len: number, private turns: number) { super(); }
  getPoint(t: number, target = new THREE.Vector3()) {
    const a = t * Math.PI * 2 * this.turns;
    return target.set(Math.cos(a) * this.r, (t - 0.5) * this.len, Math.sin(a) * this.r);
  }
}
