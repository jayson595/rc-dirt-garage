// Cragweld CW-C1 Stoneamble: a 1/10 scale trail/rock crawler. Ladder frame, two solid axles on 4-links,
// long coil-over shocks, big lugged tyres, and a moss-green hard-body pickup shell with a light bar,
// roof rack and a spare in the bed. Body frame matches CrawlerSim: x forward, y up, z right; origin at
// the centre of mass (about 0.107 m above level ground).
import * as THREE from 'three';
import { batchStatic } from './staticBatch';
import { CRAWLER_SPEC, CrawlerSlot, crawlerSpecFor, TruckSpec } from '../sim/CrawlerSim';
import { rimGeometry, roundedBox, surface, tireGeometry } from './materials';
import { buildUTBBody, buildWagonBody } from './crawlerBodies';

export const CRAWLER_COLORS = { body: 0x4f6b3a, accent: 0x9a9c94, trim: 0x1b1d1f };
export type CrawlerStyle = 'pickup' | 'wagon' | 'utb';
export const CRAWLER_STYLES: Record<CrawlerStyle, { name: string; colors: typeof CRAWLER_COLORS }> = {
  pickup: { name: 'Cragweld Stoneamble (old pickup)', colors: CRAWLER_COLORS },
  wagon: { name: "Cragweld '76 Ranchero 2-door", colors: { body: 0xc0642a, accent: 0xf1eadb, trim: 0x1b1d1f } },
  utb: { name: 'Griphold UTB trail buggy', colors: { body: 0xe8622a, accent: 0x2a2c30, trim: 0x1b1d1f } },
};

export interface CrawlerModel {
  root: THREE.Group;
  /** Pose every moving part from the simulation state. */
  pose(sim: { pos: THREE.Vector3; q: THREE.Quaternion; susp: number[]; spin: number[]; steer: number }): void;
  /** Static pose for display (garage shelf): level, mid suspension. */
  rest(): void;
  /** Height of the body origin above the floor in the rest pose (to sit it on a shelf). */
  restHeight: number;
}

const mat = (color: number, rough = 0.6, metal = 0.1) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });

/** A rod that can be re-aimed between two points each frame (unit-length cylinder scaled). */
class Rod {
  mesh: THREE.Mesh;
  constructor(parent: THREE.Object3D, r: number, m: THREE.Material, seg = 8, geo?: THREE.BufferGeometry) {
    const g = geo ?? new THREE.CylinderGeometry(r, r, 1, seg).translate(0, 0.5, 0);
    this.mesh = new THREE.Mesh(g, m); this.mesh.castShadow = true;
    parent.add(this.mesh);
  }
  aim(a: THREE.Vector3, b: THREE.Vector3) {
    const d = b.clone().sub(a); const len = Math.max(1e-4, d.length());
    this.mesh.position.copy(a);
    this.mesh.scale.set(1, len, 1);
    this.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  }
}

export function createCrawler(style: CrawlerStyle = 'pickup', colors = CRAWLER_STYLES[style].colors, fitted: Partial<Record<CrawlerSlot, string>> = {}): CrawlerModel {
  const S: TruckSpec = Object.keys(fitted).length ? crawlerSpecFor(fitted) : CRAWLER_SPEC;
  const has = (id: string) => Object.values(fitted).includes(id);
  const portal = has('axles-portal'), brassKit = has('weights-brass'), lift = has('susp-lift');
  const tyre = fitted.tyres === 'tyres-boulder' ? 'boulder' : fitted.tyres === 'tyres-claw' ? 'claw' : 'stock';
  const root = new THREE.Group(); root.name = 'crawler';
  // the mass sits low (heavy wheels, axles, brass): everything is modelled from the old reference and lifted
  const inner = new THREE.Group(); inner.position.y = S.mountY - 0.025; root.add(inner);
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D, pos: [number, number, number], rot?: [number, number, number]) => {
    const o = new THREE.Mesh(geo, m); o.position.set(...pos); if (rot) o.rotation.set(...rot);
    o.castShadow = true; o.receiveShadow = true; parent.add(o); return o;
  };
  const steel = mat(0x2a2c30, 0.45, 0.6);
  const alu = mat(0xb8bec6, 0.3, 0.85);
  const black = mat(0x141416, 0.55, 0.1);
  const red = mat(0xb3261e, 0.45, 0.4);
  const brass = mat(0xc9a23a, 0.35, 0.8);

  // ---------------- chassis (sprung): ladder frame, transmission + motor, electronics, shock hoops
  const chassis = new THREE.Group(); inner.add(chassis);
  const rail = new THREE.Shape(); // C-channel cross-section (z, y)
  rail.moveTo(0, 0); rail.lineTo(0.004, 0); rail.lineTo(0.004, 0.022); rail.lineTo(0, 0.022); rail.lineTo(0, 0.019); rail.lineTo(0.0025, 0.019); rail.lineTo(0.0025, 0.003); rail.lineTo(0, 0.003); rail.lineTo(0, 0);
  for (const sz of [-1, 1]) {
    const g = new THREE.ExtrudeGeometry(rail, { depth: 0.44, bevelEnabled: false });
    g.translate(0, 0, -0.22); g.rotateY(Math.PI / 2);
    const m = add(g, steel, chassis, [0, 0.005, sz * 0.04], [0, 0, 0]);
    if (sz < 0) m.scale.z = -1;
  }
  for (const x of [-0.2, -0.07, 0.07, 0.2]) add(roundedBox(0.012, 0.012, 0.08, 0.003), steel, chassis, [x, 0.016, 0]); // cross members
  // front/rear bumpers with winch-style plates
  add(roundedBox(0.02, 0.022, 0.13, 0.004), black, chassis, [0.235, 0.012, 0]);
  add(roundedBox(0.02, 0.022, 0.12, 0.004), black, chassis, [-0.235, 0.012, 0]);
  add(new THREE.CylinderGeometry(0.012, 0.012, 0.04, 14), black, chassis, [0.245, 0.03, 0], [Math.PI / 2, 0, 0]); // winch drum
  // transmission + motor (centre, low), skid plate
  add(roundedBox(0.07, 0.05, 0.05, 0.01), mat(0x3a3d42, 0.5, 0.2), chassis, [0.0, 0.0, 0]);
  add(roundedBox(0.09, 0.006, 0.06, 0.002), alu, chassis, [0.0, -0.028, 0]);
  add(new THREE.CylinderGeometry(0.018, 0.018, 0.05, 18), has('motor-torque') ? mat(0x2f8f6a, 0.3, 0.75) : mat(0x2b2b2e, 0.35, 0.7), chassis, [0.045, 0.012, 0.0], [0, 0, Math.PI / 2]);
  add(new THREE.CylinderGeometry(0.019, 0.019, 0.006, 18), red, chassis, [0.072, 0.012, 0], [0, 0, Math.PI / 2]);
  // battery tray + pack, ESC, receiver box
  add(roundedBox(0.1, 0.022, 0.042, 0.005), mat(0x1d1d1f, 0.45), chassis, [0.13, 0.04, 0]);
  add(roundedBox(0.04, 0.016, 0.032, 0.005), red, chassis, [-0.06, 0.045, 0.02]);
  add(roundedBox(0.03, 0.018, 0.026, 0.005), black, chassis, [-0.06, 0.045, -0.025]);
  // front and rear shock hoops
  for (const x of [0.15, -0.15]) for (const sz of [-1, 1]) add(roundedBox(0.012, 0.04, 0.008, 0.002), steel, chassis, [x, 0.036, sz * 0.05]);
  // drive shafts (centre -> axles), re-aimed each frame
  const driveF = new Rod(inner, 0.0035, alu), driveR = new Rod(inner, 0.0035, alu);

  // ---------------- body: hard pickup shell with wheel arches, bed, windows, light bar, rack, spare
  const shell = new THREE.Group(); inner.add(shell);
  if (style === 'pickup') {
  const prof = new THREE.Shape();
  prof.moveTo(-0.245, 0.04);
  prof.lineTo(-0.248, 0.1); prof.quadraticCurveTo(-0.248, 0.112, -0.236, 0.112);
  prof.lineTo(-0.066, 0.112); prof.lineTo(-0.06, 0.163); prof.quadraticCurveTo(-0.058, 0.17, -0.048, 0.17);
  prof.lineTo(0.05, 0.17); prof.quadraticCurveTo(0.06, 0.17, 0.064, 0.164);
  prof.lineTo(0.1, 0.122); prof.lineTo(0.205, 0.112); prof.quadraticCurveTo(0.25, 0.108, 0.252, 0.088);
  prof.lineTo(0.252, 0.045); prof.lineTo(0.207, 0.04);
  prof.absarc(0.16, -0.025, 0.08, Math.atan2(0.065, 0.047), Math.PI - Math.atan2(0.065, 0.047), false);
  prof.lineTo(-0.113, 0.04);
  prof.absarc(-0.16, -0.025, 0.08, Math.atan2(0.065, 0.047), Math.PI - Math.atan2(0.065, 0.047), false);
  prof.lineTo(-0.245, 0.04);
  const W = 0.2;
  const shellGeo = new THREE.ExtrudeGeometry(prof, { depth: W - 0.02, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.008, bevelSegments: 3, curveSegments: 18 });
  shellGeo.translate(0, 0, -(W - 0.02) / 2);
  const paint = new THREE.MeshPhysicalMaterial({ color: colors.body, roughness: 0.42, metalness: 0.15, clearcoat: 0.8, clearcoatRoughness: 0.2 });
  add(shellGeo, paint, shell, [0, 0, 0]);
  // bed liner (dark, set into the deck) + tailgate line
  add(roundedBox(0.16, 0.003, W - 0.03, 0.001), mat(0x1b1d1f, 0.95), shell, [-0.152, 0.1235, 0]);
  add(roundedBox(0.003, 0.05, W - 0.02, 0.001), mat(0x2a3a22, 0.5), shell, [-0.249, 0.075, 0]);
  // windows: windscreen, rear, side
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x0e1418, roughness: 0.08, metalness: 0.3, clearcoat: 1 });
  const wsGeo = new THREE.PlaneGeometry(W - 0.04, 0.05); wsGeo.rotateY(Math.PI / 2); wsGeo.rotateZ(0.7);
  add(wsGeo, glass, shell, [0.0835, 0.1445, 0]);
  const rwGeo = new THREE.PlaneGeometry(W - 0.05, 0.035); rwGeo.rotateY(-Math.PI / 2);
  add(rwGeo, glass, shell, [-0.0648, 0.142, 0]);
  for (const sz of [-1, 1]) {
    const sw = new THREE.Shape(); sw.moveTo(-0.05, 0.122); sw.lineTo(-0.047, 0.16); sw.lineTo(0.052, 0.16); sw.lineTo(0.085, 0.122); sw.lineTo(-0.05, 0.122);
    const m = add(new THREE.ShapeGeometry(sw), glass, shell, [0, 0, sz * (W / 2 + 0.0005)]);
    if (sz < 0) m.rotation.y = Math.PI, m.scale.x = -1;
  }
  // grille, headlights, tail lights, light bar
  add(roundedBox(0.003, 0.03, 0.12, 0.001), black, shell, [0.2535, 0.07, 0]);
  for (let i = 0; i < 5; i++) add(roundedBox(0.002, 0.003, 0.11, 0.001), mat(0x3a3d42, 0.4, 0.5), shell, [0.2555, 0.058 + i * 0.006, 0]);
  const lamp = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2d0, emissiveIntensity: 1.2, roughness: 0.2 });
  for (const sz of [-1, 1]) {
    add(new THREE.CylinderGeometry(0.011, 0.011, 0.004, 16), lamp, shell, [0.254, 0.08, sz * 0.07], [0, 0, Math.PI / 2]);
    add(roundedBox(0.004, 0.012, 0.02, 0.002), new THREE.MeshStandardMaterial({ color: 0xd02a20, emissive: 0x6a0a06, emissiveIntensity: 0.6 }), shell, [-0.25, 0.092, sz * 0.08]);
  }
  add(roundedBox(0.018, 0.016, 0.16, 0.004), black, shell, [0.04, 0.18, 0]);
  for (let i = 0; i < 6; i++) add(new THREE.CylinderGeometry(0.0055, 0.0055, 0.003, 12), lamp, shell, [0.05, 0.18, -0.065 + i * 0.026], [0, 0, Math.PI / 2]);
  // roof rack + bag
  for (const sz of [-1, 1]) add(new THREE.CylinderGeometry(0.0025, 0.0025, 0.1, 6), black, shell, [0.0, 0.176, sz * 0.085], [0, 0, Math.PI / 2]);
  for (const x of [-0.045, 0.045]) add(new THREE.CylinderGeometry(0.0025, 0.0025, 0.17, 6), black, shell, [x, 0.176, 0], [Math.PI / 2, 0, 0]);
  add(roundedBox(0.06, 0.018, 0.08, 0.008), surface('fabric', { color: 0x6b5a3a, repeat: [2, 2] }), shell, [-0.02, 0.186, 0.02]);
  // fender flares (dark) round each arch, both sides
  for (const x of [0.16, -0.16]) for (const sz of [-1, 1]) {
    add(new THREE.TorusGeometry(0.083, 0.006, 6, 24, Math.PI - 2 * Math.atan2(0.065, 0.047)), mat(0x1b1d1f, 0.7), shell, [x, -0.025, sz * (W / 2 + 0.003)], [0, 0, Math.atan2(0.065, 0.047)]);
  }
  // spare tyre in the bed
  const spareT = tireGeometry(S.wheelR, 0.04, 5, 22); spareT.rotateX(Math.PI / 2);
  const spare = add(spareT, surface('rubber', { color: 0x1a1a1a, repeat: [2, 2] }), shell, [-0.15, 0.135, 0.0], [Math.PI / 2, 0, 0]);
  void spare;
  // decals: CRAGWELD side panel + stripe
  const decal = (() => {
    const c = document.createElement('canvas'); c.width = 512; c.height = 96;
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, 512, 96);
    g.fillStyle = `#${colors.accent.toString(16).padStart(6, '0')}`; g.fillRect(0, 62, 512, 10);
    g.fillStyle = '#f1eadb'; g.font = '900 46px "Barlow Condensed", "Arial Narrow", system-ui, sans-serif'; g.fillText('CRAGWELD', 8, 50);
    g.font = '700 22px system-ui, sans-serif'; g.fillStyle = 'rgba(241,234,219,.85)'; g.fillText('STONEAMBLE', 300, 50);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  for (const sz of [-1, 1]) {
    const pl = add(new THREE.PlaneGeometry(0.2, 0.0375), new THREE.MeshStandardMaterial({ map: decal, transparent: true, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -2 }), shell, [-0.02, 0.083, sz * (W / 2 + 0.0008)]);
    if (sz < 0) pl.rotation.y = Math.PI;
  }

  } else if (style === 'wagon') buildWagonBody(shell, colors);
  else buildUTBBody(shell, colors);

  // ---------------- unsprung: wheels, axle housings, links, shocks, steering
  const tireMat = surface('rubber', { color: 0x1a1a1a, repeat: [2, 2], normalScale: 1.6 });
  const tW = tyre === 'boulder' ? 0.056 : tyre === 'claw' ? 0.05 : 0.046;
  const tGeo = tireGeometry(S.wheelR, tW, tyre === 'stock' ? 6 : 7, tyre === 'boulder' ? 18 : 20); tGeo.rotateX(Math.PI / 2);
  const rGeo = rimGeometry(S.wheelR * (tyre === 'stock' ? 0.62 : 0.6), tW - 0.002); rGeo.rotateX(Math.PI / 2);
  const rimMat = tyre === 'boulder' ? mat(0xb8bec6, 0.25, 0.85) : tyre === 'claw' ? mat(0x8a2a1e, 0.35, 0.6) : mat(0x2a2c30, 0.35, 0.6);
  const wheels: { steer: THREE.Group; spin: THREE.Group }[] = [];
  for (let i = 0; i < 4; i++) {
    const steer = new THREE.Group(); inner.add(steer);
    const spin = new THREE.Group(); steer.add(spin);
    const out = new THREE.Group(); if (i % 2 === 0) out.rotation.y = Math.PI; spin.add(out); // rims face out
    add(tGeo, tireMat, out, [0, 0, 0]);
    add(rGeo, rimMat, out, [0, 0, 0]);
    const face = tW / 2 - 0.001;
    add(new THREE.CylinderGeometry(0.009, 0.009, 0.006, 6), brass, out, [0, 0, face], [Math.PI / 2, 0, 0]); // beadlock hub
    const bolts = tyre === 'stock' ? 8 : 12, br = S.wheelR * 0.52;
    for (let k = 0; k < bolts; k++) { const a = (k / bolts) * Math.PI * 2; add(new THREE.CylinderGeometry(0.0016, 0.0016, 0.003, 6), alu, out, [Math.cos(a) * br, Math.sin(a) * br, face], [Math.PI / 2, 0, 0]); }
    // portal axles: a gear box at each hub, the axle tube entering near its top
    if (portal) {
      const box = add(roundedBox(0.026, 0.044, 0.016, 0.006), mat(0x9a1f1a, 0.4, 0.55), steer, [0, 0.012, 0]);
      box.position.z = (i % 2 ? -1 : 1) * (tW / 2 + 0.006);
      add(new THREE.CylinderGeometry(0.006, 0.006, 0.004, 12), alu, steer, [0, 0, box.position.z + (i % 2 ? -1 : 1) * 0.009], [Math.PI / 2, 0, 0]).position.y = 0.024;
    }
    // brass steering knuckles / hub weights
    if (brassKit) add(roundedBox(0.02, 0.026, 0.012, 0.004), brass, steer, [0, portal ? -0.004 : 0, (i % 2 ? -1 : 1) * (tW / 2 + (portal ? 0.016 : 0.007))]);
    wheels.push({ steer, spin });
  }
  const axleMat = mat(0x2a2c30, 0.4, 0.5);
  const axleTube = [new Rod(inner, 0.009, axleMat, 12), new Rod(inner, 0.009, axleMat, 12)];
  const pumpkin = [0, 1].map(() => {
    const g = new THREE.Group(); inner.add(g);
    add(new THREE.SphereGeometry(0.022, 16, 12), axleMat, g, [0, 0, 0]).scale.set(1, 1, 0.9);
    add(new THREE.CylinderGeometry(0.016, 0.016, 0.012, 16), brassKit ? brass : alu, g, [0, 0, 0], [0, 0, Math.PI / 2]);
    if (portal) g.scale.setScalar(0.8);
    return g;
  });
  const links: Rod[] = []; for (let i = 0; i < 8; i++) links.push(new Rod(inner, 0.0028, alu));
  // unit-length coil spring (y 0..1), stretched to the shock length every frame
  const coilPts: THREE.Vector3[] = [];
  for (let k = 0; k <= 160; k++) { const t = k / 160, a = t * Math.PI * 2 * 9; coilPts.push(new THREE.Vector3(Math.cos(a) * 0.0095, t, Math.sin(a) * 0.0095)); }
  const springGeo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(coilPts), 160, 0.0016, 5, false);
  const shockBody: Rod[] = [], shockShaft: Rod[] = [], spring: Rod[] = [];
  for (let i = 0; i < 4; i++) {
    shockBody.push(new Rod(inner, lift ? 0.0075 : 0.0065, lift ? mat(0x1e5fb3, 0.3, 0.7) : red, 12));
    shockShaft.push(new Rod(inner, 0.0024, alu));
    spring.push(new Rod(inner, 0, mat(0xc9a23a, 0.35, 0.75), 0, springGeo));
  }
  const dragLink = new Rod(inner, 0.0025, alu);
  const servo = add(roundedBox(0.03, 0.018, 0.016, 0.004), has('servo-ht') ? mat(0x1f4fa8, 0.35, 0.6) : black, inner, [0, 0, 0]);

  const mounts = [
    new THREE.Vector3(S.wheelbase / 2, 0.025, -S.track / 2), new THREE.Vector3(S.wheelbase / 2, 0.025, S.track / 2),
    new THREE.Vector3(-S.wheelbase / 2, 0.025, -S.track / 2), new THREE.Vector3(-S.wheelbase / 2, 0.025, S.track / 2),
  ];
  const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3();
  const axleUp = new THREE.Vector3(0, portal ? 0.016 : 0, 0);
  const centres = [0, 1, 2, 3].map(() => new THREE.Vector3());

  function poseLocal(susp: number[], spin: number[], steer: number) {
    // everything here is in the body frame (root carries the body transform)
    for (let i = 0; i < 4; i++) {
      centres[i].copy(mounts[i]).y -= susp[i];
      const w = wheels[i];
      w.steer.position.copy(centres[i]);
      w.steer.rotation.y = i < 2 ? -steer : 0;
      w.spin.rotation.z = -spin[i];
    }
    for (let a = 0; a < 2; a++) {
      const L = centres[a * 2].clone().add(axleUp), R = centres[a * 2 + 1].clone().add(axleUp);
      // axle housing between the hubs, inboard of the wheels
      tmpA.copy(L).lerp(R, 0.08); tmpB.copy(L).lerp(R, 0.92);
      axleTube[a].aim(tmpA, tmpB);
      const mid = L.clone().lerp(R, 0.42);
      pumpkin[a].position.copy(mid);
      pumpkin[a].quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), R.clone().sub(L).normalize());
      // 4-link: two lower links low on the axle, two uppers higher, running to the frame
      const sx = a === 0 ? 1 : -1;
      for (let k = 0; k < 4; k++) {
        const side = k % 2 ? 1 : -1, upper = k >= 2;
        const onAxle = L.clone().lerp(R, 0.5 + side * (upper ? 0.12 : 0.22)).add(new THREE.Vector3(0, upper ? 0.018 : -0.012, 0));
        const onFrame = new THREE.Vector3(sx * (upper ? 0.06 : 0.04), upper ? 0.03 : 0.0, side * (upper ? 0.02 : 0.035));
        links[a * 4 + k].aim(onAxle, onFrame);
      }
      // drive shaft from the transmission to the pumpkin
      (a === 0 ? driveF : driveR).aim(new THREE.Vector3(sx * 0.04, 0.0, 0), mid);
    }
    // coil-overs: from the shock hoops to the axle near each wheel
    for (let i = 0; i < 4; i++) {
      const sx = i < 2 ? 1 : -1, sz = i % 2 ? 1 : -1;
      const top = new THREE.Vector3(sx * 0.15, 0.052, sz * 0.05);
      const axleEnd = centres[i].clone().lerp(centres[i ^ 1], 0.18).add(new THREE.Vector3(0, 0.012, 0)).add(axleUp);
      const mid = top.clone().lerp(axleEnd, 0.55);
      shockBody[i].aim(top, mid);
      shockShaft[i].aim(mid, axleEnd);
      spring[i].aim(top.clone().lerp(axleEnd, 0.1), top.clone().lerp(axleEnd, 0.85));
    }
    // axle-mounted servo + drag link to the steering knuckle
    const fl = centres[0].clone().add(axleUp), fr = centres[1].clone().add(axleUp);
    servo.position.copy(fl.clone().lerp(fr, 0.65)).add(new THREE.Vector3(0.012, 0.03, 0));
    dragLink.aim(servo.position.clone().add(new THREE.Vector3(0.01, -0.008, 0)), fl.clone().lerp(fr, 0.1).add(new THREE.Vector3(0.025, 0.01, 0)));
  }

  const restSusp = S.restLen + S.travel - 0.028;
  const rest = () => poseLocal([restSusp, restSusp, restSusp, restSusp], [0, 0, 0, 0], 0);
  rest();
  root.traverse((o) => { (o as THREE.Mesh).castShadow = true; });
  // fewer draw calls: everything rigid inside the chassis, the body and each wheel becomes a few merged meshes
  batchStatic(chassis, () => false); batchStatic(shell, () => false);
  for (const w of wheels) batchStatic(w.spin, () => false);

  return {
    root,
    pose(sim) {
      root.position.copy(sim.pos);
      root.quaternion.copy(sim.q);
      poseLocal(sim.susp, sim.spin, sim.steer);
    },
    rest,
    restHeight: -(S.mountY - restSusp - S.wheelR),
  };
}

