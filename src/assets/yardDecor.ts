// Crawler test yard: purpose-built test stations and the facility around them. Every station is drawn
// from the same CrawlTerrain data the physics uses (block steps, ramps, side-slope deck, twister humps,
// ledge) so what you see is exactly what the tyres meet. Plus timber lane edging, a chain-link perimeter,
// and a pit area in the middle of the loop (canopy, tables, flags, pallets, tyres, cones).
import * as THREE from 'three';
import { lathe, roundedBox, surface, tireGeometry } from './materials';
import { taperedBin } from './garageKit';
import { neighbourPit, featherFlag } from './venueDecor';
import { campChair } from './venueProps';
import { CrawlTerrain, rockHeight } from '../sim/CrawlTerrain';

const D2R = Math.PI / 180;
function hash(x: number, y: number) { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); }

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, rep?: [number, number]) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  if (rep) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...rep); }
  return t;
}
/** Stencilled measurement label: big number on a hazard-yellow board. */
function stencil(text: string, sub = '') {
  return canvasTex(256, 128, (g) => {
    g.fillStyle = '#f2c230'; g.fillRect(0, 0, 256, 128);
    g.fillStyle = '#1c1c1e'; for (let i = -2; i < 12; i++) { g.beginPath(); g.moveTo(i * 28, 128); g.lineTo(i * 28 + 14, 128); g.lineTo(i * 28 + 34, 108); g.lineTo(i * 28 + 20, 108); g.fill(); }
    g.font = '900 72px "Barlow Condensed", "Arial Narrow", sans-serif'; g.textAlign = 'center'; g.fillText(text, 128, 78);
    if (sub) { g.font = '800 20px system-ui, sans-serif'; g.fillText(sub, 128, 100); }
  });
}
const hazard = () => canvasTex(128, 32, (g) => { g.fillStyle = '#f2c230'; g.fillRect(0, 0, 128, 32); g.fillStyle = '#1c1c1e'; for (let i = -1; i < 8; i++) { g.beginPath(); g.moveTo(i * 20, 32); g.lineTo(i * 20 + 10, 32); g.lineTo(i * 20 + 22, 0); g.lineTo(i * 20 + 12, 0); g.fill(); } }, [6, 1]);

export function buildYardFacility(T: CrawlTerrain, parent: THREE.Object3D) {
  const ply = surface('wood', { color: 0xd2b07e, repeat: [2, 2] });
  const timber = surface('wood', { color: 0x9a7048, repeat: [1, 3] });
  const frameM = surface('wood', { color: 0x6e4c30, repeat: [1, 1] });
  const concrete = surface('concrete', { color: 0xb8b2a6, repeat: [2, 1] });
  const at = (s: number, d = 0) => { const p = T.pointAt(s), r = T.rightAt(s), t = T.tangentAt(s); return { x: p.x + r.x * d, z: p.z + r.z * d, rot: -Math.atan2(t.z, t.x), t, r }; };
  const signLabel = (tex: THREE.Texture, x: number, y: number, z: number, rotY: number, w = 0.26, h = 0.13) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 }));
    m.position.set(x, y, z); m.rotation.y = rotY; parent.add(m); return m;
  };

  // ---- step blocks (stacked timber) and the concrete ledge, matched to the physics slabs
  const labels: Record<string, string> = { '0.05': '5 cm', '0.1': '10 cm', '0.15': '15 cm', '0.22': '22 cm' };
  for (const r of T.rocks) {
    if (!r.block) continue;
    const ledge = r.h > 0.2;
    const g = new THREE.Group(); g.position.set(r.x, T.groundAt(r.x, r.z), r.z); g.rotation.y = -r.rot; parent.add(g);
    const L = r.rx * 2, W = r.rz * 2;
    if (ledge) {
      const b = new THREE.Mesh(roundedBox(L, r.h, W, 0.02), concrete); b.position.y = r.h / 2; b.castShadow = true; b.receiveShadow = true; g.add(b);
      for (const sx of [-1, 1]) { const e = new THREE.Mesh(new THREE.PlaneGeometry(W, 0.04), new THREE.MeshStandardMaterial({ map: hazard(), roughness: 0.6 })); e.position.set(sx * (L / 2 + 0.001), r.h - 0.025, 0); e.rotation.y = sx * Math.PI / 2; g.add(e); }
    } else {
      // layers of 5 cm sleepers with visible joints
      const layers = Math.round(r.h / 0.05);
      for (let k = 0; k < layers; k++) for (let j = 0; j < 4; j++) {
        const sl = new THREE.Mesh(roundedBox(L - 0.004 - k * 0.01, 0.049, W / 4 - 0.006, 0.006), hash(k, j) > 0.5 ? timber : frameM);
        sl.position.set(0, 0.025 + k * 0.05, -W / 2 + W / 8 + j * W / 4); sl.castShadow = true; sl.receiveShadow = true; g.add(sl);
      }
      const nose = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.006, W), new THREE.MeshStandardMaterial({ color: 0xf2c230, roughness: 0.6 })); nose.position.set(-L / 2 + 0.006, r.h + 0.003, 0); g.add(nose);
    }
    const lab = labels[String(Math.round(r.h * 100) / 100)] ?? `${Math.round(r.h * 100)} cm`;
    const face = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(0.2, r.h * 1.6 + 0.05), Math.min(0.1, r.h * 0.8 + 0.02)), new THREE.MeshStandardMaterial({ map: stencil(lab), roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 }));
    face.position.set(0, Math.max(0.025, r.h * 0.5), W / 2 + 0.002); g.add(face);
  }

  // ---- ramps: plywood decks on a visible timber frame, angle stencilled on both sides
  for (const r of T.ramps) {
    const run = r.h / Math.tan(r.deg * D2R), L = run * 2 + r.top, W = 1.96;
    const q = at(r.s);
    const g = new THREE.Group(); g.position.set(q.x, T.groundAt(q.x, q.z) + 0.002, q.z); g.rotation.y = q.rot; parent.add(g);
    const sh = new THREE.Shape([[0, 0], [run, r.h], [run + r.top, r.h], [L, 0]].map(([a, b]) => new THREE.Vector2(a, b)));
    const geo = new THREE.ExtrudeGeometry(sh, { depth: W, bevelEnabled: false }); geo.translate(0, 0, -W / 2);
    const deck = new THREE.Mesh(geo, [frameM, ply]); deck.castShadow = true; deck.receiveShadow = true; g.add(deck);
    // cleats across the climbing faces (grip strips) and yellow nosing on the top edges
    const cleatM = new THREE.MeshStandardMaterial({ color: 0x3a3a3c, roughness: 0.95 });
    for (const [u0, sgn] of [[0, 1], [run + r.top, -1]] as const) for (let k = 1; k < 5; k++) {
      const u = u0 + (sgn > 0 ? k : 5 - k) * run / 5, hgt = sgn > 0 ? u * Math.tan(r.deg * D2R) : (L - u) * Math.tan(r.deg * D2R);
      const c = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.006, W - 0.1), cleatM); c.position.set(u, hgt + 0.004, 0); c.rotation.z = sgn * r.deg * D2R; g.add(c);
    }
    for (const u of [run, run + r.top]) { const n = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.006, W), new THREE.MeshStandardMaterial({ color: 0xf2c230, roughness: 0.6 })); n.position.set(u, r.h + 0.004, 0); g.add(n); }
    const angTex = stencil(`${r.deg}°`, `${Math.round(r.h * 100)} cm`);
    for (const sz of [-1, 1]) {
      const lab = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(0.3, L * 0.5), Math.min(0.15, r.h * 0.7)), new THREE.MeshStandardMaterial({ map: angTex, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 }));
      lab.position.set(run + r.top / 2, r.h * 0.42, sz * (W / 2 + 0.002)); if (sz < 0) lab.rotation.y = Math.PI; g.add(lab);
    }
  }

  // ---- side-slope deck: plywood surface sampled from the ground function, with a frame skirt
  {
    const S0 = T.slope.s0 + 0.4, S1 = T.slope.s1 - 0.4, nS = 40, nD = 14;
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    for (let i = 0; i <= nS; i++) for (let j = 0; j <= nD; j++) {
      const s = S0 + (i / nS) * (S1 - S0), d = -1.0 + (j / nD) * 2.0, q = at(s, d);
      pos.push(q.x, T.groundAt(q.x, q.z) + 0.004, q.z); uv.push(i / nS * 3, j / nD);
    }
    for (let i = 0; i < nS; i++) for (let j = 0; j < nD; j++) { const a = i * (nD + 1) + j, b = a + 1, c = a + nD + 1, e = c + 1; idx.push(a, b, c, b, e, c); }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(idx); geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, ply); m.receiveShadow = true; parent.add(m);
    const mid = at((S0 + S1) / 2, 1.06);
    const lab = signLabel(stencil('20°', 'SIDE SLOPE'), mid.x, T.groundAt(mid.x, mid.z) + 0.25, mid.z, mid.rot + Math.PI / 2, 0.36, 0.18);
    void lab;
  }

  // ---- big log: sign on the far side of the lane, by the log end
  if (T.bigLog) {
    const q = at(T.bigLog.s - 0.35, -1.06);
    signLabel(stencil('20 cm', 'BIG LOG · UPGRADES'), q.x, T.groundAt(q.x, q.z) + 0.25, q.z, q.rot + Math.PI / 2, 0.36, 0.18);
  }

  // ---- axle-twister humps: yellow/black rubber humps shaped like the physics mounds
  const humpGeo = lathe(Array.from({ length: 12 }, (_, i) => { const r = (1 - i / 11) * 0.34 + 0.001; return [r, 0.09 * Math.exp(-(r * r) / 0.035)] as [number, number]; }), 28);
  T.humps.forEach((hp, i) => {
    const m = new THREE.Mesh(humpGeo, new THREE.MeshStandardMaterial({ color: i % 2 ? 0xf2c230 : 0x1f2023, roughness: 0.8 }));
    m.position.set(hp.x, 0.006, hp.z); m.scale.set(1.04, 1.08, 1.04); // sits just proud of the floor's own mound
    m.castShadow = true; m.receiveShadow = true; parent.add(m);
  });

  // ---- timber lane edging boards along both sides of the lane (skipped under the structures)
  const edgeGeo = roundedBox(0.58, 0.035, 0.045, 0.008);
  const spots: { x: number; z: number; rot: number }[] = [];
  for (let s = 0.5; s < T.trailLength - 0.5; s += 0.62) {
    const busy = T.ramps.some((r) => s > r.s - 0.3 && s < r.s + 2 * r.h / Math.tan(r.deg * D2R) + r.top + 0.3) || (s > T.slope.s0 && s < T.slope.s1);
    if (busy) continue;
    for (const d of [-1.15, 1.15]) spots.push(at(s, d));
  }
  const edging = new THREE.InstancedMesh(edgeGeo, timber, spots.length);
  const m4 = new THREE.Matrix4();
  spots.forEach((p, i) => { m4.compose(new THREE.Vector3(p.x, T.groundAt(p.x, p.z) + 0.012, p.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.rot), new THREE.Vector3(1, 1, 1)); edging.setMatrixAt(i, m4); });
  edging.castShadow = true; edging.receiveShadow = true; parent.add(edging);

  // ---- chain-link perimeter fence on steel posts
  const mesh = canvasTex(64, 64, (g) => { g.clearRect(0, 0, 64, 64); g.strokeStyle = 'rgba(200,205,210,0.95)'; g.lineWidth = 3; g.beginPath(); g.moveTo(0, 32); g.lineTo(32, 0); g.lineTo(64, 32); g.lineTo(32, 64); g.closePath(); g.stroke(); }, [1, 1]);
  const fenceH = 1.4, F = 13.7;
  const postM = surface('paint', { color: 0x8d9298, metalness: 0.7, roughness: 0.4 });
  for (const [ax, az, bx, bz] of [[-F, -F, F, -F], [F, -F, F, F], [F, F, -F, F], [-F, F, -F, -F]]) {
    const len = Math.hypot(bx - ax, bz - az);
    const tx = mesh.clone(); tx.needsUpdate = true; tx.wrapS = tx.wrapT = THREE.RepeatWrapping; tx.repeat.set(len / 0.08, fenceH / 0.08);
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(len, fenceH), new THREE.MeshStandardMaterial({ map: tx, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide, metalness: 0.6, roughness: 0.5 }));
    pane.position.set((ax + bx) / 2, fenceH / 2 + 0.05, (az + bz) / 2); pane.rotation.y = -Math.atan2(bz - az, bx - ax); parent.add(pane);
    const n = Math.round(len / 2.5);
    for (let i = 0; i <= n; i++) { const t = i / n, p = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, fenceH + 0.1, 8), postM); p.position.set(ax + (bx - ax) * t, (fenceH + 0.1) / 2, az + (bz - az) * t); p.castShadow = true; parent.add(p); }
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, len, 8), postM); rail.rotation.z = Math.PI / 2; rail.rotation.y = -Math.atan2(bz - az, bx - ax); rail.position.set((ax + bx) / 2, fenceH + 0.05, (az + bz) / 2); parent.add(rail);
  }

  // ---- pit area in the middle of the loop: canopy over two tables, flags, pallets, tyres, cones
  const pit = new THREE.Group(); parent.add(pit);
  const cx = 0, cz = 0;
  {
    const legM = surface('paint', { color: 0xd8dbe0, metalness: 0.6, roughness: 0.35 });
    for (const dx of [-1.5, 1.5]) for (const dz of [-1.5, 1.5]) { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 2.1, 8), legM); l.position.set(cx + dx, 1.05, cz + dz); l.castShadow = true; pit.add(l); }
    const roof = new THREE.Mesh(new THREE.ConeGeometry(2.15, 0.55, 4, 1, true), new THREE.MeshStandardMaterial({ color: 0xc0642a, roughness: 0.85, side: THREE.DoubleSide }));
    roof.position.set(cx, 2.35, cz); roof.rotation.y = Math.PI / 4; roof.castShadow = true; pit.add(roof);
    const val = canvasTex(512, 64, (g) => { g.fillStyle = '#c0642a'; g.fillRect(0, 0, 512, 64); g.fillStyle = '#f1eadb'; g.font = '900 40px "Barlow Condensed", sans-serif'; g.textAlign = 'center'; g.fillText('CRAGWELD RC · TEST YARD', 256, 46); });
    for (let k = 0; k < 4; k++) { const v = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 0.22), new THREE.MeshStandardMaterial({ map: val, side: THREE.DoubleSide, roughness: 0.85 })); const a = k * Math.PI / 2; v.position.set(cx + Math.sin(a) * 1.5, 1.98, cz + Math.cos(a) * 1.5); v.rotation.y = a; pit.add(v); }
    neighbourPit(pit, cx - 0.2, cz - 0.6, 1, campChair);
    neighbourPit(pit, cx + 0.3, cz + 0.6, 2, campChair);
  }
  featherFlag(parent, cx + 2.3, cz - 2.3, '#c0642a', 'CRAGWELD', 0.6);
  featherFlag(parent, cx - 2.4, cz + 2.2, '#2a5aa8', 'TEST YARD', -2.2);
  // pallets + tyre stack + cones
  const pal = new THREE.Group(); pal.position.set(cx + 3.6, 0, cz + 2.8); pal.rotation.y = 0.3; parent.add(pal);
  for (let k = 0; k < 3; k++) {
    for (let j = 0; j < 7; j++) { const b = new THREE.Mesh(roundedBox(1.2, 0.02, 0.1, 0.004), timber); b.position.set(0, 0.13 + k * 0.145, -0.5 + j * 0.166); pal.add(b); }
    for (const z of [-0.45, 0, 0.45]) { const b = new THREE.Mesh(roundedBox(1.2, 0.1, 0.09, 0.006), frameM); b.position.set(0, 0.07 + k * 0.145, z); pal.add(b); }
  }
  const tg = tireGeometry(0.3, 0.2, 2, 22); const tm = surface('rubber', { color: 0x161616 });
  for (let k = 0; k < 4; k++) { const t = new THREE.Mesh(tg, tm); t.position.set(cx - 3.5, 0.1 + k * 0.2, cz - 2.6); t.rotation.y = k * 0.4; t.castShadow = true; parent.add(t); }
  const cone = lathe([[0.001, 0.4], [0.03, 0.4], [0.12, 0.03], [0.17, 0.03], [0.17, 0], [0.001, 0]], 16);
  const coneM = new THREE.MeshStandardMaterial({ color: 0xf06a1c, roughness: 0.6 });
  for (const [x, z] of [[-4.6, 1.2], [-4.2, 1.8], [4.4, -1.6], [-1.2, 3.6]]) { const c = new THREE.Mesh(cone, coneM); c.position.set(x, 0, z); c.castShadow = true; parent.add(c); }
  const bin = taperedBin(parent, 0.55, 0.4, 0.45, 0x1f2023, 0x2557c9); bin.position.set(cx + 2.9, 0, cz - 0.8);
}

/** Rocks to draw (blocks are drawn as built structures instead). */
export const isNaturalRock = (r: { block?: boolean }) => !r.block;
export { rockHeight };
