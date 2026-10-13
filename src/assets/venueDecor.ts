// Track-side life for the dirt venue: a stocked pit table and neighbouring pits along pit row, feather
// flags, tyre stacks on the corners, marshal posts, a lap board, cones, a hose cart and rubbered-in
// tyre lines on the racing line. Everything is static and gets batched by VenueWorld.
import * as THREE from 'three';
import { Track } from '../sim/Track';
import { lathe, roundedBox, surface, tireGeometry, rimGeometry } from './materials';
import { KIT, cable, chargerBody, contactShadow, driver, drawerChest, lipoPack, taperedBin } from './garageKit';
import { labelTexture } from './textures';

const std = (color: number, rough = 0.7, metal = 0) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });

function box(w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D) {
  const mesh = new THREE.Mesh(roundedBox(w, h, d, Math.min(0.02, Math.min(w, h, d) * 0.25)), m);
  mesh.position.set(x, y, z);
  mesh.castShadow = true; mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}
function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
function hash(x: number, y: number) { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); }

function bottle(parent: THREE.Object3D, x: number, y: number, z: number, color: number, cap = 0xf4efe6, scale = 1) {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(lathe([[0.001, 0], [0.024, 0], [0.026, 0.004], [0.026, 0.07], [0.02, 0.085], [0.009, 0.095], [0.009, 0.105], [0.001, 0.105]], 16), surface('plastic', { color })));
  const lid = new THREE.Mesh(lathe([[0.001, 0.104], [0.011, 0.104], [0.011, 0.122], [0.004, 0.13], [0.001, 0.13]], 12), surface('plastic', { color: cap }));
  const label = new THREE.Mesh(new THREE.CylinderGeometry(0.0265, 0.0265, 0.035, 16, 1, true), surface('plastic', { color: 0xf1eadb }));
  label.position.y = 0.035; g.add(lid, label);
  g.position.set(x, y, z); g.scale.setScalar(scale);
  g.traverse((o) => { o.castShadow = true; });
  parent.add(g);
  return g;
}

function wheel(parent: THREE.Object3D, r: number, w: number, rimColor: number) {
  const g = new THREE.Group();
  const t = new THREE.Mesh(tireGeometry(r, w, 3, 20), KIT.rubber); t.castShadow = true; g.add(t);
  g.add(new THREE.Mesh(rimGeometry(r * 0.65, w * 0.95), surface('plastic', { color: rimColor })));
  parent.add(g);
  return g;
}

/** Sandbag weight for a canopy leg. */
function sandbag(parent: THREE.Object3D, x: number, z: number) {
  const m = new THREE.Mesh(roundedBox(0.3, 0.1, 0.18, 0.045), surface('fabric', { color: 0x2a2c30, repeat: [2, 2] }));
  m.position.set(x, 0.0, z); m.castShadow = true; parent.add(m);
}

/** The player's pit: stocked table, ground gear and canopy weights. Table centre at (x, z), top at `table`. */
export function stockPit(parent: THREE.Object3D, x: number, z: number, table: number) {
  const g = new THREE.Group(); g.name = 'pit-stock';
  // anti-slip rubber pit mat on the table, under the car
  const matTex = canvasTex(256, 128, (c) => {
    c.fillStyle = '#25272b'; c.fillRect(0, 0, 256, 128);
    c.strokeStyle = 'rgba(255,255,255,.12)'; c.lineWidth = 1;
    for (let i = 0; i <= 256; i += 16) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i, 128); c.stroke(); }
    for (let j = 0; j <= 128; j += 16) { c.beginPath(); c.moveTo(0, j); c.lineTo(256, j); c.stroke(); }
    c.fillStyle = '#f2c230'; c.font = '800 9px "Barlow Condensed", system-ui, sans-serif'; c.fillText('RUTTWORKS', 8, 122);
  });
  const mat = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.55), new THREE.MeshStandardMaterial({ map: matTex, roughness: 0.95 }));
  mat.rotation.x = -Math.PI / 2; mat.position.set(x + 0.05, table + 0.0225, z - 0.05); mat.receiveShadow = true; g.add(mat);
  // field charger (faces the chairs) with a static display, running off a 12 V box under the table
  const { group: ch, face } = chargerBody(g, 0x1f2124, 0xd63a2f);
  ch.position.set(x + 0.78, table + 0.02, z + 0.12); ch.rotation.y = Math.PI / 2;
  const disp = new THREE.Mesh(new THREE.PlaneGeometry(0.13, 0.052), new THREE.MeshStandardMaterial({
    map: canvasTex(256, 100, (c) => {
      c.fillStyle = '#0d2a3e'; c.fillRect(0, 0, 256, 100); c.fillStyle = '#9fe0ff'; c.font = '700 26px system-ui, sans-serif';
      c.fillText('CHARGE 2S', 12, 34); c.fillText('8.24V  4.8A', 12, 72);
    }), emissive: 0x9fe0ff, emissiveIntensity: 0.4, roughness: 0.3,
  }));
  disp.rotation.y = -Math.PI / 2; disp.position.set(-0.0075, 0.012, -0.03); face.add(disp);
  const pwr = new THREE.Group();
  box(0.24, 0.17, 0.16, surface('plastic', { color: 0x1d1d1f }), 0, 0.085, 0, pwr);
  for (const [dx, c] of [[-0.06, 0xd63a2f], [0.06, 0x1a1a1a]] as const) { const t = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.02, 12), std(c, 0.4)); t.position.set(dx, 0.18, 0); pwr.add(t); }
  pwr.position.set(x + 0.7, 0, z - 0.1); g.add(pwr);
  cable(g, [[x + 0.64, 0.19, z - 0.1], [x + 0.62, 0.45, z + 0.05], [x + 0.72, table - 0.02, z + 0.2], [x + 0.8, table + 0.06, z + 0.24]], 0.006, 0xb93228, 24);
  cable(g, [[x + 0.76, 0.19, z - 0.1], [x + 0.78, 0.45, z + 0.08], [x + 0.84, table - 0.02, z + 0.22], [x + 0.86, table + 0.06, z + 0.25]], 0.006, 0x1a1a1a, 24);
  // two spare packs (generic, not the player's numbered packs) and charge lead
  for (let i = 0; i < 2; i++) {
    const p = lipoPack(g, '5000', 0x1d1d1f, i ? '#2557c9' : '#d63a2f');
    p.position.set(x + 0.5, table + 0.02, z - 0.2 + i * 0.075); p.rotation.y = 0.05;
  }
  // drivers in a stand, shock oil, spare wheels, rag
  const stand = new THREE.Group();
  box(0.14, 0.04, 0.05, surface('plastic', { color: 0x2a2c30 }), 0, 0.02, 0, stand);
  [0xd63a2f, 0x2557c9, 0xf2c230, 0x4ea83a].forEach((c, i) => { const d = driver(stand, c, 0.07, i % 2 === 0); d.position.set(-0.045 + i * 0.03, 0.035, 0); });
  stand.position.set(x - 0.4, table + 0.02, z - 0.28); g.add(stand);
  bottle(g, x - 0.22, table + 0.02, z - 0.3, 0xf2c230, 0x1d1d1f, 0.8);
  bottle(g, x - 0.17, table + 0.02, z - 0.31, 0xd63a2f, 0xf4efe6, 0.8);
  bottle(g, x + 0.82, table + 0.02, z - 0.3, 0x2b6fd6, 0xf4efe6, 1.5); // water bottle
  for (let i = 0; i < 2; i++) { const w = wheel(g, 0.06, 0.046, 0xf2c230); w.rotation.x = Math.PI / 2; w.position.set(x - 0.82, table + 0.045 + i * 0.047, z - 0.25); }
  const rag = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.18, 6, 5), surface('fabric', { color: 0xd63a2f, repeat: [2, 2], side: THREE.DoubleSide }));
  const rp = rag.geometry.attributes.position; for (let k = 0; k < rp.count; k++) rp.setZ(k, 0.012 * Math.sin(rp.getX(k) * 40) * Math.cos(rp.getY(k) * 30));
  rag.geometry.computeVertexNormals(); rag.rotation.x = -Math.PI / 2; rag.position.set(x - 0.45, table + 0.03, z + 0.25); g.add(rag);
  // ground: red toolbox, pit bag, cooler, totes, sandbags on the canopy legs
  const tb = drawerChest(g, { w: 0.46, h: 0.3, d: 0.24, drawers: [1, 1, 1.4], color: 0xb3261e });
  tb.position.set(x - 0.7, 0, z + 0.55);
  const bag = new THREE.Group();
  box(0.55, 0.32, 0.32, surface('fabric', { color: 0x1d1d1f, repeat: [3, 2] }), 0, 0.16, 0, bag);
  box(0.57, 0.04, 0.12, surface('fabric', { color: 0xd63a2f, repeat: [3, 1] }), 0, 0.3, 0, bag);
  const strap = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.012, 6, 16, Math.PI), surface('fabric', { color: 0x1d1d1f })); strap.position.set(0, 0.32, 0); bag.add(strap);
  bag.position.set(x - 1.15, 0, z - 0.2); bag.rotation.y = 0.3; g.add(bag);
  const cooler = new THREE.Group();
  box(0.42, 0.3, 0.28, surface('plastic', { color: 0x2557c9 }), 0, 0.15, 0, cooler);
  box(0.44, 0.06, 0.3, surface('plastic', { color: 0xf1eadb }), 0, 0.32, 0, cooler);
  cooler.position.set(x + 1.15, 0, z + 0.8); cooler.rotation.y = -0.2; g.add(cooler);
  const t1 = taperedBin(g, 0.5, 0.3, 0.38, 0x1f2023, 0xe8b923); t1.position.set(x + 0.2, 0, z - 0.1);
  for (const dx of [-1.5, 1.5]) for (const dz of [-1.5, 1.5]) sandbag(g, x + dx * 0.97, z + dz * 0.97);
  // pit number board on the canopy front
  const num = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.3), new THREE.MeshStandardMaterial({ map: labelTexture('PIT 7', { bg: '#f2c230', fg: '#1d1d1f', w: 256, h: 128, font: '900 84px "Barlow Condensed", system-ui, sans-serif' }), side: THREE.DoubleSide }));
  num.position.set(x, 1.95, z - 1.56); num.rotation.y = Math.PI; g.add(num);
  for (const [cx, cz, w, d] of [[x, z, 2.2, 1.2], [x - 0.7, z + 0.55, 0.6, 0.4], [x - 1.15, z - 0.2, 0.7, 0.45], [x + 1.15, z + 0.8, 0.55, 0.4]] as const) contactShadow(g, cx, cz, w, d, -0.052);
  parent.add(g);
  return g;
}

/** A simpler neighbouring pit under an existing canopy: table, chairs, totes, a case. */
export function neighbourPit(parent: THREE.Object3D, x: number, z: number, seed: number, campChair: (p: THREE.Object3D, x: number, z: number, r: number) => void) {
  const g = new THREE.Group();
  const table = 0.74;
  const top = surface('plastic', { color: 0xdedbd2, roughness: 0.85, repeat: [8, 4] });
  box(1.6, 0.04, 0.7, top, x, table, z, g);
  const legMat = surface('paint', { color: 0xb8bcc4, metalness: 0.6 });
  for (const dx of [-0.72, 0.72]) for (const dz of [-0.28, 0.28]) box(0.03, table, 0.03, legMat, x + dx, table / 2, z + dz, g);
  const tbl = taperedBin(g, 0.45, 0.28, 0.34, 0x1f2023, [0xe8b923, 0x2557c9, 0xd63a2f][seed % 3]); tbl.position.set(x + 0.4, table + 0.02, z - 0.05);
  const cs = new THREE.Group();
  box(0.5, 0.14, 0.32, surface('plastic', { color: 0x1d1d1f }), 0, 0.07, 0, cs);
  cs.position.set(x - 0.35, table + 0.02, z); cs.rotation.y = 0.2; g.add(cs);
  bottle(g, x - 0.65, table + 0.02, z + 0.2, [0xf2c230, 0x2b6fd6, 0xd63a2f][seed % 3], 0xf4efe6, 1.4);
  campChair(g, x - 0.45, z + 0.9, Math.PI + 0.25);
  if (seed % 2) campChair(g, x + 0.5, z + 0.95, Math.PI - 0.3);
  const t = taperedBin(g, 0.5, 0.3, 0.38, 0x1f2023, 0xe8b923); t.position.set(x + 0.9, 0, z + 0.4); t.rotation.y = 0.4;
  for (const dx of [-1.35, 1.35]) for (const dz of [-1.35, 1.35]) sandbag(g, x + dx, z + dz);
  contactShadow(g, x, z, 1.9, 1.0, -0.052);
  parent.add(g);
  return g;
}

/** Tall fabric "feather" flag on a pole, printed both sides. */
export function featherFlag(parent: THREE.Object3D, x: number, z: number, color: string, text: string, rotY: number) {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 3.2, 8), surface('paint', { color: 0x9aa0a8, metalness: 0.6 }));
  pole.position.y = 1.6; g.add(pole);
  const sail = new THREE.Shape();
  sail.moveTo(0, 0.4); sail.lineTo(0, 3.1); sail.quadraticCurveTo(0.55, 3.15, 0.7, 2.5); sail.lineTo(0.62, 0.7); sail.quadraticCurveTo(0.4, 0.42, 0, 0.4);
  const geo = new THREE.ShapeGeometry(sail, 12);
  // gentle wind ripple
  const p = geo.attributes.position; for (let k = 0; k < p.count; k++) p.setZ(k, 0.05 * Math.sin(p.getX(k) * 7 + p.getY(k) * 1.3) * (p.getX(k) / 0.7));
  geo.computeVertexNormals();
  // UVs from the shape bounds so the print fills the sail
  const uv = geo.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setXY(k, p.getX(k) / 0.7, (p.getY(k) - 0.4) / 2.75);
  const tex = canvasTex(128, 512, (c) => {
    c.fillStyle = color; c.fillRect(0, 0, 128, 512);
    c.fillStyle = 'rgba(255,255,255,.18)'; c.fillRect(0, 380, 128, 132);
    c.save(); c.translate(70, 256); c.rotate(-Math.PI / 2);
    c.fillStyle = '#f4efe6'; c.font = '900 64px "Barlow Condensed", "Arial Narrow", system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(text, 0, 0);
    c.restore();
  });
  const sailM = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, side: THREE.DoubleSide }));
  sailM.position.x = 0.02; sailM.castShadow = true; g.add(sailM);
  const base = new THREE.Mesh(lathe([[0.001, 0], [0.22, 0], [0.22, 0.06], [0.06, 0.1], [0.001, 0.1]], 16), surface('plastic', { color: 0x1d1d1f }));
  g.add(base);
  g.position.set(x, -0.06, z); g.rotation.y = rotY;
  parent.add(g);
}

/** Track-side decoration driven by the track layout. */
export function buildTrackDecor(track: Track, parent: THREE.Object3D, title = 'DIRT CLASSIC') {
  const g = new THREE.Group(); g.name = 'track-decor';
  const hw = track.halfWidth;

  // rubbered-in tyre lines along the racing line (two darker wheel tracks, soft-edged)
  const lineTex = canvasTex(64, 8, (c) => {
    const gr = c.createLinearGradient(0, 0, 64, 0);
    gr.addColorStop(0, 'rgba(60,38,20,0)'); gr.addColorStop(0.3, 'rgba(60,38,20,.38)'); gr.addColorStop(0.7, 'rgba(60,38,20,.38)'); gr.addColorStop(1, 'rgba(60,38,20,0)');
    c.fillStyle = gr; c.fillRect(0, 0, 64, 8);
  });
  const lineMat = new THREE.MeshBasicMaterial({ map: lineTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  for (const off of [-0.13, 0.13]) {
    const pos: number[] = [], uvs: number[] = [], idx: number[] = [];
    const N = track.samples.length;
    for (let i = 0; i <= N; i++) {
      const s = track.samples[i % N].s;
      const center = THREE.MathUtils.clamp(-track.curvatureAt(s) * 2.2, -hw * 0.6, hw * 0.6) + off;
      for (const e of [-0.06, 0.06]) {
        const d = center + e;
        const p = track.pointAt(s, d);
        pos.push(p.x, track.heightAt(s, d) + 0.008, p.z);
        uvs.push(e < 0 ? 0 : 1, i / 8);
      }
      if (i < N) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(idx); geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, lineMat); m.renderOrder = 1; m.name = 'tyre-lines';
    g.add(m);
  }

  // tyre stacks on the outside of the tighter corners (instanced)
  const stackPos: { x: number; z: number; y: number }[] = [];
  let lastS = -99;
  for (const smp of track.samples) {
    const k = track.curvatureAt(smp.s);
    if (Math.abs(k) < 0.24 || smp.s - lastS < 5) continue;
    lastS = smp.s;
    const d = -Math.sign(k) * (hw + 0.75);
    const p = track.pointAt(smp.s, d);
    stackPos.push({ x: p.x, z: p.z, y: Math.max(0, track.heightAt(smp.s, d)) });
  }
  (window as unknown as { __tyreStacks?: unknown }).__tyreStacks = { n: stackPos.length, maxK: Math.max(...track.samples.map((q) => Math.abs(track.curvatureAt(q.s)))) };
  const tg = tireGeometry(0.3, 0.2, 3, 22);
  tg.rotateX(Math.PI / 2);
  const tyres = new THREE.InstancedMesh(tg, surface('rubber', { color: 0x1a1a1a, repeat: [3, 1] }), stackPos.length * 3);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
  stackPos.forEach((p, i) => {
    for (let j = 0; j < 3; j++) {
      q.setFromEuler(new THREE.Euler(Math.PI / 2, 0, hash(i, j) * 3));
      m4.compose(new THREE.Vector3(p.x + (hash(i, j + 4) - 0.5) * 0.06, p.y + 0.1 + j * 0.2, p.z + (hash(i, j + 8) - 0.5) * 0.06), q, new THREE.Vector3(1, 1, 1));
      tyres.setMatrixAt(i * 3 + j, m4);
    }
    contactShadow(g, p.x, p.z, 1.0, 1.0, p.y + 0.01);
  });
  tyres.castShadow = true; tyres.receiveShadow = true;
  g.add(tyres);

  // orange cones lining the pit-lane edge and the start straight
  const coneGeo = lathe([[0.001, 0], [0.13, 0], [0.13, 0.02], [0.09, 0.03], [0.022, 0.42], [0.001, 0.44]], 16);
  const coneMat = surface('plastic', { color: 0xf06a1c, roughness: 0.5 });
  const cones = new THREE.InstancedMesh(coneGeo, coneMat, 8);
  for (let i = 0; i < 8; i++) {
    m4.makeTranslation(-14 + i * 1.3, -0.06, 13.4);
    cones.setMatrixAt(i, m4);
  }
  cones.castShadow = true; g.add(cones);

  // feather flags round the venue
  const flags: [number, number, string, string][] = [
    [-19.5, -12.6, '#d63a2f', title], [-7, -13.2, '#2557c9', 'RUTTWORKS'], [7, -13.2, '#1d1d1f', 'BRACKENBANK'],
    [19.5, -12.6, '#d63a2f', title], [20.2, 0, '#2557c9', 'RUTTWORKS'], [-20.2, 0, '#1d1d1f', 'BRACKENBANK'],
    [-8.6, 12.6, '#d63a2f', 'PIT ROW'], [5.6, 12.2, '#2557c9', 'RUTTWORKS'],
  ];
  flags.forEach(([x, z, c, t], i) => featherFlag(g, x, z, c, t, (i * 1.3) % 6.28));

  // marshal posts: a step stool and a shade umbrella on two outside corners
  const marshal = (x: number, z: number) => {
    const mg = new THREE.Group();
    const stoolM = surface('paint', { color: 0xf2c230, metalness: 0.2 });
    box(0.4, 0.04, 0.35, stoolM, 0, 0.5, 0, mg);
    for (const sx of [-0.17, 0.17]) for (const sz of [-0.14, 0.14]) box(0.03, 0.5, 0.03, stoolM, sx, 0.25, sz, mg);
    const umb = new THREE.Mesh(new THREE.ConeGeometry(0.9, 0.3, 8, 1, true), surface('fabric', { color: 0xe8e6e0, repeat: [4, 4], side: THREE.DoubleSide }));
    umb.position.set(0.15, 2.0, 0); umb.castShadow = true; mg.add(umb);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 2.0, 8), std(0x9aa0a8, 0.4, 0.6)); pole.position.set(0.15, 1.0, 0); mg.add(pole);
    mg.position.set(x, -0.06, z);
    g.add(mg);
    contactShadow(g, x, z, 1.2, 1.2, -0.05, 0.6);
  };
  for (const [mx, mz] of [[-18.6, -9.5], [18.6, -9.5]]) if (Math.abs(track.queryGlobal(mx, mz).d) > hw + 1.2) marshal(mx, mz);

  // lap board near the start line: post + dark panel with amber digits
  {
    const p = track.pointAt(track.startS, hw + 1.6);
    const lb = new THREE.Group();
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 2.4, 10), std(0x2a2c30, 0.5, 0.5)); post.position.y = 1.2; lb.add(post);
    box(1.4, 0.75, 0.1, std(0x16171a, 0.5), 0, 2.6, 0, lb);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.66), new THREE.MeshStandardMaterial({
      map: canvasTex(512, 256, (c) => {
        c.fillStyle = '#0b0c0e'; c.fillRect(0, 0, 512, 256);
        c.fillStyle = '#f2a630'; c.font = '900 64px "Barlow Condensed", system-ui, sans-serif'; c.fillText(title, 22, 70);
        c.font = '700 56px ui-monospace, monospace'; c.fillText('LAP  --/3', 22, 150); c.fillText('BEST --.--', 22, 220);
      }), emissive: 0xf2a630, emissiveIntensity: 0.25, roughness: 0.4, side: THREE.DoubleSide,
    }));
    face.position.z = 0.056; lb.add(face);
    lb.position.set(p.x, -0.06, p.z);
    lb.lookAt(0, 0, 14);
    g.add(lb);
  }

  // hose reel cart for watering the track, beside the stand
  {
    const hc = new THREE.Group();
    const frame = surface('paint', { color: 0x2f7a3a, metalness: 0.3 });
    for (const s of [-0.22, 0.22]) {
      const w = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.03, 8, 20), KIT.rubber); w.position.set(0, 0.2, s); hc.add(w);
    }
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.36, 18), frame); drum.rotation.x = Math.PI / 2; drum.position.y = 0.4; hc.add(drum);
    for (let i = 0; i < 6; i++) { const t = new THREE.Mesh(new THREE.TorusGeometry(0.205, 0.022, 6, 24), surface('rubber', { color: 0x2f7a3a })); t.position.set(0, 0.4, -0.15 + i * 0.06); hc.add(t); }
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.015, 6, 16, Math.PI), frame); handle.position.set(-0.2, 0.55, 0); handle.rotation.set(0, Math.PI / 2, 0.6); hc.add(handle);
    hc.position.set(6.6, -0.06, 12.6); hc.rotation.y = 0.4; g.add(hc);
  }

  g.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && m.name !== 'tyre-lines') { m.castShadow = m.castShadow || false; m.receiveShadow = true; } });
  parent.add(g);
  return g;
}

/** Packed gravel strip under pit row. */
export function buildPitRowGround(parent: THREE.Object3D) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(14.5, 3.8), surface('dirt', { color: 0x8a8378, repeat: [10, 3], normalScale: 1.4 }));
  m.rotation.x = -Math.PI / 2; m.position.set(-11.4, -0.055, 15.8); m.receiveShadow = true;
  parent.add(m);
  return m;
}
