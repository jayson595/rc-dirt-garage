// Procedural dirt-track venue (PLACEHOLDER art following board panels 2, 2A–2D).
import * as THREE from 'three';
import { Track } from '../sim/Track';
import { buildTransmitter } from './garageProps';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { checkerTexture, labelTexture } from './textures';
import { lathe, roundedBox, surface } from './materials';
import { neighbourPit, stockPit } from './venueDecor';

const std = (color: number, rough = 0.8, metal = 0, map?: THREE.Texture) =>
  new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, map: map ?? null });

function box(w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D) {
  const mesh = new THREE.Mesh(roundedBox(w, h, d, Math.min(0.03, Math.min(w, h, d) * 0.25)), m);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

/** Look of a race venue: day dirt (Dirt Classic), night clay (Hilltop Clay), desert sand (Dune Run). */
export type VenueTheme = 'day' | 'night' | 'desert';
export const themeFor = (layout: string): VenueTheme => layout === 'clay' ? 'night' : layout === 'dunes' ? 'desert' : 'day';
export const trackTitle = (layout: string) => layout === 'clay' ? 'HILLTOP CLAY' : layout === 'dunes' ? 'DUNE RUN' : 'DIRT CLASSIC';

export const STAND = { x: 0, z: 14.4, deck: 2.2, eye: 2.2 + 1.65 };
export const PIT = { x: -9.6, z: 15.4, table: 0.76 };

export function buildSky(parent: THREE.Object3D, theme: VenueTheme = 'day') {
  const sky = new THREE.Mesh(new THREE.SphereGeometry(140, 32, 16), new THREE.MeshBasicMaterial({ map: theme === 'night' ? nightSkyTexture() : theme === 'desert' ? desertSkyTexture() : cloudSkyTexture(), side: THREE.BackSide, fog: false }));
  sky.name = 'sky';
  parent.add(sky);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), theme === 'desert' ? surface('dirt', { color: 0xd9b88a, repeat: [60, 60] }) : surface('grass', { repeat: [80, 80], color: theme === 'night' ? 0x4a5a3a : undefined }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.06; ground.receiveShadow = true;
  parent.add(ground);
  return sky;
}

/** Heightfield terrain sharing the exact height function used by physics. */
export function buildTerrain(track: Track, parent: THREE.Object3D, res = 0.3, theme: VenueTheme = 'day') {
  const x0 = -23, x1 = 23, z0 = -16, z1 = 12.6;
  const nx = Math.round((x1 - x0) / res), nz = Math.round((z1 - z0) / res);
  const geo = new THREE.PlaneGeometry(x1 - x0, z1 - z0, nx, nz);
  geo.rotateX(-Math.PI / 2);
  geo.translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const P = theme === 'night'
    ? { dirt: 0x9a5a3c, groove: 0x6a3624, berm: 0x8a4c32, infield: 0x7a5440, grass: 0x4f5a34 }   // tacky red clay
    : theme === 'desert'
      ? { dirt: 0xe4c391, groove: 0xc69d68, berm: 0xd8b07a, infield: 0xdcbc8c, grass: 0xb9a36a }  // wind-rippled sand
      : { dirt: 0xd2a46c, groove: 0xa77748, berm: 0xbb8a55, infield: 0xb38d61, grass: 0x8f8a55 };
  const dirt = new THREE.Color(P.dirt), groove = new THREE.Color(P.groove), berm = new THREE.Color(P.berm);
  const infield = new THREE.Color(P.infield), grass = new THREE.Color(P.grass);
  const c = new THREE.Color();
  const hw = track.halfWidth;
  let hint = 0;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const q = i % (nx + 1) === 0 ? track.queryGlobal(x, z) : track.queryLocal(x, z, hint, 40);
    hint = q.idx;
    const h = track.heightAt(q.s, q.d);
    pos.setY(i, h);
    const ad = Math.abs(q.d);
    const n = hash(x * 3.1, z * 2.7);
    if (ad < hw) {
      // darker groove on the racing line
      const line = Math.max(0, 1 - Math.abs(q.d + track.curvatureAt(q.s) * 2.2) / 0.7);
      c.copy(dirt).lerp(groove, line * 0.45);
      if (h > 0.08) c.lerp(berm, 0.3);
    } else {
      // mostly packed dirt like the reference, with patchy dry grass well away from the racing surface
      // smooth, sparse dry-grass patches (no blocky cells) that only appear well away from the racing line
      const g = Math.max(0, Math.min(1, (ad - hw - 2.0) / 3));
      const n2 = 0.5 + 0.25 * Math.sin(x * 0.45 + Math.sin(z * 0.3) * 2) + 0.25 * Math.sin(z * 0.5 + Math.cos(x * 0.27) * 2);
      const patch = Math.max(0, Math.min(1, (n2 - 0.55) * 3));
      c.copy(infield).lerp(grass, g * patch * 0.7);
    }
    if (theme === 'desert') c.multiplyScalar(0.96 + 0.06 * Math.sin(x * 2.4 + Math.sin(z * 0.8) * 2.5)); // ripples
    if (theme === 'night' && ad < hw) c.multiplyScalar(0.94 + 0.08 * Math.max(0, 1 - Math.abs(q.d + track.curvatureAt(q.s) * 2.2) / 0.7)); // watered sheen on the line
    c.multiplyScalar(0.92 + n * 0.16);
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  // packed dirt: vertex colours carry the layout (groove, berms, infield), the texture carries grain + pebbles
  const dirtMat = surface('dirt', { repeat: [30, 19], normalScale: theme === 'desert' ? 0.7 : 1.3, roughness: theme === 'night' ? 0.72 : undefined });
  dirtMat.vertexColors = true;
  const mesh = new THREE.Mesh(geo, dirtMat);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  parent.add(mesh);
  return mesh;
}

function hash(x: number, y: number) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Black pipe barriers on both edges of the course. */
export function buildBarriers(track: Track, parent: THREE.Object3D) {
  const g = new THREE.Group(); g.name = 'barriers';
  const mat = surface('corrugated', { color: 0x262626, repeat: [420, 1], normalScale: 1.6 });
  for (const side of [-1, 1]) {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < track.samples.length; i += 4) {
      const s = track.samples[i].s;
      const d = side * (track.halfWidth + 0.08);
      const p = track.pointAt(s, d);
      pts.push(new THREE.Vector3(p.x, track.heightAt(s, d) + 0.06, p.z));
    }
    const curve = new THREE.CatmullRomCurve3(pts, true);
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, pts.length * 3, 0.065, 10, true), mat);
    tube.castShadow = true;
    g.add(tube);
  }
  parent.add(g);
  return g;
}

export function buildStartLine(track: Track, parent: THREE.Object3D, title = 'DIRT CLASSIC') {
  const g = new THREE.Group(); g.name = 'start-line';
  const p = track.sampleAt(track.startS);
  const heading = Math.atan2(p.tz, p.tx);
  const line = new THREE.Mesh(new THREE.PlaneGeometry(0.5, track.halfWidth * 2), new THREE.MeshStandardMaterial({ map: checkerTexture(4), roughness: 0.9 }));
  line.rotation.x = -Math.PI / 2;
  line.rotation.z = -heading;
  line.position.set(p.x, track.heightAt(track.startS, 0) + 0.012, p.z);
  g.add(line);
  // gantry
  const post = std(0x1d1d1f, 0.5, 0.4);
  for (const side of [-1, 1]) {
    const q = track.pointAt(track.startS, side * (track.halfWidth + 0.45));
    box(0.12, 1.8, 0.12, post, q.x, 0.9, q.z, g);
  }
  const a = track.pointAt(track.startS, 0);
  const beam = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.4, track.halfWidth * 2 + 1.0), [
    std(0x1d1d1f), std(0x1d1d1f), std(0x1d1d1f), std(0x1d1d1f),
    new THREE.MeshStandardMaterial({ map: labelTexture(title, { bg: '#1c1c1e', stripe: '#d63a2f', w: 1024, h: 160, font: '800 110px "Barlow Condensed", system-ui, sans-serif' }) }),
    new THREE.MeshStandardMaterial({ map: labelTexture(title, { bg: '#1c1c1e', stripe: '#d63a2f', w: 1024, h: 160, font: '800 110px "Barlow Condensed", system-ui, sans-serif' }) }),
  ]);
  beam.position.set(a.x, 1.8, a.z);
  beam.rotation.y = -heading;
  beam.castShadow = true;
  g.add(beam);
  parent.add(g);
  return g;
}

/** Small flags at each checkpoint plus one glowing guide arch moved by the session in practice. */
export function buildCheckpointMarkers(track: Track, parent: THREE.Object3D) {
  const g = new THREE.Group(); g.name = 'checkpoints';
  const flagMat = std(0xf2c230, 0.6);
  for (const s of track.checkpoints) {
    for (const side of [-1, 1]) {
      const p = track.pointAt(s, side * (track.halfWidth + 0.25));
      const h = track.heightAt(s, side * (track.halfWidth + 0.25));
      box(0.02, 0.5, 0.02, std(0xeeeeee), p.x, h + 0.25, p.z, g);
      box(0.14, 0.09, 0.005, flagMat, p.x + 0.07, h + 0.45, p.z, g);
    }
  }
  const arch = new THREE.Mesh(new THREE.TorusGeometry(track.halfWidth + 0.1, 0.035, 6, 32, Math.PI),
    new THREE.MeshBasicMaterial({ color: 0xffd43b, transparent: true, opacity: 0.55, depthWrite: false }));
  arch.name = 'guide-arch';
  g.add(arch);
  parent.add(g);
  return { group: g, arch };
}

export function buildStand(parent: THREE.Object3D) {
  const g = new THREE.Group(); g.name = 'drivers-stand';
  const wood = surface('planks', { repeat: [3, 1], color: 0xd9c4a6 });
  const post = surface('wood', { repeat: [0.3, 2], color: 0xc9a77a });
  const { x, z, deck } = STAND;
  box(9, 0.12, 2.6, wood, x, deck, z + 0.2, g);
  for (const dz of [-1.0, 1.4]) box(9, 0.22, 0.12, post, x, deck - 0.17, z + dz, g); // joists
  // front posts only at the ends so the operator's view stays open
  for (const [dx, dz] of [[-4.4, -1.1], [4.4, -1.1], [-4.4, 1.4], [-1.5, 1.4], [1.5, 1.4], [4.4, 1.4]]) {
    box(0.16, deck + 2.5, 0.16, post, x + dx, (deck + 2.5) / 2, z + dz, g);
  }
  // railing
  box(9, 0.07, 0.11, post, x, deck + 1.05, z - 1.05, g);
  box(9, 0.05, 0.05, post, x, deck + 0.55, z - 1.05, g);
  for (let i = 0; i <= 18; i++) box(0.045, 1.0, 0.045, post, x - 4.5 + i * 0.5, deck + 0.5, z - 1.05, g);
  // banner under the deck
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(5, 0.8), new THREE.MeshStandardMaterial({ map: labelTexture('DRIVERS STAND', { bg: '#1c1c1e', stripe: '#d63a2f', w: 1024, h: 160, font: '800 100px "Barlow Condensed", system-ui, sans-serif' }) }));
  sign.position.set(x, deck - 0.7, z - 1.1); sign.rotation.y = Math.PI; g.add(sign);
  // roof
  const roofMat = surface('corrugated', { color: 0x8a8f96, metalness: 0.6, repeat: [60, 1] });
  const roofMesh = box(3.0, 0.05, 9.4, roofMat, x, deck + 2.56, z + 0.2, g);
  roofMesh.rotation.y = Math.PI / 2;
  box(9.4, 0.14, 0.08, post, x, deck + 2.47, z - 1.15, g);
  // stairs
  for (let i = 0; i < 9; i++) box(1.0, 0.06, 0.32, wood, x + 5.1, 0.12 + i * 0.24, z + 1.5 - i * 0.18, g);
  for (const dx of [-0.52, 0.52]) {
    const stringer = box(0.06, 0.2, 2.6, post, x + 5.1 + dx, 1.1, z + 0.75, g);
    stringer.rotation.x = Math.atan2(2.16, 1.6) - Math.PI / 2 + 0.6;
  }
  g.traverse((o) => { o.castShadow = true; o.receiveShadow = true; });
  parent.add(g);
  return g;
}

export function buildPit(parent: THREE.Object3D) {
  const g = new THREE.Group(); g.name = 'pit';
  const { x, z, table } = PIT;
  // canopy
  const legMat = surface('paint', { color: 0xb8bcc4, metalness: 0.6 });
  canopy(g, x, z, 3.1, 0xc8352b, legMat, 'PIT ROW');
  // folding table (matte top so it doesn't mirror the sky)
  const top = surface('plastic', { color: 0xdedbd2, roughness: 0.88, repeat: [8, 4], envMapIntensity: 0.3 });
  box(1.9, 0.04, 0.8, top, x, table, z, g);
  for (const dx of [-0.85, 0.85]) for (const dz of [-0.33, 0.33]) box(0.03, table, 0.03, legMat, x + dx, table / 2, z + dz, g);
  for (const dx of [-0.85, 0.85]) box(0.025, 0.025, 0.66, legMat, x + dx, 0.2, z, g); // leg braces
  // the player's transmitter, and everything else a racer brings to the pit
  buildTransmitter(g, new THREE.Vector3(x - 0.65, table + 0.02, z + 0.05), 0.4);
  stockPit(g, x, z, table);
  // chairs
  for (const dx of [-0.6, 0.6]) campChair(g, x + dx, z + 1.0, Math.PI + (dx > 0 ? -0.2 : 0.2));
  g.traverse((o) => { o.castShadow = true; o.receiveShadow = true; });
  parent.add(g);
  return g;
}

export function buildSurroundings(parent: THREE.Object3D, theme: VenueTheme = 'day') {
  const g = new THREE.Group(); g.name = 'surroundings';
  // perimeter boards with generic sponsor-style text
  const boardTex = labelTexture('RC DIRT', { bg: '#1c1c1e', stripe: '#d63a2f', w: 512, h: 128 });
  const checker = checkerTexture(6);
  const fabricN = surface('fabric', { repeat: [8, 2] });
  const mats = [boardTex, checker].map((map) => new THREE.MeshStandardMaterial({ map, normalMap: fabricN.normalMap, roughness: 0.85 }));
  const runs: [number, number, number, number][] = [[-21, -13.8, 21, -13.8], [21, -13.8, 21, 11.4], [-21, 11.4, -21, -13.8], [-21, 11.4, -5.2, 11.4], [5.2, 11.4, 21, 11.4]];
  for (const [ax, az, bx, bz] of runs) {
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.floor(len / 2.4);
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const b = new THREE.Mesh(roundedBox(2.3, 0.55, 0.04, 0.012), mats[i % 2]);
      b.position.set(ax + (bx - ax) * t, 0.3, az + (bz - az) * t);
      b.rotation.y = -Math.atan2(bz - az, bx - ax);
      g.add(b);
    }
  }
  // trees (instanced)
  const trunkGeo = new THREE.CylinderGeometry(0.12, 0.24, 2.4, 9);
  const leafGeo = pineCrown();
  const trees: THREE.Vector3[] = [];
  for (let i = 0; i < (theme === 'desert' ? 0 : 70); i++) {
    const a = (i / 70) * Math.PI * 2 + hash(i, 1) * 0.08;
    const r = 30 + hash(i, 7) * 14;
    const p = new THREE.Vector3(Math.cos(a) * r * 1.15, 0, Math.sin(a) * r * 0.85 - 4);
    if (p.z > 10) p.z += 12; // keep the stand side open
    trees.push(p);
  }
  const trunks = new THREE.InstancedMesh(trunkGeo, surface('bark', { repeat: [2, 3] }), trees.length);
  const leaves = new THREE.InstancedMesh(leafGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, vertexColors: true }), trees.length);
  const m = new THREE.Matrix4();
  trees.forEach((p, i) => {
    const s = 0.8 + hash(i, 3) * 0.7;
    m.compose(new THREE.Vector3(p.x, 1.2 * s, p.z), new THREE.Quaternion(), new THREE.Vector3(s, s, s)); trunks.setMatrixAt(i, m);
    m.compose(new THREE.Vector3(p.x, 1.6 * s, p.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), hash(i, 2) * 6.28), new THREE.Vector3(s, s * (0.9 + hash(i, 5) * 0.5), s)); leaves.setMatrixAt(i, m);
    const col = new THREE.Color(0xffffff).multiplyScalar(0.8 + hash(i, 9) * 0.35);
    leaves.setColorAt(i, col);
  });
  g.add(trunks, leaves);
  if (theme === 'desert') buildDesertDecor(g);
  // light poles (the night track has a full set, lit)
  const poleMat = surface('paint', { color: 0x9aa0a8, metalness: 0.6 });
  const poles = theme === 'night' ? [[-20, -13], [0, -14.5], [20, -13], [-21.5, -1.5], [21.5, -1.5], [-20, 10], [20, 10]] : [[-20, -13], [20, -13], [-20, 10], [20, 10]];
  const glowTex = theme === 'night' ? (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const q = c.getContext('2d')!; const rg = q.createRadialGradient(64, 64, 0, 64, 64, 64); rg.addColorStop(0, 'rgba(255,248,230,1)'); rg.addColorStop(0.25, 'rgba(255,240,210,.55)'); rg.addColorStop(1, 'rgba(255,240,210,0)'); q.fillStyle = rg; q.fillRect(0, 0, 128, 128); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })() : null;
  for (const [x, z] of poles) {
    const pole = new THREE.Mesh(lathe([[0.001, 0], [0.16, 0], [0.16, 0.3], [0.1, 0.4], [0.07, 9], [0.001, 9]], 12), poleMat);
    pole.position.set(x, 0, z); pole.castShadow = true; g.add(pole);
    box(1.6, 0.08, 0.08, poleMat, x, 8.9, z, g);
    for (const dx of [-0.55, 0, 0.55]) {
      const head = box(0.42, 0.32, 0.18, surface('paint', { color: 0x2a2c30 }), x + dx, 9.1, z, g);
      head.rotation.x = -0.35;
      const lens = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.24), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4e0, emissiveIntensity: theme === 'night' ? 3 : 0.6 }));
      lens.position.set(0, -0.0, 0.095); head.add(lens);
      head.lookAt(0, 0, 0);
    }
    if (glowTex) { // lamp glare seen from the stand
      const glare = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
      glare.position.set(x, 9.1, z); glare.scale.setScalar(3.2); glare.name = 'glare'; parent.add(glare);
    }
  }
  // spectator tents / pit tents
  const tentCols = [0x2557c9, 0xc8352b, 0xe8e6e0, 0x2557c9, 0x1c1c1e, 0xc8352b, 0xe8e6e0];
  const legMat = surface('paint', { color: 0xb8bcc4, metalness: 0.6 });
  tentCols.forEach((col, i) => canopy(g, -18 + i * 6, -18.5, 2.9, col, legMat));
  for (let i = 0; i < 3; i++) {
    const tx = -16 + i * 3.6, tz = 16.2;
    if (Math.abs(tx - PIT.x) < 2.5) continue;
    canopy(g, tx, tz, 2.7, [0x2557c9, 0x1c1c1e, 0xe8e6e0][i], legMat);
    neighbourPit(g, tx, tz, i, campChair);
  }
  // one more pit on the other side of ours
  canopy(g, -6.1, 16.2, 2.7, 0xc8352b, legMat);
  neighbourPit(g, -6.1, 16.2, 3, campChair);
  // race control tower
  box(4, 3, 3, surface('drywall', { color: 0xe8e6e0, repeat: [3, 2] }), 14, 1.5, -17.5, g);
  box(4.3, 0.12, 3.3, surface('paint', { color: 0x2a2c30 }), 14, 3.06, -17.5, g);
  const glass = new THREE.MeshStandardMaterial({ color: 0x1d2a35, roughness: 0.05, metalness: 0.6 });
  box(3.6, 0.8, 0.04, glass, 14, 2.0, -15.99, g);
  const rc = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 0.6), new THREE.MeshStandardMaterial({ map: labelTexture('RACE CONTROL', { bg: '#1c1c1e', stripe: '#d63a2f' }) }));
  rc.position.set(14, 2.7, -15.96); rc.scale.set(1, 0.5, 1); g.add(rc);
  parent.add(g);
  return g;
}

/** Desert dressing: saguaros, barrel cacti, sandstone boulders and a few dead shrubs round the outside. */
function buildDesertDecor(g: THREE.Object3D) {
  const cactusM = new THREE.MeshStandardMaterial({ color: 0x4f7a3e, roughness: 0.75 });
  const rib = (h: number, r: number) => { const geo = new THREE.CylinderGeometry(r, r * 1.05, h, 10, 1); geo.translate(0, h / 2, 0); return geo; };
  const capG = new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + hash(i, 3) * 0.2, r = 27 + hash(i, 5) * 16;
    const x = Math.cos(a) * r * 1.1, z = Math.sin(a) * r * 0.8 - 4;
    if (z > 11) continue;
    const s = 0.7 + hash(i, 8) * 0.6, c = new THREE.Group();
    const trunk = new THREE.Mesh(rib(3.2, 0.22), cactusM); c.add(trunk);
    const top = new THREE.Mesh(capG, cactusM); top.scale.set(0.22, 0.22, 0.22); top.position.y = 3.2; c.add(top);
    for (const side of [-1, 1]) {
      if (hash(i, side + 10) < 0.3) continue;
      const hgt = 1.2 + hash(i, side) * 0.9;
      const out = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.55, 8), cactusM); out.rotation.z = side * Math.PI / 2; out.position.set(side * 0.4, hgt, 0); c.add(out);
      const up = new THREE.Mesh(rib(0.9 + hash(i, side + 4) * 0.6, 0.15), cactusM); up.position.set(side * 0.66, hgt, 0); c.add(up);
      const cap = new THREE.Mesh(capG, cactusM); cap.scale.setScalar(0.15); cap.position.set(side * 0.66, hgt + up.geometry.parameters.height, 0); c.add(cap);
    }
    c.position.set(x, -0.06, z); c.scale.setScalar(s); c.rotation.y = hash(i, 9) * 6; c.traverse((o) => { o.castShadow = true; }); g.add(c);
  }
  const rockM = new THREE.MeshStandardMaterial({ color: 0xb8794a, roughness: 0.9, flatShading: true });
  for (let i = 0; i < 30; i++) {
    const a = hash(i, 21) * Math.PI * 2, r = 24 + hash(i, 22) * 20;
    const x = Math.cos(a) * r * 1.1, z = Math.sin(a) * r * 0.8 - 4;
    if (z > 11) continue;
    const m = new THREE.Mesh(new THREE.DodecahedronGeometry(0.6 + hash(i, 23) * 1.6, 0), rockM);
    m.scale.set(1.3, 0.55 + hash(i, 24) * 0.4, 1); m.rotation.y = hash(i, 25) * 6; m.position.set(x, 0.1, z); m.castShadow = true; g.add(m);
  }
  const barrelM = new THREE.MeshStandardMaterial({ color: 0x5f8a44, roughness: 0.7 });
  for (let i = 0; i < 18; i++) {
    const x = -20 + hash(i, 31) * 40, z = -13 + hash(i, 32) * 2.5;
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 8), barrelM); b.scale.set(1, 0.8, 1); b.position.set(x, 0.12, z - 1.8); b.castShadow = true; g.add(b);
  }
}

function nightSkyTexture() {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 512;
  const g = c.getContext('2d')!;
  const gr = g.createLinearGradient(0, 0, 0, 512);
  gr.addColorStop(0, '#05070f'); gr.addColorStop(0.4, '#0d1630'); gr.addColorStop(0.5, '#28304a'); gr.addColorStop(0.52, '#1a1d24'); gr.addColorStop(1, '#0b0c0f');
  g.fillStyle = gr; g.fillRect(0, 0, 1024, 512);
  let seed = 11; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let k = 0; k < 600; k++) { const y = rnd() * 240; g.fillStyle = `rgba(255,255,255,${0.25 + rnd() * 0.7})`; const r = rnd() < 0.08 ? 1.6 : 0.8; g.fillRect(rnd() * 1024, y, r, r); }
  // town glow on the horizon
  const hg = g.createLinearGradient(0, 220, 0, 262); hg.addColorStop(0, 'rgba(255,170,90,0)'); hg.addColorStop(1, 'rgba(255,170,90,0.35)');
  g.fillStyle = hg; g.fillRect(0, 220, 1024, 42);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping;
  return t;
}

function desertSkyTexture() {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 512;
  const g = c.getContext('2d')!;
  const gr = g.createLinearGradient(0, 0, 0, 512);
  gr.addColorStop(0, '#3d7fd0'); gr.addColorStop(0.38, '#8ec3ec'); gr.addColorStop(0.49, '#f4dcb4'); gr.addColorStop(0.5, '#d9b88a'); gr.addColorStop(1, '#c9a676');
  g.fillStyle = gr; g.fillRect(0, 0, 1024, 512);
  // distant mesas on the horizon
  g.fillStyle = 'rgba(176,112,72,0.85)';
  let seed = 5; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let k = 0; k < 9; k++) { const x = rnd() * 1024, w = 60 + rnd() * 160, hgt = 10 + rnd() * 22; g.beginPath(); g.moveTo(x - w * 0.6, 256); g.lineTo(x - w * 0.4, 256 - hgt); g.lineTo(x + w * 0.4, 256 - hgt); g.lineTo(x + w * 0.6, 256); g.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping;
  return t;
}

// ---------------------------------------------------------------- shared venue builders
export function cloudSkyTexture() {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 512;
  const g = c.getContext('2d')!;
  const gr = g.createLinearGradient(0, 0, 0, 512);
  gr.addColorStop(0, '#4f8fd6'); gr.addColorStop(0.42, '#93c0ea'); gr.addColorStop(0.5, '#dfe9ee'); gr.addColorStop(1, '#cfd6d2');
  g.fillStyle = gr; g.fillRect(0, 0, 1024, 512);
  // soft cumulus: clusters of blurred white puffs above the horizon
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let k = 0; k < 26; k++) {
    const cx = rnd() * 1024, cy = 90 + rnd() * 150, w = 40 + rnd() * 90;
    for (let j = 0; j < 14; j++) {
      const x = cx + (rnd() - 0.5) * w * 2, y = cy + (rnd() - 0.6) * w * 0.35, r = w * (0.25 + rnd() * 0.35);
      const rg = g.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, 'rgba(255,255,255,0.55)'); rg.addColorStop(0.6, 'rgba(250,250,252,0.25)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = rg; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping;
  return t;
}

/** Layered, jagged pine crown with vertex-colour shading (darker inside, lighter tips). */
export function pineCrown() {
  const parts: THREE.BufferGeometry[] = [];
  const layers = 5;
  for (let i = 0; i < layers; i++) {
    const r = 1.7 * (1 - i / (layers + 0.5)), h = 1.5;
    const cone = new THREE.ConeGeometry(r, h, 11, 2, true);
    const pos = cone.attributes.position;
    for (let k = 0; k < pos.count; k++) {
      const y = pos.getY(k);
      if (y < -h / 2 + 0.01) { // ragged bottom edge, drooping branch tips
        const a = Math.atan2(pos.getZ(k), pos.getX(k));
        const jag = 1 + 0.18 * Math.sin(a * 7 + i);
        pos.setX(k, pos.getX(k) * jag); pos.setZ(k, pos.getZ(k) * jag); pos.setY(k, y - 0.15 * (jag - 0.8));
      }
    }
    cone.translate(0, 1.0 + i * 0.85, 0);
    parts.push(cone.toNonIndexed());
  }
  const geo = mergeGeometries(parts, false)!;
  geo.computeVertexNormals();
  const col = new Float32Array(geo.attributes.position.count * 3);
  const base = new THREE.Color(0x2f5a28), tip = new THREE.Color(0x5f8a3e), c = new THREE.Color();
  for (let k = 0; k < geo.attributes.position.count; k++) {
    const x = geo.attributes.position.getX(k), z = geo.attributes.position.getZ(k);
    const t = Math.min(1, Math.hypot(x, z) / 1.6);
    c.copy(base).lerp(tip, t * 0.8);
    col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

/** Pop-up canopy: fabric peaked roof with a printed valance on four legs. */
function canopy(parent: THREE.Object3D, x: number, z: number, size: number, color: number, legMat: THREE.Material, label?: string) {
  const g = new THREE.Group();
  const half = size / 2;
  for (const dx of [-half, half]) for (const dz of [-half, half]) box(0.05, 2.3, 0.05, legMat, dx * 0.97, 1.15, dz * 0.97, g);
  const fabric = surface('fabric', { color, repeat: [6, 6], side: THREE.DoubleSide });
  const roof = new THREE.Mesh(new THREE.ConeGeometry(half * Math.SQRT2, 0.55, 4, 2, true), fabric);
  roof.rotation.y = Math.PI / 4; roof.position.y = 2.58; roof.castShadow = true; g.add(roof);
  const valMat = label
    ? new THREE.MeshStandardMaterial({ map: labelTexture(label, { bg: `#${color.toString(16).padStart(6, '0')}`, fg: '#f4efe6', w: 512, h: 96, font: '800 56px "Barlow Condensed", system-ui, sans-serif' }), side: THREE.DoubleSide, roughness: 0.85 })
    : fabric;
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    // printed valance: two single-sided panels back to back so the lettering reads correctly from both sides
    for (const flip of [0, Math.PI]) {
      const v = new THREE.Mesh(new THREE.PlaneGeometry(size, 0.22), label ? valMat.clone() : valMat);
      (v.material as THREE.Material).side = label ? THREE.FrontSide : THREE.DoubleSide;
      v.position.set(Math.sin(a) * (half + (flip ? -0.004 : 0.004)), 2.2, Math.cos(a) * (half + (flip ? -0.004 : 0.004))); v.rotation.y = a + flip; g.add(v);
      if (!label) break;
    }
  }
  g.position.set(x, 0, z);
  parent.add(g);
  return g;
}

/** Folding camp chair with fabric seat and back. */
export function campChair(parent: THREE.Object3D, x: number, z: number, rotY: number) {
  const g = new THREE.Group();
  const frame = surface('paint', { color: 0x2a2c30, metalness: 0.5 });
  const cloth = surface('fabric', { color: 0x2557c9, repeat: [3, 3], side: THREE.DoubleSide });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const leg = box(0.025, 0.5, 0.025, frame, sx * 0.22, 0.25, sz * 0.2, g);
    leg.rotation.x = sz * 0.25;
  }
  const seat = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.42, 1, 4), cloth);
  const sp = seat.geometry.attributes.position; for (let k = 0; k < sp.count; k++) sp.setZ(k, -0.03 * (1 - Math.pow(sp.getY(k) / 0.21, 2)));
  seat.geometry.computeVertexNormals();
  seat.rotation.x = -Math.PI / 2; seat.position.y = 0.46; g.add(seat);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.45), cloth);
  back.position.set(0, 0.72, -0.22); back.rotation.x = 0.15; g.add(back);
  for (const sx of [-1, 1]) box(0.06, 0.03, 0.4, cloth, sx * 0.25, 0.62, 0, g);
  g.position.set(x, 0, z); g.rotation.y = rotY;
  g.traverse((o) => { o.castShadow = true; });
  parent.add(g);
}
