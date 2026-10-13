// Grindstone Bowl: the evening RC monster-truck arena. Dirt floor (from the same ArenaTerrain the physics
// uses), plywood board walls with sponsor banners, bleachers with a crowd on both long sides, floodlight
// towers, a live scoreboard, sculpted junk cars (crushable) and school buses, and race-gate flags.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createMonster, MONSTER_COLORS, MonsterModel } from '../assets/monsterModel';
import { MonsterSlot } from '../sim/monsterUpgrades';
import { roundedBox, skyEnvironment, surface, tireGeometry } from '../assets/materials';
import { blobShadowTexture } from '../assets/textures';
import { batchStatic } from '../assets/staticBatch';
import { endCap, hex3, loftShell, Painter, profile, ShellSpec, sstep } from '../assets/crawlerBodies';
import { ArenaLayout, ArenaTerrain, arenaName, JunkCar } from '../sim/ArenaTerrain';

function hash(x: number, y: number) { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); }

/** Spectator stand: where the camera operator stands (top of the near bleachers). */
export const ARENA_EYE = new THREE.Vector3(0, 5.6, 16.5);

export class MonsterWorld {
  scene = new THREE.Scene();
  terrain: ArenaTerrain;
  private get fair() { return this.terrain.layout === 'fair'; }
  truck: MonsterModel;
  private kitKey = '{}';
  /** Rebuild the truck when the fitted hop-ups change. */
  setKit(fitted: Partial<Record<MonsterSlot, string>>) {
    const key = JSON.stringify(fitted);
    if (key === this.kitKey) return;
    this.kitKey = key;
    this.scene.remove(this.truck.root);
    this.truck = createMonster(undefined, fitted);
    this.scene.add(this.truck.root);
  }
  shadow: THREE.Mesh;
  sun: THREE.DirectionalLight;
  /** AI rival trucks for event races (built on demand, hidden otherwise). */
  rivals: { model: MonsterModel; shadow: THREE.Mesh; key: string }[] = [];
  setRivals(colors: (typeof MONSTER_COLORS)[]) {
    colors.forEach((c, i) => {
      const key = JSON.stringify(c);
      let r = this.rivals[i];
      if (!r || r.key !== key) {
        if (r) this.scene.remove(r.model.root);
        const model = createMonster(c);
        this.scene.add(model.root);
        const shadow = r?.shadow ?? new THREE.Mesh(this.shadow.geometry, (this.shadow.material as THREE.Material).clone());
        shadow.rotation.x = -Math.PI / 2; shadow.renderOrder = 1;
        if (!r) this.scene.add(shadow);
        r = this.rivals[i] = { model, shadow, key };
      }
      r.model.root.visible = r.shadow.visible = true;
    });
    for (let i = colors.length; i < this.rivals.length; i++) this.rivals[i].model.root.visible = this.rivals[i].shadow.visible = false;
  }
  hideRivals() { for (const r of this.rivals) r.model.root.visible = r.shadow.visible = false; }
  poseRival(i: number, sim: Parameters<MonsterModel['pose']>[0] & { forward: THREE.Vector3 }) {
    const r = this.rivals[i]; r.model.pose(sim);
    const p = sim.pos, g = this.terrain.heightAt(p.x, p.z);
    r.shadow.position.set(p.x, g + 0.015, p.z);
    r.shadow.rotation.z = Math.atan2(-sim.forward.z, sim.forward.x);
    (r.shadow.material as THREE.MeshBasicMaterial).opacity = THREE.MathUtils.clamp(0.75 - (p.y - g - 0.17) * 1.2, 0.15, 0.75);
  }
  gates = new THREE.Group();
  private carMeshes: THREE.Object3D[] = [];
  private board: { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture };

  constructor(renderer?: THREE.WebGLRenderer, layout: ArenaLayout = 'bowl') {
    this.terrain = new ArenaTerrain(layout);
    const s = this.scene, fair = layout === 'fair';
    s.fog = fair ? new THREE.Fog(0xe8d2b0, 50, 140) : new THREE.Fog(0x1a1c2a, 40, 110);
    if (renderer) { s.environment = fair ? skyEnvironment(renderer) : skyEnvironment(renderer, 0x2a3350, 0x8a6a5a, 0x3a3028); s.environmentIntensity = fair ? 0.5 : 0.55; }
    s.add(fair ? new THREE.HemisphereLight(0xdfeaff, 0x6a5a38, 0.85) : new THREE.HemisphereLight(0xb8c4ff, 0x4a3828, 0.75));
    this.sun = new THREE.DirectionalLight(fair ? 0xffe2b8 : 0xfff2e0, fair ? 2.8 : 2.6);
    this.sun.castShadow = true; this.sun.shadow.mapSize.set(1024, 1024);
    Object.assign(this.sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 1, far: 60 });
    this.sun.shadow.bias = -0.0005;
    s.add(this.sun, this.sun.target);
    // fill from the floodlights on the opposite side
    const fill = new THREE.DirectionalLight(0xdfe6ff, fair ? 0.35 : 0.6); fill.position.set(10, 14, -16); s.add(fill);
    this.buildSky();

    const deco = new THREE.Group(); s.add(deco);
    this.buildFloor(deco);
    this.buildWalls(deco);
    this.buildStands(deco, 1);
    this.buildStands(deco, -1);
    if (fair) this.buildFair(deco); else this.buildLights(deco);
    this.buildBuses(deco);
    batchStatic(deco, () => false);
    this.board = this.buildScoreboard();
    this.buildCars();
    this.buildGates();

    this.truck = createMonster();
    s.add(this.truck.root);
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.6), new THREE.MeshBasicMaterial({ map: blobShadowTexture(), transparent: true, depthWrite: false, opacity: 0.75 }));
    this.shadow.rotation.x = -Math.PI / 2; this.shadow.renderOrder = 1; s.add(this.shadow);
  }

  private buildSky() {
    const geo = new THREE.SphereGeometry(140, 32, 16);
    const col = new Float32Array(geo.attributes.position.count * 3), c = new THREE.Color();
    const fair = this.fair;
    const top = new THREE.Color(fair ? 0x3f7fd0 : 0x0e1224), mid = new THREE.Color(fair ? 0x9cc8ee : 0x2a2f55), low = new THREE.Color(fair ? 0xf2d2a2 : 0xd8875a);
    for (let i = 0; i < geo.attributes.position.count; i++) {
      const y = geo.attributes.position.getY(i) / 140;
      c.copy(low).lerp(mid, THREE.MathUtils.smoothstep(y, -0.02, 0.18)).lerp(top, THREE.MathUtils.smoothstep(y, 0.18, 0.7));
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.scene.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false })));
    // car park / town glow ring beyond the stands
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(260, 260), fair ? surface('grass', { repeat: [70, 70] }) : new THREE.MeshStandardMaterial({ color: 0x23222a, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.05; this.scene.add(ground);
  }

  private buildFloor(parent: THREE.Object3D) {
    const T = this.terrain, res = 0.14;
    const nx = Math.round((T.hx * 2) / res), nz = Math.round((T.hz * 2) / res);
    const geo = new THREE.PlaneGeometry(T.hx * 2, T.hz * 2, nx, nz); geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const col = new Float32Array(pos.count * 3);
    const mudC = new THREE.Color(0x3a2a1c);
    const dirt = new THREE.Color(this.fair ? 0x8a6640 : 0x6e4f34), dry = new THREE.Color(this.fair ? 0xa8845a : 0x8c6a49), dark = new THREE.Color(0x4f3826), chalk = new THREE.Color(0xe8e2d2), c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i), y = T.groundAt(x, z);
      pos.setY(i, y);
      const n1 = hash(x * 3.1, z * 2.7), n2 = 0.5 + 0.5 * Math.sin(x * 0.7 + Math.sin(z * 0.9) * 2) * Math.cos(z * 0.8 + x * 0.2);
      c.copy(dirt).lerp(dry, Math.min(1, y * 2.4) * 0.8 + n2 * 0.2);
      // tyre-worn lanes along the jump lines and the circuit
      const zA = T.gates[1].z, zB = T.gates[4].z;
      const lane = Math.max(Math.exp(-Math.pow((z - zA) / 0.7, 2)), Math.exp(-Math.pow((z - zB) / 0.7, 2)) * (x > -12 ? 1 : 0));
      c.lerp(dark, lane * 0.35 * (0.6 + 0.4 * Math.sin(x * 9 + z * 3)));
      if (T.mud) { const q = Math.hypot((x - T.mud.x) / T.mud.rx, (z - T.mud.z) / T.mud.rz); c.lerp(mudC, (1 - THREE.MathUtils.smoothstep(q, 0.85, 1.1)) * (0.85 + 0.15 * Math.sin(x * 11 + z * 7))); }
      const dd = Math.hypot(x - T.donut.x, z - T.donut.z);
      if (Math.abs(dd - T.donut.r) < 0.05) c.copy(chalk);
      if (Math.abs(x - T.gates[0].x) < 0.06 && Math.abs(z - T.gates[0].z) < 1.3) c.copy(chalk);
      c.multiplyScalar(0.88 + n1 * 0.2);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const m = surface('dirt', { repeat: [T.hx * 1.4, T.hz * 1.4], normalScale: 1.4 }); m.vertexColors = true;
    const mesh = new THREE.Mesh(geo, m); mesh.receiveShadow = true; parent.add(mesh);
  }

  private buildWalls(parent: THREE.Object3D) {
    const sponsors: [string, string, string][] = [['CRAGWELD RC', '#c0642a', '#f1eadb'], ['RUTTWORKS', '#1c1c1e', '#f2c230'], ['GRIPHOLD TYRES', '#2a5aa8', '#f1eadb'], ['TURFHOUND', '#b8281f', '#f1eadb'],
      ['MUDHAMMER', '#1f6fd1', '#f7d23a'], ['BRACKENBANK RC CLUB', '#3f5a3a', '#f1eadb'], ['VOLTSTACK LIPO', '#1c1c1e', '#7fe39a'], ['DIRT DAYS', '#e8622a', '#1c1c1e']];
    const tex = sponsors.map(([t, bg, fg]) => {
      const c = document.createElement('canvas'); c.width = 512; c.height = 96; const g = c.getContext('2d')!;
      g.fillStyle = bg; g.fillRect(0, 0, 512, 96); g.fillStyle = fg; g.font = '900 60px "Barlow Condensed", "Arial Narrow", sans-serif'; g.textAlign = 'center'; g.fillText(t, 256, 70);
      const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace; return tx;
    });
    const ply = surface('wood', { color: 0xd8d2c4, repeat: [2, 1] });
    const post = surface('paint', { color: 0x2b2e33, metalness: 0.5, roughness: 0.4 });
    const run = (ax: number, az: number, bx: number, bz: number, faceIn: number) => {
      const len = Math.hypot(bx - ax, bz - az), n = Math.round(len / 2.4), rot = Math.atan2(-(bz - az), bx - ax);
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n, x = ax + (bx - ax) * t, z = az + (bz - az) * t;
        const seg = new THREE.Group(); seg.position.set(x, 0, z); seg.rotation.y = rot; parent.add(seg);
        const board = new THREE.Mesh(roundedBox(len / n - 0.04, 0.62, 0.04, 0.01), ply); board.position.y = 0.31; board.castShadow = true; board.receiveShadow = true; seg.add(board);
        const ban = new THREE.Mesh(new THREE.PlaneGeometry(len / n - 0.2, 0.36), new THREE.MeshStandardMaterial({ map: tex[(i + Math.round(ax)) % tex.length], roughness: 0.6 }));
        ban.position.set(0, 0.33, faceIn * 0.022); if (faceIn < 0) ban.rotation.y = Math.PI; seg.add(ban);
        const p = new THREE.Mesh(roundedBox(0.08, 0.7, 0.08, 0.01), post); p.position.set(-(len / n) / 2, 0.35, 0); seg.add(p);
      }
    };
    run(-17.3, 11.3, 17.3, 11.3, -1); run(-17.3, -11.3, 17.3, -11.3, 1); run(-17.3, -11.3, -17.3, 11.3, -1); run(17.3, -11.3, 17.3, 11.3, 1);
  }

  /** Aluminium bleachers with a crowd; side = +1 near (camera) side, -1 far side. */
  private buildStands(parent: THREE.Object3D, side: number) {
    const rows = 8, alu = surface('paint', { color: 0xb9bec4, metalness: 0.8, roughness: 0.35 }), frame = surface('paint', { color: 0x3a3d42, metalness: 0.6, roughness: 0.4 });
    for (let k = 0; k < rows; k++) {
      const z = side * (12.1 + k * 0.55), y = 0.45 + k * 0.42;
      const bench = new THREE.Mesh(roundedBox(34, 0.05, 0.3, 0.01), alu); bench.position.set(0, y, z); bench.receiveShadow = true; parent.add(bench);
      const foot = new THREE.Mesh(roundedBox(34, 0.03, 0.26, 0.01), alu); foot.position.set(0, y - 0.38, z + side * 0.22); parent.add(foot);
    }
    for (let x = -17; x <= 17; x += 2.8) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 3.6, 0.08), frame); leg.position.set(x, 1.6, side * 15.8); parent.add(leg);
      const brace = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 4.6), frame); brace.position.set(x, 1.6, side * 13.9); brace.rotation.x = side * 0.62; parent.add(brace);
    }
    const back = new THREE.Mesh(roundedBox(34.4, 1.1, 0.1, 0.02), frame); back.position.set(0, 3.95, side * 16.25); parent.add(back);
    if (side > 0) { // the operators' platform at the top of the near stand
      const deck = new THREE.Mesh(roundedBox(4, 0.08, 1.6, 0.02), alu); deck.position.set(0, 3.9, 16.6); parent.add(deck);
      const rail = new THREE.Mesh(roundedBox(4, 0.05, 0.05, 0.01), frame); rail.position.set(0, 4.85, 15.85); parent.add(rail);
    }
    // crowd: seated/standing figures (merged torso + head), instanced with shirt colours
    const torso = new THREE.CylinderGeometry(0.17, 0.2, 0.62, 6); torso.translate(0, 0.31, 0);
    const legs = new THREE.BoxGeometry(0.3, 0.1, 0.36); legs.translate(0, 0.0, side * -0.12);
    const bodyGeo = mergeGeometries([torso.toNonIndexed(), legs.toNonIndexed()])!;
    const headGeo = new THREE.SphereGeometry(0.115, 8, 6); headGeo.translate(0, 0.75, 0);
    const spots: [number, number, number][] = [];
    for (let k = 0; k < rows; k++) for (let x = -16.6; x <= 16.6; x += 0.62) {
      if (side > 0 && Math.abs(x) < 3.2 && k > 2) continue; // keep the operator's sight line clear
      if (hash(x * 1.3, k * 2.1 + side) < (side > 0 ? 0.45 : 0.3)) continue;
      spots.push([x + (hash(x, k) - 0.5) * 0.2, 0.47 + k * 0.42, side * (12.1 + k * 0.55)]);
    }
    const bodies = new THREE.InstancedMesh(bodyGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 }), spots.length);
    const heads = new THREE.InstancedMesh(headGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 }), spots.length);
    const m = new THREE.Matrix4(), shirts = [0xd63a2f, 0x2557c9, 0xf2c230, 0xf1eadb, 0x3f5a3a, 0x1c1c1e, 0xe8622a, 0x7a4fb0, 0x5ab0d8];
    const skins = [0xf1c7a4, 0xd9a07a, 0xb57a52, 0x8a5a3a, 0x5e3d28, 0xf5d6bd];
    spots.forEach(([x, y, z], i) => {
      const sc = 0.9 + hash(x, z) * 0.2;
      m.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (side > 0 ? Math.PI : 0) + (hash(z, x) - 0.5) * 0.6), new THREE.Vector3(sc, sc, sc));
      bodies.setMatrixAt(i, m); heads.setMatrixAt(i, m);
      bodies.setColorAt(i, new THREE.Color(shirts[Math.floor(hash(x * 7, z * 3) * shirts.length)]).multiplyScalar(0.7 + hash(x, y) * 0.3));
      heads.setColorAt(i, new THREE.Color(skins[Math.floor(hash(x * 3, z * 5) * skins.length)]));
    });
    this.scene.add(bodies, heads);
  }

  private buildLights(parent: THREE.Object3D) {
    const pole = surface('paint', { color: 0x4a4d52, metalness: 0.7, roughness: 0.4 });
    const lamp = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4dc, emissiveIntensity: 2.2, roughness: 0.3 });
    for (const [x, z] of [[-19, -14], [19, -14], [-19, 14], [19, 14]]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.24, 10, 10), pole); p.position.set(x, 5, z); parent.add(p);
      const bank = new THREE.Group(); bank.position.set(x * 0.97, 10.2, z * 0.97); bank.lookAt(0, 0, 0); parent.add(bank);
      const frameM = new THREE.Mesh(roundedBox(2.2, 1.2, 0.2, 0.04), pole); bank.add(frameM);
      for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) { const l = new THREE.Mesh(new THREE.CircleGeometry(0.2, 16), lamp); l.position.set(-0.75 + i * 0.5, -0.27 + j * 0.54, 0.11); bank.add(l); }
    }
  }

  /** County-fair dressing: hay bales along the boards, a Ferris wheel, striped tents and festoon lights. */
  private buildFair(parent: THREE.Object3D) {
    const hay = surface('fabric', { color: 0xd8b25a, repeat: [2, 1], normalScale: 2 });
    const twine = new THREE.MeshStandardMaterial({ color: 0x8a5a2a, roughness: 0.9 });
    const bale = roundedBox(1.0, 0.42, 0.5, 0.06);
    for (const [ax, az, bx, bz] of [[-16.2, 10.9, 16.2, 10.9], [-16.2, -10.9, 16.2, -10.9], [-16.9, -10.2, -16.9, 10.2], [16.9, -10.2, 16.9, 10.2]] as [number, number, number, number][]) {
      const len = Math.hypot(bx - ax, bz - az), n = Math.floor(len / 1.05), rot = Math.atan2(-(bz - az), bx - ax);
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n, b = new THREE.Mesh(bale, hay); b.position.set(ax + (bx - ax) * t, 0.21, az + (bz - az) * t); b.rotation.y = rot + (hash(i, ax) - 0.5) * 0.08; b.castShadow = true; b.receiveShadow = true; parent.add(b);
        for (const o of [-0.25, 0.25]) { const tw = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.43, 0.51), twine); tw.position.copy(b.position); tw.rotation.y = b.rotation.y; tw.translateX(o); parent.add(tw); }
        if (i % 4 === 1) { const top = new THREE.Mesh(bale, hay); top.position.copy(b.position).setY(0.63); top.rotation.y = b.rotation.y + 0.06; top.castShadow = true; parent.add(top); }
      }
    }
    // Ferris wheel beyond the far stand
    const steel = surface('paint', { color: 0xe8e2d4, metalness: 0.5, roughness: 0.4 }), red = surface('paint', { color: 0xd2232a });
    const wheel = new THREE.Group(); wheel.position.set(-12, 11, -27); parent.add(wheel);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(9, 0.18, 8, 64), steel); wheel.add(rim);
    const rim2 = rim.clone(); rim2.position.z = 1.2; wheel.add(rim2);
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 9, 6), steel); sp.position.set(Math.cos(a) * 4.5, Math.sin(a) * 4.5, 0.6); sp.rotation.z = a - Math.PI / 2; wheel.add(sp);
      const cab = new THREE.Mesh(roundedBox(1.1, 0.9, 1.0, 0.12), surface('paint', { color: [0xd2232a, 0xf2c230, 0x2a5aa8, 0x3f9a4a][k % 4] })); cab.position.set(Math.cos(a) * 9, Math.sin(a) * 9 - 0.7, 0.6); wheel.add(cab);
    }
    for (const sx of [-1, 1]) { const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 12.5, 8), steel); leg.position.set(-12 + sx * 3.6, 5.4, -26.4); leg.rotation.z = sx * 0.3; parent.add(leg); }
    // striped tents
    const tentCols = [0xd2232a, 0x2a5aa8, 0xf2c230, 0x3f9a4a, 0xd2232a, 0x7a4fb0];
    tentCols.forEach((col, i) => {
      const x = -24 + i * 9.5, z = -21 - (i % 2) * 3;
      const t = new THREE.Group(); t.position.set(x, 0, z); parent.add(t);
      const wall = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 2, 12, 1, true), surface('fabric', { color: 0xf1eadb, repeat: [6, 1], side: THREE.DoubleSide })); wall.position.y = 1; t.add(wall);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(2.6, 2, 12), surface('fabric', { color: col, repeat: [6, 2] })); roof.position.y = 3; roof.castShadow = true; t.add(roof);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.35), red); flag.position.set(0.3, 4.3, 0); t.add(flag);
    });
    // festoon lights strung over the far stand
    const bulb = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffd9a0, emissiveIntensity: 1.8 });
    const bulbG = new THREE.SphereGeometry(0.08, 8, 6);
    for (let i = 0; i < 70; i++) { const x = -17 + i * 0.5, sag = Math.sin(((i % 14) / 14) * Math.PI) * 0.6; const b = new THREE.Mesh(bulbG, bulb); b.position.set(x, 5.4 - sag, -16.6); parent.add(b); }
    // two light poles for the evening sessions
    const pole = surface('paint', { color: 0x4a4d52, metalness: 0.7, roughness: 0.4 });
    for (const [x, z] of [[-19, 14], [19, 14]]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.24, 10, 10), pole); p.position.set(x, 5, z); parent.add(p); }
  }

  private buildScoreboard() {
    const c = document.createElement('canvas'); c.width = 768; c.height = 288;
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const frame = new THREE.Mesh(roundedBox(7.2, 2.9, 0.3, 0.06), surface('paint', { color: 0x1c1d20, metalness: 0.4, roughness: 0.5 }));
    frame.position.set(0, 6.9, -17.2); this.scene.add(frame);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(6.8, 2.55), new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.9, roughness: 0.4 }));
    screen.position.set(0, 6.9, -17.04); this.scene.add(screen);
    for (const x of [-2.6, 2.6]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.2, 5.5, 0.2), surface('paint', { color: 0x3a3d42, metalness: 0.6 })); leg.position.set(x, 2.8, -17.3); this.scene.add(leg); }
    const b = { canvas: c, tex };
    this.board = b;
    this.setScoreboard(arenaName(this.terrain.layout).toUpperCase(), 'MUDHAMMER', '');
    return b;
  }

  /** Big screen: title line, main line, sub line. */
  setScoreboard(title: string, main: string, sub: string) {
    const { canvas: c, tex } = this.board, g = c.getContext('2d')!;
    g.fillStyle = '#07080c'; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#f2c230'; g.fillRect(0, 0, c.width, 46);
    g.fillStyle = '#111'; g.font = '900 36px "Barlow Condensed", system-ui, sans-serif'; g.textAlign = 'center'; g.fillText(title, c.width / 2, 36);
    g.fillStyle = '#f1eadb'; g.font = '900 128px "Barlow Condensed", system-ui, sans-serif'; g.fillText(main, c.width / 2, 186);
    g.fillStyle = '#7fe39a'; g.font = '800 40px "Barlow Condensed", system-ui, sans-serif'; g.fillText(sub, c.width / 2, 258);
    tex.needsUpdate = true;
  }

  // ---------------------------------------------------------------- junk cars (sculpted sedans)
  private buildCars() {
    const T = this.terrain;
    T.cars.forEach((car, i) => {
      const g = sedan(car, i);
      g.position.set(car.x, T.groundAt(car.x, car.z), car.z);
      g.rotation.y = -Math.PI / 2 - car.rot;
      this.scene.add(g); this.carMeshes.push(g);
    });
  }

  /** Visual crush: squash the car flat, kink it, drop the glass. */
  crushCar(i: number) {
    const g = this.carMeshes[i]; if (!g) return;
    g.scale.set(1.04, 0.45, 1.08);
    g.rotation.z = (hash(i, 3) - 0.5) * 0.12; g.rotation.x = (hash(i, 7) - 0.5) * 0.1;
  }
  resetCars() { this.carMeshes.forEach((g, i) => { g.scale.set(1, 1, 1); g.rotation.z = 0; g.rotation.x = 0; void i; }); }

  private buildBuses(parent: THREE.Object3D) {
    const T = this.terrain;
    const proto = schoolBus();
    for (const b of T.buses) { const bus = proto.clone(); bus.position.set(b.x, 0, b.z); bus.rotation.y = Math.PI / 2; parent.add(bus); }
  }

  private buildGates() {
    const T = this.terrain;
    const poleM = surface('paint', { color: 0xf1eadb }), flagM = new THREE.MeshStandardMaterial({ color: 0xf06a1c, roughness: 0.7, side: THREE.DoubleSide });
    T.gates.forEach((g, i) => {
      const next = T.gates[(i + 1) % T.gates.length], prev = T.gates[(i - 1 + T.gates.length) % T.gates.length];
      const dir = new THREE.Vector2(next.x - prev.x, next.z - prev.z).normalize();
      const side = new THREE.Vector2(-dir.y, dir.x).multiplyScalar(g.r * 0.85);
      for (const sgn of [-1, 1]) {
        const x = g.x + side.x * sgn, z = g.z + side.y * sgn, y = T.groundAt(x, z);
        const p = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 1.4, 8), poleM); p.position.set(x, y + 0.7, z); this.gates.add(p);
        const f = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.26), i === 0 ? new THREE.MeshStandardMaterial({ map: checker(), side: THREE.DoubleSide }) : flagM); f.position.set(x + 0.2, y + 1.25, z); this.gates.add(f);
      }
    });
    this.gates.visible = false;
    this.scene.add(this.gates);
  }

  focusShadows(target: THREE.Vector3) {
    this.sun.target.position.copy(target);
    this.sun.position.set(target.x - 6, target.y + 14, target.z + 9);
  }
}

function checker() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 40; const g = c.getContext('2d')!;
  for (let i = 0; i < 8; i++) for (let j = 0; j < 5; j++) { g.fillStyle = (i + j) % 2 ? '#111' : '#f1eadb'; g.fillRect(i * 8, j * 8, 8, 8); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.NearestFilter; return t;
}

/** A 1/10 junk sedan body: lofted shell with rust-blotched paint and dark glass, on small wheels. */
function sedan(car: JunkCar, seed: number) {
  const g = new THREE.Group();
  const XF = car.len / 2, XR = -car.len / 2, W = car.wid / 2 - 0.004;
  const belt = profile([[XF, 0.06], [0.15, 0.068], [-0.15, 0.07], [XR, 0.064]]);
  const top = profile([[XF, 0.062], [0.17, 0.072], [0.1, 0.078], [0.07, 0.118], [0.03, 0.124], [-0.07, 0.122], [-0.11, 0.084], [-0.17, 0.078], [XR, 0.07]], 2);
  const cab = (x: number) => sstep(0.11, 0.09, x) * (1 - sstep(-0.1, -0.12, x));
  const AR = 0.042, archTop = (x: number) => { let t = -1; for (const ax of [0.135, -0.135]) { const dx = x - ax; if (Math.abs(dx) < AR) t = Math.max(t, 0.012 + Math.sqrt(AR * AR - dx * dx)); } return t; };
  const spec: ShellSpec = {
    xF: XF, xR: XR, endRound: 0.01,
    half(x) {
      const b = Math.max(0.018, archTop(x)), bl = belt(x), t = top(x), c = cab(x), wt = THREE.MathUtils.lerp(W - 0.006, W - 0.018, c);
      return [[W, b], [W + 0.002, (b + bl) / 2], [W, bl], [THREE.MathUtils.lerp(W - 0.002, wt + 0.002, c), Math.min(bl + 0.003, t - 0.003)], [wt, t - 0.006 * c - 0.002], [wt - 0.012, t], [0, t + 0.002]];
    },
  };
  const base = hex3(car.color), rust: [number, number, number] = [0.42, 0.22, 0.1], glass: [number, number, number] = [0.08, 0.1, 0.12];
  const paint: Painter = (x, y, z, o) => {
    const c = cab(x), az = Math.abs(z);
    const n = Math.sin(x * 90 + seed) * Math.cos(y * 120 + z * 60) + Math.sin(x * 37 + z * 80 + seed * 2) * 0.6;
    o.c = n > 0.75 ? rust : base; o.r = n > 0.75 ? 0.9 : 0.55; o.m = 0.1;
    if (c > 0.5 && y > belt(x) + 0.006 && y < top(x) - 0.006) {
      if (az > W - 0.022 && x < 0.075 && x > -0.095 && Math.abs(x + 0.01) > 0.006) { o.c = glass; o.r = 0.15; o.m = 0.3; }
      if (az < W - 0.024) { o.c = glass; o.r = 0.15; o.m = 0.3; }
    }
    if (y < 0.03) { o.c = [0.1, 0.1, 0.1]; o.r = 0.8; }
  };
  const L = loftShell(spec, paint, { U: 64, V: 40, TW: 256, TH: 128 });
  const hexC = `#${car.color.toString(16).padStart(6, '0')}`;
  g.add(L.outer, L.inner);
  g.add(endCap(L.front, XF, 1, (c2, P) => { c2.fillStyle = hexC; c2.fillRect(0, 0, 4096, 4096); const [a, b] = P(-0.05, 0.05); const [cx, d] = P(0.05, 0.035); c2.fillStyle = '#222'; c2.fillRect(a, b, cx - a, d - b); for (const s of [-1, 1]) { const [lx, ly] = P(s * 0.07, 0.045); c2.fillStyle = '#ddd'; c2.fillRect(lx - 14, ly - 8, 28, 16); } }));
  g.add(endCap(L.rear, XR, -1, (c2, P) => { c2.fillStyle = hexC; c2.fillRect(0, 0, 4096, 4096); for (const s of [-1, 1]) { const [lx, ly] = P(s * 0.07, 0.05); c2.fillStyle = '#a32018'; c2.fillRect(lx - 14, ly - 8, 28, 16); } }));
  const tg = tireGeometry(0.03, 0.02, 2, 14); tg.rotateX(Math.PI / 2);
  const tm = surface('rubber', { color: 0x151515 });
  for (const ax of [0.135, -0.135]) for (const s of [-1, 1]) { const w = new THREE.Mesh(tg, tm); w.position.set(ax, 0.03, s * (W - 0.01)); g.add(w); }
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

/** A 1/10 school bus: boxy lofted body, yellow with black rub rails, window band, stop-arm sign. */
function schoolBus() {
  const g = new THREE.Group();
  const XF = 0.575, XR = -0.575, W = 0.13;
  const top = profile([[XF, 0.2], [0.53, 0.205], [0.45, 0.29], [0.42, 0.3], [XR, 0.3]], 2);
  const hood = (x: number) => sstep(0.45, 0.47, x);
  const archTop = (x: number) => { let t = -1; for (const ax of [0.37, -0.32]) { const dx = x - ax; if (Math.abs(dx) < 0.06) t = Math.max(t, 0.02 + Math.sqrt(0.0036 - dx * dx)); } return t; };
  const spec: ShellSpec = {
    xF: XF, xR: XR, endRound: 0.012,
    half(x) { const b = Math.max(0.03, archTop(x)), t = top(x), h = hood(x); return [[W, b], [W, (b + t) / 2], [W, t - 0.02 - h * 0.01], [W - 0.012, t - 0.002], [0, t + 0.004]]; },
  };
  const yellow: [number, number, number] = [0.95, 0.7, 0.11], black: [number, number, number] = [0.07, 0.07, 0.08], glass: [number, number, number] = [0.1, 0.13, 0.16];
  const paint: Painter = (x, y, z, o) => {
    o.c = yellow; o.r = 0.4; o.m = 0.1;
    const side = Math.abs(z) > W - 0.004;
    if (side && x < 0.43 && x > -0.55 && y > 0.18 && y < 0.255) { const k = ((x + 0.55) / 0.098) % 1; o.c = k < 0.12 ? black : glass; o.r = 0.15; }
    if (side && (Math.abs(y - 0.13) < 0.005 || Math.abs(y - 0.07) < 0.005)) { o.c = black; o.r = 0.5; }
    if (y < 0.04) { o.c = black; o.r = 0.7; }
    if (!side && x < 0.43 && Math.abs(z) < W - 0.02 && y > 0.29) o.c = [0.92, 0.9, 0.86];
  };
  const L = loftShell(spec, paint, { U: 120, V: 40, TW: 512, TH: 128 });
  g.add(L.outer, L.inner);
  g.add(endCap(L.front, XF, 1, (c, P) => { c.fillStyle = '#f2b31c'; c.fillRect(0, 0, 4096, 4096); const [a, b] = P(-0.08, 0.17); const [d, e] = P(0.08, 0.09); c.fillStyle = '#1c1c1e'; c.fillRect(a, b, d - a, e - b); for (const s of [-1, 1]) { const [lx, ly] = P(s * 0.1, 0.13); c.fillStyle = '#eee'; c.beginPath(); c.arc(lx, ly, 14, 0, 7); c.fill(); } }));
  g.add(endCap(L.rear, XR, -1, (c, P) => { c.fillStyle = '#f2b31c'; c.fillRect(0, 0, 4096, 4096); const [a, b] = P(-0.09, 0.26); const [d, e] = P(0.09, 0.19); c.fillStyle = '#1a2026'; c.fillRect(a, b, d - a, e - b); for (const s of [-1, 1]) { const [lx, ly] = P(s * 0.1, 0.27); c.fillStyle = '#c8231b'; c.beginPath(); c.arc(lx, ly, 10, 0, 7); c.fill(); } }));
  const tg = tireGeometry(0.05, 0.035, 2, 18); tg.rotateX(Math.PI / 2);
  const tm = surface('rubber', { color: 0x151515 });
  for (const ax of [0.37, -0.32]) for (const s of [-1, 1]) { const w = new THREE.Mesh(tg, tm); w.position.set(ax, 0.05, s * (W - 0.012)); g.add(w); }
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}
