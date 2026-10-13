// Suburban backyard props for the mowing job: gabled neighbour houses with siding, shingle roofs,
// framed windows, doors, chimneys and gutters; a broadleaf lawn tree; rounded shrubs.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { roundedBox, surface } from './materials';

function tex(w: number, hgt: number, draw: (g: CanvasRenderingContext2D) => void, rep: [number, number] = [1, 1]) {
  const c = document.createElement('canvas'); c.width = w; c.height = hgt; draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...rep); t.anisotropy = 4; return t;
}
const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

let shingleTex: THREE.Texture | null = null;
function shingles() {
  return shingleTex ??= tex(256, 256, (g) => {
    g.fillStyle = '#4a3f3b'; g.fillRect(0, 0, 256, 256);
    for (let row = 0; row < 16; row++) for (let i = 0; i < 9; i++) {
      const x = i * 32 - (row % 2) * 16, y = row * 16, v = 52 + ((i * 37 + row * 11) % 24);
      g.fillStyle = `rgb(${v + 14},${v + 4},${v})`; g.fillRect(x + 1, y + 1, 30, 14);
      g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(x, y + 13, 32, 3);
    }
  });
}
function siding(color: number, w: number, hgt: number) {
  return tex(128, 128, (g) => {
    g.fillStyle = hex(color); g.fillRect(0, 0, 128, 128);
    for (let y = 0; y < 128; y += 16) { g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(0, y + 13, 128, 3); g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(0, y, 128, 2); }
  }, [w / 1.2, hgt / 1.2]);
}

/** A two-storey gabled house, front facing +z. Origin at ground centre. */
export function gableHouse(w: number, d: number, wallH: number, color: number, trim = 0xf2efe8) {
  const g = new THREE.Group();
  const wallMat = new THREE.MeshStandardMaterial({ map: siding(color, w, wallH), roughness: 0.8 });
  const sideMat = new THREE.MeshStandardMaterial({ map: siding(color, d, wallH), roughness: 0.8 });
  const trimMat = new THREE.MeshStandardMaterial({ color: trim, roughness: 0.6 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x24323c, roughness: 0.08, metalness: 0.4, clearcoat: 1, envMapIntensity: 1.4 });
  const box = new THREE.Mesh(new THREE.BoxGeometry(w, wallH, d), [sideMat, sideMat, wallMat, wallMat, wallMat, wallMat]);
  box.position.y = wallH / 2; box.castShadow = true; box.receiveShadow = true; g.add(box);
  // gable ends (siding) + roof slabs (shingles) with overhang
  const rise = w * 0.32;
  const gable = new THREE.Shape(); gable.moveTo(-w / 2, 0); gable.lineTo(w / 2, 0); gable.lineTo(0, rise); gable.lineTo(-w / 2, 0);
  for (const sz of [-1, 1]) {
    const m = new THREE.Mesh(new THREE.ShapeGeometry(gable), wallMat); m.position.set(0, wallH, sz * d / 2); if (sz < 0) m.rotation.y = Math.PI; g.add(m);
  }
  const slope = Math.atan2(rise, w / 2), len = Math.hypot(rise, w / 2) + 0.35;
  const roofMat = new THREE.MeshStandardMaterial({ map: shingles(), roughness: 0.85 });
  roofMat.map = roofMat.map!.clone(); roofMat.map.repeat.set(d / 1.4, len / 1.4); roofMat.map.needsUpdate = true;
  for (const sx of [-1, 1]) {
    const r = new THREE.Mesh(new THREE.BoxGeometry(len, 0.08, d + 0.5), roofMat);
    r.position.set(sx * (w / 4 + 0.08), wallH + rise / 2 + 0.02, 0); r.rotation.z = -sx * slope;
    r.castShadow = true; g.add(r);
    // gutter along the eave
    const gut = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, d + 0.5, 8, 1, false, 0, Math.PI), trimMat);
    gut.rotation.x = Math.PI / 2; gut.rotation.y = Math.PI; gut.position.set(sx * (w / 2 + 0.26), wallH - 0.08, 0); g.add(gut);
  }
  const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.1, d + 0.5), roofMat); ridge.position.set(0, wallH + rise + 0.05, 0); g.add(ridge);
  // chimney
  const ch = new THREE.Mesh(roundedBox(0.6, 1.6, 0.6, 0.03), surface('concrete', { color: 0x9a5a44, repeat: [1, 2] })); ch.position.set(w * 0.25, wallH + rise * 0.6, -d * 0.2); ch.castShadow = true; g.add(ch);
  // windows (both storeys) + door on the front, windows on the back too
  const win = (x: number, y: number, z: number, rotY: number, ww = 1.0, wh = 1.2) => {
    const f = new THREE.Group(); f.position.set(x, y, z); f.rotation.y = rotY; g.add(f);
    const frame = new THREE.Mesh(roundedBox(ww + 0.14, wh + 0.14, 0.08, 0.02), trimMat); f.add(frame);
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(ww, wh), glass); pane.position.z = 0.042; f.add(pane);
    const mull = new THREE.Mesh(new THREE.BoxGeometry(0.05, wh, 0.03), trimMat); mull.position.z = 0.05; f.add(mull);
    const tr = new THREE.Mesh(new THREE.BoxGeometry(ww, 0.05, 0.03), trimMat); tr.position.z = 0.05; f.add(tr);
    const sill = new THREE.Mesh(roundedBox(ww + 0.3, 0.06, 0.16, 0.02), trimMat); sill.position.set(0, -wh / 2 - 0.1, 0.06); f.add(sill);
  };
  for (const face of [1, -1]) {
    const z = face * (d / 2 + 0.01), rot = face > 0 ? 0 : Math.PI;
    for (const x of [-w * 0.3, w * 0.3]) win(x, wallH * 0.72, z, rot);
    win(face > 0 ? w * 0.3 : -w * 0.3, wallH * 0.27, z, rot);
  }
  const door = new THREE.Mesh(roundedBox(1.0, 2.1, 0.08, 0.02), new THREE.MeshStandardMaterial({ color: 0x2f4f6a, roughness: 0.45 }));
  door.position.set(-w * 0.28, 1.05, d / 2 + 0.03); g.add(door);
  const dframe = new THREE.Mesh(roundedBox(1.2, 2.25, 0.06, 0.02), trimMat); dframe.position.set(-w * 0.28, 1.1, d / 2 + 0.01); g.add(dframe);
  return g;
}

/** Broadleaf tree crown: lumpy clusters of leaf mass with darker undersides. Origin at the crown base. */
export function leafyCrown(seed = 1) {
  const parts: THREE.BufferGeometry[] = [];
  const rnd = (i: number) => { const s = Math.sin(i * 91.7 + seed * 13.1) * 43758.5; return s - Math.floor(s); };
  for (let i = 0; i < 9; i++) {
    const a = rnd(i) * Math.PI * 2, rr = i === 0 ? 0 : 0.7 + rnd(i + 3) * 0.6;
    const ico = new THREE.IcosahedronGeometry(0.85 + rnd(i + 7) * 0.5, 2);
    const p = ico.attributes.position as THREE.BufferAttribute;
    for (let k = 0; k < p.count; k++) { const n = 1 + 0.16 * Math.sin(p.getX(k) * 7 + i) * Math.cos(p.getZ(k) * 6 - i) + 0.08 * Math.sin(p.getY(k) * 11); p.setXYZ(k, p.getX(k) * n, p.getY(k) * n * 0.85, p.getZ(k) * n); }
    ico.translate(Math.cos(a) * rr, 0.9 + rnd(i + 11) * 1.1 + (i === 0 ? 0.6 : 0), Math.sin(a) * rr);
    parts.push(ico.toNonIndexed());
  }
  const geo = mergeGeometries(parts, false)!;
  geo.computeVertexNormals();
  const col = new Float32Array(geo.attributes.position.count * 3), c = new THREE.Color();
  const dark = new THREE.Color(0x2c4a1f), light = new THREE.Color(0x6e9a3e);
  for (let k = 0; k < geo.attributes.position.count; k++) {
    const ny = geo.attributes.normal.getY(k), y = geo.attributes.position.getY(k);
    c.copy(dark).lerp(light, THREE.MathUtils.clamp(0.45 + ny * 0.4 + (y - 1.4) * 0.12 + (Math.sin(k * 12.9898) * 0.5 + 0.5) * 0.15, 0, 1));
    col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

/** A rounded garden shrub (same leaf treatment, smaller). */
export function shrubGeometry(seed = 2, scale = 1) {
  const g = leafyCrown(seed); g.scale(0.32 * scale, 0.26 * scale, 0.32 * scale); g.translate(0, -0.12 * scale, 0); return g;
}

/** Tapered trunk with two forks into the crown. */
export function trunkGeometry(h = 2.2) {
  const parts = [new THREE.CylinderGeometry(0.13, 0.22, h, 10).translate(0, h / 2, 0).toNonIndexed()];
  for (const [ax, az] of [[0.5, 0.2], [-0.4, -0.3]]) {
    const b = new THREE.CylinderGeometry(0.06, 0.11, 1.2, 8); b.translate(0, 0.6, 0); b.rotateZ(-ax * 0.9); b.rotateX(az * 0.9); b.translate(0, h - 0.3, 0);
    parts.push(b.toNonIndexed());
  }
  return mergeGeometries(parts, false)!;
}
