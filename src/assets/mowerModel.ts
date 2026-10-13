// Turfhound 21 RC: a full-size 21" petrol rotary mower converted to radio control. Stamped steel
// deck with skirt and bumper, finned single-cylinder engine under a shroud, recoil grille, air box,
// muffler and heat shield, fuel cap, grass bag on a frame, height levers, front wheels steered by a
// servo + tie rod, and the RC box (receiver, antenna with flag) where the handlebars used to be.
// Body frame: x forward, y up, z right; origin on the ground under the deck centre. Real size (metres).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { lathe, roundedBox, surface, tireGeometry } from './materials';
import { cable } from './garageKit';
import { batchStatic } from './staticBatch';

export interface MowerPose { speed: number; steer: number; accel: number; turn: number; dt: number; t: number }
export interface MowerModel { root: THREE.Group; pose(p: MowerPose): void }

const mat = (color: number, rough = 0.6, metal = 0.1) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });

function canvasTex(w: number, hgt: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas'); c.width = w; c.height = hgt;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

/** Rounded-rectangle outline in the x/z plane (front corners rounder, like a real deck). */
function deckShape(L: number, W: number, rf: number, rr: number) {
  const s = new THREE.Shape(), x0 = -L / 2, x1 = L / 2, z0 = -W / 2, z1 = W / 2;
  s.moveTo(x0 + rr, z0);
  s.lineTo(x1 - rf, z0); s.quadraticCurveTo(x1, z0, x1, z0 + rf);
  s.lineTo(x1, z1 - rf); s.quadraticCurveTo(x1, z1, x1 - rf, z1);
  s.lineTo(x0 + rr, z1); s.quadraticCurveTo(x0, z1, x0, z1 - rr);
  s.lineTo(x0, z0 + rr); s.quadraticCurveTo(x0, z0, x0 + rr, z0);
  return s;
}

export function createMower(): MowerModel {
  const root = new THREE.Group(); root.name = 'mower';
  const body = new THREE.Group(); root.add(body);        // sprung: pitches/rolls/vibrates
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D, pos: [number, number, number], rot?: [number, number, number], shadow = true) => {
    const o = new THREE.Mesh(geo, m); o.position.set(...pos); if (rot) o.rotation.set(...rot);
    o.castShadow = shadow; o.receiveShadow = true; parent.add(o); return o;
  };
  const red = new THREE.MeshPhysicalMaterial({ color: 0xb8281f, roughness: 0.38, metalness: 0.2, clearcoat: 0.7, clearcoatRoughness: 0.25 });
  const black = mat(0x18191b, 0.55, 0.1);
  const satin = mat(0x2a2c30, 0.4, 0.55);
  const alu = mat(0xb9bec4, 0.32, 0.85);
  const steel = mat(0x8d9298, 0.35, 0.8);
  const yellow = mat(0xf0b82a, 0.45, 0.1);

  // ---------------- deck: stamped steel, rolled top, skirt, discharge tunnel to the rear bag
  const L = 0.56, W = 0.5, deckY = 0.05, deckH = 0.07;
  const dg = new THREE.ExtrudeGeometry(deckShape(L, W, 0.13, 0.05), { depth: deckH, bevelEnabled: true, bevelThickness: 0.018, bevelSize: 0.016, bevelSegments: 4, curveSegments: 14 });
  dg.rotateX(-Math.PI / 2);
  add(dg, red, body, [0, deckY, 0]);
  // raised engine boss + stiffening ribs
  add(lathe([[0.2, 0], [0.19, 0.012], [0.16, 0.022], [0.001, 0.024]], 40), red, body, [0.01, deckY + deckH + 0.016, 0]);
  for (const sz of [-1, 1]) add(roundedBox(0.34, 0.012, 0.03, 0.006), red, body, [0.0, deckY + deckH + 0.018, sz * 0.205], [0, sz * 0.12, 0]);
  // dark skirt band + front bumper bar
  add(roundedBox(L + 0.02, 0.018, W + 0.02, 0.008), black, body, [0, deckY + 0.004, 0]);
  const bump = new THREE.CatmullRomCurve3([[0.2, 0.09, -0.27], [0.31, 0.09, -0.2], [0.33, 0.09, 0], [0.31, 0.09, 0.2], [0.2, 0.09, 0.27]].map((p) => new THREE.Vector3(...p)));
  add(new THREE.TubeGeometry(bump, 30, 0.011, 8, false), satin, body, [0, 0, 0]);
  // rear discharge tunnel + hinged flap into the bag
  add(roundedBox(0.08, 0.07, 0.26, 0.02), red, body, [-0.3, deckY + 0.06, 0]);
  add(roundedBox(0.012, 0.09, 0.28, 0.004), black, body, [-0.342, deckY + 0.07, 0], [0, 0, -0.2]);

  // ---------------- engine: base, finned barrel, shroud, recoil grille, air box, muffler, fuel cap
  const eng = new THREE.Group(); eng.position.set(0.01, deckY + deckH + 0.04, 0); body.add(eng);
  add(new THREE.CylinderGeometry(0.11, 0.115, 0.016, 28), satin, eng, [0, 0.008, 0]);
  add(new THREE.CylinderGeometry(0.07, 0.07, 0.07, 22), alu, eng, [0.05, 0.05, -0.07], [0, 0, Math.PI / 2]);  // barrel (horizontal, forward)
  for (let i = 0; i < 7; i++) add(new THREE.CylinderGeometry(0.058, 0.058, 0.004, 22), alu, eng, [0.06 + i * 0.011, 0.05, -0.07], [0, 0, Math.PI / 2], false);
  add(new THREE.CylinderGeometry(0.012, 0.012, 0.03, 10), black, eng, [0.145, 0.05, -0.07], [0, 0, Math.PI / 2]);   // spark plug boot
  cable(eng, [[0.155, 0.05, -0.07], [0.16, 0.09, -0.05], [0.1, 0.13, -0.02]], 0.004, 0x111111, 10);
  const shroud = lathe([[0.001, 0.205], [0.07, 0.205], [0.098, 0.198], [0.112, 0.18], [0.118, 0.12], [0.116, 0.04], [0.11, 0.02]], 36);
  add(shroud, new THREE.MeshPhysicalMaterial({ color: 0x1d1e21, roughness: 0.35, metalness: 0.1, clearcoat: 0.5, side: THREE.DoubleSide }), eng, [-0.02, 0, 0.012]);
  // recoil starter grille (radial slots printed in) + brand cap
  const grille = canvasTex(256, 256, (g) => {
    g.fillStyle = '#2a2b2e'; g.beginPath(); g.arc(128, 128, 128, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#0b0b0c'; g.lineWidth = 9; g.lineCap = 'round';
    for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2; g.beginPath(); g.moveTo(128 + Math.cos(a) * 60, 128 + Math.sin(a) * 60); g.lineTo(128 + Math.cos(a) * 112, 128 + Math.sin(a) * 112); g.stroke(); }
    g.fillStyle = '#b8281f'; g.beginPath(); g.arc(128, 128, 44, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#f1eadb'; g.font = '900 30px "Barlow Condensed", "Arial Narrow", sans-serif'; g.textAlign = 'center'; g.fillText('TH', 128, 139);
  });
  add(new THREE.CircleGeometry(0.075, 36).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: grille, roughness: 0.5 }), eng, [-0.02, 0.2065, 0.012], undefined, false);
  // air filter box (front), primer bulb, muffler with perforated heat shield (side), fuel tank + cap
  add(roundedBox(0.07, 0.08, 0.1, 0.018), new THREE.MeshPhysicalMaterial({ color: 0xb8281f, roughness: 0.4, clearcoat: 0.5 }), eng, [0.11, 0.12, 0.06]);
  for (let i = 0; i < 5; i++) add(roundedBox(0.002, 0.05, 0.004, 0.001), black, eng, [0.146, 0.12, 0.03 + i * 0.015], undefined, false);
  add(new THREE.SphereGeometry(0.013, 14, 10), mat(0x9a2a24, 0.35, 0.0), eng, [0.12, 0.17, 0.02]);
  const shieldTex = canvasTex(128, 64, (g) => { g.fillStyle = '#3c3f44'; g.fillRect(0, 0, 128, 64); g.fillStyle = '#0c0c0d'; for (let y = 8; y < 60; y += 10) for (let x = 8; x < 124; x += 10) { g.beginPath(); g.arc(x + (y % 20 ? 5 : 0), y, 2.6, 0, Math.PI * 2); g.fill(); } });
  add(roundedBox(0.11, 0.05, 0.04, 0.014), mat(0x3b3a37, 0.6, 0.5), eng, [0.02, 0.06, 0.12]);
  add(new THREE.PlaneGeometry(0.12, 0.06), new THREE.MeshStandardMaterial({ map: shieldTex, roughness: 0.5, metalness: 0.6 }), eng, [0.02, 0.06, 0.142], undefined, false);
  add(new THREE.CylinderGeometry(0.006, 0.006, 0.03, 8), satin, eng, [-0.04, 0.06, 0.13], [0, 0, Math.PI / 2]);
  add(new THREE.CylinderGeometry(0.022, 0.024, 0.02, 20), yellow, eng, [-0.06, 0.215, -0.06]);
  for (let i = 0; i < 8; i++) add(roundedBox(0.004, 0.012, 0.004, 0.001), mat(0xc79a20, 0.5), eng, [-0.06 + Math.cos(i / 8 * Math.PI * 2) * 0.023, 0.215, -0.06 + Math.sin(i / 8 * Math.PI * 2) * 0.023], [0, -i / 8 * Math.PI * 2, 0], false);
  // throttle linkage: servo on the deck pulling the governor arm
  add(roundedBox(0.04, 0.022, 0.02, 0.004), black, body, [-0.1, deckY + deckH + 0.04, 0.12]);
  add(roundedBox(0.012, 0.004, 0.026, 0.002), mat(0xeeeeee, 0.4), body, [-0.1, deckY + deckH + 0.054, 0.12]);
  cable(body, [[-0.1, deckY + deckH + 0.056, 0.132], [-0.05, deckY + deckH + 0.07, 0.14], [0.0, deckY + deckH + 0.1, 0.12]], 0.0022, 0x8d9298, 10);

  // ---------------- RC box where the handlebars were: weatherproof case, receiver, LED, antenna + flag
  const rc = new THREE.Group(); rc.position.set(-0.23, deckY + deckH + 0.02, -0.05); body.add(rc);
  add(roundedBox(0.012, 0.09, 0.012, 0.003), satin, rc, [0, 0.045, -0.12]); add(roundedBox(0.012, 0.09, 0.012, 0.003), satin, rc, [0, 0.045, 0.12]); // handle stubs
  add(roundedBox(0.11, 0.06, 0.15, 0.012), mat(0xd6d3cc, 0.5, 0.0), rc, [0, 0.05, 0]);
  add(roundedBox(0.112, 0.012, 0.152, 0.004), mat(0x2b2d31, 0.5), rc, [0, 0.084, 0]);
  const rcLabel = canvasTex(256, 96, (g) => {
    g.fillStyle = '#d6d3cc'; g.fillRect(0, 0, 256, 96); g.fillStyle = '#b8281f'; g.fillRect(0, 0, 256, 18);
    g.fillStyle = '#1c1c1e'; g.font = '900 40px "Barlow Condensed", "Arial Narrow", sans-serif'; g.fillText('RC CONVERSION', 10, 62);
    g.font = '700 18px system-ui, sans-serif'; g.fillText('2.4 GHz · FAILSAFE: ENGINE STOP', 10, 86);
  });
  add(new THREE.PlaneGeometry(0.14, 0.05), new THREE.MeshStandardMaterial({ map: rcLabel, roughness: 0.55 }), rc, [0.0, 0.05, 0.0755], undefined, false);
  add(new THREE.SphereGeometry(0.006, 10, 8), new THREE.MeshStandardMaterial({ color: 0x33e06a, emissive: 0x2fe064, emissiveIntensity: 1.6 }), rc, [0.056, 0.07, 0.04], undefined, false);
  const mast = new THREE.Group(); mast.position.set(-0.03, 0.09, -0.05); rc.add(mast);
  add(new THREE.CylinderGeometry(0.0025, 0.004, 0.36, 8), black, mast, [0, 0.18, 0]);
  const flagTex = canvasTex(64, 48, (g) => { g.fillStyle = '#ff6a1a'; g.fillRect(0, 0, 64, 48); g.fillStyle = '#fff3e0'; g.fillRect(0, 20, 64, 8); });
  const flag = add(new THREE.PlaneGeometry(0.07, 0.05).translate(-0.035, 0, 0), new THREE.MeshStandardMaterial({ map: flagTex, side: THREE.DoubleSide, roughness: 0.8 }), mast, [0, 0.33, 0], undefined, true);

  // ---------------- grass bag: fabric bag on a steel frame with a moulded top + carry handle
  const bag = new THREE.Group(); bag.position.set(-0.47, 0, 0); body.add(bag);
  const bagGeo = roundedBox(0.3, 0.2, 0.36, 0.07);
  { // sag the bottom and bulge the sides a touch so it reads as cloth
    const p = bagGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const u = 1 - Math.min(1, Math.abs(x) / 0.15) ** 2, v = 1 - Math.min(1, Math.abs(z) / 0.18) ** 2;
      if (y < 0) p.setY(i, y - 0.02 * u * v);
      p.setZ(i, z * (1 + 0.05 * (1 - Math.abs(y) / 0.1) * u));
    }
    bagGeo.computeVertexNormals();
  }
  add(bagGeo, surface('fabric', { color: 0x3c4a33, repeat: [4, 3], roughness: 0.95 }), bag, [0, 0.19, 0]);
  add(roundedBox(0.32, 0.03, 0.38, 0.012), mat(0x1d1e21, 0.45), bag, [0.0, 0.3, 0]);
  const hand = new THREE.CatmullRomCurve3([[0.06, 0.31, -0.08], [0.03, 0.36, -0.06], [-0.03, 0.36, 0.06], [-0.06, 0.31, 0.08]].map((p) => new THREE.Vector3(...p)));
  add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([[-0.08, 0.315, -0.09], [-0.08, 0.36, -0.06], [-0.08, 0.36, 0.06], [-0.08, 0.315, 0.09]].map((p) => new THREE.Vector3(...p))), 16, 0.008, 8, false), black, bag, [0, 0, 0]);
  void hand;
  for (const sz of [-1, 1]) add(new THREE.CylinderGeometry(0.005, 0.005, 0.2, 6), steel, bag, [0.14, 0.18, sz * 0.18], [0, 0, 0.3], false);

  // ---------------- decals: TURFHOUND side panels + height scale
  const side = canvasTex(512, 96, (g) => {
    g.clearRect(0, 0, 512, 96);
    g.fillStyle = '#f1eadb'; g.fillRect(0, 70, 512, 7);
    g.fillStyle = '#1c1c1e'; g.fillRect(0, 79, 512, 5);
    g.fillStyle = '#f1eadb'; g.font = 'italic 900 52px "Barlow Condensed", "Arial Narrow", sans-serif'; g.fillText('TURFHOUND', 10, 58);
    g.font = '800 26px "Barlow Condensed", "Arial Narrow", sans-serif'; g.fillStyle = '#f0b82a'; g.fillText('21 RC · SELF-PROPELLED', 268, 56);
  });
  for (const sz of [-1, 1]) {
    const pl = add(new THREE.PlaneGeometry(0.4, 0.075), new THREE.MeshStandardMaterial({ map: side, transparent: true, roughness: 0.4, polygonOffset: true, polygonOffsetFactor: -2 }), body, [0.0, deckY + 0.042, sz * (W / 2 + 0.0165)], undefined, false);
    if (sz < 0) pl.rotation.y = Math.PI;
  }
  const warn = canvasTex(128, 96, (g) => { g.fillStyle = '#f0b82a'; g.fillRect(0, 0, 128, 96); g.fillStyle = '#111'; g.beginPath(); g.moveTo(64, 10); g.lineTo(112, 86); g.lineTo(16, 86); g.closePath(); g.lineWidth = 8; g.strokeStyle = '#111'; g.stroke(); g.font = '900 52px sans-serif'; g.textAlign = 'center'; g.fillText('!', 64, 78); });
  add(new THREE.PlaneGeometry(0.06, 0.045).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: warn, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -2 }), body, [0.2, deckY + deckH + 0.0185, -0.1], [0, 0, 0], false);

  // ---------------- wheels: front pair steered by the tie rod, rear pair driven
  const tyreMat = surface('rubber', { color: 0x161616, repeat: [2, 2] });
  const hubMat = mat(0xd9d6cf, 0.45, 0.05);
  const capMat = new THREE.MeshPhysicalMaterial({ color: 0xb8281f, roughness: 0.4, clearcoat: 0.6 });
  const mkWheel = (r: number) => {
    const t = tireGeometry(r, 0.05, 3, 22); t.rotateX(Math.PI / 2);
    const hub = mergeGeometries([
      lathe([[r * 0.66, -0.024], [r * 0.7, -0.02], [r * 0.7, 0.02], [r * 0.66, 0.024], [r * 0.3, 0.026], [r * 0.25, 0.03], [0.001, 0.032]], 28).toNonIndexed(),
      ...Array.from({ length: 6 }, (_, i) => new THREE.BoxGeometry(0.008, 0.006, r * 0.36).translate(0, 0.024, r * 0.46).rotateY((i / 6) * Math.PI * 2).toNonIndexed()),
    ])!;
    hub.rotateX(Math.PI / 2);
    const g = new THREE.Group();
    add(t, tyreMat, g, [0, 0, 0]);
    add(hub, hubMat, g, [0, 0, 0]);
    add(new THREE.CylinderGeometry(r * 0.22, r * 0.24, 0.012, 18).rotateX(Math.PI / 2), capMat, g, [0, 0, 0.034], undefined, false);
    return g;
  };
  const steerF: THREE.Group[] = [], spinners: { g: THREE.Group; r: number }[] = [];
  for (const [x, r] of [[0.2, 0.085], [-0.21, 0.1]] as const) for (const sz of [-1, 1]) {
    const knuckle = new THREE.Group(); knuckle.position.set(x, r, sz * 0.285); root.add(knuckle);
    const w = mkWheel(r); if (sz < 0) w.rotation.y = Math.PI;
    const spin = new THREE.Group(); spin.add(w); knuckle.add(spin);
    spinners.push({ g: spin, r });
    if (x > 0) steerF.push(knuckle);
    // height-adjust lever + knob on the deck beside each wheel
    add(roundedBox(0.012, 0.06, 0.008, 0.003), steel, body, [x, deckY + deckH + 0.03, sz * (W / 2 + 0.008)], [0, 0, -0.5], false);
    add(new THREE.SphereGeometry(0.011, 10, 8), black, body, [x - 0.016, deckY + deckH + 0.058, sz * (W / 2 + 0.008)], undefined, false);
    add(new THREE.CylinderGeometry(0.008, 0.008, 0.04, 8), steel, body, [x, r, sz * (W / 2 + 0.012)], [Math.PI / 2, 0, 0], false); // axle stub
  }
  const tie = add(new THREE.CylinderGeometry(0.004, 0.004, 0.5, 6), steel, root, [0.235, 0.085, 0], [Math.PI / 2, 0, 0], false);
  // steering servo on the front of the deck
  add(roundedBox(0.035, 0.02, 0.045, 0.004), black, body, [0.25, deckY + deckH + 0.014, 0]);
  const horn = add(roundedBox(0.008, 0.003, 0.03, 0.001), mat(0xeeeeee, 0.4), body, [0.25, deckY + deckH + 0.026, 0], undefined, false);

  // merge the static body parts per material (the antenna mast and servo horn move, so they stay separate)
  batchStatic(body, (o) => o === mast || o === horn);
  for (const s of spinners) batchStatic(s.g, () => false);

  // ---------------- motion
  let pitch = 0, roll = 0, flagA = 0, tAcc = 0;
  return {
    root,
    pose(p: MowerPose) {
      tAcc += p.dt;
      const dt = Math.min(p.dt, 0.05);
      for (const k of steerF) k.rotation.y = -p.steer * 0.55;
      tie.position.x = 0.235; tie.rotation.z = 0;
      horn.rotation.y = -p.steer * 0.8;
      for (const s of spinners) s.g.rotation.z -= (p.speed / s.r) * dt;
      // body squats under throttle, dives on braking, leans out of turns; idle shake from the engine
      pitch += ((-p.accel * 0.012) - pitch) * (1 - Math.exp(-dt * 8));
      roll += ((p.turn * p.speed * 0.02) - roll) * (1 - Math.exp(-dt * 8));
      const shake = 0.0016 + 0.0012 * Math.min(1, Math.abs(p.speed));
      body.rotation.set(roll + Math.sin(tAcc * 71) * shake * 0.6, 0, pitch + Math.sin(tAcc * 53) * shake);
      body.position.y = Math.sin(tAcc * 97) * shake * 0.6;
      // antenna flag streams back with speed and flutters
      flagA += (Math.min(1.2, Math.abs(p.speed) * 0.7) - flagA) * (1 - Math.exp(-dt * 4));
      flag.rotation.y = Math.sin(tAcc * 9) * 0.25 * (0.3 + flagA) + (p.speed >= 0 ? 0 : Math.PI);
      mast.rotation.z = -flagA * 0.12 * Math.sign(p.speed || 1);
    },
  };
}
