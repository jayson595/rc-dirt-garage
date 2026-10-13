// Mossknuckle Ridge: the 3D world for the crawler trail. Terrain + rocks + logs are built from the same
// CrawlTerrain the physics uses; forest, footpath, trail stakes and the finish arch are decoration.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createCrawler, CrawlerModel, CrawlerStyle } from '../assets/crawlerModel';
import { skyEnvironment, surface } from '../assets/materials';
import { blobShadowTexture } from '../assets/textures';
import { cloudSkyTexture, pineCrown } from '../assets/venueProps';
import { batchStatic } from '../assets/staticBatch';
import { buildYardFacility } from '../assets/yardDecor';
import { CrawlerSlot } from '../sim/CrawlerSim';
import { PILE_NAME } from '../sim/CrawlTerrain';
import { roundedBox } from '../assets/materials';
import { CrawlLayout, CrawlTerrain, rockHeight, TRAIL_NAME, YARD_NAME } from '../sim/CrawlTerrain';

function hash(x: number, y: number) { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); }

export class CrawlWorld {
  scene = new THREE.Scene();
  terrain: CrawlTerrain;
  crawler: CrawlerModel;
  private style: CrawlerStyle = 'wagon';
  private kitKey = '{}';
  /** Swap the crawler body / hop-ups (rebuilds the model when the saved choice changes). */
  setStyle(style: CrawlerStyle, fitted: Partial<Record<CrawlerSlot, string>> = {}) {
    const key = JSON.stringify(fitted);
    if (style === this.style && key === this.kitKey) return;
    this.style = style; this.kitKey = key;
    this.scene.remove(this.crawler.root);
    this.crawler = createCrawler(style, undefined, fitted);
    this.scene.add(this.crawler.root);
  }
  shadow: THREE.Mesh;
  guide: THREE.Mesh;
  sun: THREE.DirectionalLight;

  constructor(renderer?: THREE.WebGLRenderer, readonly layout: CrawlLayout = 'trail') {
    this.terrain = new CrawlTerrain(layout);
    const s = this.scene;
    s.fog = new THREE.Fog(0xc9d8d2, 18, 60);
    if (renderer) { s.environment = skyEnvironment(renderer); s.environmentIntensity = 0.45; }
    s.add(new THREE.HemisphereLight(0xdcecff, 0x5a5236, 0.65));
    this.sun = new THREE.DirectionalLight(0xfff0d6, 2.0);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    Object.assign(this.sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 1, far: 50 });
    this.sun.shadow.bias = -0.0005;
    s.add(this.sun, this.sun.target);
    const sky = new THREE.Mesh(new THREE.SphereGeometry(120, 32, 16), new THREE.MeshBasicMaterial({ map: cloudSkyTexture(), side: THREE.BackSide, fog: false }));
    s.add(sky);

    const deco = new THREE.Group(); s.add(deco);
    this.buildGround(deco);
    this.buildRocks(deco);
    this.buildLogs(deco);
    this.buildForest(deco);
    this.buildMarkers(deco);
    if (layout === 'yard') this.buildYard(deco);
    batchStatic(deco, () => false);

    this.crawler = createCrawler(this.style);
    s.add(this.crawler.root);
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.42), new THREE.MeshBasicMaterial({ map: blobShadowTexture(), transparent: true, depthWrite: false, opacity: 0.8 }));
    this.shadow.rotation.x = -Math.PI / 2; this.shadow.renderOrder = 1;
    s.add(this.shadow);
    this.guide = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.03, 6, 32, Math.PI), new THREE.MeshBasicMaterial({ color: 0xffd43b, transparent: true, opacity: 0.5, depthWrite: false }));
    s.add(this.guide);
  }

  private buildGround(parent: THREE.Object3D) {
    const T = this.terrain;
    const make = (half: number, res: number, inner: boolean) => {
      const n = Math.round((half * 2) / res);
      const geo = new THREE.PlaneGeometry(half * 2, half * 2, n, n);
      geo.rotateX(-Math.PI / 2);
      const pos = geo.attributes.position as THREE.BufferAttribute;
      const col = new Float32Array(pos.count * 3);
      const yard = T.layout === 'yard', gravel = new THREE.Color(0x9a958b), lane = new THREE.Color(0x8a6e52), lineC = new THREE.Color(0xe8e2d4);
      const grass = new THREE.Color(0x5f8a3a), grit = new THREE.Color(0xb3aa9a), sand = new THREE.Color(0xc4a27a), scrub = new THREE.Color(0x7a7a4a);
      const dirt = new THREE.Color(0x8a6a48), path = new THREE.Color(0xa08360), moss = new THREE.Color(0x5d7a3a), dry = new THREE.Color(0x8a8a50), litter = new THREE.Color(0x6e5a3e);
      const c = new THREE.Color();
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), z = pos.getZ(i);
        const insideInner = Math.abs(x) < T.half - 0.05 && Math.abs(z) < T.half - 0.05;
        let y = T.groundAt(x, z);
        if (!inner && insideInner) y -= 0.06; // tuck the outer ring under the detailed course
        pos.setY(i, y);
        const { s, d } = T.nearest(x, z);
        const n1 = hash(x * 1.7, z * 2.3), n2 = 0.5 + 0.5 * Math.sin(x * 0.9 + Math.sin(z * 0.7) * 2) * Math.cos(z * 0.6);
        c.copy(moss).lerp(dry, n2 * 0.5).lerp(litter, Math.max(0, n2 - 0.6));
        if (T.layout === 'pile') {
          // crawler park: mown grass, worn granite grit on the mound, a dirt walking ring
          const r = Math.hypot(x, z), speck = hash(x * 37, z * 41);
          c.copy(grass).multiplyScalar(0.8 + n2 * 0.3).lerp(dry, Math.max(0, n2 - 0.7));
          c.lerp(grit.clone().multiplyScalar(0.85 + speck * 0.3), 1 - THREE.MathUtils.smoothstep(r, 6.4, 7.6));
          c.lerp(path, (1 - THREE.MathUtils.smoothstep(Math.abs(r - 8.6), 0.35, 0.7)) * 0.8);
          if (s >= 0 && r < 7) c.lerp(dirt, (1 - THREE.MathUtils.smoothstep(Math.abs(d), 0.35, 0.7)) * 0.35);
        } else if (T.layout === 'comp') {
          // dry granite gulch: decomposed-granite sand, darker in the lane, desert scrub tones outside
          const speck = hash(x * 29, z * 31);
          c.copy(sand).multiplyScalar(0.86 + speck * 0.22 + n2 * 0.08).lerp(scrub, Math.max(0, n2 - 0.75) * 0.6);
          if (s >= 0) {
            const ad = Math.abs(d);
            c.lerp(sand.clone().multiplyScalar(0.8 + n1 * 0.1), (1 - THREE.MathUtils.smoothstep(ad, 0.5, 1.1)) * 0.6);
            c.lerp(path, (1 - THREE.MathUtils.smoothstep(Math.abs(d - T.walkSide * 1.9), 0.3, 0.55)) * 0.7);
          }
        } else if (yard) {
          // pea gravel speckle, compacted brown lane with two tyre ruts, packed footpath
          const speck = hash(x * 41, z * 37);
          c.copy(gravel).multiplyScalar(0.82 + speck * 0.3 + n2 * 0.06);
          if (speck > 0.92) c.lerp(lineC, 0.35);
          if (s >= 0) {
            const ad = Math.abs(d);
            const laneK = 1 - THREE.MathUtils.smoothstep(ad, 1.05, 1.2);
            const rut = Math.exp(-Math.pow((ad - 0.13) / 0.05, 2)) * 0.25;
            c.lerp(lane.clone().multiplyScalar(0.92 + n1 * 0.12 - rut), laneK);
            c.lerp(path, (1 - THREE.MathUtils.smoothstep(Math.abs(d - T.walkSide * 1.9), 0.3, 0.55)) * 0.85);
          }
        } else if (s >= 0) {
          const ad = Math.abs(d);
          c.lerp(dirt, 1 - THREE.MathUtils.smoothstep(ad, 0.55, 1.05));
          const pd = Math.abs(d - T.walkSide * 1.9);
          c.lerp(path, (1 - THREE.MathUtils.smoothstep(pd, 0.25, 0.6)) * 0.7);
        }
        c.multiplyScalar(0.9 + n1 * 0.18);
        col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      geo.computeVertexNormals();
      const m = surface('dirt', { repeat: [half * 1.5, half * 1.5], normalScale: 1.2 });
      m.vertexColors = true;
      const mesh = new THREE.Mesh(geo, m);
      mesh.receiveShadow = true;
      parent.add(mesh);
    };
    make(T.half, T.layout === 'yard' ? 0.1 : 0.14, true);
    make(42, 0.7, false);
  }

  private buildRocks(parent: THREE.Object3D) {
    const T = this.terrain;
    const geos: THREE.BufferGeometry[] = [];
    for (const r of T.rocks) {
      if (r.block) continue; // built structures, drawn by the yard facility
      const R = Math.max(r.rx, r.rz) * 1.02;
      const res = R < 0.5 ? 0.04 : 0.1;
      const n = Math.max(6, Math.round((R * 2) / res));
      const g = new THREE.PlaneGeometry(R * 2, R * 2, n, n);
      g.rotateX(-Math.PI / 2);
      const pos = g.attributes.position as THREE.BufferAttribute;
      const col = new Float32Array(pos.count * 3);
      const base = 0.42 + hash(r.seed, 1) * 0.16;
      const tint = T.layout === 'pile' ? [1.18, 1.16, 1.12] : T.layout === 'comp' ? [1.22, 1.06, 0.94] : [1.02, 1, 0.95];
      const mossy = T.layout === 'trail';
      for (let i = 0; i < pos.count; i++) {
        const dx = pos.getX(i), dz = pos.getZ(i);
        const x = r.x + dx, z = r.z + dz;
        const hr = rockHeight(r, dx, dz);
        pos.setXYZ(i, x, T.groundAt(x, z) + (hr > 0 ? hr : -0.015), z);
        const v = base * (0.85 + hash(x * 13, z * 17) * 0.3);
        const sp = T.layout === 'trail' ? 1 : hash(x * 61, z * 53) > 0.86 ? 0.55 : hash(x * 23, z * 19) > 0.9 ? 1.25 : 1; // granite speckle
        col[i * 3] = v * tint[0] * sp; col[i * 3 + 1] = v * tint[1] * sp; col[i * 3 + 2] = v * tint[2] * sp;
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.computeVertexNormals();
      // moss and lichen on the flatter tops
      const nrm = g.attributes.normal as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const up = nrm.getY(i);
        const m = mossy ? Math.max(0, (up - 0.82) * 4) * (hash(pos.getX(i) * 7, pos.getZ(i) * 5) > 0.45 ? 0.7 : 0.15) : 0;
        col[i * 3] = col[i * 3] * (1 - m) + 0.33 * m; col[i * 3 + 1] = col[i * 3 + 1] * (1 - m) + 0.45 * m; col[i * 3 + 2] = col[i * 3 + 2] * (1 - m) + 0.2 * m;
      }
      geos.push(g);
    }
    const merged = mergeGeometries(geos)!;
    const m = surface('concrete', { color: 0xffffff, repeat: [6, 6], normalScale: 2.2, roughness: 0.95 });
    m.vertexColors = true;
    const mesh = new THREE.Mesh(merged, m);
    mesh.castShadow = true; mesh.receiveShadow = true;
    parent.add(mesh);
  }

  private buildLogs(parent: THREE.Object3D) {
    const T = this.terrain;
    const bark = surface('bark', { repeat: [1, 4] });
    const endM = surface('wood', { color: 0xc9a27a, repeat: [0.4, 0.4] });
    for (const l of T.logs) {
      const g = new THREE.Group();
      const m = new THREE.Mesh(new THREE.CylinderGeometry(l.r, l.r * 1.05, l.len, 16, 1, true), bark);
      m.castShadow = true; m.receiveShadow = true; g.add(m);
      for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.CircleGeometry(l.r, 16), endM); e.position.y = s * l.len / 2; e.rotation.x = s * -Math.PI / 2; g.add(e); }
      g.position.set(l.x, T.groundAt(l.x, l.z) + l.r, l.z);
      g.rotation.set(0, -l.rot, Math.PI / 2);
      parent.add(g);
    }
  }

  private buildForest(parent: THREE.Object3D) {
    const T = this.terrain;
    const spots: THREE.Vector3[] = [];
    for (let i = 0; i < 260 && spots.length < 120; i++) {
      const x = (hash(i, 3) - 0.5) * 70, z = (hash(i, 7) - 0.5) * 70;
      const inside = Math.abs(x) < T.half && Math.abs(z) < T.half;
      if (T.layout === 'yard' && Math.abs(x) < 15.5 && Math.abs(z) < 15.5) continue; // the yard is cleared inside its fence
      if (inside) { const { d } = T.nearest(x, z); if (Math.abs(d) < 3.4) continue; }
      if (T.layout === 'pile' && Math.hypot(x, z) < 13) continue;
      if (T.layout === 'comp' && (hash(i, 21) > 0.35 || (Math.abs(x) < 9 && Math.abs(z) < 9))) continue;
      spots.push(new THREE.Vector3(x, T.groundAt(x, z), z));
    }
    const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.24, 2.4, 9), surface('bark', { repeat: [2, 3] }), spots.length);
    const crowns = new THREE.InstancedMesh(pineCrown(), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, vertexColors: true }), spots.length);
    const m = new THREE.Matrix4();
    spots.forEach((p, i) => {
      const s = 0.8 + hash(i, 3) * 0.8;
      m.compose(new THREE.Vector3(p.x, p.y + 1.2 * s, p.z), new THREE.Quaternion(), new THREE.Vector3(s, s, s)); trunks.setMatrixAt(i, m);
      m.compose(new THREE.Vector3(p.x, p.y + 1.6 * s, p.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), hash(i, 2) * 6.28), new THREE.Vector3(s, s * (0.9 + hash(i, 5) * 0.5), s)); crowns.setMatrixAt(i, m);
      crowns.setColorAt(i, new THREE.Color(0xffffff).multiplyScalar(0.75 + hash(i, 9) * 0.35));
    });
    trunks.castShadow = true; crowns.castShadow = true;
    parent.add(trunks, crowns);
    // ferns and low bushes near the trail edges
    const fern = new THREE.IcosahedronGeometry(0.2, 1); fern.scale(1, 0.6, 1);
    const ferns: THREE.Vector3[] = [];
    for (let i = 0; i < 500 && ferns.length < 180; i++) {
      const x = (hash(i, 11) - 0.5) * 27, z = (hash(i, 13) - 0.5) * 27;
      const { d } = T.nearest(x, z);
      if (Math.abs(d) < 1.3 || Math.abs(d - T.walkSide * 1.9) < 0.7) continue;
      if (T.layout === 'yard' || T.layout === 'pile') continue;
      if (T.layout === 'comp' && hash(i, 17) > 0.3) continue;
      ferns.push(new THREE.Vector3(x, T.groundAt(x, z), z));
    }
    const fm = new THREE.InstancedMesh(fern, new THREE.MeshStandardMaterial({ color: 0x4f7a32, roughness: 0.9, flatShading: true }), ferns.length);
    fm.castShadow = true;
    ferns.forEach((p, i) => {
      const s = 0.6 + hash(i, 4) * 0.9;
      m.compose(new THREE.Vector3(p.x, p.y + 0.05 * s, p.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, hash(i, 6) * 6, 0)), new THREE.Vector3(s, s * (0.7 + hash(i, 12) * 0.6), s)); fm.setMatrixAt(i, m);
      fm.setColorAt(i, new THREE.Color(0xffffff).multiplyScalar(0.7 + hash(i, 8) * 0.4));
    });
    parent.add(fm);
  }

  private buildMarkers(parent: THREE.Object3D) {
    const T = this.terrain;
    const stakeM = surface('wood', { color: 0xd9c4a0, repeat: [0.2, 1] });
    const flagM = new THREE.MeshStandardMaterial({ color: 0xf06a1c, roughness: 0.7, side: THREE.DoubleSide });
    // orange-flagged stakes either side of the trail at each checkpoint
    T.checkpoints.forEach((s, i) => {
      if (i === T.checkpoints.length - 1 || T.layout === 'comp') return;
      for (const side of [-1, 1]) {
        const p = T.pointAt(s).addScaledVector(T.rightAt(s), side * 0.95);
        const y = T.heightAt(p.x, p.z);
        const st = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.45, 6), stakeM); st.position.set(p.x, y + 0.22, p.z); st.castShadow = true; parent.add(st);
        const f = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.08), flagM); f.position.set(p.x + 0.06, y + 0.4, p.z); f.rotation.y = hash(i, side) * 3; parent.add(f);
      }
    });
    // start sign and finish arch
    const sign = (text: string, s: number, side: number, color: string, sub = 'CRAWLER TRAIL · CRAGWELD RC', scale = 1) => {
      const c = document.createElement('canvas'); c.width = 512; c.height = 160;
      const g = c.getContext('2d')!;
      g.fillStyle = '#2b2a22'; g.fillRect(0, 0, 512, 160); g.fillStyle = color; g.fillRect(0, 0, 512, 18);
      g.fillStyle = '#f1eadb'; g.font = '900 64px "Barlow Condensed", "Arial Narrow", system-ui, sans-serif'; g.textAlign = 'center'; g.fillText(text, 256, 100);
      g.font = '700 26px system-ui, sans-serif'; g.fillStyle = 'rgba(241,234,219,.8)'; g.fillText(sub, 256, 140);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
      const p = T.pointAt(s).addScaledVector(T.rightAt(s), side * 1.3);
      const y = T.groundAt(p.x, p.z);
      const grp = new THREE.Group();
      for (const dx of [-0.5, 0.5]) { const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.3, 8), stakeM); post.position.set(dx, 0.65, 0); grp.add(post); }
      const board = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.38), new THREE.MeshStandardMaterial({ map: t, side: THREE.DoubleSide, roughness: 0.8 })); board.position.y = 1.1; grp.add(board);
      grp.position.set(p.x, y, p.z); grp.scale.setScalar(scale);
      const tan = T.tangentAt(s);
      grp.rotation.y = Math.atan2(tan.x, tan.z);
      parent.add(grp);
    };
    const title = T.layout === 'yard' ? YARD_NAME : T.layout === 'pile' ? PILE_NAME : T.layout === 'comp' ? 'GRANITE GULCH' : TRAIL_NAME;
    sign(title.toUpperCase(), 0.8, -1, T.layout === 'comp' ? '#d2232a' : T.layout === 'pile' ? '#f2c230' : '#9a9c94',
      T.layout === 'pile' ? 'CRAWLER PARK · PICK YOUR LINE' : T.layout === 'comp' ? 'COMP COURSE · 10 GATES' : 'CRAWLER TRAIL · CRAGWELD RC');
    this.signFn = sign;
    if (T.layout === 'pile') { this.buildPile(parent); return; }
    if (T.layout === 'comp') this.buildComp(parent);
    // finish arch over the trail
    const fs = T.checkpoints[T.checkpoints.length - 1];
    const fp = T.pointAt(fs), fr = T.rightAt(fs);
    const archM = new THREE.MeshStandardMaterial({ map: (() => {
      const c = document.createElement('canvas'); c.width = 512; c.height = 96;
      const g = c.getContext('2d')!;
      for (let i = 0; i < 32; i++) for (let j = 0; j < 6; j++) { g.fillStyle = (i + j) % 2 ? '#111' : '#f1eadb'; g.fillRect(i * 16, j * 16, 16, 16); }
      g.fillStyle = '#2b2a22'; g.fillRect(120, 14, 272, 68); g.fillStyle = '#f2c230'; g.font = '900 56px "Barlow Condensed", system-ui, sans-serif'; g.textAlign = 'center'; g.fillText('FINISH', 256, 68);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
    })(), side: THREE.DoubleSide, roughness: 0.8 });
    for (const side of [-1, 1]) {
      const p = fp.clone().addScaledVector(fr, side * 0.95);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.2, 8), stakeM); post.position.set(p.x, T.heightAt(p.x, p.z) + 0.6, p.z); parent.add(post);
    }
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.34), archM);
    banner.position.set(fp.x, T.heightAt(fp.x, fp.z) + 1.05, fp.z);
    banner.rotation.y = Math.atan2(fr.x, fr.z) + Math.PI / 2;
    parent.add(banner);
  }

  /** Rock pile extras: summit flag, a canopy + bench for the drivers, and the park fence. */
  private buildPile(parent: THREE.Object3D) {
    const T = this.terrain, S = T.summit!;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.9, 8), new THREE.MeshStandardMaterial({ color: 0xd8dadc, metalness: 0.7, roughness: 0.3 }));
    const gy = T.heightAt(S.x + 0.45, S.z);
    pole.position.set(S.x + 0.45, gy + 0.45, S.z); pole.castShadow = true; parent.add(pole);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.22), new THREE.MeshStandardMaterial({ map: (() => {
      const c = document.createElement('canvas'); c.width = 256; c.height = 160; const g = c.getContext('2d')!;
      for (let i = 0; i < 8; i++) for (let j = 0; j < 5; j++) { g.fillStyle = (i + j) % 2 ? '#111' : '#f1eadb'; g.fillRect(i * 32, j * 32, 32, 32); }
      g.fillStyle = '#f2c230'; g.fillRect(40, 50, 176, 60); g.fillStyle = '#111'; g.font = '900 44px "Barlow Condensed", system-ui, sans-serif'; g.textAlign = 'center'; g.fillText('SUMMIT', 128, 96);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })(), side: THREE.DoubleSide, roughness: 0.8 }));
    flag.position.set(S.x + 0.45 + 0.17, gy + 0.78, S.z); parent.add(flag);
    // a ring of summit paint on the slab
    const ring = new THREE.Mesh(new THREE.RingGeometry(S.r - 0.04, S.r, 40), new THREE.MeshBasicMaterial({ color: 0xf2c230, transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(S.x, T.heightAt(S.x, S.z) + 0.012, S.z); parent.add(ring);
    // pop-up canopy + bench by the start
    const st = T.pointAt(0.5).addScaledVector(T.rightAt(0.5), 2.6);
    const g = new THREE.Group(); g.position.set(st.x, T.groundAt(st.x, st.z), st.z); parent.add(g);
    const legM = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.6, roughness: 0.4 });
    for (const [lx, lz] of [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]]) { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 2, 6), legM); l.position.set(lx, 1, lz); g.add(l); }
    const roof = new THREE.Mesh(new THREE.ConeGeometry(1.35, 0.4, 4, 1, true), new THREE.MeshStandardMaterial({ color: 0xd2232a, roughness: 0.8, side: THREE.DoubleSide })); roof.rotation.y = Math.PI / 4; roof.position.y = 2.2; roof.castShadow = true; g.add(roof);
    const table = new THREE.Mesh(roundedBox(1.4, 0.05, 0.6, 0.01), surface('wood', { color: 0xb08a5a, repeat: [1, 1] })); table.position.set(0, 0.75, 0); g.add(table);
    for (const tx of [-0.6, 0.6]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.75, 0.5), legM); leg.position.set(tx, 0.37, 0); g.add(leg); }
    // pit boxes and a spare crawler on the table
    for (let i = 0; i < 3; i++) { const b = new THREE.Mesh(roundedBox(0.3, 0.16, 0.2, 0.02), new THREE.MeshStandardMaterial({ color: [0x2f6fd8, 0xf2c230, 0x3a3d42][i], roughness: 0.6 })); b.position.set(-0.4 + i * 0.36, 0.86, 0.05); g.add(b); }
    // post-and-rail fence round the park
    const rail = surface('wood', { color: 0x8a6a48, repeat: [1, 1] });
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * Math.PI * 2, r = 12.4, x = Math.cos(a) * r, z = Math.sin(a) * r;
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.6, 0.08), rail); post.position.set(x, T.groundAt(x, z) + 0.3, z); parent.add(post);
      const a2 = ((i + 1) / 64) * Math.PI * 2, x2 = Math.cos(a2) * r, z2 = Math.sin(a2) * r, len = Math.hypot(x2 - x, z2 - z);
      for (const yy of [0.25, 0.5]) { const b = new THREE.Mesh(new THREE.BoxGeometry(len, 0.05, 0.03), rail); b.position.set((x + x2) / 2, T.groundAt(x, z) + yy, (z + z2) / 2); b.rotation.y = -Math.atan2(z2 - z, x2 - x); parent.add(b); }
    }
  }

  /** Comp course extras: numbered gate markers, boundary tape on posts, and the judges' table. */
  private buildComp(parent: THREE.Object3D) {
    const T = this.terrain;
    const num = (n: number, color: string) => {
      const c = document.createElement('canvas'); c.width = 128; c.height = 96; const g = c.getContext('2d')!;
      g.fillStyle = color; g.fillRect(0, 0, 128, 96); g.fillStyle = '#fff'; g.font = '900 72px "Barlow Condensed", system-ui, sans-serif'; g.textAlign = 'center'; g.fillText(n === T.gates.length ? 'F' : String(n), 64, 76);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
    };
    const coneG = new THREE.ConeGeometry(0.04, 0.13, 14);
    for (const gt of T.gates) {
      for (const side of [-1, 1]) {
        const p = T.gateMarker(gt, side), col = side < 0 ? '#d2232a' : '#1f5fd1';
        const cone = new THREE.Mesh(coneG, new THREE.MeshStandardMaterial({ color: col, roughness: 0.6 })); cone.position.set(p.x, p.y + 0.065, p.z); cone.castShadow = true; parent.add(cone);
        const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.42, 6), new THREE.MeshStandardMaterial({ color: 0xeeeeee })); rod.position.set(p.x, p.y + 0.25, p.z); parent.add(rod);
        const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.12), new THREE.MeshStandardMaterial({ map: num(gt.n, col), side: THREE.DoubleSide, roughness: 0.7 }));
        const t = T.tangentAt(gt.s); flag.position.set(p.x - t.x * 0.08, p.y + 0.4, p.z - t.z * 0.08); flag.rotation.y = Math.atan2(t.x, t.z) + Math.PI / 2; parent.add(flag);
      }
    }
    // boundary tape: posts every ~0.8 m on both sides of the lane
    const postM = new THREE.MeshStandardMaterial({ color: 0xe8e2d4, roughness: 0.6 });
    const tapeM = new THREE.MeshStandardMaterial({ map: (() => { const c = document.createElement('canvas'); c.width = 128; c.height = 8; const g = c.getContext('2d')!; for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#111' : '#f2c230'; g.fillRect(i * 16, 0, 16, 8); } const t = new THREE.CanvasTexture(c); t.wrapS = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t; })(), side: THREE.DoubleSide, roughness: 0.7 });
    for (const side of [-1, 1]) {
      let prev: THREE.Vector3 | null = null;
      for (let sv = 0; sv <= T.trailLength + 0.01; sv += 0.8) {
        const p = T.pointAt(sv).addScaledVector(T.rightAt(sv), side * T.compBound);
        // skip where the tape would cross another part of the course
        const nn = T.nearest(p.x, p.z);
        if (Math.abs(nn.s - sv) > 3) { prev = null; continue; }
        p.y = T.heightAt(p.x, p.z) + 0.16;
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.2, 6), postM); post.position.set(p.x, p.y - 0.06, p.z); parent.add(post);
        if (prev) {
          const len = prev.distanceTo(p), tape = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.025), tapeM);
          (tape.material as THREE.MeshStandardMaterial).map!.repeat.set(len * 4, 1);
          tape.position.copy(prev).lerp(p, 0.5); tape.lookAt(p.x, tape.position.y, p.z); tape.rotateY(Math.PI / 2); parent.add(tape);
        }
        prev = p;
      }
    }
    // judges' table + score board at the start
    const st = T.pointAt(0.6).addScaledVector(T.rightAt(0.6), 2.5);
    const g = new THREE.Group(); g.position.set(st.x, T.groundAt(st.x, st.z), st.z); g.rotation.y = Math.atan2(T.tangentAt(0.6).x, T.tangentAt(0.6).z); parent.add(g);
    const legM = new THREE.MeshStandardMaterial({ color: 0x3a3d42, metalness: 0.5, roughness: 0.4 });
    const top = new THREE.Mesh(roundedBox(1.6, 0.05, 0.7, 0.01), new THREE.MeshStandardMaterial({ color: 0xe8e2d4, roughness: 0.7 })); top.position.y = 0.76; g.add(top);
    const skirt = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.7), new THREE.MeshStandardMaterial({ map: (() => { const c = document.createElement('canvas'); c.width = 512; c.height = 224; const q = c.getContext('2d')!; q.fillStyle = '#d2232a'; q.fillRect(0, 0, 512, 224); q.fillStyle = '#fff'; q.font = '900 64px "Barlow Condensed", system-ui, sans-serif'; q.textAlign = 'center'; q.fillText('JUDGES', 256, 100); q.font = '700 30px system-ui, sans-serif'; q.fillText('GRANITE GULCH COMP · CLASS 1', 256, 160); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })(), roughness: 0.8, side: THREE.DoubleSide }));
    skirt.position.set(0, 0.4, 0.36); g.add(skirt);
    for (const tx of [-0.75, 0.75]) for (const tz of [-0.3, 0.3]) { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.76, 6), legM); l.position.set(tx, 0.38, tz); g.add(l); }
    for (const cx of [-0.45, 0.45]) { const chair = new THREE.Mesh(roundedBox(0.4, 0.45, 0.4, 0.04), new THREE.MeshStandardMaterial({ color: 0x1f5fd1, roughness: 0.7 })); chair.position.set(cx, 0.23, -0.6); g.add(chair); }
    const clip = new THREE.Mesh(roundedBox(0.22, 0.01, 0.3, 0.005), new THREE.MeshStandardMaterial({ color: 0x8a6a48 })); clip.position.set(-0.3, 0.79, 0); g.add(clip);
  }

  private signFn: ((text: string, s: number, side: number, color: string, sub?: string, scale?: number) => void) | null = null;

  /** Test yard extras: plywood ramp faces matching the physics ramps, and a sign at every station. */
  private buildYard(parent: THREE.Object3D) {
    const T = this.terrain;
    buildYardFacility(T, parent);
    for (const st of T.stations) this.signFn?.(st.label, st.s, -1, '#f2c230', 'TEST STATION', 0.7);
  }

  focusShadows(target: THREE.Vector3) {
    this.sun.target.position.copy(target);
    this.sun.position.set(target.x - 8, target.y + 16, target.z + 6);
  }
}
