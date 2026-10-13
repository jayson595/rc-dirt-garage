// Odd job: mow Mrs Pell's back lawn with an RC lawn mower. You stand on the patio with the same
// transmitter; the lawn is a grid of grass cells that get cut (with proper light/dark mowing stripes)
// wherever the deck passes. Paid for coverage and speed; flower beds and the gnome cost you.
import * as THREE from 'three';
import { roundedBox, surface, skyEnvironment } from '../assets/materials';
import { createMower, MowerModel } from '../assets/mowerModel';
import { gableHouse, leafyCrown, shrubGeometry, trunkGeometry } from '../assets/yardProps';
import { cloudSkyTexture, pineCrown } from '../assets/venueProps';
import { blobShadowTexture } from '../assets/textures';
import { batchStatic } from '../assets/staticBatch';
import { fmtTime, h, toast } from '../ui/dom';
import { TransmitterControls } from '../ui/TransmitterControls';
import { AppContext, Screen } from './common';

const LAWN = { w: 9, d: 7, cell: 0.1 };          // x: -4.5..4.5, z: -3.5..3.5 (patio at +z)
const NX = Math.round(LAWN.w / LAWN.cell), NZ = Math.round(LAWN.d / LAWN.cell);
const DECK_R = 0.3;
/** Lawn pay: scales from 30% mowed up to the full rate at 95%; a quick full mow earns the bonus. */
export const MOW_PAY = { full: 90, speedBonus: 35, targetTime: 110, flowers: 3, gnome: 10 };
const PAY = MOW_PAY;

type Circle = { x: number; z: number; r: number; kind: 'tree' | 'gnome' | 'sprinkler' | 'birdbath' };
type Bed = { x0: number; z0: number; x1: number; z1: number };

/** Five tapered grass blades fanned round a root, dark at the base and light at the tips. */
function grassClump() {
  const pos: number[] = [], col: number[] = [];
  for (let b = 0; b < 5; b++) {
    const a = (b / 5) * Math.PI * 2 + b * 0.7, r = 0.012 + (b % 2) * 0.02;
    const cx = Math.cos(a) * r, cz = Math.sin(a) * r, w = 0.011, lean = 0.025 + (b % 3) * 0.012;
    const px = -Math.sin(a) * w, pz = Math.cos(a) * w, tx = cx + Math.cos(a) * lean, tz = cz + Math.sin(a) * lean;
    const hgt = 0.1 + (b % 3) * 0.025;
    pos.push(cx - px, 0, cz - pz, cx + px, 0, cz + pz, tx, hgt, tz);
    col.push(0.45, 0.55, 0.4, 0.45, 0.55, 0.4, 1.15, 1.15, 1.0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  // point normals up-ish so the lit blades read like a lawn, not paper
  const n = g.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < n.count; i++) { n.setY(i, Math.abs(n.getY(i)) + 0.8); }
  return g;
}

function hash(x: number, y: number) { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); }

export class MowScene implements Screen {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(50, 1, 0.05, 200);
  controls: TransmitterControls;
  // mower state (simple arcade physics: it's a lawn mower)
  x = 0; z = 2.4; heading = Math.PI / 2; speed = 0; steerA = 0;
  phase: 'brief' | 'count' | 'ready' | 'running' | 'done' = 'brief';
  time = 0;
  cutCount = 0;
  penalties = 0;
  private cut = new Uint8Array(NX * NZ);       // 0 = tall, 1/2 = cut (stripe direction)
  private mowable = new Uint8Array(NX * NZ);   // 0 = not lawn (bed, tree, path)
  private mowableCount = 0;
  private bedHit = new Set<number>();
  private gnomeDown = false;
  private obstacles: Circle[] = [];
  private beds: Bed[] = [];
  private tex!: THREE.DataTexture;
  private tufts!: THREE.InstancedMesh;
  private tuftCell: number[] = [];
  private tuftH: number[] = [];
  private mower!: MowerModel;
  private accel = 0; private turnRate = 0;
  private clip!: THREE.Points; private clipVel = new Float32Array(0); private clipLife = new Float32Array(0); private clipNext = 0; private clipAcc = 0;
  private countdown = 0; private countEl: HTMLElement | null = null;
  private gnome!: THREE.Group;
  private shadow!: THREE.Mesh;
  private sun!: THREE.DirectionalLight;
  private els: Record<string, HTMLElement> = {};
  private W = 1; private H = 1;
  private look = new THREE.Vector3();
  private msgTimer = 0;
  private hudTimer = 0;
  private paused = false;
  private built = false;
  private readonly eye = new THREE.Vector3(0.6, 2.9, 4.6);

  constructor(private ctx: AppContext) {
    this.controls = new TransmitterControls(ctx.input, () => ctx.store.data.settings);
  }

  overlay() { return { scene: this.controls.scene, camera: this.controls.camera, height: this.controls.bandH }; }

  // ---------------------------------------------------------------- world
  private build() {
    const s = this.scene;
    s.fog = new THREE.Fog(0xd8e6ee, 25, 70);
    s.environment = skyEnvironment(this.ctx.renderer); s.environmentIntensity = 0.5;
    s.add(new THREE.HemisphereLight(0xdcefff, 0x6a7a4a, 0.7));
    this.sun = new THREE.DirectionalLight(0xfff2da, 2.0);
    this.sun.position.set(-6, 12, 4); this.sun.castShadow = true; this.sun.shadow.mapSize.set(1024, 1024);
    Object.assign(this.sun.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7, near: 1, far: 40 });
    this.sun.shadow.bias = -0.0005;
    s.add(this.sun);
    s.add(new THREE.Mesh(new THREE.SphereGeometry(110, 32, 16), new THREE.MeshBasicMaterial({ map: cloudSkyTexture(), side: THREE.BackSide, fog: false })));
    // neighbourhood ground beyond the fence
    const outer = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), surface('grass', { repeat: [60, 60] }));
    outer.rotation.x = -Math.PI / 2; outer.position.y = -0.02; outer.receiveShadow = true; s.add(outer);

    // layout: flower beds along the back fence, a tree, gnome, sprinkler, bird bath
    this.beds = [{ x0: -4.5, z0: -3.5, x1: -1.2, z1: -2.8 }, { x0: 1.8, z0: -3.5, x1: 4.5, z1: -2.9 }];
    this.obstacles = [
      { x: -2.6, z: -0.6, r: 0.35, kind: 'tree' },
      { x: 2.4, z: 0.9, r: 0.12, kind: 'gnome' },
      { x: 0.6, z: -1.5, r: 0.1, kind: 'sprinkler' },
      { x: 3.4, z: -1.6, r: 0.28, kind: 'birdbath' },
    ];
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
      const x = -LAWN.w / 2 + (i + 0.5) * LAWN.cell, z = -LAWN.d / 2 + (j + 0.5) * LAWN.cell;
      let ok = 1;
      for (const b of this.beds) if (x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1) ok = 0;
      for (const o of this.obstacles) if (o.kind !== 'gnome' && Math.hypot(x - o.x, z - o.z) < o.r * 0.9) ok = 0;
      if (Math.hypot(x - 0.55, z - 3.38) < 0.2 || Math.hypot(x - 0.68, z - 3.0) < 0.2) ok = 0; // stepping stones
      this.mowable[j * NX + i] = ok; this.mowableCount += ok;
    }
    // lawn: per-cell colour texture (tall / short with stripes) + grass normal detail
    const data = new Uint8Array(NX * NZ * 4);
    this.tex = new THREE.DataTexture(data, NX, NZ, THREE.RGBAFormat);
    this.tex.magFilter = THREE.LinearFilter; this.tex.minFilter = THREE.LinearFilter; this.tex.colorSpace = THREE.SRGBColorSpace;
    const grassN = surface('grass', { repeat: [LAWN.w * 3, LAWN.d * 3], normalScale: 1.2 });
    const lawnMat = new THREE.MeshStandardMaterial({ map: this.tex, normalMap: grassN.normalMap, roughness: 0.95 });
    lawnMat.normalScale.set(1.2, 1.2);
    const lawn = new THREE.Mesh(new THREE.PlaneGeometry(LAWN.w, LAWN.d), lawnMat);
    lawn.rotation.x = -Math.PI / 2; lawn.receiveShadow = true; s.add(lawn);
    // tall tufts over the lawn, shortened to stubble as they're cut
    const tuftGeo = grassClump();
    const spots: [number, number, number][] = [];
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
      const k = j * NX + i; if (!this.mowable[k] || hash(i * 1.3, j * 0.7) < 0.35) continue;
      spots.push([-LAWN.w / 2 + (i + 0.2 + hash(i, j) * 0.6) * LAWN.cell, -LAWN.d / 2 + (j + 0.2 + hash(j, i) * 0.6) * LAWN.cell, k]);
    }
    this.tufts = new THREE.InstancedMesh(tuftGeo, new THREE.MeshStandardMaterial({ color: 0x5a9a38, roughness: 0.9, side: THREE.DoubleSide, vertexColors: true }), spots.length);
    this.tufts.receiveShadow = true;
    const m4 = new THREE.Matrix4();
    spots.forEach(([x, z, k], i) => {
      this.tuftCell.push(k); const th = 0.75 + hash(z, x) * 0.6; this.tuftH.push(th);
      m4.compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), hash(x, z) * 6), new THREE.Vector3(1 + hash(x, x) * 0.4, th, 1 + hash(z, z) * 0.4));
      this.tufts.setMatrixAt(i, m4);
      this.tufts.setColorAt(i, new THREE.Color(0xffffff).multiplyScalar(0.8 + hash(x * 3, z * 2) * 0.35));
    });
    s.add(this.tufts);

    // flower beds: soil + flowers
    const soil = surface('dirt', { color: 0x5a3e28, repeat: [3, 1] });
    const stemGeo = new THREE.CylinderGeometry(0.008, 0.008, 0.22, 4), stemMat = new THREE.MeshStandardMaterial({ color: 0x3f7a2a });
    const bloomGeo = new THREE.IcosahedronGeometry(0.045, 1);
    const bloomMats = [0xe04a6a, 0xf2c230, 0xffffff, 0x8a5ad6].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6 }));
    for (const b of this.beds) {
      const bed = new THREE.Mesh(roundedBox(b.x1 - b.x0, 0.08, b.z1 - b.z0, 0.03), soil);
      bed.position.set((b.x0 + b.x1) / 2, 0.03, (b.z0 + b.z1) / 2); bed.receiveShadow = true; s.add(bed);
      const n = Math.round((b.x1 - b.x0) * 9);
      for (let i = 0; i < n; i++) {
        const fx = b.x0 + 0.15 + (i / n) * (b.x1 - b.x0 - 0.3), fz = b.z0 + 0.12 + hash(i, b.x0) * (b.z1 - b.z0 - 0.24);
        const stem = new THREE.Mesh(stemGeo, stemMat);
        stem.position.set(fx, 0.17, fz); s.add(stem);
        const bloom = new THREE.Mesh(bloomGeo, bloomMats[i % 4]);
        bloom.position.set(fx, 0.29, fz); bloom.castShadow = true; s.add(bloom);
      }
    }
    // tree, sprinkler, bird bath, gnome
    const leafMat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.85 });
    for (const o of this.obstacles) {
      if (o.kind === 'tree') {
        const trunk = new THREE.Mesh(trunkGeometry(2.8), surface('bark', { repeat: [2, 3] }));
        trunk.position.set(o.x, 0, o.z); trunk.castShadow = true; s.add(trunk);
        const flare = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.34, 0.14, 12), surface('bark', { repeat: [2, 1] })); flare.position.set(o.x, 0.07, o.z); s.add(flare);
        const crown = new THREE.Mesh(leafyCrown(3), leafMat);
        crown.position.set(o.x, 2.2, o.z); crown.scale.setScalar(1.1); crown.castShadow = true; s.add(crown);
        // mulch ring round the trunk
        const mulch = new THREE.Mesh(new THREE.CircleGeometry(o.r * 0.95, 24).rotateX(-Math.PI / 2), surface('dirt', { color: 0x5a3a24, repeat: [1, 1] })); mulch.position.set(o.x, 0.006, o.z); mulch.receiveShadow = true; s.add(mulch);
      } else if (o.kind === 'sprinkler') {
        const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 0.08, 12), new THREE.MeshStandardMaterial({ color: 0x2f7a3a, roughness: 0.5 }));
        sp.position.set(o.x, 0.04, o.z); sp.castShadow = true; s.add(sp);
      } else if (o.kind === 'birdbath') {
        const bb = new THREE.Mesh(new THREE.LatheGeometry([[0.001, 0], [0.16, 0], [0.12, 0.05], [0.06, 0.1], [0.05, 0.55], [0.26, 0.62], [0.28, 0.68], [0.24, 0.7], [0.001, 0.66]].map(([r, y]) => new THREE.Vector2(r, y)), 20), surface('concrete', { color: 0xc8c4bb, repeat: [1, 1] }));
        bb.position.set(o.x, 0, o.z); bb.castShadow = true; s.add(bb);
      } else {
        this.gnome = new THREE.Group();
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 0.16, 12), new THREE.MeshStandardMaterial({ color: 0x2557c9 })); body.position.y = 0.08; this.gnome.add(body);
        const face = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), new THREE.MeshStandardMaterial({ color: 0xf0c8a0 })); face.position.y = 0.19; this.gnome.add(face);
        const beard = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.08, 10), new THREE.MeshStandardMaterial({ color: 0xffffff })); beard.position.set(0, 0.15, 0.03); beard.rotation.x = Math.PI; this.gnome.add(beard);
        const hat = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.16, 12), new THREE.MeshStandardMaterial({ color: 0xd63a2f })); hat.position.y = 0.3; this.gnome.add(hat);
        this.gnome.position.set(o.x, 0, o.z); this.gnome.rotation.y = 2.4;
        this.gnome.traverse((c) => { (c as THREE.Mesh).castShadow = true; });
        s.add(this.gnome);
      }
    }
    // picket fence round three sides, house wall + patio on the fourth
    const wood = surface('paint', { color: 0xf1ede4, repeat: [1, 1] });
    const picket = new THREE.InstancedMesh(roundedBox(0.07, 0.9, 0.025, 0.01), wood, 400);
    let pi = 0;
    const run = (ax: number, az: number, bx: number, bz: number) => {
      const len = Math.hypot(bx - ax, bz - az), n = Math.floor(len / 0.13), rot = -Math.atan2(bz - az, bx - ax);
      for (let i = 0; i <= n && pi < 400; i++) {
        const t = i / n; m4.compose(new THREE.Vector3(ax + (bx - ax) * t, 0.45, az + (bz - az) * t), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot), new THREE.Vector3(1, 1, 1));
        picket.setMatrixAt(pi++, m4);
      }
      for (const y of [0.25, 0.7]) { const rail = new THREE.Mesh(roundedBox(len, 0.06, 0.03, 0.01), wood); rail.position.set((ax + bx) / 2, y, (az + bz) / 2); rail.rotation.y = rot; s.add(rail); }
    };
    run(-4.6, -3.6, 4.6, -3.6); run(-4.6, -3.6, -4.6, 3.6); run(4.6, -3.6, 4.6, 3.6);
    picket.count = pi; picket.castShadow = true; s.add(picket);
    const patio = new THREE.Mesh(roundedBox(10, 0.12, 2.6, 0.02), surface('concrete', { color: 0xc9c2b4, repeat: [5, 1.5] }));
    patio.position.set(0, 0.06, 4.8); patio.receiveShadow = true; s.add(patio);
    const wall = new THREE.Mesh(roundedBox(12, 3.2, 0.2, 0.02), surface('planks', { color: 0xbfd2d9, repeat: [6, 3] }));
    wall.position.set(0, 1.6, 6.3); s.add(wall);
    // two stepping stones from the patio onto the lawn
    const stoneMat = surface('concrete', { color: 0xbab3a6 });
    for (const [sx, sz] of [[0.55, 3.38], [0.68, 3.0]]) { const st = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.21, 0.04, 16), stoneMat); st.position.set(sx, 0.015, sz); st.receiveShadow = true; s.add(st); }
    // the neighbours: gabled houses beyond the back fence, trees between, shrubs along the fences
    for (const [x, c, rot] of [[-7.5, 0xd9c3a0, 0.12], [1.5, 0xb8c8d8, -0.05], [10, 0xc9d4b8, -0.15]] as const) {
      const hs = gableHouse(7, 6, 5.2, c); hs.position.set(x, 0, -12.5); hs.rotation.y = Math.PI + rot; s.add(hs);
    }
    for (let i = 0; i < 7; i++) {
      const tr = new THREE.Mesh(i % 2 ? pineCrown() : leafyCrown(10 + i), leafMat);
      tr.position.set(-11 + i * 3.6, i % 2 ? 0.2 : 1.6, -6.6 - hash(i, 1) * 2); tr.scale.setScalar(i % 2 ? 1.1 + hash(i, 2) * 0.4 : 1.2 + hash(i, 3) * 0.5); tr.castShadow = true; s.add(tr);
      if (!(i % 2)) { const tk = new THREE.Mesh(trunkGeometry(1.9), surface('bark', { repeat: [2, 3] })); tk.position.set(tr.position.x, 0, tr.position.z); s.add(tk); }
    }
    for (let i = 0; i < 10; i++) {
      const side = i < 5 ? -1 : 1, t = (i % 5) / 4;
      const sh = new THREE.Mesh(shrubGeometry(20 + i, 0.55 + hash(i, 5) * 0.3), leafMat);
      sh.position.set(side * 5.25, 0, -2.6 + t * 4.4); sh.castShadow = true; sh.receiveShadow = true; s.add(sh);
    }
    // fence posts with caps every couple of metres
    const postMat = surface('paint', { color: 0xf1ede4, repeat: [1, 1] });
    const post = (x: number, z: number) => {
      const p = new THREE.Mesh(roundedBox(0.09, 1.05, 0.09, 0.01), postMat); p.position.set(x, 0.525, z); p.castShadow = true; s.add(p);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.08, 4), postMat); cap.position.set(x, 1.09, z); cap.rotation.y = Math.PI / 4; s.add(cap);
    };
    for (let x = -4.6; x <= 4.61; x += 2.3) post(x, -3.6);
    for (let z = -1.3; z <= 3.61; z += 2.3) { post(-4.6, z); post(4.6, z); }
    // patio edge: a bench, potted plants and the hose reel where you stand
    const pot = (x: number, z: number, sc: number) => {
      const pt = new THREE.Mesh(new THREE.CylinderGeometry(0.2 * sc, 0.14 * sc, 0.3 * sc, 16), surface('concrete', { color: 0xb5643c, repeat: [1, 1] })); pt.position.set(x, 0.12 + 0.15 * sc, z); pt.castShadow = true; s.add(pt);
      const pl = new THREE.Mesh(shrubGeometry(40 + x, 0.32 * sc), leafMat); pl.position.set(x, 0.12 + 0.32 * sc, z); s.add(pl);
    };
    pot(-3.4, 3.8, 1.1); pot(4.2, 3.8, 1.0);
    batchStatic(s, (o) => o === this.gnome);

    this.mower = createMower();
    s.add(this.mower.root);
    // grass clippings kicked out from under the deck while cutting
    const N = 160, cp = new Float32Array(N * 3).fill(-50);
    const cg = new THREE.BufferGeometry(); cg.setAttribute('position', new THREE.BufferAttribute(cp, 3));
    this.clip = new THREE.Points(cg, new THREE.PointsMaterial({ color: 0x7cb84a, size: 0.05, sizeAttenuation: true }));
    this.clip.frustumCulled = false; s.add(this.clip);
    this.clipVel = new Float32Array(N * 3); this.clipLife = new Float32Array(N);
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.7), new THREE.MeshBasicMaterial({ map: blobShadowTexture(), transparent: true, depthWrite: false, opacity: 0.7 }));
    this.shadow.rotation.x = -Math.PI / 2; this.shadow.renderOrder = 1; s.add(this.shadow);
    this.built = true;
  }

  // ---------------------------------------------------------------- lifecycle
  enter() {
    if (!this.built) this.build();
    this.cut.fill(0); this.cutCount = 0; this.penalties = 0; this.bedHit.clear();
    this.gnomeDown = false; this.gnome.rotation.set(0, 2.4, 0); this.gnome.position.y = 0;
    this.x = 0.6; this.z = 3.0; this.heading = Math.PI / 2; this.speed = 0; this.steerA = 0;
    this.phase = 'brief'; this.time = 0; this.paused = false; this.accel = 0; this.turnRate = 0;
    this.clipLife.fill(0);
    const m4 = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
    for (let i = 0; i < this.tuftCell.length; i++) { this.tufts.getMatrixAt(i, m4); m4.decompose(p, q, sc); sc.y = this.tuftH[i]; m4.compose(p, q, sc); this.tufts.setMatrixAt(i, m4); }
    this.tufts.instanceMatrix.needsUpdate = true;
    this.paintAll();
    this.look.set(this.x, 0, this.z); this.eye.x = 0.6;
    this.controls.mount(this.ctx.stage);
    this.controls.layout(this.W, this.H);
    this.buildUI();
    this.ctx.input.enabled = true;
    this.ctx.input.clear();
    this.ctx.input.onPause = () => (this.paused ? this.resume() : this.pause());
    this.ctx.input.onResetKey = null;
    this.showBriefing();
  }

  exit() {
    this.ctx.input.enabled = false; this.ctx.input.clear();
    this.controls.unmount();
    this.ctx.stage.style.removeProperty('--band');
    this.camera.clearViewOffset();
    this.ctx.input.onPause = null;
    this.ctx.store.save();
  }

  private buildUI() {
    const e = this.els = {} as Record<string, HTMLElement>;
    const cell = (label: string, id: string) => h('div', { class: 'hud-cell' }, h('small', {}, label), (e[id] = h('b', { id }, '')));
    e.cutBar = h('i', {});
    const top = h('div', { class: 'hud-top' },
      cell('MOWED', 'pct'),
      cell('JOB TIME', 'time'),
      h('div', { class: 'hud-cell bat' }, h('small', {}, 'PAY'), h('div', { class: 'bar mini ok' }, e.cutBar), (e.pay = h('b', {}, ''))),
      h('button', { class: 'icon-btn pause', 'aria-label': 'Pause', onclick: () => this.pause() }, '❚❚'),
    );
    e.sub1 = h('span', {}, ''); e.sub2 = h('span', {}, '');
    e.finish = h('button', { class: 'tool-btn', onclick: () => this.finish() }, 'Done');
    e.message = h('div', { class: 'hud-message' }, '');
    this.ctx.hud.replaceChildren(top, h('div', { class: 'hud-sub' }, e.sub1, e.sub2), h('div', { class: 'hud-tools' }, e.finish), e.message);
    this.ctx.panel.className = 'panel drive-empty';
    this.ctx.panel.replaceChildren();
    this.ctx.overlay.replaceChildren();
  }

  private message(text: string, seconds = 2.2) {
    this.els.message.textContent = text;
    this.els.message.classList.toggle('show', !!text);
    this.msgTimer = seconds;
  }

  /** Job card before the clock starts, styled like the race briefing. */
  private showBriefing() {
    const best = this.ctx.store.data.jobs.mowBest;
    this.ctx.overlay.replaceChildren(h('div', { class: 'sheet-overlay' }, h('div', { class: 'modal-card scroll-ok' },
      h('div', { class: 'eyebrow' }, 'Odd job · 14 Larkspur Close'),
      h('h2', {}, "Mrs Pell's back lawn"),
      h('p', { class: 'muted small' }, "She's lent you her Turfhound 21 with the RC conversion. Mow the whole lawn: straight passes leave proper stripes."),
      h('table', { class: 'laps' },
        h('tr', {}, h('td', {}, 'Full lawn (95%+)'), h('td', {}, `${PAY.full} cr`)),
        h('tr', {}, h('td', {}, `Quick job (under ${fmtTime(PAY.targetTime)})`), h('td', {}, `+${PAY.speedBonus} cr`)),
        h('tr', { class: 'pen' }, h('td', {}, 'Each squashed flower patch'), h('td', {}, `−${PAY.flowers} cr`)),
        h('tr', { class: 'pen' }, h('td', {}, 'Knocking over the gnome'), h('td', {}, `−${PAY.gnome} cr`))),
      h('div', { class: 'muted small' }, `Partial lawns pay from 30% mowed.${best != null ? ` Your best full mow: ${fmtTime(best)}.` : ''}`),
      h('div', { class: 'row end' },
        h('button', { class: 'btn ghost', onclick: () => this.ctx.go('garage') }, 'Not now'),
        h('button', { class: 'btn primary', 'data-start': '', onclick: () => this.startCountdown() }, 'Start the mower')))));
  }

  private startCountdown() {
    this.phase = 'count'; this.countdown = 3;
    this.countEl = h('div', { class: 'countdown' }, h('i', {}), h('i', {}), h('i', {}), h('b', {}, '3'));
    this.ctx.overlay.replaceChildren(this.countEl);
    this.message('', 0);
  }

  private updateCountdown(dt: number) {
    const c = this.countEl; if (!c) return;
    this.countdown -= dt;
    const n = this.countdown, lit = n > 2 ? 1 : n > 1 ? 2 : n > 0 ? 3 : 0;
    c.querySelectorAll('i').forEach((el, i) => el.classList.toggle('on', i < lit));
    (c.querySelector('b') as HTMLElement).textContent = n > 0 ? String(Math.ceil(n)) : 'GO!';
    if (n <= 0) {
      c.classList.add('go'); const el = c; setTimeout(() => el.remove(), 700); this.countEl = null;
      this.phase = 'running';
    }
  }

  pause() {
    if (this.paused || this.phase === 'done' || this.phase === 'brief') return;
    this.paused = true; this.ctx.input.clear();
    this.ctx.overlay.replaceChildren(h('div', { class: 'sheet-overlay' }, h('div', { class: 'modal-card scroll-ok' },
      h('h2', {}, 'Paused'), h('p', { class: 'muted' }, "Mrs Pell's lawn · the job clock is frozen."),
      h('div', { class: 'stack' },
        h('button', { class: 'btn primary', onclick: () => this.resume() }, 'Resume'),
        h('button', { class: 'btn', onclick: () => { this.ctx.overlay.replaceChildren(); this.ctx.go('mow'); } }, 'Start the lawn again'),
        h('button', { class: 'btn ghost', onclick: () => this.ctx.go('garage') }, 'Quit the job (no pay)')))));
  }
  resume() { if (!this.paused) return; this.paused = false; this.ctx.input.clear(); this.ctx.overlay.replaceChildren(); }

  // ---------------------------------------------------------------- pay
  get pct() { return this.mowableCount ? (this.cutCount / this.mowableCount) * 100 : 0; }
  private payNow() {
    const cover = THREE.MathUtils.clamp((this.pct - 30) / 65, 0, 1);
    const base = Math.round(PAY.full * cover);
    const speed = this.pct >= 90 ? Math.round(PAY.speedBonus * THREE.MathUtils.clamp((PAY.targetTime * 1.6 - this.time) / (PAY.targetTime * 0.6), 0, 1)) : 0;
    return { base, speed, total: Math.max(0, base + speed - this.penalties) };
  }

  private finish() {
    if (this.phase === 'done' || this.phase === 'brief' || this.phase === 'count') return;
    this.phase = 'done';
    this.ctx.input.clear();
    const d = this.ctx.store.data;
    const pay = this.payNow();
    d.credits += pay.total;
    d.jobs.mowRuns++;
    const best = d.jobs.mowBest;
    const pb = this.pct >= 95 && (best == null || this.time < best);
    if (pb) d.jobs.mowBest = this.time;
    this.ctx.store.save();
    this.ctx.overlay.replaceChildren(h('div', { class: 'sheet-overlay' }, h('div', { class: 'modal-card result scroll-ok' },
      h('div', { class: 'eyebrow' }, "Mrs Pell's lawn"),
      h('div', { class: 'big-time' }, `${Math.round(this.pct)}% mowed`),
      h('div', { class: 'muted small' }, `in ${fmtTime(this.time)}${pb ? ' · fastest full mow yet!' : ''}`),
      h('table', { class: 'laps' },
        h('tr', {}, h('td', {}, 'Lawn pay'), h('td', {}, `+${pay.base} cr`)),
        h('tr', {}, h('td', {}, 'Quick job bonus'), h('td', {}, `+${pay.speed} cr`)),
        this.penalties ? h('tr', { class: 'pen' }, h('td', {}, 'Squashed flowers / gnome'), h('td', {}, `−${this.penalties} cr`)) : null),
      h('div', { class: 'earned' }, `+${pay.total} credits`),
      h('div', { class: 'muted small' }, this.pct < 95 ? `Mrs Pell pays the full ${PAY.full} cr for a lawn that is at least 95% done.` : 'Mrs Pell is delighted. Same time next week?'),
      h('div', { class: 'row end' },
        h('button', { class: 'btn', onclick: () => this.ctx.go('mow') }, 'Mow again'),
        h('button', { class: 'btn primary', onclick: () => this.ctx.go('garage') }, 'Back to the garage')))));
    toast(`Lawn job · +${pay.total} cr`, 'good');
  }

  // ---------------------------------------------------------------- loop
  update(dt: number) {
    const input = this.ctx.input;
    const live = !this.paused && this.phase !== 'done' && this.phase !== 'brief';
    if (live) {
      this.controls.feed(dt);
      input.update(dt);
      if (this.phase === 'count') this.updateCountdown(dt);
      const go = this.phase === 'running';
      if (go) this.time += dt;
      this.drive(dt, go ? input.steer : 0, go ? input.throttle : 0);
      if (go) this.mowUnderDeck(dt);
      if (this.pct >= 99.5) this.finish();
    }
    this.controls.pose(dt, live ? input.steer : 0, live ? input.throttle : 0, this.speed < -0.05);
    this.poseMower(dt);
    this.stepClippings(dt);
    this.updateCamera(dt);
    if (this.msgTimer > 0) { this.msgTimer -= dt; if (this.msgTimer <= 0) this.message('', 0); }
    this.hudTimer -= dt;
    if (this.hudTimer <= 0) { this.updateHud(); this.hudTimer = 1 / 12; }
  }

  private drive(dt: number, steer: number, throttle: number) {
    const max = throttle >= 0 ? 2.0 : 1.0;
    const target = throttle * max;
    const before = this.speed;
    // self-propelled drive: firm pull-away, engine braking when you let off, quicker brake
    const rate = Math.abs(target) < Math.abs(this.speed) || Math.sign(target) !== Math.sign(this.speed) ? 3.6 : 2.2;
    this.speed += THREE.MathUtils.clamp(target - this.speed, -rate * dt, rate * dt);
    this.accel = (this.speed - before) / Math.max(dt, 1e-3);
    // same steering feel as the buggy: expo curve, less lock at speed
    const sAbs = Math.abs(steer), shaped = Math.sign(steer) * (0.35 * sAbs + 0.65 * sAbs * sAbs);
    const taper = 1 - 0.25 * Math.min(1, Math.abs(this.speed) / 2);
    this.steerA += THREE.MathUtils.clamp(shaped * 0.75 * taper - this.steerA, -4 * dt, 4 * dt);
    this.turnRate = (this.speed * Math.tan(this.steerA)) / 0.33;
    this.heading -= this.turnRate * dt; // +steer = right turn
    let nx = this.x + Math.cos(this.heading) * this.speed * dt;
    let nz = this.z - Math.sin(this.heading) * this.speed * dt;
    // fence and patio edge
    const lim = 0.34;
    if (nx < -LAWN.w / 2 + lim || nx > LAWN.w / 2 - lim) { nx = THREE.MathUtils.clamp(nx, -LAWN.w / 2 + lim, LAWN.w / 2 - lim); this.speed *= 0.3; }
    if (nz < -LAWN.d / 2 + lim || nz > LAWN.d / 2 - 0.3) { nz = THREE.MathUtils.clamp(nz, -LAWN.d / 2 + lim, LAWN.d / 2 - 0.3); this.speed *= 0.3; }
    for (const o of this.obstacles) {
      if (o.kind === 'gnome' && this.gnomeDown) continue;
      const dx = nx - o.x, dz = nz - o.z, dist = Math.hypot(dx, dz), min = o.r + 0.3;
      if (dist < min) {
        if (o.kind === 'gnome') { this.knockGnome(); continue; }
        nx = o.x + (dx / dist) * min; nz = o.z + (dz / dist) * min; this.speed *= 0.4;
      }
    }
    this.x = nx; this.z = nz;
  }

  private knockGnome() {
    this.gnomeDown = true; this.penalties += PAY.gnome;
    this.gnome.rotation.set(Math.PI / 2, this.heading, 0); this.gnome.position.y = 0.07;
    this.message(`Oops — you knocked the gnome over! −${PAY.gnome} cr`, 2.2);
  }

  private mowUnderDeck(dt: number) {
    const cx = this.x + Math.cos(this.heading) * 0.03, cz = this.z - Math.sin(this.heading) * 0.03;
    const r = DECK_R, c = LAWN.cell;
    const i0 = Math.max(0, Math.floor((cx - r + LAWN.w / 2) / c)), i1 = Math.min(NX - 1, Math.floor((cx + r + LAWN.w / 2) / c));
    const j0 = Math.max(0, Math.floor((cz - r + LAWN.d / 2) / c)), j1 = Math.min(NZ - 1, Math.floor((cz + r + LAWN.d / 2) / c));
    // stripe shade follows the direction of the pass (like a roller lawn mower)
    const stripe = Math.abs(Math.cos(this.heading)) > Math.abs(Math.sin(this.heading)) ? (Math.cos(this.heading) > 0 ? 1 : 2) : (Math.sin(this.heading) > 0 ? 1 : 2);
    let changed = false;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = -LAWN.w / 2 + (i + 0.5) * c, z = -LAWN.d / 2 + (j + 0.5) * c;
      if (Math.hypot(x - cx, z - cz) > r) continue;
      const k = j * NX + i;
      if (!this.mowable[k]) {
        // flower beds: squashed flowers cost money (once per patch of bed)
        for (const b of this.beds) if (x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1) {
          const patch = Math.floor(i / 4) * 1000 + Math.floor(j / 4);
          if (!this.bedHit.has(patch) && Math.abs(this.speed) > 0.05) { this.bedHit.add(patch); this.penalties += PAY.flowers; this.message(`Careful — that's the flower bed! −${PAY.flowers} cr`, 1.6); }
        }
        continue;
      }
      if (Math.abs(this.speed) < 0.02 && this.cut[k]) continue;
      if (!this.cut[k]) { this.cutCount++; this.clipAcc += 0.6; }
      if (this.cut[k] !== stripe) { this.cut[k] = stripe; this.paintCell(i, j); changed = true; }
    }
    if (changed) { this.tex.needsUpdate = true; this.updateTufts(i0, i1, j0, j1); }
    this.spawnClippings(Math.min(8, Math.floor(this.clipAcc)), dt); this.clipAcc -= Math.floor(this.clipAcc);
  }

  private paintCell(i: number, j: number) {
    const k = j * NX + i, d = this.tex.image.data as Uint8Array, o = k * 4;
    const n = hash(i * 0.37, j * 0.71);
    let r: number, g: number, b: number;
    if (!this.mowable[k]) { r = 92; g = 120; b = 62; }
    else if (this.cut[k] === 0) { r = 74 + n * 14; g = 112 + n * 20; b = 44 + n * 10; }        // tall, darker
    else if (this.cut[k] === 1) { r = 132 + n * 8; g = 184 + n * 10; b = 80 + n * 6; }        // light stripe
    else { r = 84 + n * 8; g = 132 + n * 10; b = 50 + n * 6; }                                 // dark stripe
    d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = 255;
  }
  private paintAll() { for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) this.paintCell(i, j); this.tex.needsUpdate = true; }

  private tmpM = new THREE.Matrix4(); private tmpP = new THREE.Vector3(); private tmpQ = new THREE.Quaternion(); private tmpS = new THREE.Vector3();
  private updateTufts(i0: number, i1: number, j0: number, j1: number) {
    let dirty = false;
    for (let t = 0; t < this.tuftCell.length; t++) {
      const k = this.tuftCell[t], i = k % NX, j = Math.floor(k / NX);
      if (i < i0 - 1 || i > i1 + 1 || j < j0 - 1 || j > j1 + 1 || !this.cut[k]) continue;
      this.tufts.getMatrixAt(t, this.tmpM); this.tmpM.decompose(this.tmpP, this.tmpQ, this.tmpS);
      if (this.tmpS.y > 0.3) { this.tmpS.y = 0.1; this.tmpM.compose(this.tmpP, this.tmpQ, this.tmpS); this.tufts.setMatrixAt(t, this.tmpM); dirty = true; }
    }
    if (dirty) this.tufts.instanceMatrix.needsUpdate = true;
  }

  private poseMower(dt: number) {
    const r = this.mower.root;
    r.position.set(this.x, 0, this.z);
    r.rotation.y = this.heading;
    this.mower.pose({ speed: this.speed, steer: this.steerA / 0.75, accel: this.accel, turn: this.turnRate, dt, t: this.time });
    this.shadow.position.set(this.x, 0.012, this.z); this.shadow.rotation.z = this.heading;
  }

  /** Clippings puff out of the skirt on the discharge side and fall back into the grass. */
  private spawnClippings(n: number, _dt: number) {
    const pos = this.clip.geometry.attributes.position as THREE.BufferAttribute;
    const c = Math.cos(this.heading), sn = Math.sin(this.heading);
    for (let k = 0; k < n; k++) {
      const i = this.clipNext; this.clipNext = (this.clipNext + 1) % this.clipLife.length;
      const lx = -0.2 + Math.random() * 0.4, lz = (Math.random() < 0.5 ? -1 : 1) * 0.27;
      pos.setXYZ(i, this.x + c * lx + sn * lz, 0.03, this.z - sn * lx + c * lz);
      const out = Math.sign(lz) * (0.5 + Math.random() * 0.6), back = -0.3 - Math.random() * 0.4;
      this.clipVel[i * 3] = c * back + sn * out + Math.cos(this.heading) * this.speed * 0.3;
      this.clipVel[i * 3 + 1] = 0.8 + Math.random() * 0.9;
      this.clipVel[i * 3 + 2] = -sn * back + c * out - Math.sin(this.heading) * this.speed * 0.3;
      this.clipLife[i] = 0.6 + Math.random() * 0.5;
    }
  }
  private stepClippings(dt: number) {
    const pos = this.clip.geometry.attributes.position as THREE.BufferAttribute;
    let any = false;
    for (let i = 0; i < this.clipLife.length; i++) {
      if (this.clipLife[i] <= 0) continue;
      any = true;
      this.clipLife[i] -= dt;
      this.clipVel[i * 3 + 1] -= 6 * dt;
      const y = Math.max(0.01, pos.getY(i) + this.clipVel[i * 3 + 1] * dt);
      pos.setXYZ(i, pos.getX(i) + this.clipVel[i * 3] * dt, y, pos.getZ(i) + this.clipVel[i * 3 + 2] * dt);
      if (this.clipLife[i] <= 0) pos.setY(i, -50);
    }
    if (any) pos.needsUpdate = true;
  }

  private updateCamera(dt: number) {
    const cam = this.camera;
    // the operator strolls along the patio edge to keep the mower in front of them
    const wantX = THREE.MathUtils.clamp(this.x * 0.55, -2.6, 2.6);
    this.eye.x += THREE.MathUtils.clamp(wantX - this.eye.x, -1.4 * dt, 1.4 * dt);
    cam.position.copy(this.eye);
    // look at a point between the mower and the middle of the lawn so the job stays readable
    const tx = THREE.MathUtils.lerp(this.x, this.eye.x, 0.25), tz = THREE.MathUtils.lerp(this.z, -0.5, 0.3);
    this.look.lerp(this.tmpLook.set(tx, 0, tz), 1 - Math.exp(-dt * 5));
    cam.lookAt(this.look);
    const band = this.controls.bandH;
    const trackH = Math.max(1, this.H - band);
    const cy = Math.min(this.H / 2, (70 + trackH) / 2);
    const fullH = 2 * (this.H - cy);
    const dist = this.eye.distanceTo(this.look);
    const fov = THREE.MathUtils.clamp(THREE.MathUtils.mapLinear(dist, 3, 9, 60, 44), 42, 62);
    cam.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(fov) / 2) * fullH / trackH));
    cam.aspect = this.W / fullH;
    cam.setViewOffset(this.W, fullH, 0, fullH - this.H, this.W, this.H);
    cam.updateProjectionMatrix();
  }
  private tmpLook = new THREE.Vector3();

  private updateHud() {
    const e = this.els, pay = this.payNow();
    e.pct.textContent = `${Math.floor(this.pct)}%`;
    e.time.textContent = fmtTime(this.time);
    e.cutBar.style.width = `${Math.min(100, (pay.total / (PAY.full + PAY.speedBonus)) * 100)}%`;
    e.pay.textContent = `${pay.total}`;
    e.sub1.textContent = this.phase !== 'running' ? '' : `Penalties ${this.penalties ? `−${this.penalties}` : 0} cr`;
    e.sub2.textContent = `Best full mow ${this.ctx.store.data.jobs.mowBest != null ? fmtTime(this.ctx.store.data.jobs.mowBest) : '--'}`;
  }

  resize(w: number, hgt: number) {
    this.W = Math.max(1, w); this.H = Math.max(1, hgt);
    this.controls.layout(this.W, this.H);
    this.ctx.stage.style.setProperty('--band', `${this.controls.bandH}px`);
  }
}
