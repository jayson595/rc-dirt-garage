// Reusable, non-primitive garage props: drawer chests with real bar pulls and drawer gaps, wrenches,
// hobby chargers, LiPo packs with leads, cables, tapered storage bins, kit boxes, shop lights and
// soft contact shadows. Geometry and materials are shared/cached to keep the scene mobile-friendly.
import * as THREE from 'three';
import { lathe, roundedBox, surface } from './materials';

const geoCache = new Map<string, THREE.BufferGeometry>();
function cached(key: string, make: () => THREE.BufferGeometry) {
  let g = geoCache.get(key);
  if (!g) { g = make(); geoCache.set(key, g); }
  return g;
}

export const KIT = {
  chrome: new THREE.MeshStandardMaterial({ color: 0xd6dade, roughness: 0.16, metalness: 1 }),
  steel: new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.32, metalness: 1 }),
  gap: new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 1 }),
  rubber: surface('rubber', { color: 0x161616, repeat: [2, 2] }),
  blackPlastic: surface('plastic', { color: 0x1c1c1f, roughness: 0.6, repeat: [2, 2] }),
};

function add(parent: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, shadow = true) {
  const o = new THREE.Mesh(geo, m);
  o.position.set(x, y, z);
  o.castShadow = shadow; o.receiveShadow = true;
  parent.add(o);
  return o;
}

/** Tubular bar pull on two standoffs, horizontal along x, facing +z. */
export function barPull(parent: THREE.Object3D, w: number, x: number, y: number, z: number, m: THREE.Material = KIT.chrome) {
  const g = new THREE.Group();
  const bar = add(g, cached(`pullbar${w.toFixed(3)}`, () => new THREE.CapsuleGeometry(0.0065, w, 4, 10).rotateZ(Math.PI / 2)), m, 0, 0, 0.026, false);
  void bar;
  for (const s of [-1, 1]) add(g, cached('pullpost', () => new THREE.CylinderGeometry(0.005, 0.0055, 0.026, 8).rotateX(Math.PI / 2)), m, s * w * 0.42, 0, 0.013, false);
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

/** Caster: lathed wheel in a steel fork on a swivel plate. */
export function caster(parent: THREE.Object3D, x: number, z: number, r = 0.035) {
  const g = new THREE.Group();
  const wheel = add(g, cached(`casterw${r}`, () => lathe([[0.004, -0.012], [r * 0.85, -0.012], [r, -0.006], [r, 0.006], [r * 0.85, 0.012], [0.004, 0.012]], 18).rotateX(Math.PI / 2)), KIT.rubber, 0, r, 0);
  wheel.rotation.y = Math.PI / 2;
  for (const s of [-1, 1]) add(g, cached(`casterf${r}`, () => roundedBox(0.004, r * 1.5, r * 0.9, 0.0015)), KIT.steel, s * 0.016, r * 1.25, 0, false);
  add(g, cached(`casterp${r}`, () => roundedBox(0.05, 0.006, 0.05, 0.002)), KIT.steel, 0, r * 2 + 0.006, 0, false);
  g.position.set(x, 0, z);
  parent.add(g);
  return g;
}

/**
 * Roll cabinet / tool chest: rounded carcass, inset drawer fronts with dark gaps, full-width bar pulls,
 * optional casters and a ribbed rubber top mat. Origin at the floor, front face toward +z.
 */
export function drawerChest(parent: THREE.Object3D, o: { w: number; h: number; d: number; drawers: number[]; color: number; casters?: boolean; topMat?: boolean; pullMat?: THREE.Material; metal?: number }) {
  const g = new THREE.Group();
  const lift = o.casters ? 0.085 : 0.0;
  const body = surface('paint', { color: o.color, metalness: o.metal ?? 0.35, roughness: 0.55, repeat: [2, 2] });
  const front = surface('paint', { color: new THREE.Color(o.color).multiplyScalar(1.08).getHex(), metalness: o.metal ?? 0.35, roughness: 0.45, repeat: [2, 2] });
  const H = o.h - lift;
  add(g, roundedBox(o.w, H, o.d, 0.018), body, 0, lift + H / 2, 0);
  // recessed front: a dark gap plane behind the drawer fronts
  add(g, new THREE.PlaneGeometry(o.w - 0.04, H - 0.05), KIT.gap, 0, lift + H / 2, o.d / 2 + 0.001, false);
  const total = o.drawers.reduce((a, b) => a + b, 0);
  let y = lift + H - 0.025;
  for (const share of o.drawers) {
    const dh = (H - 0.05) * (share / total);
    const fh = dh - 0.008;
    add(g, roundedBox(o.w - 0.05, fh, 0.022, 0.006), front, 0, y - dh / 2, o.d / 2 + 0.006);
    barPull(g, Math.min(0.5, o.w * 0.62), 0, y - Math.min(0.03, dh * 0.22), o.d / 2 + 0.017, o.pullMat ?? KIT.chrome);
    y -= dh;
  }
  if (o.casters) for (const sx of [-1, 1]) for (const sz of [-1, 1]) caster(g, sx * (o.w / 2 - 0.05), sz * (o.d / 2 - 0.05));
  else add(g, roundedBox(o.w - 0.02, 0.03, o.d - 0.04, 0.008), KIT.gap, 0, 0.015, -0.005, false); // toe kick
  if (o.topMat) add(g, roundedBox(o.w - 0.02, 0.006, o.d - 0.02, 0.003), surface('rubber', { color: 0x202022, repeat: [10, 6], normalScale: 1.5 }), 0, o.h + 0.003, 0, false);
  parent.add(g);
  return g;
}

/** Combination wrench: flat extruded shank with an open jaw and a ring end. Lies in the xy plane. */
export function wrenchGeometry(len: number) {
  return cached(`wrench${len.toFixed(3)}`, () => {
    const s = new THREE.Shape();
    const hw = len * 0.045, head = len * 0.11;
    s.moveTo(-len / 2 + head * 0.8, -hw);
    s.lineTo(len / 2 - head * 0.8, -hw * 0.8);
    s.absarc(len / 2 - head * 0.2, 0, head, -2.2, 2.2, false);
    s.lineTo(len / 2 - head * 0.8, hw * 0.8);
    s.lineTo(-len / 2 + head * 0.8, hw);
    s.absarc(-len / 2 + head * 0.1, 0, head * 0.95, 2.4, -2.4 + Math.PI * 2, false);
    const ring = new THREE.Path(); ring.absarc(-len / 2 + head * 0.1, 0, head * 0.55, 0, Math.PI * 2, true);
    s.holes.push(ring);
    const jaw = new THREE.Path();
    jaw.moveTo(len / 2 + head, -head * 0.42); jaw.lineTo(len / 2 - head * 0.45, -head * 0.42); jaw.lineTo(len / 2 - head * 0.45, head * 0.42); jaw.lineTo(len / 2 + head, head * 0.42);
    s.holes.push(jaw);
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.004, bevelEnabled: true, bevelThickness: 0.0015, bevelSize: 0.0015, bevelSegments: 2, curveSegments: 14 });
    g.translate(0, 0, -0.002);
    return g;
  });
}

/** Screwdriver / hex driver: lathed handle with grip flutes + steel shaft. Axis along +y, tip at top. */
export function driver(parent: THREE.Object3D, color: number, len = 0.07, hex = false) {
  const g = new THREE.Group();
  const handle = add(g, cached('drvhandle', () => lathe([[0.001, 0], [0.008, 0.001], [0.0105, 0.012], [0.0108, 0.045], [0.0095, 0.06], [0.006, 0.068], [0.004, 0.07], [0.001, 0.07]], 12)), surface('plastic', { color, roughness: 0.4 }), 0, 0, 0);
  void handle;
  add(g, cached('drvband', () => new THREE.CylinderGeometry(0.0112, 0.0112, 0.01, 12)), KIT.blackPlastic, 0, 0.03, 0, false);
  add(g, cached(`drvshaft${len}${hex}`, () => new THREE.CylinderGeometry(hex ? 0.0024 : 0.0021, hex ? 0.0024 : 0.0021, len, hex ? 6 : 8)), KIT.chrome, 0, 0.07 + len / 2, 0);
  parent.add(g);
  return g;
}

/** Soft contact shadow decal under an object (multiplied-looking dark radial falloff). */
const shadowTex = (() => {
  const c = document.createElement('canvas'); c.width = 128; c.height = 128;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(64, 64, 8, 64, 64, 64);
  gr.addColorStop(0, 'rgba(0,0,0,0.6)'); gr.addColorStop(0.55, 'rgba(0,0,0,0.32)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  return t;
})();
const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0.85, polygonOffset: true, polygonOffsetFactor: -2 });
export function contactShadow(parent: THREE.Object3D, x: number, z: number, w: number, d: number, y = 0.004, opacity = 1) {
  const m = opacity === 1 ? shadowMat : shadowMat.clone();
  if (opacity !== 1) m.opacity = 0.85 * opacity;
  const p = new THREE.Mesh(cached('shadowplane', () => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)), m);
  p.scale.set(w, 1, d);
  p.position.set(x, y, z);
  p.renderOrder = -1;
  parent.add(p);
  return p;
}

/** Tapered moulded storage bin (wider at the top) with a lip and a label recess. */
export function taperedBin(parent: THREE.Object3D, w: number, h: number, d: number, color: number, lidColor?: number) {
  const g = new THREE.Group();
  const geo = cached(`bin${w}${h}${d}`, () => {
    const b = roundedBox(w, h, d, 0.012);
    const p = b.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const t = (p.getY(i) + h / 2) / h; // 0 bottom .. 1 top
      const s = 0.9 + 0.1 * t;
      p.setX(i, p.getX(i) * s); p.setZ(i, p.getZ(i) * s);
    }
    b.computeVertexNormals();
    return b;
  });
  add(g, geo, surface('plastic', { color, roughness: 0.55 }), 0, h / 2, 0);
  add(g, roundedBox(w + 0.012, 0.014, d + 0.012, 0.005), surface('plastic', { color: lidColor ?? color, roughness: 0.5 }), 0, h - 0.004, 0);
  if (lidColor !== undefined) {
    add(g, roundedBox(w + 0.02, 0.03, d + 0.02, 0.01), surface('plastic', { color: lidColor, roughness: 0.5 }), 0, h + 0.016, 0);
    for (const s of [-1, 1]) add(g, roundedBox(0.012, 0.035, d * 0.3, 0.004), surface('plastic', { color: lidColor }), s * (w / 2 + 0.008), h - 0.01, 0, false);
  }
  parent.add(g);
  return g;
}

/** Printed cardboard kit box (original fictional art), lid seam and tape. */
export function kitBox(parent: THREE.Object3D, w: number, h: number, d: number, art: (c: CanvasRenderingContext2D, W: number, H: number) => void) {
  const g = new THREE.Group();
  const card = surface('fabric', { color: 0xc9a77a, roughness: 1, repeat: [2, 2], normalScale: 0.4 });
  add(g, roundedBox(w, h, d, 0.006), card, 0, h / 2, 0);
  const c = document.createElement('canvas'); c.width = 256; c.height = Math.round(256 * h / d);
  art(c.getContext('2d')!, c.width, c.height);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  const face = add(g, new THREE.PlaneGeometry(d - 0.012, h - 0.012), new THREE.MeshStandardMaterial({ map: t, roughness: 0.7 }), w / 2 + 0.001, h / 2, 0, false);
  face.rotation.y = Math.PI / 2;
  add(g, new THREE.BoxGeometry(w + 0.002, 0.004, d + 0.002), surface('plastic', { color: 0xa98a60 }), 0, h - 0.03, 0, false); // lid seam
  parent.add(g);
  return g;
}

/** Hobby charger: sloped-front moulded case, bezel + live display, encoder knob, buttons, banana jacks,
 *  balance port, vent slots, rubber feet. Origin at the base; display faces -x (toward the room). */
export function chargerBody(parent: THREE.Object3D, color: number, accent: number) {
  const g = new THREE.Group();
  const prof = new THREE.Shape();
  // side profile in (depth toward the wall = +u, height = v); the front (u=0) slopes back
  prof.moveTo(0, 0.004); prof.lineTo(0.22, 0.004); prof.quadraticCurveTo(0.24, 0.004, 0.24, 0.03);
  prof.lineTo(0.24, 0.1); prof.quadraticCurveTo(0.24, 0.12, 0.21, 0.12); prof.lineTo(0.06, 0.12);
  prof.quadraticCurveTo(0.035, 0.12, 0.028, 0.1); prof.lineTo(0.0, 0.03); prof.quadraticCurveTo(-0.004, 0.004, 0, 0.004);
  const geo = new THREE.ExtrudeGeometry(prof, { depth: 0.24, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 3, curveSegments: 8 });
  geo.translate(0, 0, -0.12); // front (u = 0) faces -x, back against the wall at +x
  geo.computeVertexNormals();
  const caseM = surface('plastic', { color, roughness: 0.5, repeat: [2, 2] });
  add(g, geo, caseM);
  // accent side panels
  for (const s of [-1, 1]) add(g, roundedBox(0.2, 0.08, 0.006, 0.003), surface('plastic', { color: accent, roughness: 0.45 }), 0.13, 0.06, s * 0.129, false);
  // vent slots (top)
  const vent = cached('chvent', () => roundedBox(0.09, 0.004, 0.008, 0.002));
  for (let i = 0; i < 7; i++) add(g, vent, KIT.gap, 0.16, 0.1245, -0.09 + i * 0.03, false);
  // sloped front: everything mounted on a tilted plate
  const face = new THREE.Group();
  face.position.set(0.012, 0.066, 0);
  face.rotation.z = -Math.atan2(0.028, 0.07); // matches the front slope
  g.add(face);
  add(face, roundedBox(0.004, 0.06, 0.15, 0.002), KIT.gap, -0.004, 0.012, -0.03, false); // display bezel
  // encoder knob + buttons + jacks
  const knob = add(face, cached('chknob', () => lathe([[0.001, 0], [0.018, 0], [0.019, 0.004], [0.017, 0.018], [0.012, 0.022], [0.001, 0.022]], 20).rotateZ(Math.PI / 2)), surface('rubber', { color: 0x2a2a2c, normalScale: 2, repeat: [6, 1] }), -0.004, 0.018, 0.085, false);
  void knob;
  const btn = cached('chbtn', () => roundedBox(0.008, 0.012, 0.018, 0.003));
  for (let i = 0; i < 4; i++) add(face, btn, surface('plastic', { color: i === 3 ? accent : 0x3a3c40 }), -0.006, -0.03, -0.075 + i * 0.03, false);
  for (const [z, c] of [[0.06, 0xd63a2f], [0.09, 0x1a1a1a]] as const) add(face, cached('chjack', () => new THREE.CylinderGeometry(0.0075, 0.0075, 0.012, 12).rotateZ(Math.PI / 2)), new THREE.MeshStandardMaterial({ color: c, roughness: 0.4 }), -0.008, -0.03, z, false);
  add(face, cached('chbal', () => roundedBox(0.008, 0.012, 0.04, 0.002)), new THREE.MeshStandardMaterial({ color: 0xf1eadb, roughness: 0.5 }), -0.006, -0.05, -0.03, false);
  // rubber feet
  for (const sx of [0.03, 0.21]) for (const sz of [-0.1, 0.1]) add(g, cached('chfoot', () => new THREE.CylinderGeometry(0.012, 0.012, 0.006, 10)), KIT.rubber, sx, 0.0, sz, false);
  parent.add(g);
  return { group: g, face };
}

/** Wire/cable along a smooth path. */
export function cable(parent: THREE.Object3D, pts: [number, number, number][], r: number, color: number, segs = 24) {
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)), false, 'centripetal');
  const m = add(parent, new THREE.TubeGeometry(curve, segs, r, 6, false), new THREE.MeshStandardMaterial({ color, roughness: 0.55 }), 0, 0, 0, false);
  return m;
}

/** 2S hard-case LiPo: rounded case, printed wrap label, red/black power leads with a yellow connector,
 *  white balance plug. Origin at the base centre; long axis along x. */
export function lipoPack(parent: THREE.Object3D, label: string, color = 0x1d1d1f, accent = '#d63a2f') {
  const g = new THREE.Group();
  add(g, cached('lipocase', () => roundedBox(0.14, 0.025, 0.047, 0.006)), surface('plastic', { color, roughness: 0.45 }), 0, 0.0125, 0);
  const c = document.createElement('canvas'); c.width = 256; c.height = 96;
  const x = c.getContext('2d')!;
  x.fillStyle = '#1d1d1f'; x.fillRect(0, 0, 256, 96);
  x.fillStyle = accent; x.fillRect(0, 0, 256, 20); x.fillRect(0, 76, 256, 20);
  x.fillStyle = '#f4efe6'; x.font = '800 34px "Barlow Condensed", system-ui, sans-serif'; x.fillText(label, 14, 60);
  x.font = '600 18px system-ui, sans-serif'; x.fillStyle = 'rgba(244,239,230,.8)'; x.fillText('7.4V · 2S', 150, 58);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const top = add(g, cached('lipotop', () => new THREE.PlaneGeometry(0.128, 0.04).rotateX(-Math.PI / 2)), new THREE.MeshStandardMaterial({ map: t, roughness: 0.5 }), 0, 0.0252, 0, false);
  void top;
  // leads exit one end
  cable(g, [[0.07, 0.012, 0.008], [0.09, 0.014, 0.012], [0.11, 0.008, 0.02]], 0.0022, 0xb93228, 8);
  cable(g, [[0.07, 0.012, -0.002], [0.092, 0.014, 0.0], [0.11, 0.008, 0.008]], 0.0022, 0x1a1a1a, 8);
  add(g, cached('xt', () => roundedBox(0.016, 0.008, 0.016, 0.002)), new THREE.MeshStandardMaterial({ color: 0xe8b923, roughness: 0.45 }), 0.118, 0.008, 0.014, false);
  cable(g, [[0.07, 0.016, -0.014], [0.09, 0.02, -0.02], [0.1, 0.01, -0.03]], 0.0016, 0xf1eadb, 8);
  add(g, cached('balplug', () => roundedBox(0.012, 0.006, 0.008, 0.0015)), new THREE.MeshStandardMaterial({ color: 0xf1eadb, roughness: 0.5 }), 0.104, 0.008, -0.032, false);
  parent.add(g);
  return g;
}

/** Hanging LED shop light: rounded aluminium housing, frosted diffuser, chains. */
export function shopLight(parent: THREE.Object3D, x: number, y: number, z: number, len = 1.2) {
  const g = new THREE.Group();
  add(g, roundedBox(len, 0.04, 0.16, 0.015), surface('paint', { color: 0xd9dcdf, metalness: 0.5, roughness: 0.4 }), 0, 0, 0, false);
  const diff = new THREE.Mesh(roundedBox(len - 0.04, 0.012, 0.12, 0.005), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff1d6, emissiveIntensity: 1.7, roughness: 0.4 }));
  diff.position.y = -0.024; g.add(diff);
  for (const s of [-1, 1]) for (let i = 0; i < 6; i++) {
    const link = add(g, cached('chainlink', () => new THREE.TorusGeometry(0.008, 0.002, 4, 8)), KIT.steel, s * (len / 2 - 0.08), 0.03 + i * 0.016, 0, false);
    link.rotation.y = (i % 2) * (Math.PI / 2);
  }
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}
