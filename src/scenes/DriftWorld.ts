// Kanjo Hall: an indoor RC drift venue. Polished grey P-tile lane (interlocking tiles, painted edge lines,
// outer-zone hatching, clipping-point rings, start line) inside a board wall on the outside and a red/white
// kerb wall around the carpeted infield. Raised driver's stand along the front straight; steel-framed
// warehouse with roof trusses, high-bay lights, neon strips, banners, pit tables and a roller door.
// Live rubber marks (ribbons under the rear tyres) and a little tyre haze.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createDrift, DriftModel } from '../assets/driftModel';
import { driftColorsFor, DriftSlot } from '../sim/driftUpgrades';
import { roomEnvironment, roundedBox, surface } from '../assets/materials';
import { blobShadowTexture } from '../assets/textures';
import { batchStatic } from '../assets/staticBatch';
import { bentTube } from '../assets/crawlerBodies';
import { DriftLayout, DriftTrack, driftVenueName } from '../sim/DriftTrack';
import { skyEnvironment } from '../assets/materials';

function hash(x: number, y: number) { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); }
const canvas = (w: number, h: number) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')!] as const; };
const tex = (c: HTMLCanvasElement, srgb = true) => { const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };

export class DriftWorld {
  scene = new THREE.Scene();
  track: DriftTrack;
  private get lot() { return this.track.layout === 'lot'; }
  car: DriftModel;
  private kitKey = '{}';
  /** Rebuild the car when the fitted hop-ups or livery change. */
  setKit(fitted: Partial<Record<DriftSlot, string>>) {
    const key = JSON.stringify(fitted);
    if (key === this.kitKey) return;
    this.kitKey = key;
    this.scene.remove(this.car.root);
    this.car = createDrift(driftColorsFor(fitted), fitted);
    this.scene.add(this.car.root);
  }
  shadow: THREE.Mesh;
  sun: THREE.DirectionalLight;
  /** +1 if the infield is on the +n side of the lane. */
  inSide: 1 | -1;
  /** Driver's stand eye point (camera). */
  eye: THREE.Vector3;
  marks: SkidMarks;
  haze: Haze;

  constructor(renderer?: THREE.WebGLRenderer, layout: DriftLayout = 'hall') {
    this.track = new DriftTrack(layout);
    const s = this.scene, T = this.track, lot = layout === 'lot';
    s.background = new THREE.Color(lot ? 0x0a0d18 : 0x15161a);
    if (renderer) { s.environment = lot ? skyEnvironment(renderer, 0x1a2238, 0x3a3440, 0x15151a) : roomEnvironment(renderer); s.environmentIntensity = lot ? 0.25 : 0.45; }
    s.add(lot ? new THREE.HemisphereLight(0x6a78a8, 0x2a2018, 0.55) : new THREE.HemisphereLight(0xe6ecf5, 0x2a2a30, 0.9));
    if (lot) s.fog = new THREE.Fog(0x0e1220, 18, 60);
    // the car park is lit by sodium lamps: warm key from high above
    this.sun = new THREE.DirectionalLight(lot ? 0xffc890 : 0xfff6ea, lot ? 2.1 : 2.3);
    this.sun.castShadow = true; this.sun.shadow.mapSize.set(1024, 1024);
    Object.assign(this.sun.shadow.camera, { left: -2.5, right: 2.5, top: 2.5, bottom: -2.5, near: 1, far: 30 });
    this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.01;
    s.add(this.sun, this.sun.target);
    const fill = new THREE.DirectionalLight(0xdfe6ff, 0.55); fill.position.set(-6, 9, -8); s.add(fill);

    let turn = 0; for (const p of T.samples) turn += p.curv * (T.length / T.samples.length);
    this.inSide = turn > 0 ? 1 : -1;
    this.eye = new THREE.Vector3(T.stand.x, T.stand.deck + 1.62, T.stand.z - 0.05);

    const deco = new THREE.Group(); s.add(deco);
    this.buildFloor(deco);
    this.buildLane(deco);
    this.buildWalls(deco);
    this.buildInfield(deco);
    this.buildClips(deco);
    this.buildStand(deco);
    if (lot) this.buildLot(deco); else this.buildHall(deco);
    this.buildPits(deco);
    batchStatic(deco, () => false);
    this.buildPeople();

    this.marks = new SkidMarks(); s.add(this.marks.mesh);
    this.haze = new Haze(); s.add(this.haze.points);
    this.car = createDrift();
    s.add(this.car.root);
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.36), new THREE.MeshBasicMaterial({ map: blobShadowTexture(), transparent: true, depthWrite: false, opacity: 0.7 }));
    this.shadow.rotation.x = -Math.PI / 2; this.shadow.renderOrder = 2; s.add(this.shadow);
  }

  // ------------------------------------------------------------------ floor + lane
  private tileTexture(base: string, seam: string, light: number) {
    const [c, g] = canvas(256, 256);
    g.fillStyle = base; g.fillRect(0, 0, 256, 256);
    // faint polish swirl + speckle
    for (let i = 0; i < 900; i++) { const v = hash(i, light) ; g.fillStyle = `rgba(${v > 0.5 ? '255,255,255' : '0,0,0'},${0.025 + hash(i * 3, 1) * 0.03})`; g.fillRect(hash(i, 2) * 256, hash(i, 5) * 256, 2, 2); }
    // interlocking tile edge (dovetail teeth) and bevel
    g.strokeStyle = seam; g.lineWidth = 3;
    g.beginPath();
    for (let side = 0; side < 2; side++) for (let k = 0; k <= 16; k++) {
      const t = (k / 16) * 256, tooth = k % 2 ? 4 : -4;
      if (side === 0) { if (k === 0) g.moveTo(t, 1.5 + tooth); else g.lineTo(t, 1.5 + tooth); }
      else { if (k === 0) g.moveTo(1.5 + tooth, t); else g.lineTo(1.5 + tooth, t); }
    }
    g.stroke();
    g.fillStyle = `rgba(255,255,255,${light})`; g.fillRect(4, 4, 248, 2); g.fillRect(4, 4, 2, 248);
    const t = tex(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
  }

  /** Night-lot asphalt: dark aggregate speckle, a few patches and cracks; `bays` adds painted parking bays. */
  private asphaltTexture(base: string, bays = false) {
    const [c, g] = canvas(512, 512);
    g.fillStyle = base; g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 9000; i++) { const v = hash(i, 7); g.fillStyle = `rgba(${v > 0.55 ? '255,255,255' : '0,0,0'},${0.04 + hash(i, 9) * 0.08})`; const r = hash(i, 4) < 0.1 ? 3 : 1.5; g.fillRect(hash(i, 2) * 512, hash(i, 5) * 512, r, r); }
    g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 1.5;
    for (let k = 0; k < 5; k++) { g.beginPath(); let x = hash(k, 11) * 512, y = hash(k, 12) * 512; g.moveTo(x, y); for (let j = 0; j < 8; j++) { x += (hash(k, j) - 0.5) * 60; y += (hash(j, k) - 0.3) * 50; g.lineTo(x, y); } g.stroke(); }
    if (bays) { g.strokeStyle = 'rgba(240,240,232,0.75)'; g.lineWidth = 5; for (let x = 16; x < 512; x += 128) { g.beginPath(); g.moveTo(x, 40); g.lineTo(x, 230); g.moveTo(x, 282); g.lineTo(x, 472); g.stroke(); } g.beginPath(); g.moveTo(0, 256); g.lineTo(512, 256); g.stroke(); }
    const t = tex(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
  }

  /** Car-park surroundings: sodium light poles with glare, a parking structure, dark city blocks with lit windows. */
  private buildLot(parent: THREE.Object3D) {
    const { hx, hz } = this.track.hall;
    const steel = surface('paint', { color: 0x5a5e66, metalness: 0.6, roughness: 0.4 });
    const lamp = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffb060, emissiveIntensity: 3 });
    const [gc, gg] = canvas(128, 128); const rg = gg.createRadialGradient(64, 64, 0, 64, 64, 64); rg.addColorStop(0, 'rgba(255,200,130,1)'); rg.addColorStop(0.3, 'rgba(255,170,90,.45)'); rg.addColorStop(1, 'rgba(255,170,90,0)'); gg.fillStyle = rg; gg.fillRect(0, 0, 128, 128);
    const glow = tex(gc);
    for (const [x, z] of [[-hx - 0.6, -hz + 1], [-7, -hz - 0.8], [7, -hz - 0.8], [hx + 0.6, -hz + 1], [-hx - 0.6, 3], [hx + 0.6, 3]] as [number, number][]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 7, 8), steel); p.position.set(x, 3.5, z); parent.add(p);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.08, 0.08), steel); arm.position.set(x - Math.sign(x || 1) * 0.5, 7, z); parent.add(arm);
      const head = new THREE.Mesh(roundedBox(0.6, 0.14, 0.3, 0.04), steel); head.position.set(x - Math.sign(x || 1) * 1.0, 6.95, z); parent.add(head);
      const lens = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.22), lamp); lens.rotation.x = Math.PI / 2; lens.position.set(head.position.x, 6.87, z); parent.add(lens);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); sp.position.set(head.position.x, 6.8, z); sp.scale.setScalar(2.6); this.scene.add(sp);
    }
    // parking structure behind the far side
    const conc = surface('concrete', { color: 0x6a6c70, repeat: [10, 2], roughness: 0.9 });
    for (let lvl = 0; lvl < 3; lvl++) {
      const slab = new THREE.Mesh(new THREE.BoxGeometry(26, 0.3, 8), conc); slab.position.set(0, 0.6 + lvl * 2.8, -hz - 6); parent.add(slab);
      for (let x = -12; x <= 12; x += 4) { const col = new THREE.Mesh(new THREE.BoxGeometry(0.4, 2.8, 0.4), conc); col.position.set(x, 2 + lvl * 2.8, -hz - 2.2); parent.add(col); }
      const strip = new THREE.Mesh(new THREE.BoxGeometry(26, 0.06, 0.06), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.4, 1.2, 0.9) })); strip.position.set(0, 0.45 + lvl * 2.8 + 2.4, -hz - 2.1); parent.add(strip);
    }
    // city blocks with lit windows
    const [wc, wg] = canvas(256, 512); wg.fillStyle = '#121520'; wg.fillRect(0, 0, 256, 512);
    for (let y = 8; y < 512; y += 24) for (let x = 8; x < 256; x += 22) if (hash(x, y) > 0.55) { wg.fillStyle = hash(y, x) > 0.5 ? '#ffd28a' : '#9fc4ff'; wg.globalAlpha = 0.5 + hash(x + 1, y) * 0.5; wg.fillRect(x, y, 12, 14); }
    wg.globalAlpha = 1;
    const winTex = tex(wc);
    const bm = new THREE.MeshStandardMaterial({ color: 0x15161c, emissive: 0xffffff, emissiveMap: winTex, emissiveIntensity: 0.6, map: winTex, roughness: 0.9 });
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2, r = 34 + hash(i, 1) * 10, w = 6 + hash(i, 2) * 6, hgt = 10 + hash(i, 3) * 22;
      const x = Math.cos(a) * r, z = Math.sin(a) * r * 0.8 - 6;
      if (z > 8) continue;
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, hgt, w * 0.8), bm); b.position.set(x, hgt / 2, z); b.lookAt(0, hgt / 2, 0); parent.add(b);
    }
    // a couple of parked cars at the edges (boxy silhouettes)
    const carM = [0x8a2a24, 0x2a3a5a, 0xd8d6d0].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.4, metalness: 0.5 }));
    for (let i = 0; i < 5; i++) {
      const x = -hx + 2 + i * 5.6, z = hz + 1.6; if (Math.abs(x - this.track.stand.x) < 4.5) continue;
      const g2 = new THREE.Group(); g2.position.set(x, 0, z); parent.add(g2);
      const body = new THREE.Mesh(roundedBox(4.2, 0.8, 1.8, 0.2), carM[i % 3]); body.position.y = 0.65; g2.add(body);
      const cab = new THREE.Mesh(roundedBox(2.2, 0.6, 1.6, 0.2), new THREE.MeshStandardMaterial({ color: 0x0c0e12, roughness: 0.2, metalness: 0.6 })); cab.position.set(-0.2, 1.3, 0); g2.add(cab);
    }
  }

  private buildFloor(parent: THREE.Object3D) {
    const T = this.track, W = T.hall.hx * 2, D = T.hall.hz * 2;
    const t = this.lot ? this.asphaltTexture('#2b2c2f') : this.tileTexture('#3a3c41', 'rgba(10,10,12,0.75)', 0.05); t.repeat.set(W / (this.lot ? 2 : 0.4), D / (this.lot ? 2 : 0.4));
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(this.lot ? W + 30 : W, this.lot ? D + 30 : D), new THREE.MeshStandardMaterial({ map: t, roughness: this.lot ? 0.85 : 0.42, metalness: 0.05, envMapIntensity: 0.8 }));
    if (this.lot) t.repeat.set((W + 30) / 2, (D + 30) / 2);
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; parent.add(floor);
  }

  /** Polished light-grey lane (world-space tile UVs so tiles line up) + painted markings overlay. */
  private buildLane(parent: THREE.Object3D) {
    const T = this.track, S = T.samples, n = S.length;
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    for (let i = 0; i <= n; i++) {
      const p = S[i % n];
      for (const sd of [-1, 1]) { const x = p.x + p.nx * p.hw * sd * 1.02, z = p.z + p.nz * p.hw * sd * 1.02; pos.push(x, 0.0012, z); uv.push(x / (this.lot ? 2 : 0.4), z / (this.lot ? 2 : 0.4)); }
      if (i < n) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    if ((g.attributes.normal as THREE.BufferAttribute).getY(0) < 0) { g.index!.array.reverse(); g.computeVertexNormals(); }
    const lt = this.lot ? this.asphaltTexture('#3d3e42') : this.tileTexture('#8d9096', 'rgba(40,42,46,0.6)', 0.12);
    const lane = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: lt, roughness: this.lot ? 0.7 : 0.3, metalness: 0.05, envMapIntensity: 1.1 }));
    lane.receiveShadow = true; parent.add(lane);

    // markings: one canvas over the lane's bounding box
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (const p of S) { x0 = Math.min(x0, p.x - p.hw); x1 = Math.max(x1, p.x + p.hw); z0 = Math.min(z0, p.z - p.hw); z1 = Math.max(z1, p.z + p.hw); }
    x0 -= 0.2; x1 += 0.2; z0 -= 0.2; z1 += 0.2;
    const ppm = 100, CW = Math.round((x1 - x0) * ppm), CH = Math.round((z1 - z0) * ppm);
    const sc = Math.min(1, 2048 / Math.max(CW, CH));
    const [c, m] = canvas(Math.round(CW * sc), Math.round(CH * sc));
    const P = (x: number, z: number): [number, number] => [(x - x0) * ppm * sc, (z - z0) * ppm * sc];
    const line = (d: (p: (typeof S)[number]) => number, color: string, width: number, dash?: number[]) => {
      m.strokeStyle = color; m.lineWidth = width * ppm * sc; m.setLineDash(dash ? dash.map((v) => v * ppm * sc) : []); m.beginPath();
      S.forEach((p, i) => { const [a, b] = P(p.x + p.nx * d(p), p.z + p.nz * d(p)); if (i) m.lineTo(a, b); else m.moveTo(a, b); });
      m.closePath(); m.stroke(); m.setLineDash([]);
    };
    // edge lines: white solid outside, dashed inside; faint racing-line guide
    line((p) => -this.inSide * (p.hw - 0.07), 'rgba(240,240,236,0.92)', 0.035);
    line((p) => this.inSide * (p.hw - 0.07), 'rgba(240,240,236,0.85)', 0.03, [0.3, 0.22]);
    // outer zones: hatched boxes against the outer wall
    for (const zn of T.zones) {
      if (zn.kind !== 'outer') continue;
      const steps = Math.round(zn.len / 0.05);
      m.fillStyle = 'rgba(242,194,48,0.85)';
      const outline: [number, number][] = [], inner: [number, number][] = [];
      for (let k = 0; k <= steps; k++) {
        const p = T.sampleAt(zn.s - zn.len / 2 + (k / steps) * zn.len);
        outline.push(P(p.x + p.nx * zn.side * (p.hw - 0.02), p.z + p.nz * zn.side * (p.hw - 0.02)));
        inner.push(P(p.x + p.nx * zn.side * (p.hw - 0.5), p.z + p.nz * zn.side * (p.hw - 0.5)));
      }
      m.save(); m.beginPath(); outline.forEach(([a, b], i) => (i ? m.lineTo(a, b) : m.moveTo(a, b))); [...inner].reverse().forEach(([a, b]) => m.lineTo(a, b)); m.closePath();
      m.globalAlpha = 0.25; m.fill(); m.globalAlpha = 1; m.clip();
      // chevron hatching
      m.strokeStyle = 'rgba(242,194,48,0.9)'; m.lineWidth = 0.05 * ppm * sc;
      for (let k = 0; k < steps; k += 6) { const [a, b] = outline[k], [c2, d2] = inner[Math.min(steps, k + 4)]; m.beginPath(); m.moveTo(a, b); m.lineTo(c2, d2); m.stroke(); }
      m.restore();
      m.strokeStyle = 'rgba(242,194,48,0.95)'; m.lineWidth = 0.03 * ppm * sc; m.beginPath(); inner.forEach(([a, b], i) => (i ? m.lineTo(a, b) : m.moveTo(a, b))); m.stroke();
      const mid = T.sampleAt(zn.s), [lx, ly] = P(mid.x + mid.nx * zn.side * (mid.hw - 0.75), mid.z + mid.nz * zn.side * (mid.hw - 0.75));
      m.save(); m.translate(lx, ly); m.rotate(Math.atan2(mid.tz, mid.tx)); m.fillStyle = 'rgba(242,194,48,0.95)'; m.font = `900 ${Math.round(0.22 * ppm * sc)}px "Barlow Condensed", "Arial Narrow", sans-serif`; m.textAlign = 'center'; m.textBaseline = 'middle'; m.fillText(zn.label, 0, 0); m.restore();
    }
    // clipping points: target rings at the inner edge
    for (const zn of T.zones) {
      if (zn.kind !== 'inner') continue;
      const p = T.sampleAt(zn.s), [cx, cy] = P(p.x + p.nx * zn.side * (p.hw - 0.3), p.z + p.nz * zn.side * (p.hw - 0.3));
      m.strokeStyle = 'rgba(232,98,42,0.95)'; m.lineWidth = 0.035 * ppm * sc;
      for (const r of [0.12, 0.24]) { m.beginPath(); m.arc(cx, cy, r * ppm * sc, 0, Math.PI * 2); m.stroke(); }
      m.fillStyle = 'rgba(232,98,42,0.95)'; m.beginPath(); m.arc(cx, cy, 0.04 * ppm * sc, 0, Math.PI * 2); m.fill();
    }
    // start line (checker) across the lane
    const st = T.sampleAt(T.start.s);
    m.save(); const [sx, sy] = P(st.x, st.z); m.translate(sx, sy); m.rotate(Math.atan2(st.tz, st.tx));
    const cs = 0.06 * ppm * sc, nAcross = Math.round((st.hw * 2) / 0.06);
    for (let a = 0; a < 3; a++) for (let b = 0; b < nAcross; b++) { m.fillStyle = (a + b) % 2 ? 'rgba(20,20,22,0.9)' : 'rgba(240,240,236,0.92)'; m.fillRect(a * cs - cs * 1.5, -st.hw * ppm * sc + b * cs, cs, cs); }
    m.restore();
    // grip-wear ribbon: darker polished line through the corners (where everyone drives)
    m.strokeStyle = 'rgba(20,20,24,0.12)'; m.lineWidth = 0.5 * ppm * sc; m.beginPath();
    S.forEach((p, i) => { const off = -Math.sign(p.curv) * Math.min(0.45, Math.abs(p.curv) * 0.6) * p.hw; const [a, b] = P(p.x + p.nx * off, p.z + p.nz * off); if (i) m.lineTo(a, b); else m.moveTo(a, b); }); m.closePath(); m.stroke();
    const mt = tex(c);
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), new THREE.MeshStandardMaterial({ map: mt, transparent: true, roughness: 0.4, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    plane.rotation.x = -Math.PI / 2; plane.position.set((x0 + x1) / 2, 0.0025, (z0 + z1) / 2); plane.receiveShadow = true; plane.renderOrder = 1; parent.add(plane);
  }

  /** Ribbon wall along the lane edge on one side. */
  private wallRibbon(side: number, height: number, thick: number, mat: THREE.Material, uScale: number, gap = 0) {
    const T = this.track, S = T.samples, n = S.length, step = 2;
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    let s = 0, vi = 0;
    for (let i = 0; i <= n; i += step) {
      const p = S[i % n], d0 = side * (p.hw + gap), d1 = side * (p.hw + gap + thick);
      const ax = p.x + p.nx * d0, az = p.z + p.nz * d0, bx = p.x + p.nx * d1, bz = p.z + p.nz * d1;
      if (i) s += Math.hypot(ax - pos[(vi - 4) * 3], az - pos[(vi - 4) * 3 + 2]);
      // face (lane side) bottom/top, back top/bottom
      pos.push(ax, 0, az, ax, height, az, bx, height, bz, bx, 0, bz);
      const u = s / uScale;
      uv.push(u, 0, u, 0.82, u, 1, u, 0.82);
      if (i) { const a = vi - 4, b = vi; for (const [p0, p1] of [[0, 1], [1, 2], [2, 3]]) idx.push(a + p0, b + p0, a + p1, a + p1, b + p0, b + p1); }
      vi += 4;
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, mat); mesh.castShadow = true; mesh.receiveShadow = true;
    // make sure the faces point at the lane (flip if the side ordering wound them backwards)
    const nrm = g.attributes.normal as THREE.BufferAttribute, p0 = S[0];
    const out = nrm.getX(0) * p0.nx * side + nrm.getZ(0) * p0.nz * side;
    if (out > 0) { (g.index!.array as Uint32Array | Uint16Array).reverse(); g.computeVertexNormals(); }
    return mesh;
  }

  private buildWalls(parent: THREE.Object3D) {
    // outer: white/black board panels with sponsor text
    const [c, g] = canvas(2048, 128);
    const panels: [string, string, string][] = [['SLIDEWAY', '#f1f0ec', '#1c1c1e'], ['KANJO HALL', '#1c1c1e', '#f1f0ec'], ['GRIPHOLD', '#f1f0ec', '#2a5aa8'], ['VOLTSTACK', '#1c1c1e', '#7fe39a']];
    panels.forEach(([t, bg, fg], i) => { g.fillStyle = bg; g.fillRect(i * 512, 0, 512, 128); g.fillStyle = fg; g.font = 'italic 900 64px "Barlow Condensed", "Arial Narrow", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t, i * 512 + 256, 50, 470); g.fillStyle = '#d2232a'; g.fillRect(i * 512, 96, 512, 10); g.fillStyle = '#111'; g.fillRect(i * 512 + 506, 0, 6, 128); });
    if (this.lot) { // grey concrete jersey barriers with stencilled sponsor text and hazard stripes
      g.fillStyle = '#9a9a96'; g.fillRect(0, 0, 2048, 128);
      for (let i = 0; i < 2048; i += 4) { g.fillStyle = `rgba(0,0,0,${0.04 + hash(i, 3) * 0.06})`; g.fillRect(i, hash(i, 1) * 128, 3, 3); }
      ['BAYSIDE', 'SLIDEWAY', 'NIGHT RUN', 'GRIPHOLD'].forEach((t, i) => { g.fillStyle = 'rgba(30,30,32,0.75)'; g.font = '900 56px "Barlow Condensed", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t, i * 512 + 256, 52, 420); g.fillStyle = '#e8b923'; g.fillRect(i * 512, 100, 512, 14); g.fillStyle = '#1c1c1e'; for (let k = 0; k < 512; k += 48) g.fillRect(i * 512 + k, 100, 24, 14); g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(i * 512 + 506, 0, 6, 128); });
    }
    const wt = tex(c); wt.wrapS = THREE.RepeatWrapping;
    parent.add(this.wallRibbon(-this.inSide, this.lot ? 0.16 : 0.13, this.lot ? 0.07 : 0.04, new THREE.MeshStandardMaterial({ map: wt, roughness: this.lot ? 0.9 : 0.55, metalness: 0.05 }), -2.4));
    // inner: red/white kerb blocks
    const [c2, g2] = canvas(256, 64);
    for (let i = 0; i < 2; i++) { g2.fillStyle = this.lot ? (i ? '#2b2c2f' : '#e8b923') : i ? '#f1f0ec' : '#d2232a'; g2.fillRect(i * 128, 0, 128, 64); }
    g2.fillStyle = 'rgba(0,0,0,0.25)'; g2.fillRect(0, 52, 256, 12);
    const kt = tex(c2); kt.wrapS = THREE.RepeatWrapping;
    parent.add(this.wallRibbon(this.inSide, 0.055, 0.06, new THREE.MeshStandardMaterial({ map: kt, roughness: 0.5 }), 0.5));
  }

  private buildInfield(parent: THREE.Object3D) {
    const T = this.track, S = T.samples;
    const pts = S.filter((_, i) => i % 3 === 0).map((p) => new THREE.Vector2(p.x + p.nx * this.inSide * (p.hw + 0.1), -(p.z + p.nz * this.inSide * (p.hw + 0.1))));
    const shape = new THREE.Shape(pts);
    const geo = new THREE.ShapeGeometry(shape, 1); geo.rotateX(-Math.PI / 2); geo.translate(0, 0.004, 0);
    const carpet = this.lot ? new THREE.MeshStandardMaterial({ map: this.asphaltTexture('#26272a', true), roughness: 0.85 }) : surface('fabric', { color: 0x2c3a34, repeat: [24, 24], roughness: 0.95 });
    const pos = geo.attributes.position as THREE.BufferAttribute, uv = geo.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / 2, pos.getZ(i) / 2);
    const mesh = new THREE.Mesh(geo, carpet); mesh.receiveShadow = true; parent.add(mesh);
    // the infield's widest open spot gets the hall logo and a tyre-stack island
    let best = { x: 0, z: 0, r: 0 };
    for (let x = -9; x <= 9; x += 0.25) for (let z = -5; z <= 5; z += 0.25) {
      const q = T.query(x, z); if (Math.sign(q.d) !== this.inSide) continue;
      const r = Math.abs(q.d) - q.hw; if (r > best.r) best = { x, z, r };
    }
    const [c, g] = canvas(1024, 384);
    g.fillStyle = 'rgba(0,0,0,0)'; g.fillRect(0, 0, 1024, 384);
    g.fillStyle = '#f1f0ec'; g.font = 'italic 900 170px "Barlow Condensed", "Arial Narrow", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(this.lot ? 'BAYSIDE' : 'KANJO HALL', 512, 160);
    g.fillStyle = '#d2232a'; g.fillRect(140, 268, 744, 22); g.fillStyle = '#f2c230'; g.font = '800 64px "Barlow Condensed", sans-serif'; g.fillText(this.lot ? 'NIGHT RUN · CAR PARK DRIFT' : 'RC DRIFT · EST. 1989', 512, 336);
    const logo = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(5.2, best.r * 2.2), Math.min(5.2, best.r * 2.2) * 0.375), new THREE.MeshStandardMaterial({ map: tex(c), transparent: true, roughness: 0.9, depthWrite: false }));
    logo.rotation.x = -Math.PI / 2; logo.position.set(best.x, 0.006, best.z); parent.add(logo);
    // tyre stacks dotted around the infield
    const tyre = new THREE.TorusGeometry(0.11, 0.045, 10, 22); tyre.rotateX(Math.PI / 2);
    const rub = new THREE.MeshStandardMaterial({ color: 0x1b1b1d, roughness: 0.8 });
    let placed = 0;
    for (let k = 0; k < 400 && placed < 7; k++) {
      const x = -9 + hash(k, 1) * 18, z = -5 + hash(k, 2) * 10;
      const q = T.query(x, z); if (Math.sign(q.d) !== this.inSide || Math.abs(q.d) - q.hw < 0.55) continue;
      if (Math.hypot(x - best.x, z - best.z) < best.r * 1.1) continue;
      const hgt = 1 + Math.floor(hash(k, 3) * 2);
      for (let j = 0; j < hgt; j++) { const t = new THREE.Mesh(tyre, rub); t.position.set(x, 0.05 + j * 0.088, z); t.castShadow = true; parent.add(t); }
      placed++;
    }
  }

  private buildClips(parent: THREE.Object3D) {
    const T = this.track;
    const [c, g] = canvas(64, 256);
    for (let i = 0; i < 4; i++) { g.fillStyle = i % 2 ? '#f1f0ec' : '#e8622a'; g.fillRect(0, i * 64, 64, 64); }
    const pole = new THREE.MeshStandardMaterial({ map: tex(c), roughness: 0.6 });
    for (const zn of T.zones) {
      const p = T.sampleAt(zn.s);
      if (zn.kind === 'inner') {
        // foam clipping post on the kerb, with a flag card
        const x = p.x + p.nx * zn.side * (p.hw + 0.12), z = p.z + p.nz * zn.side * (p.hw + 0.12);
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.34, 14).translate(0, 0.17, 0), pole); post.position.set(x, 0, z); post.castShadow = true; parent.add(post);
        const [lc, lg] = canvas(256, 128); lg.fillStyle = '#e8622a'; lg.fillRect(0, 0, 256, 128); lg.fillStyle = '#fff'; lg.font = '900 84px "Barlow Condensed", sans-serif'; lg.textAlign = 'center'; lg.textBaseline = 'middle'; lg.fillText(zn.label, 128, 66);
        const card = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.11), new THREE.MeshStandardMaterial({ map: tex(lc), side: THREE.DoubleSide, roughness: 0.6 }));
        card.position.set(x, 0.42, z); card.lookAt(this.eye.x, 0.42, this.eye.z); parent.add(card);
        const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.1, 6), pole); stick.position.set(x, 0.36, z); parent.add(stick);
      } else {
        // yellow panels over the wall section of an outer zone
        const steps = 6;
        for (let k = 0; k <= steps; k++) {
          const q = T.sampleAt(zn.s - zn.len / 2 + (k / steps) * zn.len);
          const x = q.x + q.nx * zn.side * (q.hw - 0.003), z = q.z + q.nz * zn.side * (q.hw - 0.003);
          const pl = new THREE.Mesh(new THREE.PlaneGeometry(zn.len / steps * 0.98, 0.1), new THREE.MeshStandardMaterial({ color: 0xf2c230, roughness: 0.5 }));
          pl.position.set(x, 0.065, z); pl.lookAt(x - q.nx * zn.side, 0.065, z - q.nz * zn.side); parent.add(pl);
        }
        // tall zone marker board behind the wall
        const q = T.sampleAt(zn.s), x = q.x + q.nx * zn.side * (q.hw + 0.4), z = q.z + q.nz * zn.side * (q.hw + 0.4);
        const [lc, lg] = canvas(256, 128); lg.fillStyle = '#f2c230'; lg.fillRect(0, 0, 256, 128); lg.fillStyle = '#1c1c1e'; lg.font = '900 80px "Barlow Condensed", sans-serif'; lg.textAlign = 'center'; lg.textBaseline = 'middle'; lg.fillText(zn.label, 128, 66);
        const board = new THREE.Mesh(roundedBox(0.5, 0.25, 0.03, 0.01), new THREE.MeshStandardMaterial({ map: tex(lc), roughness: 0.6 }));
        board.position.set(x, 0.55, z); board.lookAt(this.eye.x, 0.55, this.eye.z); parent.add(board);
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.44, 8), new THREE.MeshStandardMaterial({ color: 0x2b2e33, metalness: 0.6, roughness: 0.4 })); leg.position.set(x, 0.22, z); parent.add(leg);
      }
    }
  }

  private buildStand(parent: THREE.Object3D) {
    const st = this.track.stand;
    const steel = surface('paint', { color: 0x2b2e33, metalness: 0.6, roughness: 0.45 });
    const deck = new THREE.Mesh(roundedBox(st.w, 0.08, 1.3, 0.02), surface('fabric', { color: 0x2a2c31, repeat: [10, 2] }));
    deck.position.set(st.x, st.deck, st.z + 0.25); deck.receiveShadow = true; parent.add(deck);
    // fascia with the hall banner
    const [c, g] = canvas(2048, 160);
    g.fillStyle = '#121316'; g.fillRect(0, 0, 2048, 160); g.fillStyle = '#d2232a'; g.fillRect(0, 130, 2048, 30);
    g.fillStyle = '#f1f0ec'; g.font = 'italic 900 100px "Barlow Condensed", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(`${driftVenueName(this.track.layout).toUpperCase()}  ·  DRIVERS' STAND  ·  SLIDEWAY RC  ·  GRIPHOLD`, 1024, 68);
    const fascia = new THREE.Mesh(new THREE.PlaneGeometry(st.w, st.deck - 0.05), new THREE.MeshStandardMaterial({ map: tex(c), roughness: 0.6 }));
    fascia.position.set(st.x, (st.deck - 0.05) / 2, st.z - 0.4); parent.add(fascia);
    for (let x = st.x - st.w / 2 + 0.2; x <= st.x + st.w / 2 - 0.1; x += 1.2) for (const dz of [-0.38, 0.85]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, st.deck, 0.06), steel); leg.position.set(x, st.deck / 2, st.z + dz); parent.add(leg);
    }
    // railing along the front + posts
    const ry = st.deck + 0.86, rz = st.z - 0.32;
    parent.add(bentTube([new THREE.Vector3(st.x - st.w / 2 + 0.05, ry, rz + 1.1), new THREE.Vector3(st.x - st.w / 2 + 0.05, ry, rz), new THREE.Vector3(st.x + st.w / 2 - 0.05, ry, rz), new THREE.Vector3(st.x + st.w / 2 - 0.05, ry, rz + 1.1)], 0.022, 0.1, steel));
    for (let x = st.x - st.w / 2 + 0.05; x <= st.x + st.w / 2; x += 0.9) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.86, 8), steel); p.position.set(x, st.deck + 0.43, rz); parent.add(p); }
    // steps at the right end
    for (let k = 0; k < 6; k++) { const s = new THREE.Mesh(roundedBox(0.8, 0.05, 0.28, 0.01), steel); s.position.set(st.x + st.w / 2 + 0.45, (k + 1) * (st.deck / 6) - 0.02, st.z + 0.9 - k * 0.24); parent.add(s); }
  }

  private buildHall(parent: THREE.Object3D) {
    const { hx, hz } = this.track.hall, H = 6.6;
    const block = surface('concrete', { color: 0x4a4d54, repeat: [12, 2], roughness: 0.9 });
    const cor = surface('corrugated', { color: 0x8a9099, repeat: [16, 2], metalness: 0.5, roughness: 0.5 });
    const steel = surface('paint', { color: 0x3a3e45, metalness: 0.7, roughness: 0.4 });
    const wall = (w: number, x: number, z: number, ry: number) => {
      const lo = new THREE.Mesh(new THREE.PlaneGeometry(w, 2.6), block); lo.position.set(x, 1.3, z); lo.rotation.y = ry; parent.add(lo);
      const hi = new THREE.Mesh(new THREE.PlaneGeometry(w, H - 2.6), cor); hi.position.set(x, 2.6 + (H - 2.6) / 2, z); hi.rotation.y = ry; parent.add(hi);
    };
    wall(hx * 2, 0, -hz, 0); wall(hx * 2, 0, hz, Math.PI); wall(hz * 2, -hx, 0, Math.PI / 2); wall(hz * 2, hx, 0, -Math.PI / 2);
    // ceiling + trusses + high-bay lights
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(hx * 2, hz * 2), new THREE.MeshStandardMaterial({ color: 0x1a1b1f, roughness: 1 })); ceil.rotation.x = Math.PI / 2; ceil.position.y = H; parent.add(ceil);
    const lamp = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff6e6, emissiveIntensity: 2.4 });
    const shade = surface('paint', { color: 0x2b2e33, metalness: 0.6, roughness: 0.4, side: THREE.DoubleSide });
    for (let x = -hx + 1.5; x <= hx - 1; x += 3) {
      const chord = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.16, hz * 2), steel); chord.position.set(x, H - 0.1, 0); parent.add(chord);
      const bottom = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, hz * 2), steel); bottom.position.set(x, H - 1.0, 0); parent.add(bottom);
      for (let z = -hz + 0.6; z < hz - 0.4; z += 1.2) { const d = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.08, 0.04), steel); d.position.set(x, H - 0.55, z); d.rotation.x = 0.75 * ((Math.round(z / 1.2) % 2) ? 1 : -1); parent.add(d); }
      for (const z of [-4.2, 0, 4.2]) {
        const sh = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.34, 20, 1, true), shade); sh.position.set(x, H - 1.45, z); parent.add(sh);
        const disc = new THREE.Mesh(new THREE.CircleGeometry(0.36, 20), lamp); disc.rotation.x = Math.PI / 2; disc.position.set(x, H - 1.62, z); parent.add(disc);
        const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.45, 4), steel); cable.position.set(x, H - 1.05, z); parent.add(cable);
      }
    }
    // neon strips (pink + cyan) around the hall at the block/cladding line
    const pink = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.35, 1.0) }), cyan = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 1.4, 1.6) });
    for (const [w, x, z, ry] of [[hx * 2, 0, -hz + 0.03, 0], [hx * 2, 0, hz - 0.03, 0], [hz * 2, -hx + 0.03, 0, Math.PI / 2], [hz * 2, hx - 0.03, 0, Math.PI / 2]] as const) {
      const a = new THREE.Mesh(new THREE.BoxGeometry(w, 0.035, 0.03), pink); a.position.set(x, 2.62, z); a.rotation.y = ry; parent.add(a);
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, 0.035, 0.03), cyan); b.position.set(x, 2.78, z); b.rotation.y = ry; parent.add(b);
    }
    // banners on the far wall and ends
    const banner = (text: string, bg: string, fg: string, w: number, x: number, y: number, z: number, ry: number) => {
      const [c, g] = canvas(1024, 256); g.fillStyle = bg; g.fillRect(0, 0, 1024, 256); g.fillStyle = fg; g.font = 'italic 900 150px "Barlow Condensed", "Arial Narrow", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 512, 132);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4), new THREE.MeshStandardMaterial({ map: tex(c), roughness: 0.7 })); m.position.set(x, y, z); m.rotation.y = ry; parent.add(m);
    };
    banner('KANJO HALL', '#121316', '#f1f0ec', 6.4, 0, 4.4, -hz + 0.05, 0);
    banner('TRACTION IS OPTIONAL', '#d2232a', '#f1f0ec', 5.2, -7.2, 4.0, -hz + 0.05, 0);
    banner('SLIDEWAY RC', '#f1f0ec', '#1c1c1e', 4.4, 7.4, 4.0, -hz + 0.05, 0);
    banner('GRIPHOLD TYRES', '#2a5aa8', '#f1f0ec', 4.8, -hx + 0.05, 4.2, 0, Math.PI / 2);
    banner('VOLTSTACK LIPO', '#1c1c1e', '#7fe39a', 4.8, hx - 0.05, 4.2, 0, -Math.PI / 2);
    // roller door on the right end wall
    const door = new THREE.Mesh(new THREE.PlaneGeometry(4, 3.6), surface('corrugated', { color: 0xb8bcc2, repeat: [1, 6], metalness: 0.6, roughness: 0.45 }));
    door.position.set(hx - 0.04, 1.8, -3.2); door.rotation.y = -Math.PI / 2; door.rotation.z = Math.PI / 2; parent.add(door);
    const doorHead = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.4, 4.3), steel); doorHead.position.set(hx - 0.15, 3.8, -3.2); parent.add(doorHead);
  }

  private buildPits(parent: THREE.Object3D) {
    const { hx, hz } = this.track.hall;
    const top = surface('wood', { color: 0xb59a76, repeat: [3, 1] }), steel = surface('paint', { color: 0x2b2e33, metalness: 0.6, roughness: 0.45 });
    const caseCols = [0x1c1c1e, 0xd2232a, 0x2557c9, 0xe8b923, 0x3f5a3a];
    for (let i = 0; i < 5; i++) {
      const x = -hx + 2.4 + i * 3.6, z = -hz + 0.65;
      const t = new THREE.Mesh(roundedBox(2.6, 0.04, 0.8, 0.01), top); t.position.set(x, 0.76, z); t.castShadow = true; t.receiveShadow = true; parent.add(t);
      for (const dx of [-1.2, 1.2]) for (const dz of [-0.33, 0.33]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.74, 0.04), steel); l.position.set(x + dx, 0.37, z + dz); parent.add(l); }
      for (let k = 0; k < 3; k++) {
        const w = 0.35 + hash(i, k) * 0.25, hh = 0.1 + hash(k, i) * 0.12;
        const b = new THREE.Mesh(roundedBox(w, hh, 0.3, 0.015), new THREE.MeshStandardMaterial({ color: caseCols[(i + k) % caseCols.length], roughness: 0.55 }));
        b.position.set(x - 0.9 + k * 0.8 + hash(i, k + 4) * 0.2, 0.78 + hh / 2, z + (hash(k, 9) - 0.5) * 0.2); b.castShadow = true; parent.add(b);
      }
      // pit lamp
      const arm = bentTube([new THREE.Vector3(x + 1.1, 0.78, z + 0.25), new THREE.Vector3(x + 1.1, 1.25, z + 0.25), new THREE.Vector3(x + 0.8, 1.32, z + 0.05)], 0.01, 0.06, steel); parent.add(arm);
      // stool
      const stool = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.05, 16), new THREE.MeshStandardMaterial({ color: 0x1c1c1e, roughness: 0.6 })); stool.position.set(x - 0.4, 0.6, z + 0.75); parent.add(stool);
      const sl = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.05, 0.58, 8), steel); sl.position.set(x - 0.4, 0.29, z + 0.75); parent.add(sl);
    }
  }

  /** A few other drivers on the stand (instanced, simple). */
  private buildPeople() {
    const st = this.track.stand;
    const torso = new THREE.CylinderGeometry(0.17, 0.19, 0.66, 8); torso.translate(0, 1.03, 0);
    const legs = new THREE.CylinderGeometry(0.15, 0.12, 0.72, 8); legs.translate(0, 0.36, 0);
    const arms = new THREE.BoxGeometry(0.12, 0.1, 0.4); arms.translate(0, 1.12, -0.2);
    const tx = new THREE.BoxGeometry(0.16, 0.2, 0.08); tx.translate(0, 1.18, -0.38);
    const bodyGeo = mergeGeometries([torso.toNonIndexed(), legs.toNonIndexed(), arms.toNonIndexed(), tx.toNonIndexed()])!;
    const headGeo = new THREE.SphereGeometry(0.12, 12, 8); headGeo.translate(0, 1.5, 0);
    const spots: [number, number, number, number][] = [
      [st.x - 2.6, st.deck + 0.04, st.z + 0.1, 0], [st.x - 1.5, st.deck + 0.04, st.z + 0.15, 0.2], [st.x + 2.2, st.deck + 0.04, st.z + 0.1, -0.15],
    ];
    const bodies = new THREE.InstancedMesh(bodyGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 }), spots.length);
    const heads = new THREE.InstancedMesh(headGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 }), spots.length);
    const m = new THREE.Matrix4(), shirts = [0xd63a2f, 0x2557c9, 0x1c1c1e, 0xf1eadb, 0x3f5a3a, 0x7a4fb0], skins = [0xf1c7a4, 0xb57a52, 0x8a5a3a, 0xd9a07a, 0x5e3d28, 0xf5d6bd];
    spots.forEach(([x, y, z, r], i) => {
      m.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), r), new THREE.Vector3(1, 1, 1));
      bodies.setMatrixAt(i, m); heads.setMatrixAt(i, m);
      bodies.setColorAt(i, new THREE.Color(shirts[i % shirts.length])); heads.setColorAt(i, new THREE.Color(skins[i % skins.length]));
    });
    bodies.castShadow = true; this.scene.add(bodies, heads);
  }

  focusShadows(target: THREE.Vector3) {
    this.sun.target.position.copy(target);
    this.sun.position.set(target.x - 2, target.y + 10, target.z + 3);
  }
}

// ====================================================================================== rubber marks
/** Ring buffer of quads laid under the rear tyres while they slide. */
export class SkidMarks {
  readonly max = 2600;
  mesh: THREE.Mesh;
  private pos: Float32Array; private col: Float32Array;
  private head = 0;
  private last: ({ x: number; z: number } | null)[] = [null, null];
  constructor() {
    this.pos = new Float32Array(this.max * 4 * 3);
    this.col = new Float32Array(this.max * 4 * 4);
    const idx = new Uint32Array(this.max * 6);
    for (let i = 0; i < this.max; i++) { const a = i * 4; idx.set([a, a + 2, a + 1, a + 1, a + 2, a + 3], i * 6); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 1;
  }
  clear() { this.pos.fill(0); this.col.fill(0); this.head = 0; this.last = [null, null]; this.flag(); }
  /** Lift the pen (no stroke between the last point and the next). */
  lift(i: number) { this.last[i] = null; }
  add(i: number, x: number, z: number, strength: number) {
    const L = this.last[i];
    if (!L) { this.last[i] = { x, z }; return; }
    const dx = x - L.x, dz = z - L.z, d = Math.hypot(dx, dz);
    if (d < 0.035) return;
    if (d > 0.5) { this.last[i] = { x, z }; return; }
    const nx = -dz / d * 0.012, nz = dx / d * 0.012, y = 0.0032;
    const k = this.head, p = this.pos, c = this.col, a = Math.min(0.55, strength * 0.42);
    p.set([L.x + nx, y, L.z + nz, L.x - nx, y, L.z - nz, x + nx, y, z + nz, x - nx, y, z - nz], k * 12);
    for (let v = 0; v < 4; v++) c.set([0.04, 0.04, 0.045, a], k * 16 + v * 4);
    this.head = (k + 1) % this.max;
    this.last[i] = { x, z };
    this.flag();
  }
  private flag() { const g = this.mesh.geometry; (g.attributes.position as THREE.BufferAttribute).needsUpdate = true; (g.attributes.color as THREE.BufferAttribute).needsUpdate = true; }
}

// ====================================================================================== tyre haze
/** Soft grey puffs from the rear tyres when they're spinning hard (P-tile makes a little, not a lot). */
export class Haze {
  readonly n = 90;
  points: THREE.Points;
  private p: Float32Array; private a: Float32Array; private sz: Float32Array;
  private v: Float32Array; private age: Float32Array; private next = 0;
  constructor() {
    this.p = new Float32Array(this.n * 3); this.a = new Float32Array(this.n); this.sz = new Float32Array(this.n);
    this.v = new Float32Array(this.n * 3); this.age = new Float32Array(this.n).fill(99);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.p, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.a, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.sz, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { scale: { value: 600 } },
      vertexShader: 'attribute float alpha; attribute float size; varying float vA; uniform float scale; void main(){ vA = alpha; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * scale / -mv.z; gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'varying float vA; void main(){ vec2 d = gl_PointCoord - 0.5; float r = length(d); if (r > 0.5) discard; gl_FragColor = vec4(vec3(0.78,0.79,0.82), vA * smoothstep(0.5, 0.1, r)); }',
    });
    this.points = new THREE.Points(g, mat); this.points.frustumCulled = false; this.points.renderOrder = 3;
  }
  setScale(px: number) { (this.points.material as THREE.ShaderMaterial).uniforms.scale.value = px; }
  emit(x: number, z: number, vx: number, vz: number, strength: number) {
    const i = this.next; this.next = (this.next + 1) % this.n;
    this.p.set([x, 0.02, z], i * 3); this.v.set([vx * 0.25 + (Math.random() - 0.5) * 0.3, 0.12 + Math.random() * 0.1, vz * 0.25 + (Math.random() - 0.5) * 0.3], i * 3);
    this.age[i] = 0; this.a[i] = 0.11 * strength; this.sz[i] = 0.07;
  }
  update(dt: number) {
    for (let i = 0; i < this.n; i++) {
      if (this.age[i] > 3) { this.a[i] = 0; continue; }
      this.age[i] += dt;
      const k = Math.exp(-1.6 * dt);
      for (let j = 0; j < 3; j++) { this.v[i * 3 + j] *= k; this.p[i * 3 + j] += this.v[i * 3 + j] * dt; }
      this.sz[i] += dt * 0.32;
      this.a[i] *= Math.exp(-1.1 * dt);
    }
    const g = this.points.geometry;
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true; (g.attributes.alpha as THREE.BufferAttribute).needsUpdate = true; (g.attributes.size as THREE.BufferAttribute).needsUpdate = true;
  }
  clear() { this.age.fill(99); this.a.fill(0); }
}
