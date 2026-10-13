// Ruttworks Garage: one connected room. Default mode is an eye-level look-around (drag to look, tap a
// station). Stations open close views inside the same room: vehicle shelves, workbench, charging
// bench, parts cabinet and the exit with a departure check.
import { EVENTS, EventDef, ordinal } from '../data/events';
import * as THREE from 'three';
import { createBuggy, BuggyModel, lookFor, lookKey } from '../assets/buggyModel';
import {
  ANCHORS, ChargerRig, DecorId, SHELF_SLOTS, STATION_LABELS, StationId, buildBackWallDecor, buildChargingWall, buildEntryWall,
  buildClutter, buildWallFill, buildFloorProps, buildPartsCabinet, buildShell, buildStorageWall, buildToolChest, buildWorkbench, buildSandboxTable,
} from '../assets/garageRoom';
import { createMower } from '../assets/mowerModel';
import { createMonster, MonsterModel } from '../assets/monsterModel';
import { MONSTER_PAY } from './MonsterScene';
import { createDrift, DriftModel, DRIFT_BODY_NAME } from '../assets/driftModel';
import { DRIFT_SPEC } from '../sim/DriftSim';
import { DRIFT_TRACK_NAME, driftVenueName } from '../sim/DriftTrack';
import { ACCENT_COLORS, BUGGY_CLASSES, BUGGY_ORDER, BuggyId, DEFAULT_SETUP, ECONOMY, FUTURE_CLASSES, LIVERIES, PAINT_COLORS, PartId, SETUP_RANGES, SetupSheet, setupFx, SHOCK_SETTINGS, TIRE_COMPOUNDS, TireCompound } from '../data/specs';
import { packLetter, vehicleFx } from '../core/ServiceSystem';
import { BatteryState, SaveData, activeVehicle, defaultVehicle, installedBattery, monsterBest } from '../core/state';
import { PartsSheet } from '../ui/PartsSheet';
import { roomEnvironment } from '../assets/materials';
import { lipoPack } from '../assets/garageKit';
import { createCrawler, CrawlerModel } from '../assets/crawlerModel';
import { CRAWLER_SLOTS, CRAWLER_UPGRADES, crawlerSpecFor, crawlerUpgradeById } from '../sim/CrawlerSim';
import { DRIFT_SLOT_NAMES, DRIFT_SLOTS, DRIFT_UPGRADES, driftColorsFor, DriftSlot, driftSpecFor, driftUpgradeById } from '../sim/driftUpgrades';
import { MONSTER_SLOT_NAMES, MONSTER_SLOTS, MONSTER_UPGRADES, MonsterSlot, monsterSpecFor, monsterUpgradeById } from '../sim/monsterUpgrades';
import { TRAIL_NAME } from '../sim/CrawlTerrain';
import { batchStatic } from '../assets/staticBatch';
import { bar, fmtTime, h, toast } from '../ui/dom';
import { runScrewSort, SORT } from '../ui/ScrewSort';
import { MOW_PAY } from './MowScene';
import { AppContext, INTERNAL_PARTS, OrbitInspect, Screen, fovFor, ghostShell } from './common';

export type GarageMode = 'room' | StationId;

const STATION_VIEWS: Record<Exclude<GarageMode, 'room' | 'bench'>, { pos: THREE.Vector3; target: THREE.Vector3; hfov: number }> = {
  storage: { pos: new THREE.Vector3(-1.35, 1.45, -3.25), target: new THREE.Vector3(-2.7, 1.02, -4.0), hfov: 68 },
  charging: { pos: new THREE.Vector3(1.6, 1.42, -4.35), target: new THREE.Vector3(2.75, 0.95, -4.8), hfov: 60 },
  parts: { pos: new THREE.Vector3(1.15, 1.45, -4.85), target: new THREE.Vector3(2.2, 1.05, -6.2), hfov: 60 },
  sandbox: { pos: new THREE.Vector3(0.95, 1.5, -2.05), target: new THREE.Vector3(2.5, 0.9, -2.6), hfov: 60 },
  departure: { pos: new THREE.Vector3(0.3, 1.6, -3.3), target: new THREE.Vector3(-0.3, 1.15, 0), hfov: 70 },
};

const TITLES: Record<GarageMode, string> = {
  room: 'Look around', storage: 'Vehicle shelves', bench: 'Workbench', charging: 'Charging bench', parts: 'Parts cabinet', sandbox: 'Sandbox table', departure: 'Ready check',
};

interface Snapshot { at: number; charges: Record<string, number>; cond: Record<string, number> }
let departSnapshot: Snapshot | null = null;

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export class GarageScene implements Screen {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(70, 1, 0.03, 40);
  mode: GarageMode = 'room';
  /** Session-only room orientation; restored when backing out of a station. */
  look = { yaw: 0, pitch: -0.17, zoom: 1 };
  private camPos = new THREE.Vector3().copy(ANCHORS.look);
  private camTarget = new THREE.Vector3(0, 1.3, -6.5);
  private trans: { fromPos: THREE.Vector3; fromTarget: THREE.Vector3; t: number; dur: number } | null = null;
  private buggy: BuggyModel;
  private proxies = new THREE.Group();
  private shellOnCar = true;
  private shellAnim: { t: number; off: boolean; fromPos: THREE.Vector3; fromQ: THREE.Quaternion } | null = null;
  private carPlace: 'shelf' | 'bench' = 'shelf';
  private carAnim: { t: number; from: THREE.Vector3; fromRot: number } | null = null;
  private packs = new Map<string, THREE.Group>();
  private charger: ChargerRig;
  private chargeAnim: { id: string; t: number; from: number } | null = null;
  private orbit = new OrbitInspect(ANCHORS.stand.clone().add(new THREE.Vector3(-0.08, 0.05, 0)), 1.2, 0.12, 0.55, 0.15, 1.25);
  private sheet: PartsSheet | null = null;
  private selectedPart: PartId | null = null;
  private ray = new THREE.Raycaster();
  private aspect = 1;
  private time = 0;
  private labelEls = new Map<StationId, HTMLElement>();
  private crawlerShelf: CrawlerModel | null = null;
  private hintEl: HTMLElement | null = null;
  private tmpV = new THREE.Vector3();

  constructor(private ctx: AppContext) {
    const s = this.scene;
    s.background = new THREE.Color(0x221d19);
    // image-based fill so paint, plastic and chrome pick up soft reflections
    s.environment = roomEnvironment(ctx.renderer);
    s.environmentIntensity = 0.3;
    // warm overhead workshop light + modest daylight from the entry
    s.add(new THREE.HemisphereLight(0xffeedd, 0x4a3c30, 0.38));
    for (const z of [-1.8, -4.0, -6.0]) {
      const p = new THREE.PointLight(0xffe2ba, 3.4, 8, 1.8);
      p.position.set(0, 2.38, z);
      s.add(p);
    }
    const key = new THREE.DirectionalLight(0xffe4c0, 1.25);
    key.position.set(-0.8, 2.65, -4.2);
    key.target.position.set(0.2, 0.8, -6.4);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    Object.assign(key.shadow.camera, { left: -3.2, right: 3.2, top: 2.5, bottom: -2.5, near: 0.3, far: 6 });
    key.shadow.bias = -0.0008;
    s.add(key, key.target);
    const day = new THREE.DirectionalLight(0xcfe3ff, 0.35);
    day.position.set(-0.3, 1.6, 2);
    day.target.position.set(0, 0.5, -3);
    s.add(day, day.target);

    // all room furniture is static: build it, then batch it into a few dozen draw calls
    const room = new THREE.Group(); room.name = 'garage-room';
    s.add(room);
    buildShell(room);
    buildEntryWall(room);
    buildWorkbench(room);
    buildToolChest(room);
    buildPartsCabinet(room);
    buildBackWallDecor(room);
    buildStorageWall(room);
    this.charger = buildChargingWall(room);
    buildFloorProps(room);
    this.sandboxAt = buildSandboxTable(room).turntableAt;
    buildClutter(room);
    buildWallFill(room);
    const stats = batchStatic(room, (o) => o.name === 'drift-kit' || o.name.startsWith('kit-'));
    // the sandbox turntable model is decoration until the sandbox opens: build it after the first frames
    window.setTimeout(() => this.showPreview(this.data.sandbox.preview), 1200);
    (window as unknown as { __garageBatch?: unknown }).__garageBatch = stats;
    // warm task light from the LED bar over the bench
    const task = new THREE.PointLight(0xffe2b8, 1.6, 3.2, 1.8);
    task.position.set(0, 2.0, -6.55);
    s.add(task);

    // the one buggy: same model and state on the shelf and on the stand
    // the rock crawler sits on the lower shelf once it's owned
    this.syncCrawler();
    this.buggy = createBuggy(this.data.activeBuggy, lookFor(this.v));
    this.buggy.root.traverse((o) => { o.userData.isBuggy = true; });
    s.add(this.buggy.root);
    this.buildProxies();
    this.syncFleet();
    for (const b of ctx.store.data.batteries) this.packs.set(b.id, this.buildPack(b.id));
    this.placeCarImmediate();
  }

  private get data() { return this.ctx.store.data; }
  private get v() { return activeVehicle(this.data); }

  // ---------------------------------------------------------------- lifecycle
  enter(opts?: Record<string, unknown>) {
    const asked = opts?.view as GarageMode | undefined;
    const want: GarageMode = asked && (asked === 'room' || asked in STATION_VIEWS || asked === 'bench') ? asked : 'room';
    if (opts?.returning) {
      // the buggy comes home onto the bench for service
      this.data.selectedVehicle = this.data.activeBuggy;
      this.data.garage.vehiclePlace = 'bench';
      this.ctx.store.save();
    }
    if (this.buggy.root.userData.lookKey !== lookKey(this.data.activeBuggy, lookFor(this.v))) this.rebuildActiveModel();
    this.syncFleet();
    this.placeCarImmediate();
    this.syncShellImmediate();
    this.mode = want === 'bench' && !this.carOnBench ? 'storage' : want;
    this.trans = null;
    this.snapCamera();
    this.sync();
    this.render();
    if (opts?.returning && departSnapshot) this.showReturnSummary(departSnapshot);
    departSnapshot = null;
  }

  exit() {
    this.sheet = null;
    this.ctx.hud.replaceChildren();
    this.labelEls.clear();
    this.ctx.store.save();
  }

  get carOnBench() { return this.data.selectedVehicle != null && this.data.garage.vehiclePlace === 'bench'; }

  // ---------------------------------------------------------------- navigation
  go(mode: GarageMode) {
    // buttons always work, even mid-transition: the new move starts from wherever the camera is now
    if (mode === this.mode) return;
    if (mode === 'bench' && !this.carOnBench) {
      toast('Pick a car on the shelves and prepare it on the workbench first', 'info');
      mode = 'storage';
    }
    const reduced = this.data.settings.reducedMotion;
    this.trans = { fromPos: this.camera.position.clone(), fromTarget: this.camTarget.clone(), t: 0, dur: reduced ? 0.0001 : 0.6 };
    this.mode = mode;
    if (mode !== 'bench') { this.selectedPart = null; this.sync(); }
    this.render();
  }

  private poseFor(mode: GarageMode, outPos: THREE.Vector3, outTarget: THREE.Vector3) {
    if (mode === 'room') {
      outPos.copy(ANCHORS.look);
      const { yaw, pitch } = this.look;
      outTarget.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)).add(outPos);
    } else if (mode === 'bench') {
      this.orbit.dist = THREE.MathUtils.clamp(this.orbit.dist, 0.55, 1.6);
      this.orbit.position(outPos);
      outTarget.copy(this.orbit.target);
    } else if (mode === 'storage') {
      // the shelving is long: frame the active car's slot (its neighbours stay in view either side)
      const slot = SHELF_SLOTS[this.data.activeBuggy].at;
      outTarget.set(slot.x, slot.y + 0.14, slot.z);
      outPos.set(slot.x + 1.6, slot.y + 0.5, slot.z + 0.5);
    } else {
      const v = STATION_VIEWS[mode];
      outPos.copy(v.pos); outTarget.copy(v.target);
    }
  }

  private hfovFor(mode: GarageMode) {
    if (mode === 'room') return 74 * this.look.zoom;
    if (mode === 'bench') return 64;
    return STATION_VIEWS[mode].hfov;
  }

  private snapCamera() {
    this.poseFor(this.mode, this.camPos, this.camTarget);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camTarget);
    this.camera.fov = fovFor(this.hfovFor(this.mode), this.aspect, 42, 84);
    this.camera.updateProjectionMatrix();
  }

  recenter() {
    this.look.yaw = 0; this.look.pitch = -0.17; this.look.zoom = 1;
  }

  // ---------------------------------------------------------------- input
  tap(ndc: THREE.Vector2) {
    if (this.trans || this.carAnim) return; // no ambiguous taps mid-transition
    this.ray.setFromCamera(ndc, this.camera);
    if (this.mode === 'bench') { this.tapBench(); return; }
    const hits = this.ray.intersectObjects(this.scene.children, true);
    for (const hit of hits) {
      const o = hit.object;
      if (o.userData.isBuggy) { this.go(this.carOnBench ? 'bench' : 'storage'); return; }
      if (o.userData.fleetId) { if (this.mode === 'storage') this.setActive(o.userData.fleetId as BuggyId); else this.go('storage'); return; }
      if (o.userData.batteryId) { this.go('charging'); return; }
      const decor = o.userData.decor as DecorId | undefined;
      if (decor) { this.showDecor(decor); return; }
      const st = o.userData.station as StationId | undefined;
      if (st) { if (this.mode !== st) this.go(st); return; }
      if (o.userData.solid !== false) break; // first solid surface wins
    }
  }

  /** Deterministic selection: nearest surface wins, but serviceable parts beat structure when they
   *  are within a few millimetres of it, and thin parts get forgiving invisible volumes. */
  private tapBench() {
    const shellOn = this.v.shellOn;
    const shellThrough = !!this.selectedPart && shellOn && INTERNAL_PARTS.includes(this.selectedPart);
    const meshes: THREE.Object3D[] = [];
    for (const [id, list] of this.buggy.parts) {
      if (id === 'shell' && shellThrough) continue;
      for (const m of list) if (m.visible) meshes.push(m);
    }
    const hits = this.ray.intersectObjects(meshes, false)
      .concat(this.ray.intersectObjects(this.proxies.children, false).filter((x) => !shellOn || ['tires', 'shell'].includes(x.object.userData.partId)))
      .sort((a, b) => a.distance - b.distance);
    let p: PartId | null = null;
    if (hits.length) {
      const PRIORITY: PartId[] = ['battery', 'tires', 'shocks', 'shell', 'motor', 'servo', 'esc', 'diff', 'gears', 'chassis'];
      const near = hits.filter((x) => x.distance <= hits[0].distance + 0.035);
      near.sort((a, b) => PRIORITY.indexOf(a.object.userData.partId) - PRIORITY.indexOf(b.object.userData.partId));
      p = near[0].object.userData.partId as PartId;
      // with the body on, an internal part is only reachable once you've chosen it from the list
      if (shellOn && !shellThrough && INTERNAL_PARTS.includes(p) && hits.some((x) => x.object.userData.partId === 'shell')) p = 'shell';
    }
    if (this.sheet) this.sheet.select(p); // empty bench space deselects
  }

  drag(dx: number, dy: number) {
    if (this.trans) return;
    if (this.mode === 'room') {
      this.look.yaw -= dx * 0.0055;
      this.look.pitch = THREE.MathUtils.clamp(this.look.pitch + dy * 0.0045, -0.85, 0.6);
      this.hideHint();
    } else if (this.mode === 'bench') {
      this.orbit.drag(dx, dy);
      this.orbit.az = THREE.MathUtils.clamp(this.orbit.az, -1.25, 1.25); // never through the back wall
    }
  }

  zoom(f: number) {
    if (this.mode === 'room') this.look.zoom = THREE.MathUtils.clamp(this.look.zoom * f, 0.62, 1.05);
    else if (this.mode === 'bench') this.orbit.dist = THREE.MathUtils.clamp(this.orbit.dist * f, 0.55, 1.6);
  }

  // ---------------------------------------------------------------- props + state sync
  private buildPack(id: string) {
    const g = new THREE.Group();
    lipoPack(g, `PACK ${packLetter(this.data.batteries.find((b) => b.id === id)?.name ?? '?')}`);
    g.scale.setScalar(1.6); // the prop reads at room distance; the in-car pack is modelled separately
    g.traverse((o) => { o.userData.batteryId = id; (o as THREE.Mesh).castShadow = true; });
    this.scene.add(g);
    return g;
  }

  // ---------------------------------------------------------------- the buggy fleet
  /** Shelf models for owned buggies that aren't the active one (the active one is this.buggy). */
  private fleet = new Map<BuggyId, BuggyModel>();

  private syncFleet() {
    const d = this.data;
    for (const id of BUGGY_ORDER) {
      const owned = !!d.vehicles[id], slot = SHELF_SLOTS[id];
      const kit = this.scene.getObjectByName(`kit-${id}`); if (kit) kit.visible = !owned;
      let m = this.fleet.get(id);
      const wantShelf = owned && id !== d.activeBuggy;
      if (m && wantShelf && m.root.userData.lookKey !== lookKey(id, lookFor(d.vehicles[id]!))) { this.scene.remove(m.root); this.fleet.delete(id); m = undefined; }
      if (wantShelf && !m) {
        m = createBuggy(id, lookFor(d.vehicles[id]!));
        m.root.position.copy(slot.at); m.root.rotation.y = slot.rot;
        m.root.traverse((o) => { o.userData.fleetId = id; (o as THREE.Mesh).castShadow = true; });
        this.scene.add(m.root); this.fleet.set(id, m);
      }
      if (m) {
        m.root.visible = wantShelf;
        const v = d.vehicles[id];
        if (v) { m.setTires(v.tireCompound, v.condition.tires); m.setBatteryVisible(v.batteryId !== null); m.setShell(true); }
      }
    }
  }

  /** Replace the active (bench/shelf) model after the active buggy changes. */
  private rebuildActiveModel() {
    const old = this.buggy;
    this.scene.remove(old.root);
    if (old.shell.parent && old.shell.parent !== old.body && old.shell.parent !== old.root) old.shell.parent.remove(old.shell);
    old.root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && !m.userData.partId) m.geometry.dispose(); });
    this.buggy = createBuggy(this.data.activeBuggy, lookFor(this.v));
    this.buggy.root.traverse((o) => { o.userData.isBuggy = true; });
    this.scene.add(this.buggy.root);
    this.proxies = new THREE.Group();
    this.buildProxies();
    this.shellOnCar = true;
    this.shellAnim = null;
    this.selectedPart = null;
  }

  /** Make another owned buggy the one the bench, battery and track use. The pack moves across with you. */
  private setActive(id: BuggyId) {
    const d = this.data;
    if (id === d.activeBuggy || !d.vehicles[id] || this.carAnim) return;
    const cur = activeVehicle(d);
    if (!cur.shellOn) { toast(`Refit the body on the ${BUGGY_CLASSES[cur.id].short} first`, 'warn'); return; }
    const next = d.vehicles[id]!;
    if (next.batteryId === null && cur.batteryId !== null) { next.batteryId = cur.batteryId; cur.batteryId = null; }
    d.activeBuggy = id;
    d.selectedVehicle = id;
    d.garage.vehiclePlace = 'shelf';
    this.ctx.store.save();
    this.rebuildActiveModel();
    this.syncFleet();
    this.placeCarImmediate();
    this.trans = { fromPos: this.camera.position.clone(), fromTarget: this.camTarget.clone(), t: 0, dur: d.settings.reducedMotion ? 0.0001 : 0.6 };
    this.syncShellImmediate();
    this.sync();
    toast(`${BUGGY_CLASSES[id].name} is your active car`, 'good');
    this.render();
  }

  private buyBuggy(id: BuggyId) {
    const d = this.data, price = this.ctx.service.price(BUGGY_CLASSES[id].price);
    if (d.vehicles[id] || d.credits < price) return;
    d.credits -= price;
    d.vehicles[id] = defaultVehicle(id);
    this.ctx.store.save();
    this.syncFleet();
    toast(`${BUGGY_CLASSES[id].name} bought: it's on the shelf`, 'good');
    this.render();
  }

  private buildProxies() {
    // invisible but raycastable selection volumes, in buggy-root space
    const inv = new THREE.MeshBasicMaterial({ visible: false });
    const add = (part: PartId, size: [number, number, number], pos: [number, number, number]) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(...size), inv);
      m.position.set(...pos); m.userData.partId = part; m.userData.isBuggy = true; this.proxies.add(m);
    };
    add('battery', [0.18, 0.06, 0.075], [0, 0.06, -0.038]);
    add('motor', [0.09, 0.07, 0.07], [-0.07, 0.065, 0.035]);
    add('esc', [0.07, 0.06, 0.06], [0.035, 0.06, 0.04]);
    add('servo', [0.06, 0.06, 0.05], [0.11, 0.06, 0.028]);
    add('gears', [0.07, 0.07, 0.04], [-0.025, 0.07, 0.03]);
    for (const x of [0.17, -0.17]) add('diff', [0.07, 0.06, 0.07], [x, 0.06, 0]);
    for (const x of [0.15, -0.15]) for (const z of [0.075, -0.075]) add('shocks', [0.06, 0.1, 0.05], [x, 0.085, z]);
    for (const x of [0.165, -0.165]) for (const z of [0.125, -0.125]) add('tires', [0.15, 0.15, 0.08], [x, 0.06, z]);
    add('chassis', [0.44, 0.03, 0.15], [0, 0.04, 0]);
    this.buggy.root.add(this.proxies);
  }

  private carTarget() {
    return this.carPlace === 'bench'
      ? { pos: ANCHORS.stand, rot: 0.25 }
      : { pos: SHELF_SLOTS[this.data.activeBuggy].at, rot: SHELF_SLOTS[this.data.activeBuggy].rot };
  }

  private placeCarImmediate() {
    this.carPlace = this.carOnBench ? 'bench' : 'shelf';
    const t = this.carTarget();
    this.buggy.root.position.copy(t.pos);
    this.buggy.root.rotation.set(0, t.rot, 0);
    this.carAnim = null;
  }

  private syncShellImmediate() {
    const shell = this.buggy.shell;
    if (this.v.shellOn) {
      this.buggy.body.add(shell);
      shell.position.set(0, 0, 0); shell.quaternion.identity();
      this.shellOnCar = true;
    } else {
      this.scene.add(shell);
      shell.position.copy(ANCHORS.shellRest); shell.rotation.set(0, 0.7, 0);
      this.shellOnCar = false;
    }
    this.shellAnim = null;
  }

  /** Reflect saved state in the room (one place for each physical object). */
  private sync() {
    const d = this.data;
    const v = this.v;
    // car placement: animate a short carry between shelf and stand
    const want = this.carOnBench ? 'bench' : 'shelf';
    if (want !== this.carPlace) {
      this.carAnim = { t: 0, from: this.buggy.root.position.clone(), fromRot: this.buggy.root.rotation.y };
      this.carPlace = want;
    }
    if (v.shellOn !== this.shellOnCar && !this.shellAnim) {
      this.shellAnim = { t: 0, off: !v.shellOn, fromPos: new THREE.Vector3(), fromQ: new THREE.Quaternion() };
      this.buggy.shell.getWorldPosition(this.shellAnim.fromPos);
      this.buggy.shell.getWorldQuaternion(this.shellAnim.fromQ);
      this.scene.attach(this.buggy.shell);
    }
    this.buggy.shell.visible = true;
    this.buggy.setTires(v.tireCompound, v.condition.tires);
    this.buggy.setBatteryVisible(v.batteryId !== null);
    ghostShell(this.buggy, this.mode === 'bench' && !!this.selectedPart && v.shellOn && INTERNAL_PARTS.includes(this.selectedPart));
    // battery packs: in the car (hidden prop), on the bench tray, or on a charger slot
    let benchSlot = 0;
    d.batteries.forEach((b, i) => {
      const pack = this.packs.get(b.id)!;
      if (b.id === v.batteryId) { pack.visible = false; return; }
      pack.visible = true;
      const place = d.garage.batteryPlace[b.id] ?? 'charger';
      if (place === 'bench') {
        pack.position.copy(ANCHORS.benchPack[Math.min(benchSlot++, ANCHORS.benchPack.length - 1)]);
        pack.rotation.set(0, 0.1, 0);
      } else {
        pack.position.copy(ANCHORS.chargerPack[i % ANCHORS.chargerPack.length]);
        pack.rotation.set(0, Math.PI / 2, 0);
      }
    });
    this.drawChargers();
  }

  private drawChargers() {
    const d = this.data;
    d.batteries.forEach((b, i) => {
      const disp = this.charger.displays[i];
      if (!disp) return;
      const onCharger = b.id !== this.v.batteryId && (d.garage.batteryPlace[b.id] ?? 'charger') === 'charger';
      const animating = this.chargeAnim?.id === b.id;
      const pct = animating ? this.chargeAnim!.from + (100 - this.chargeAnim!.from) * Math.min(1, this.chargeAnim!.t / 0.8) : b.charge;
      const g = disp.canvas.getContext('2d')!;
      g.fillStyle = '#0b2233'; g.fillRect(0, 0, 256, 128);
      g.fillStyle = '#7fd4ff'; g.font = '700 30px system-ui, sans-serif'; g.textAlign = 'left';
      if (!onCharger) {
        g.fillText('NO PACK', 18, 52);
        g.font = '500 22px system-ui'; g.fillText(b.id === this.v.batteryId ? `${packLetter(b.name)}: IN BUGGY` : `${packLetter(b.name)}: ON BENCH`, 18, 96);
      } else {
        g.fillText(`PACK ${packLetter(b.name)}`, 18, 46);
        g.font = '800 44px system-ui'; g.fillText(`${Math.round(pct)}%`, 18, 104);
        g.font = '600 20px system-ui'; g.textAlign = 'right';
        g.fillText(animating ? 'CHARGING' : pct >= 100 ? 'FULL' : 'READY', 238, 104);
      }
      disp.tex.needsUpdate = true;
      const led = this.charger.leds[i];
      const col = !onCharger ? 0x444444 : animating ? 0xffb020 : pct >= 100 ? 0x33ff66 : 0xff7a30;
      led.color.setHex(col); led.emissive.setHex(col);
    });
  }

  // ---------------------------------------------------------------- per frame
  update(dt: number) {
    this.time += dt;
    if (this.preview) this.preview.rotation.y += dt * 0.45;
    // camera
    const pos = this.tmpV, target = new THREE.Vector3();
    this.poseFor(this.mode, pos, target);
    if (this.trans) {
      this.trans.t += dt / this.trans.dur;
      const k = ease(Math.min(1, this.trans.t));
      this.camPos.copy(this.trans.fromPos).lerp(pos, k);
      this.camTarget.copy(this.trans.fromTarget).lerp(target, k);
      if (this.trans.t >= 1) this.trans = null;
    } else {
      const k = this.mode === 'room' ? 1 : 1 - Math.exp(-dt * 12);
      this.camPos.lerp(pos, k);
      this.camTarget.lerp(target, k);
    }
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camTarget);
    const fov = fovFor(this.hfovFor(this.mode), this.aspect, 38, 84);
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov += (fov - this.camera.fov) * Math.min(1, dt * 8);
      this.camera.updateProjectionMatrix();
    }

    // car carry between shelf and stand (short arc)
    if (this.carAnim) {
      const reduced = this.data.settings.reducedMotion;
      this.carAnim.t += dt / (reduced ? 0.0001 : 0.9);
      const k = ease(Math.min(1, this.carAnim.t));
      const t = this.carTarget();
      this.buggy.root.position.copy(this.carAnim.from).lerp(t.pos, k);
      this.buggy.root.position.y += Math.sin(Math.PI * k) * 0.45;
      this.buggy.root.rotation.y = this.carAnim.fromRot + (t.rot - this.carAnim.fromRot) * k;
      if (this.carAnim.t >= 1) { this.carAnim = null; this.buggy.root.position.copy(t.pos); }
    }
    // shell lift to/from the rest mat
    if (this.shellAnim) {
      const a = this.shellAnim;
      a.t += dt / (this.data.settings.reducedMotion ? 0.0001 : 0.55);
      const k = ease(Math.min(1, a.t));
      const shell = this.buggy.shell;
      const toPos = new THREE.Vector3(), toQ = new THREE.Quaternion();
      if (a.off) { toPos.copy(ANCHORS.shellRest); toQ.setFromEuler(new THREE.Euler(0, 0.7, 0)); }
      else { this.buggy.body.updateMatrixWorld(true); this.buggy.body.getWorldPosition(toPos); this.buggy.body.getWorldQuaternion(toQ); }
      shell.position.copy(a.fromPos).lerp(toPos, k);
      shell.position.y += Math.sin(Math.PI * k) * 0.22;
      shell.quaternion.copy(a.fromQ).slerp(toQ, k);
      if (a.t >= 1) {
        if (a.off) { this.shellOnCar = false; }
        else { this.buggy.body.add(shell); shell.position.set(0, 0, 0); shell.quaternion.identity(); this.shellOnCar = true; }
        this.shellAnim = null;
        this.sync();
      }
    }
    // charging display animation (state already committed; this only shows it)
    if (this.chargeAnim) {
      this.chargeAnim.t += dt;
      this.drawChargers();
      if (this.chargeAnim.t >= 0.8) { this.chargeAnim = null; this.drawChargers(); this.render(); }
    }
    this.buggy.highlight(this.mode === 'bench' ? this.selectedPart : null, this.time);
    if (this.mode === 'room' && !this.trans) this.updateLabels();
  }

  private updateLabels() {
    const r = this.ctx.canvas.getBoundingClientRect();
    for (const [id, el] of this.labelEls) {
      const p = STATION_LABELS[id].at.clone().project(this.camera);
      const visible = p.z < 1 && Math.abs(p.x) < 1.05 && Math.abs(p.y) < 1.05;
      el.style.display = visible ? '' : 'none';
      if (visible) {
        const x = ((p.x + 1) / 2) * r.width, y = ((1 - p.y) / 2) * r.height;
        el.style.transform = `translate(${Math.round(Math.min(r.width - 50, Math.max(50, x)))}px, ${Math.round(Math.min(r.height - 30, Math.max(70, y)))}px) translate(-50%, -50%)`;
      }
    }
  }

  resize(w: number, hgt: number) {
    this.aspect = w / Math.max(1, hgt);
    this.camera.aspect = this.aspect;
    this.camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------- UI
  private header(backable: boolean) {
    const d = this.data;
    return h('div', { class: 'panel-head' },
      h('div', { class: 'row' },
        backable ? h('button', { class: 'icon-btn back', 'aria-label': 'Back to room', onclick: () => this.go('room') }, '←') : null,
        h('div', {},
          h('div', { class: 'eyebrow' }, 'Ruttworks Garage'),
          h('div', { class: 'title' }, TITLES[this.mode]),
        ),
      ),
      h('div', { class: 'row' },
        h('span', { class: 'credits', title: 'Credits' }, `${d.credits} cr`),
        h('button', { class: 'icon-btn', 'aria-label': 'Settings', onclick: () => this.ctx.openSettings() }, '⚙'),
      ),
    );
  }

  render() {
    const panel = this.ctx.panel;
    let body: HTMLElement;
    let footer: HTMLElement | null = null;
    switch (this.mode) {
      case 'room': body = this.roomBody(); break;
      case 'storage': body = this.storageBody(); break;
      case 'bench': ({ body, footer } = this.benchBody()); break;
      case 'charging': body = this.chargingBody(); break;
      case 'parts': body = this.partsBody(); break;
      case 'sandbox': body = this.sandboxBody(); break;
      default: body = this.departureBody();
    }
    panel.className = `panel garage mode-${this.mode}`;
    panel.replaceChildren(...[this.header(this.mode !== 'room'), h('div', { class: 'panel-body scroll-ok' }, body), footer].filter((x): x is HTMLElement => !!x));
    this.renderHud();
  }

  private renderHud() {
    const hud = this.ctx.hud;
    this.labelEls.clear();
    hud.replaceChildren();
    if (this.mode === 'room') {
      for (const id of Object.keys(STATION_LABELS) as StationId[]) {
        const el = h('button', { class: `station-label ${id === 'departure' ? 'go' : ''}`, onclick: () => this.go(id) }, STATION_LABELS[id].label);
        el.style.display = 'none';
        this.labelEls.set(id, el);
        hud.append(el);
      }
      hud.append(h('button', { class: 'hud-chip recenter', onclick: () => this.recenter() }, 'Recenter view'));
      if (!this.data.tutorial.garageLookHint) {
        this.hintEl = h('div', { class: 'hint-chip big' }, 'Drag to look around. Tap a station to use it.');
        hud.append(this.hintEl);
        window.setTimeout(() => this.hideHint(), 7000);
      }
    } else if (this.mode === 'bench') {
      hud.append(h('div', { class: 'hint-chip' }, 'Drag to turn the buggy · pinch to zoom · tap a part'));
    }
  }

  private hideHint() {
    if (!this.hintEl) return;
    this.hintEl.remove();
    this.hintEl = null;
    if (!this.data.tutorial.garageLookHint) { this.data.tutorial.garageLookHint = true; this.ctx.store.save(); }
  }

  private stationButtons() {
    const items: [StationId, string, string][] = [
      ['storage', 'Vehicles', '▤'], ['bench', 'Workbench', '⚒'], ['charging', 'Charging', 'ϟ'], ['parts', 'Parts', '▦'], ['departure', 'Go to Track', '→'],
    ];
    return h('nav', { class: 'station-grid', 'aria-label': 'Garage stations' },
      items.map(([id, label, glyph]) => h('button', { class: `station-btn ${id === 'departure' ? 'go' : ''}`, onclick: () => this.go(id) },
        h('span', { class: 'glyph', 'aria-hidden': 'true' }, glyph), h('span', {}, label))));
  }

  private roomBody() {
    const d = this.data;
    const bat = installedBattery(d);
    return h('div', { class: 'stack' },
      this.stationButtons(),
      h('div', { class: 'muted small' },
        d.selectedVehicle
          ? `${BUGGY_CLASSES[d.activeBuggy].name}: ${this.carOnBench ? 'on the workbench' : 'on the shelf'} · battery ${bat ? `${Math.round(bat.charge)}%` : 'not installed'}`
          : 'Start at the vehicle shelves: pick your buggy and prepare it on the workbench.'),
      h('div', { class: 'row' },
        h('button', { class: 'btn grow primary', 'data-events': '', onclick: () => this.showEvents() }, '🏆 Events · prizes'),
        h('button', { class: 'btn grow', 'data-jobs': '', onclick: () => this.showJobs() }, 'Odd jobs'),
        h('button', { class: 'btn grow', 'data-sandbox': '', onclick: () => this.go('sandbox') }, 'Sandbox table')),
    );
  }

  // ---------------------------------------------------------------- sandbox table
  private sandboxAt = new THREE.Vector3();
  private preview: THREE.Object3D | null = null;
  private previewKind: string | null = null;

  /** Put a vehicle on the sandbox turntable (built on demand; one at a time). */
  private showPreview(kind: SaveData['sandbox']['preview']) {
    if (this.previewKind === kind && this.preview) return;
    if (this.preview) { this.scene.remove(this.preview); this.preview.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); }); }
    let obj: THREE.Object3D;
    if (kind in BUGGY_CLASSES) obj = createBuggy(kind as BuggyId).root;
    else if (kind === 'monster') { const m = createMonster(); m.rest(); obj = m.root; obj.scale.setScalar(0.85); }
    else if (kind === 'drift') { const m = createDrift(); m.rest(); obj = m.root; obj.scale.setScalar(1.15); }
    else if (kind === 'mower') { const m = createMower(); m.pose({ speed: 0, steer: 0, accel: 0, turn: 0, dt: 0, t: 0 }); obj = m.root; obj.scale.setScalar(0.42); }
    else { const c = createCrawler(kind as 'wagon' | 'utb'); c.rest(); obj = c.root; }
    const holder = new THREE.Group(); holder.add(obj);
    holder.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj);
    obj.position.y -= box.min.y; obj.position.x -= (box.min.x + box.max.x) / 2; obj.position.z -= (box.min.z + box.max.z) / 2;
    holder.position.copy(this.sandboxAt);
    holder.rotation.y = this.preview ? this.preview.rotation.y : 0.6;
    holder.traverse((o) => { o.userData.station = 'sandbox'; (o as THREE.Mesh).castShadow = true; });
    this.scene.add(holder);
    this.preview = holder; this.previewKind = kind;
  }

  private sandboxBody() {
    const d = this.data, sb = d.sandbox, v = this.v;
    this.showPreview(sb.preview);
    const set = (fn: () => void, msg?: string) => { fn(); this.ctx.store.save(); if (msg) toast(msg, 'good'); this.syncCrawler(); this.sync(); this.render(); };
    const chip = (on: boolean, label: string, fn: () => void) => h('button', { class: `chip ${on ? 'on' : ''}`, 'aria-pressed': on, onclick: fn }, label);
    const INFO: Record<typeof sb.preview, [string, string]> = {
      buggy: [BUGGY_CLASSES.buggy.name, '1/8 4WD race buggy · cab-forward body, chassis wing'],
      buggy2wd: [BUGGY_CLASSES.buggy2wd.name, '1/10 2WD buggy · rear drive, ribbed front tyres, long nose'],
      stadium: [BUGGY_CLASSES.stadium.name, '1/10 2WD stadium truck · cab body, big tyres, tall wing'],
      sct: [BUGGY_CLASSES.sct.name, '1/10 4WD short course truck · full fenders, bumpers, nerf bars'],
      truggy: [BUGGY_CLASSES.truggy.name, '1/8 4WD truggy · wide arms, long shocks, big wing'],
      wagon: ["Cragweld '76 Ranchero", '1/10 trail crawler · two-door hard body, steel bumpers, roof rack'],
      utb: ['Griphold UTB', '1/10 trail crawler · tube-cage trail buggy with driver'],
      mower: ['Turfhound 21 RC', "Petrol rotary mower with an RC conversion (Mrs Pell's)"],
      monster: ['Cragweld Mudhammer', '1/10 solid-axle monster truck · tube chassis, 4-wheel steer, chevron tyres'],
      drift: [`${DRIFT_SPEC.name} · ${DRIFT_BODY_NAME}`, '1/10 RWD drift car · steering gyro, 55° lock, hard plastic tyres'],
    };
    const drive = () => {
      if (sb.preview in BUGGY_CLASSES) {
        const id = sb.preview as BuggyId;
        if (!d.vehicles[id]) { d.vehicles[id] = defaultVehicle(id); this.syncFleet(); }
        if (id !== d.activeBuggy) this.setActive(id);
        d.selectedVehicle = id; d.garage.vehiclePlace = 'bench'; this.ctx.store.save(); this.sync(); this.go('departure'); return;
      }
      if (sb.preview === 'mower') { this.ctx.store.save(); this.ctx.go('mow'); return; }
      if (sb.preview === 'drift') { d.drift.unlocked = true; d.drift.owned = true; d.drift.charge = 100; this.ctx.store.save(); this.ctx.go('drift'); return; }
      if (sb.preview === 'monster') { d.monster.unlocked = true; d.monster.owned = true; d.monster.charge = 100; this.ctx.store.save(); this.ctx.go('monster', { mode: 'freestyle' }); return; }
      d.crawler.unlocked = true; d.crawler.owned = true; d.crawler.style = sb.preview as 'wagon' | 'utb'; d.crawler.charge = 100; this.ctx.store.save(); this.ctx.go('crawl');
    };
    const section = (title: string, ...kids: (HTMLElement | null)[]) => h('div', { class: 'stack tight' }, h('div', { class: 'eyebrow' }, title), ...kids);
    return h('div', { class: 'stack' },
      h('p', { class: 'muted small' }, 'Your test table: look at any vehicle, fit any part and try things out. Free play makes everything cost nothing.'),
      section('On the turntable',
        h('div', { class: 'chips' },
          ...BUGGY_ORDER.map((id) => chip(sb.preview === id, BUGGY_CLASSES[id].short, () => set(() => { sb.preview = id; }))),
          chip(sb.preview === 'wagon', "'76 Ranchero", () => set(() => { sb.preview = 'wagon'; })),
          chip(sb.preview === 'utb', 'Griphold UTB', () => set(() => { sb.preview = 'utb'; })),
          chip(sb.preview === 'mower', 'Turfhound mower', () => set(() => { sb.preview = 'mower'; })),
          chip(sb.preview === 'monster', 'Mudhammer monster', () => set(() => { sb.preview = 'monster'; })),
          chip(sb.preview === 'drift', 'RD-1 drift car', () => set(() => { sb.preview = 'drift'; }))),
        h('div', { class: 'vehicle-card' }, h('div', { class: 'grow' }, h('strong', {}, INFO[sb.preview][0]), h('div', { class: 'muted small' }, INFO[sb.preview][1])),
          h('button', { class: 'btn small primary', onclick: drive }, sb.preview in BUGGY_CLASSES ? 'Ready check' : 'Drive it'))),
      section('Proving grounds (no wear, no pay, live telemetry)',
        h('div', { class: 'row' },
          h('button', { class: 'btn grow primary', 'data-proving': '', onclick: () => { this.ctx.store.save(); this.ctx.go('proving'); } }, 'Buggy test loop'),
          h('button', { class: 'btn grow primary', 'data-yard': '', onclick: () => { if (sb.preview === 'wagon' || sb.preview === 'utb') d.crawler.style = sb.preview as 'wagon' | 'utb'; this.ctx.store.save(); this.ctx.go('crawltest'); } }, 'Crawler test yard')),
        h('div', { class: 'row' },
          h('button', { class: 'btn grow', onclick: () => { d.crawler.unlocked = true; d.crawler.owned = true; d.crawler.charge = 100; this.ctx.store.save(); this.ctx.go('crawlpile'); } }, 'Rock Pile'),
          h('button', { class: 'btn grow', onclick: () => { d.crawler.unlocked = true; d.crawler.owned = true; d.crawler.charge = 100; this.ctx.store.save(); this.ctx.go('crawlcomp'); } }, 'Comp course')),
        h('div', { class: 'muted small' }, 'Loop: graded jumps 12/22/34 cm, whoops, table, berms. Yard: steps 5/10/15 cm, ramps 20/30/40°, side slope, twister, log, rocks, ledge.')),
      section('Free play',
        h('button', { class: `btn ${sb.free ? 'primary' : ''}`, 'aria-pressed': sb.free, onclick: () => set(() => { sb.free = !sb.free; }, sb.free ? 'Free play off' : 'Free play on: parts, repairs and vehicles are free') },
          sb.free ? 'Free play is ON · tap to turn off' : 'Turn on free play')),
      section('Vehicles',
        h('div', { class: 'row' },
          h('button', { class: 'btn grow', onclick: () => set(() => { d.crawler.unlocked = true; d.crawler.owned = true; d.crawler.charge = 100; }, 'Crawler unlocked and on the shelf') }, 'Give me the crawler'),
          h('button', { class: 'btn grow', onclick: () => set(() => { d.crawler.owned = false; d.crawler.unlocked = false; }, 'Crawler locked again (test the unlock)') }, 'Lock crawler')),
        h('div', { class: 'row' },
          h('button', { class: 'btn grow', onclick: () => set(() => { d.crawler.parts = CRAWLER_SLOTS.flatMap((sl) => CRAWLER_UPGRADES[sl].filter((u) => u.price > 0).map((u) => u.id)); }, 'All crawler hop-ups in the parts box') }, 'Give me all crawler hop-ups'),
          h('button', { class: 'btn grow', onclick: () => set(() => { d.crawler.fitted = {}; d.crawler.parts = []; d.crawler.bigLog = false; }, 'Crawler back to stock') }, 'Crawler stock')),
        h('div', { class: 'row' },
          h('button', { class: 'btn grow', onclick: () => set(() => { d.monster.parts = MONSTER_SLOTS.flatMap((sl) => MONSTER_UPGRADES[sl].filter((u) => u.price > 0).map((u) => u.id)); }, 'All monster hop-ups in the parts box') }, 'Give me all monster hop-ups'),
          h('button', { class: 'btn grow', onclick: () => set(() => { d.monster.fitted = {}; d.monster.parts = []; }, 'Monster truck back to stock') }, 'Monster stock')),
        h('div', { class: 'row' },
          h('button', { class: 'btn grow', onclick: () => set(() => { d.drift.unlocked = true; d.drift.owned = true; d.drift.parts = DRIFT_SLOTS.flatMap((sl) => DRIFT_UPGRADES[sl].filter((u) => u.price > 0).map((u) => u.id)); }, 'Drift car on the shelf with all hop-ups in the parts box') }, 'Give me all drift hop-ups'),
          h('button', { class: 'btn grow', onclick: () => set(() => { d.drift.fitted = {}; d.drift.parts = []; }, 'Drift car back to stock') }, 'Drift stock')),
        h('div', { class: 'row' },
          h('button', { class: 'btn grow', onclick: () => set(() => { d.monster.unlocked = true; d.monster.owned = true; d.monster.charge = 100; }, 'Monster truck on the shelf') }, 'Give me the monster truck'),
          h('button', { class: 'btn grow', onclick: () => set(() => { d.monster.owned = false; d.monster.unlocked = false; }, 'Monster truck locked again') }, 'Lock monster')),
        h('div', { class: 'row' },
          h('button', { class: 'btn grow', onclick: () => set(() => { for (const id of BUGGY_ORDER) if (!d.vehicles[id]) d.vehicles[id] = defaultVehicle(id); this.syncFleet(); }, 'Every race car is on the shelf') }, 'Give me all race cars'),
          h('button', { class: 'btn grow', onclick: () => set(() => { for (const id of BUGGY_ORDER) if (id !== 'buggy' && id !== d.activeBuggy) delete d.vehicles[id]; this.syncFleet(); }, 'Extra race cars removed (except the active one)') }, 'Remove extra cars')),
        h('div', { class: 'row' },
          h('button', { class: 'btn grow', onclick: () => set(() => { d.drift.unlocked = true; d.drift.owned = true; d.drift.charge = 100; }, 'Drift car on the shelf') }, 'Give me the drift car'),
          h('button', { class: 'btn grow', onclick: () => set(() => { d.drift.owned = false; d.drift.unlocked = false; }, 'Drift car locked again') }, 'Lock drift car')),
        h('div', { class: 'chips' },
          chip(d.crawler.style === 'wagon', "Crawler body: '76 Ranchero", () => set(() => { d.crawler.style = 'wagon'; })),
          chip(d.crawler.style === 'utb', 'Crawler body: UTB', () => set(() => { d.crawler.style = 'utb'; })))),
      section('Buggy parts (fitted instantly)',
        h('div', { class: 'muted small' }, 'Tyres'),
        h('div', { class: 'chips' }, (Object.keys(TIRE_COMPOUNDS) as TireCompound[]).map((k) => chip(v.tireCompound === k, TIRE_COMPOUNDS[k].name, () => set(() => { v.tireCompound = k; v.condition.tires = 100; }, `Fitted ${TIRE_COMPOUNDS[k].name}`)))),
        h('div', { class: 'muted small' }, 'Shocks'),
        h('div', { class: 'chips' }, (Object.keys(SHOCK_SETTINGS) as (keyof typeof SHOCK_SETTINGS)[]).map((k) => chip(v.shockSetting === k, SHOCK_SETTINGS[k].label, () => set(() => { v.shockSetting = k; })))),
        h('div', { class: 'row' },
          h('button', { class: 'btn grow', onclick: () => set(() => { for (const k of Object.keys(v.condition) as (keyof typeof v.condition)[]) v.condition[k] = 100; v.damageLog = []; }, 'Everything repaired') }, 'Repair all'),
          h('button', { class: 'btn grow', onclick: () => set(() => { for (const b of d.batteries) b.charge = 100; d.crawler.charge = 100; d.monster.charge = 100; d.drift.charge = 100; }, 'All packs charged') }, 'Charge all'),
          h('button', { class: 'btn grow', onclick: () => set(() => { for (const k of Object.keys(d.spares.tires) as TireCompound[]) d.spares.tires[k] = Math.min(20, d.spares.tires[k] + 1); }, 'One spare set of each tyre added') }, '+ spare tyres'))),
      section('Credits & jobs',
        h('div', { class: 'row' },
          h('button', { class: 'btn grow', onclick: () => set(() => { d.credits += 500; }, '+500 credits') }, '+500 cr'),
          h('button', { class: 'btn grow', onclick: () => set(() => { d.credits += 5000; }, '+5000 credits') }, '+5000 cr'),
          h('button', { class: 'btn grow', onclick: () => set(() => { d.credits = ECONOMY.startCredits; }, 'Credits reset') }, `Reset to ${ECONOMY.startCredits}`)),
        h('div', { class: 'row' },
          h('button', { class: 'btn grow', onclick: () => { this.ctx.store.save(); this.ctx.go('mow'); } }, 'Mowing job'),
          h('button', { class: 'btn grow', onclick: () => this.startSort() }, 'Screw tray'),
          h('button', { class: 'btn grow', onclick: () => set(() => { d.jobs.mowBest = null; d.jobs.sortBest = 0; }, 'Job bests cleared') }, 'Clear job bests'))),
    );
  }

  /** The events board: free entry, prize money for the top three, cleared in any order. */
  private showEvents() {
    const d = this.data;
    const close = () => this.ctx.overlay.replaceChildren();
    const ico: Record<string, string> = { buggy: '🏁', monster: '🛻', crawler: '🪨', drift: '💨' };
    const fmt = (e: EventDef) => e.format === 'race' ? `${e.laps}-lap race vs 3 AI rivals` : e.format === 'score' ? `Judged: beat the posted scores (${e.rivalMarks!.join(' / ')})`
      : e.format === 'time' ? `Timed climb: beat ${e.rivalMarks!.map((t) => fmtTime(t)).join(' / ')}` : `Judged comp: beat ${e.rivalMarks!.join(' / ')} points`;
    const medal = (p: number | null) => p == null ? '' : p === 1 ? '🥇' : p === 2 ? '🥈' : p === 3 ? '🥉' : ordinal(p);
    const won = EVENTS.filter((e) => (d.events[e.id]?.wins ?? 0) > 0).length;
    const earned = Object.values(d.events).reduce((a, e) => a + e.earned, 0);
    this.ctx.overlay.replaceChildren(h('div', { class: 'sheet-overlay', onclick: (e: Event) => { if (e.target === e.currentTarget) close(); } },
      h('div', { class: 'modal-card scroll-ok events-card' },
        h('div', { class: 'eyebrow' }, 'Brackenbank RC Club'),
        h('h2', {}, 'Events board'),
        h('p', { class: 'muted small' }, 'Free entry. Top three get paid. Run them in any order — win three to open the Championship Final.'),
        h('div', { class: 'summary' }, h('span', {}, h('b', {}, `${won}/${EVENTS.length}`), ' won'), h('span', {}, h('b', {}, `${earned}`), ' cr prize money')),
        ...EVENTS.map((e) => {
          const open = e.unlock(d), rec = d.events[e.id];
          return h('div', { class: `ev ${open ? '' : 'locked'}`, 'data-ev': e.id },
            h('div', { class: 'ico', 'aria-hidden': 'true' }, e.id === 'finale' ? '🏆' : ico[e.vehicle]),
            h('div', {},
              h('strong', {}, e.name, rec?.best ? h('span', { class: 'medal' }, medal(rec.best)) : null),
              h('div', { class: 'muted meta' }, `${e.venueName} · ${open ? fmt(e) : `🔒 ${e.lockHint}`}`),
              h('div', { class: 'prize' }, `🥇 ${e.prizes[0]}  🥈 ${e.prizes[1]}  🥉 ${e.prizes[2]} cr`)),
            h('button', { class: `btn small ${open ? 'primary' : 'disabled'}`, disabled: !open, onclick: () => { close(); this.enterEvent(e); } }, 'Enter'));
        }),
        h('div', { class: 'row end' }, h('button', { class: 'btn ghost', onclick: close }, 'Close')))));
  }

  private enterEvent(e: EventDef) {
    const d = this.data;
    if (e.vehicle === 'buggy') {
      d.raceTrack = e.venue as SaveData['raceTrack'];
      this.ctx.store.save();
      if (this.readiness().every((i) => i.ok || !i.required)) { toast(`${e.name}: hit Race at the pit when you're set`, 'info', 3500); this.depart(); }
      else { toast('Get your buggy ready first, then head to the track', 'warn', 3500); this.go('departure'); }
    } else if (e.vehicle === 'monster') {
      d.monster.venue = e.venue as 'bowl' | 'fair';
      this.goMonster(e.format === 'race' ? 'race' : 'freestyle', e.id);
    } else if (e.vehicle === 'crawler') {
      this.goCrawl(e.venue === 'comp' ? 'crawlcomp' : 'crawlpile', e.id);
    } else {
      d.drift.venue = e.venue as 'hall' | 'lot';
      this.goDrift(e.id);
    }
  }

  /** Cheesy side jobs so there's always a way to earn credits while learning to race. */
  private showJobs() {
    const j = this.data.jobs;
    const close = () => this.ctx.overlay.replaceChildren();
    const job = (ico: string, name: string, sub: string, label: string, go: () => void) =>
      h('div', { class: 'job-card' }, h('div', { class: 'job-ico', 'aria-hidden': 'true' }, ico),
        h('div', { class: 'grow' }, h('strong', {}, name), h('div', { class: 'muted small' }, sub)),
        h('button', { class: 'btn small primary', onclick: go }, label));
    this.ctx.overlay.replaceChildren(h('div', { class: 'sheet-overlay', onclick: (e: Event) => { if (e.target === e.currentTarget) close(); } },
      h('div', { class: 'modal-card scroll-ok jobs-card' },
        h('div', { class: 'eyebrow' }, 'Club board'),
        h('h2', {}, 'Odd jobs'),
        h('p', { class: 'muted small' }, 'Short on credits? The neighbours and the club always need a hand.'),
        job('🌱', "Mow Mrs Pell's lawn", `RC mower, same transmitter · up to ${MOW_PAY.full + MOW_PAY.speedBonus} cr${j.mowBest != null ? ` · best ${fmtTime(j.mowBest)}` : ''}`, 'Go', () => { close(); this.ctx.store.save(); this.ctx.go('mow'); }),
        job('🔩', 'Sort the screw tray', `${SORT.seconds}-second tap game · up to ${SORT.maxPay} cr${j.sortBest ? ` · best ${j.sortBest} pts` : ''}`, 'Start', () => this.startSort()),
        h('div', { class: 'row end' }, h('button', { class: 'btn ghost', onclick: close }, 'Close')))));
  }

  private startSort() {
    runScrewSort(this.ctx.overlay, this.data.jobs.sortBest, (r) => {
      if (!r) return;
      const j = this.data.jobs;
      j.sortRuns++;
      j.sortBest = Math.max(j.sortBest, r.points);
      this.data.credits += r.pay;
      this.ctx.store.save();
      toast(`Screw tray · +${r.pay} cr`, 'good');
      this.render();
    });
  }

  private conditionGrid() {
    const v = this.v;
    const bat = installedBattery(this.data);
    return h('div', { class: 'grid4' },
      h('div', {}, h('small', {}, 'Battery'), bar(bat?.charge ?? 0)),
      h('div', {}, h('small', {}, 'Tires'), bar(v.condition.tires)),
      h('div', {}, h('small', {}, 'Shocks'), bar(v.condition.shocks)),
      h('div', {}, h('small', {}, 'Chassis'), bar(v.condition.chassis)),
    );
  }

  private storageBody() {
    const d = this.data;
    const v = this.v;
    const cls = BUGGY_CLASSES[v.id];
    const onBench = this.carOnBench;
    const bat = installedBattery(d);
    const swatch = (c: typeof cls) => h('div', { class: 'swatch', style: { background: `linear-gradient(135deg,#${c.color.toString(16).padStart(6, '0')} 60%,#${c.accent.toString(16).padStart(6, '0')} 60%)` } });
    const others = BUGGY_ORDER.filter((id) => id !== v.id).map((id) => {
      const c = BUGGY_CLASSES[id], ov = d.vehicles[id];
      if (ov) {
        return h('div', { class: 'vehicle-card' }, swatch(c),
          h('div', { class: 'grow' }, h('strong', {}, c.name), h('div', { class: 'muted small' }, `${c.scale} ${c.kind} · on the shelf · tyres ${Math.round(ov.condition.tires)}% · chassis ${Math.round(ov.condition.chassis)}%`)),
          h('button', { class: 'btn small', 'data-select-buggy': id, onclick: () => this.setActive(id) }, 'Use this'));
      }
      const price = this.ctx.service.price(c.price), short = price - d.credits;
      return h('div', { class: 'vehicle-card' }, swatch(c),
        h('div', { class: 'grow' }, h('strong', {}, c.name), h('div', { class: 'muted small' }, `${c.scale} ${c.kind} · ${c.blurb}${short > 0 ? ` · you need ${short} more` : ''}`)),
        h('button', { class: `btn small ${short > 0 ? 'disabled' : 'primary'}`, disabled: short > 0, 'data-buy-buggy': id, onclick: () => this.buyBuggy(id) }, `Buy · ${price} cr`));
    });
    return h('div', { class: 'stack' },
      h('div', { class: 'eyebrow' }, 'Race cars (dirt track)'),
      h('div', { class: `vehicle-card on` },
        swatch(cls),
        h('div', { class: 'grow' },
          h('strong', {}, `${cls.name} · active`),
          h('div', { class: 'muted small' }, `${cls.scale} ${cls.kind} · ${onBench ? 'on the workbench' : 'on the shelf'} · battery ${bat ? `${packLetter(bat.name)} ${Math.round(bat.charge)}%` : 'none installed'} · ${TIRE_COMPOUNDS[v.tireCompound].name}, ${SHOCK_SETTINGS[v.shockSetting].label} shocks`)),
      ),
      this.conditionGrid(),
      onBench
        ? h('div', { class: 'row' },
          h('button', { class: 'btn primary grow', onclick: () => this.go('bench') }, 'Open the workbench'),
          h('button', { class: 'btn', onclick: () => this.storeOnShelf() }, 'Return to shelf'))
        : h('button', { class: 'btn primary', onclick: () => this.prepareOnBench() }, 'Prepare on Workbench'),
      ...others,
      h('div', { class: 'eyebrow' }, 'Other vehicles'),
      this.crawlerCard(),
      this.monsterCard(),
      this.driftCard(),
      ...FUTURE_CLASSES.map((fc) =>
        h('div', { class: 'vehicle-card locked', 'aria-disabled': 'true' },
          h('div', { class: 'swatch', style: { background: `#${fc.color.toString(16).padStart(6, '0')}` } }),
          h('div', { class: 'grow' }, h('strong', {}, fc.name), h('div', { class: 'muted small' }, `${fc.venue} · coming in a later build`)),
          h('span', { class: 'tag' }, 'Soon'))),
    );
  }

  /** Cragweld rock crawler: locked until the first finished race, then bought with credits. */
  private crawlerCard() {
    const d = this.data, c = d.crawler, price = this.ctx.service.price(ECONOMY.crawlerPrice);
    const swatch = h('div', { class: 'swatch', style: { background: c.style === 'utb' ? '#e8622a' : '#c0642a' } });
    if (!c.unlocked) {
      return h('div', { class: 'vehicle-card locked', 'aria-disabled': 'true' }, swatch,
        h('div', { class: 'grow' }, h('strong', {}, 'Cragweld trail crawler'), h('div', { class: 'muted small' }, 'Rock crawler · finish your first 3-lap race to unlock')),
        h('span', { class: 'tag' }, 'Locked'));
    }
    if (!c.owned) {
      const short = price - d.credits;
      return h('div', { class: 'vehicle-card' }, swatch,
        h('div', { class: 'grow' }, h('strong', {}, 'Cragweld trail crawler'), h('div', { class: 'muted small' }, `Rock crawler for ${TRAIL_NAME} · ${price} cr${short > 0 ? ` · you need ${short} more` : ''}`)),
        h('button', { class: `btn small ${short > 0 ? 'disabled' : 'primary'}`, disabled: short > 0, onclick: () => this.buyCrawler() }, `Buy · ${price} cr`));
    }
    const styleChips = h('div', { class: 'chips' },
      ([['wagon', "'76 Ranchero wagon"], ['utb', 'Griphold UTB buggy']] as const).map(([id, label]) =>
        h('button', { class: `chip ${c.style === id ? 'on' : ''}`, 'aria-pressed': c.style === id, onclick: () => this.setCrawlerStyle(id) }, label)));
    return h('div', { class: 'stack tight' }, h('div', { class: 'vehicle-card on' }, swatch,
      h('div', { class: 'grow' }, h('strong', {}, c.style === 'wagon' ? "Cragweld '76 Ranchero" : 'Griphold UTB'),
        h('div', { class: 'muted small' }, `On the shelf · crawler pack ${Math.round(c.charge)}% · trail best ${c.best != null ? fmtTime(c.best) : '--'}`)),
      h('div', { class: 'stack tight' },
        c.charge < 99 ? h('button', { class: 'btn small', onclick: () => { c.charge = 100; this.ctx.store.save(); toast('Crawler pack charged', 'good'); this.render(); } }, 'Charge') : null,
        h('button', { class: 'btn small primary', 'data-crawl': 'crawl', onclick: () => this.goCrawl() }, 'To the trail'))),
      h('div', { class: 'row' },
        h('button', { class: 'btn grow', 'data-crawl': 'crawlpile', onclick: () => this.goCrawl('crawlpile') }, h('span', {}, 'Rock Pile'), h('span', { class: 'note' }, c.pileBest != null ? `summit ${fmtTime(c.pileBest)}` : 'race to the summit')),
        c.best != null
          ? h('button', { class: 'btn grow', 'data-crawl': 'crawlcomp', onclick: () => this.goCrawl('crawlcomp') }, h('span', {}, 'Comp course'), h('span', { class: 'note' }, c.compBest != null ? `best ${c.compBest} pts` : '10 gates, lowest points'))
          : h('button', { class: 'btn grow disabled', disabled: true }, h('span', {}, 'Comp course'), h('span', { class: 'note' }, 'finish the trail to unlock'))),
      h('div', { class: 'muted small' }, 'Crawler body (free to swap, same chassis):'), styleChips,
      h('div', { class: 'row between' },
        h('div', { class: 'muted small' }, `Hop-ups ${Object.values(c.fitted).filter((id) => (crawlerUpgradeById(id ?? '')?.price ?? 0) > 0).length}/${CRAWLER_SLOTS.length}${c.bigLog ? ' · big log cleared' : ' · big log not cleared yet'}`),
        h('button', { class: 'btn small', 'data-crawler-upgrades': '', onclick: () => this.showCrawlerUpgrades() }, 'Hop-ups')));
  }

  /** Crawler hop-up shop: one row per slot, buy once and swap freely after. */
  private showCrawlerUpgrades() {
    const c = this.data.crawler;
    const mm = (m: number) => `${Math.round(m * 1000)} mm`;
    const geom = (fitted: typeof c.fitted) => {
      const S = crawlerSpecFor(fitted), rest = S.restLen + S.travel - 0.028, cg = -(S.mountY - rest - S.wheelR);
      return { tyre: 2 * S.wheelR, skid: cg + S.hull[0][1], diff: S.wheelR - S.diffDrop - 0.012, cg, grip: S.mu, torque: S.driveGain, steer: S.maxSteer };
    };
    const base = geom({});
    this.showHopups({
      title: 'Crawler hop-ups', eyebrow: 'Cragweld trail crawler · hop-ups', owner: c,
      slots: CRAWLER_SLOTS, upgrades: CRAWLER_UPGRADES, byId: crawlerUpgradeById,
      slotName: (slot) => ({ tyres: 'Tyres', axles: 'Axles', suspension: 'Suspension', weights: 'Weights', servo: 'Steering servo', motor: 'Motor' } as Record<string, string>)[slot],
      stats: () => {
        const g = geom(c.fitted);
        return [
          ['Tyre height', mm(g.tyre), g.tyre - base.tyre, true],
          ['Diff clearance', mm(g.diff), g.diff - base.diff, true],
          ['Skid-plate clearance', mm(g.skid), g.skid - base.skid, true],
          ['Centre of gravity', mm(g.cg), g.cg - base.cg, false],
          ['Tyre grip', `${Math.round(g.grip / base.grip * 100)}%`, g.grip - base.grip, true],
          ['Low-speed torque', `${Math.round(g.torque / base.torque * 100)}%`, g.torque - base.torque, true],
          ['Steering lock', `${Math.round(g.steer * 57.3)}°`, g.steer - base.steer, true],
        ];
      },
      footnote: () => c.bigLog ? 'Big log: cleared ✓' : 'Big log (test yard, 20 cm): needs more clearance and bite. Tall tyres + portals get it done at a crawl.',
    });
  }

  private showMonsterUpgrades() {
    const m = this.data.monster;
    const stat = (fitted: typeof m.fitted) => {
      const S = monsterSpecFor(fitted);
      return { top: S.maxFwd, punch: S.maxForce, grip: S.mu, damp: S.c, air: S.airPitch * (1 + S.airBoost), roll: S.airRoll, steer: S.maxSteer, rear: S.rearSteer, tyre: 2 * S.wheelR, drain: S.drainMul, bar: S.rollers.length > 0, wheelie: S.torqueReact };
    };
    const base = stat({});
    const pct = (a: number, b: number) => `${Math.round(a / b * 100)}%`;
    this.showHopups({
      title: 'Monster truck hop-ups', eyebrow: 'Cragweld Mudhammer · hop-ups', owner: m,
      slots: MONSTER_SLOTS, upgrades: MONSTER_UPGRADES, byId: monsterUpgradeById, slotName: (slot) => MONSTER_SLOT_NAMES[slot as MonsterSlot],
      stats: () => {
        const g = stat(m.fitted);
        return [
          ['Top speed', `${Math.round(g.top * 3.6)} km/h`, g.top - base.top, true],
          ['Punch', pct(g.punch, base.punch), g.punch - base.punch, true],
          ['Tyre grip', pct(g.grip, base.grip), g.grip - base.grip, true],
          ['Tyre height', `${Math.round(g.tyre * 1000)} mm`, g.tyre - base.tyre, true],
          ['Landing damping', pct(g.damp, base.damp), g.damp - base.damp, true],
          ['Air pitch control', pct(g.air, base.air), g.air - base.air, true],
          ['Air roll control', g.roll > 0 ? 'Yes' : 'No', g.roll - base.roll, true],
          ['Steering', `${Math.round(g.steer * 57.3)}° · rear ${Math.round(g.rear * 100)}%`, g.steer - base.steer, true],
          ['Wheelie lift', g.wheelie > 0.7 ? 'Wild' : g.wheelie > 0 ? 'Pops up' : 'None', g.wheelie - base.wheelie, true],
          ['Battery use', pct(g.drain, base.drain), g.drain - base.drain, false],
        ];
      },
      footnote: () => stat(m.fitted).wheelie > 0.7 && !stat(m.fitted).bar ? '6S without a wheelie bar: feather the trigger from slow or it loops over backwards.' : 'Freestyle tip: the flywheel turns steering into barrel rolls in the air; a wheelie bar lets you ride wheelies for points.',
    });
  }

  /** Shared hop-up shop: one row per slot, buy a part once and swap it freely after. */
  private showHopups(cfg: {
    title: string; eyebrow: string; owner: { fitted: Partial<Record<string, string>>; parts: string[] };
    slots: readonly string[]; upgrades: Record<string, { id: string; slot: string; name: string; price: number; note: string }[]>;
    byId: (id: string) => { id: string; slot: string; name: string; price: number } | undefined; slotName: (slot: string) => string;
    stats: () => [string, string, number, boolean][]; footnote: () => string;
  }) {
    const d = this.data, o = cfg.owner, close = () => { this.ctx.overlay.replaceChildren(); this.render(); };
    const statsBox = h('div', { class: 'setup-fx' });
    const credits = h('p', { class: 'muted small' });
    const refresh = () => {
      credits.textContent = `Buy a part once, swap it in and out for free. Credits: ${d.credits} cr.`;
      statsBox.replaceChildren(h('div', { class: 'eyebrow' }, 'Yours vs stock'),
        ...cfg.stats().map(([k, v, delta, upGood]) => h('div', { class: 'setup-row-fx' }, h('span', {}, k),
          h('b', { class: Math.abs(delta) < 1e-6 ? '' : (delta > 0) === upGood ? 'good' : 'bad' }, v))),
        h('div', { class: 'muted small' }, cfg.footnote()));
    };
    const slotRows = h('div', { class: 'stack tight' });
    const renderSlots = () => {
      slotRows.replaceChildren(...cfg.slots.map((slot) => {
        const cur = o.fitted[slot] ?? cfg.upgrades[slot][0].id;
        return h('div', { class: 'setup-item' }, h('strong', {}, cfg.slotName(slot)),
          ...cfg.upgrades[slot].map((u) => {
            const owned = u.price === 0 || o.parts.includes(u.id), on = cur === u.id, price = this.ctx.service.price(u.price), short = price - d.credits;
            const act = on ? h('span', { class: 'tag' }, 'Fitted')
              : owned ? h('button', { class: 'btn small', 'data-cu': u.id, onclick: () => fit(u.id) }, 'Fit')
              : h('button', { class: `btn small ${short > 0 ? 'disabled' : 'primary'}`, disabled: short > 0, 'data-cu': u.id, onclick: () => buy(u.id) }, `Buy · ${price} cr`);
            return h('div', { class: `cu-row ${on ? 'on' : ''}` }, h('div', { class: 'grow' }, h('div', {}, u.name), h('div', { class: 'muted small' }, u.note)), act);
          }));
      }));
    };
    const changed = (msg: string) => { this.ctx.store.save(); toast(msg, 'good'); this.syncCrawler(); renderSlots(); refresh(); };
    const fit = (id: string) => { const u = cfg.byId(id)!; if (u.price === 0) delete o.fitted[u.slot]; else o.fitted[u.slot] = id; changed(`${u.name} fitted`); };
    const buy = (id: string) => {
      const u = cfg.byId(id)!, price = this.ctx.service.price(u.price);
      if (d.credits < price || o.parts.includes(id)) return;
      d.credits -= price; o.parts.push(id); o.fitted[u.slot] = id; changed(`${u.name} bought and fitted`);
    };
    renderSlots(); refresh();
    this.ctx.overlay.replaceChildren(h('div', { class: 'sheet-overlay', onclick: (e: Event) => { if (e.target === e.currentTarget) close(); } },
      h('div', { class: 'modal-card scroll-ok setup-card' },
        h('div', { class: 'eyebrow' }, cfg.eyebrow), h('h2', {}, cfg.title), credits,
        slotRows, statsBox,
        h('div', { class: 'row between' }, h('span', {}), h('button', { class: 'btn primary', 'data-hopups-done': '', onclick: close }, 'Done')))));
  }

  private buyCrawler() {
    const d = this.data;
    const price = this.ctx.service.price(ECONOMY.crawlerPrice);
    if (d.crawler.owned || !d.crawler.unlocked || d.credits < price) return;
    d.credits -= price;
    d.crawler.owned = true;
    this.ctx.store.save();
    toast('Rock crawler bought — it\'s on the shelf', 'good');
    this.syncCrawler();
    this.render();
  }

  private goCrawl(where: 'crawl' | 'crawlpile' | 'crawlcomp' = 'crawl', event?: string) {
    if (this.data.crawler.charge < 10) { toast('Charge the crawler pack first', 'warn'); return; }
    this.ctx.store.save();
    this.ctx.go(where, event ? { event } : undefined);
  }

  private shelfStyle = '';
  private makeShelfCrawler(style: 'wagon' | 'utb') {
    const c = createCrawler(style, undefined, this.data.crawler.fitted);
    c.root.position.copy(SHELF_SLOTS.crawler.at).add(new THREE.Vector3(0, c.restHeight, 0));
    c.root.rotation.y = SHELF_SLOTS.crawler.rot;
    c.root.traverse((o) => { o.userData.station = 'storage'; });
    this.scene.add(c.root);
    this.shelfStyle = style + JSON.stringify(this.data.crawler.fitted);
    return c;
  }

  private setCrawlerStyle(style: 'wagon' | 'utb') {
    if (this.data.crawler.style === style) return;
    this.data.crawler.style = style;
    this.ctx.store.save();
    toast(style === 'wagon' ? "'76 Ranchero body fitted" : 'Griphold UTB cage fitted', 'good');
    this.syncCrawler();
    this.render();
  }

  // ---------------------------------------------------------------- monster truck
  private monsterShelf: MonsterModel | null = null;
  private monsterKey = '{}';

  /** Mudhammer monster truck: locked until the crawler trail is finished, then bought with credits. */
  private monsterCard() {
    const d = this.data, m = d.monster, price = this.ctx.service.price(ECONOMY.monsterPrice);
    const swatch = h('div', { class: 'swatch', style: { background: '#1f6fd1' } });
    if (!m.unlocked) {
      return h('div', { class: 'vehicle-card locked', 'aria-disabled': 'true' }, swatch,
        h('div', { class: 'grow' }, h('strong', {}, 'Cragweld Mudhammer'), h('div', { class: 'muted small' }, 'Monster truck · finish the crawler trail to unlock')),
        h('span', { class: 'tag' }, 'Locked'));
    }
    if (!m.owned) {
      const short = price - d.credits;
      return h('div', { class: 'vehicle-card' }, swatch,
        h('div', { class: 'grow' }, h('strong', {}, 'Cragweld Mudhammer'), h('div', { class: 'muted small' }, `Monster truck for the Grindstone Bowl · ${price} cr${short > 0 ? ` · you need ${short} more` : ''}`)),
        h('button', { class: `btn small ${short > 0 ? 'disabled' : 'primary'}`, disabled: short > 0, onclick: () => this.buyMonster() }, `Buy · ${price} cr`));
    }
    return h('div', { class: 'stack tight' }, h('div', { class: 'vehicle-card on' }, swatch,
      h('div', { class: 'grow' }, h('strong', {}, 'Cragweld Mudhammer'),
        h('div', { class: 'muted small' }, `On the shelf · pack ${Math.round(m.charge)}% · ${m.venue === 'fair' ? 'Fair' : 'Bowl'} bests: freestyle ${monsterBest(d).bestScore} pts · race ${monsterBest(d).bestRace != null ? fmtTime(monsterBest(d).bestRace) : '--'}`)),
      m.charge < 99 ? h('button', { class: 'btn small', onclick: () => { m.charge = 100; this.ctx.store.save(); toast('Monster truck pack charged', 'good'); this.render(); } }, 'Charge') : null),
      h('div', { class: 'chips' }, ([['bowl', 'Grindstone Bowl'], ['fair', 'County Fair']] as const).map(([id, label]) => {
        const open = id === 'bowl' || m.runs > 0;
        return h('button', { class: `chip ${m.venue === id ? 'on' : ''} ${open ? '' : 'locked'}`, 'data-arena': id, disabled: !open, 'aria-pressed': m.venue === id,
          onclick: () => { if (!open) return; m.venue = id; this.ctx.store.save(); this.render(); } }, open ? label : `🔒 ${label} (do one run first)`);
      })),
      h('div', { class: 'row' },
        h('button', { class: 'btn grow primary', 'data-monster': 'freestyle', onclick: () => this.goMonster('freestyle') }, `Freestyle · up to ${MONSTER_PAY.freestyleMax} cr`),
        h('button', { class: 'btn grow', 'data-monster': 'race', onclick: () => this.goMonster('race') }, `Race · ${MONSTER_PAY.race} cr`)),
      h('div', { class: 'row between' },
        h('div', { class: 'muted small' }, `Hop-ups ${Object.keys(m.fitted).length}/${MONSTER_SLOTS.length}`),
        h('button', { class: 'btn small', 'data-monster-upgrades': '', onclick: () => this.showMonsterUpgrades() }, 'Hop-ups')));
  }

  private buyMonster() {
    const d = this.data, price = this.ctx.service.price(ECONOMY.monsterPrice);
    if (d.monster.owned || !d.monster.unlocked || d.credits < price) return;
    d.credits -= price; d.monster.owned = true;
    this.ctx.store.save();
    toast('Monster truck bought — it\'s on the shelf', 'good');
    this.syncCrawler(); this.render();
  }

  private goMonster(mode: 'freestyle' | 'race', event?: string) {
    if (this.data.monster.charge < 10) { toast('Charge the monster truck pack first', 'warn'); return; }
    this.ctx.store.save();
    this.ctx.go('monster', { mode, event });
  }

  // ---------------------------------------------------------------- drift car
  private driftShelf: DriftModel | null = null;
  private driftKey = '{}';

  /** Slideway RD-1: locked until the first monster truck run, then bought. Free practice at Kanjo Hall. */
  private driftCard() {
    const d = this.data, m = d.drift, price = this.ctx.service.price(ECONOMY.driftPrice);
    const lc = driftColorsFor(m.fitted), hx = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
    const swatch = h('div', { class: 'swatch', style: { background: `linear-gradient(135deg,${hx(lc.body)} 55%,${hx(lc.stripe)} 55%)` } });
    const name = `${DRIFT_SPEC.name} · ${DRIFT_BODY_NAME}`;
    if (!m.unlocked) {
      return h('div', { class: 'vehicle-card locked', 'aria-disabled': 'true' }, swatch,
        h('div', { class: 'grow' }, h('strong', {}, 'Slideway RD-1 drift car'), h('div', { class: 'muted small' }, 'RWD drift car · do your first monster truck run to unlock')),
        h('span', { class: 'tag' }, 'Locked'));
    }
    if (!m.owned) {
      const short = price - d.credits;
      return h('div', { class: 'vehicle-card' }, swatch,
        h('div', { class: 'grow' }, h('strong', {}, name), h('div', { class: 'muted small' }, `RWD drift car with steering gyro for ${DRIFT_TRACK_NAME} · ${price} cr${short > 0 ? ` · you need ${short} more` : ''}`)),
        h('button', { class: `btn small ${short > 0 ? 'disabled' : 'primary'}`, disabled: short > 0, 'data-buy-drift': '', onclick: () => this.buyDrift() }, `Buy · ${price} cr`));
    }
    return h('div', { class: 'stack tight' }, h('div', { class: 'vehicle-card on' }, swatch,
      h('div', { class: 'grow' }, h('strong', {}, name),
        h('div', { class: 'muted small' }, `On the shelf · pack ${Math.round(m.charge)}% · gyro ${Math.round(m.gyro * 100)}% · longest drift ${m.bestDrift.toFixed(1)} s · biggest angle ${m.bestAngle}°`)),
      m.charge < 99 ? h('button', { class: 'btn small', onclick: () => { m.charge = 100; this.ctx.store.save(); toast('Drift car pack charged', 'good'); this.render(); } }, 'Charge') : null),
      h('div', { class: 'chips' }, ([['hall', 'Kanjo Hall'], ['lot', 'Bayside Car Park']] as const).map(([id, label]) => {
        const open = id === 'hall' || m.sessions > 0;
        return h('button', { class: `chip ${m.venue === id ? 'on' : ''} ${open ? '' : 'locked'}`, 'data-drift-venue': id, disabled: !open, 'aria-pressed': m.venue === id,
          onclick: () => { if (!open) return; m.venue = id; this.ctx.store.save(); this.render(); } }, open ? label : `🔒 ${label} (practise once first)`);
      })),
      h('button', { class: 'btn primary', 'data-drift': '', onclick: () => this.goDrift() }, `Practice at ${driftVenueName(m.venue)}`),
      h('div', { class: 'row between' },
        h('div', { class: 'muted small' }, `Hop-ups ${Object.keys(m.fitted).filter((k) => k !== 'livery').length}/${DRIFT_SLOTS.length - 1} · ${driftUpgradeById(m.fitted.livery ?? '')?.name ?? 'Kanjo white'}`),
        h('button', { class: 'btn small', 'data-drift-upgrades': '', onclick: () => this.showDriftUpgrades() }, 'Hop-ups')));
  }

  private showDriftUpgrades() {
    const m = this.data.drift;
    const stat = (fitted: typeof m.fitted) => { const S = driftSpecFor(fitted); return { top: S.vTop, torque: S.torque, gripF: S.muF, gripR: S.muR, slide: S.slide, lock: S.maxSteer, servo: S.servoRate, catchK: S.gyroK, auth: 1 - S.authority, rear: S.b / (S.a + S.b) }; };
    const base = stat({});
    const pct = (a: number, b: number) => `${Math.round(a / b * 100)}%`;
    this.showHopups({
      title: 'Drift car hop-ups', eyebrow: `${DRIFT_SPEC.name} · hop-ups`, owner: m,
      slots: DRIFT_SLOTS, upgrades: DRIFT_UPGRADES, byId: driftUpgradeById, slotName: (slot) => DRIFT_SLOT_NAMES[slot as DriftSlot],
      stats: () => {
        const g = stat(m.fitted);
        return [
          ['Top speed', `${Math.round(g.top * 3.6)} km/h`, g.top - base.top, true],
          ['Power', pct(g.torque, base.torque), g.torque - base.torque, true],
          ['Front grip', pct(g.gripF, base.gripF), g.gripF - base.gripF, true],
          ['Rear grip', pct(g.gripR, base.gripR), g.gripR - base.gripR, true],
          ['Grip while sliding', `${Math.round(g.slide * 100)}%`, g.slide - base.slide, true],
          ['Steering lock', `${Math.round(g.lock * 57.3)}°`, g.lock - base.lock, true],
          ['Servo speed', pct(g.servo, base.servo), g.servo - base.servo, true],
          ['Gyro catch', pct(g.catchK, base.catchK), g.catchK - base.catchK, true],
          ['Weight on rear', `${Math.round((1 - g.rear) * 100)}%`, (1 - g.rear) - (1 - base.rear), true],
        ];
      },
      footnote: () => 'Grippier tyres need more power to break loose: pair LF-4 tyres with the brushless motor. Liveries are looks only.',
    });
  }

  private buyDrift() {
    const d = this.data, price = this.ctx.service.price(ECONOMY.driftPrice);
    if (d.drift.owned || !d.drift.unlocked || d.credits < price) return;
    d.credits -= price; d.drift.owned = true;
    this.ctx.store.save();
    toast('Drift car bought — it\'s on the top shelf', 'good');
    this.syncCrawler(); this.render();
  }

  private goDrift(event?: string) {
    if (this.data.drift.charge < 10) { toast('Charge the drift car pack first', 'warn'); return; }
    this.ctx.store.save();
    this.ctx.go('drift', event ? { event } : undefined);
  }

  private syncCrawler() {
    const dKey = JSON.stringify(this.data.drift.fitted);
    if (this.driftShelf && this.driftKey !== dKey) { this.scene.remove(this.driftShelf.root); this.driftShelf = null; }
    if (this.data.drift.owned && !this.driftShelf) {
      const m = createDrift(driftColorsFor(this.data.drift.fitted), this.data.drift.fitted); m.rest(); this.driftKey = dKey;
      m.root.position.copy(SHELF_SLOTS.drift.at); m.root.rotation.y = SHELF_SLOTS.drift.rot;
      m.root.traverse((o) => { o.userData.station = 'storage'; });
      this.scene.add(m.root); this.driftShelf = m;
    }
    if (this.driftShelf) this.driftShelf.root.visible = this.data.drift.owned;
    const kit = this.scene.getObjectByName('drift-kit'); if (kit) kit.visible = !this.data.drift.owned;
    const mKey = JSON.stringify(this.data.monster.fitted);
    if (this.monsterShelf && this.monsterKey !== mKey) { this.scene.remove(this.monsterShelf.root); this.monsterShelf = null; }
    if (this.data.monster.owned && !this.monsterShelf) {
      const m = createMonster(undefined, this.data.monster.fitted); m.rest(); this.monsterKey = mKey;
      m.root.position.copy(SHELF_SLOTS.monster.at).add(new THREE.Vector3(0, 0.168 + (m.restHeight - 0.1695) * 0.92, 0)); m.root.rotation.y = SHELF_SLOTS.monster.rot; m.root.scale.setScalar(0.92);
      m.root.traverse((o) => { o.userData.station = 'storage'; });
      this.scene.add(m.root); this.monsterShelf = m;
    }
    if (this.monsterShelf) this.monsterShelf.root.visible = this.data.monster.owned;
    // the shelf crawler is only built once there is one to show
    if (this.data.crawler.owned && (!this.crawlerShelf || this.shelfStyle !== this.data.crawler.style + JSON.stringify(this.data.crawler.fitted))) {
      if (this.crawlerShelf) this.scene.remove(this.crawlerShelf.root);
      this.crawlerShelf = this.makeShelfCrawler(this.data.crawler.style);
    }
    if (this.crawlerShelf) this.crawlerShelf.root.visible = this.data.crawler.owned;
  }

  private prepareOnBench() {
    if (this.carAnim) return;
    this.data.selectedVehicle = this.data.activeBuggy;
    this.data.garage.vehiclePlace = 'bench';
    this.ctx.store.save();
    this.sync();
    toast(`${BUGGY_CLASSES[this.data.activeBuggy].short} moved to the workbench`, 'good');
    // follow the buggy to the bench once it lands
    window.setTimeout(() => { if (this.mode === 'storage') this.go('bench'); }, this.data.settings.reducedMotion ? 0 : 650);
    this.render();
  }

  private storeOnShelf() {
    if (!this.v.shellOn) { toast('Refit the body before storing the buggy', 'warn'); return; }
    this.data.garage.vehiclePlace = 'shelf';
    this.ctx.store.save();
    this.sync();
    if (this.mode === 'bench') this.go('storage'); else this.render();
  }

  private benchBody() {
    const v = this.v;
    this.sheet = new PartsSheet(this.ctx.service, 'garage', (p) => { this.selectedPart = p; this.sync(); }, () => {
      this.refreshLook();
      this.sync();
      const c = this.ctx.panel.querySelector('.credits'); if (c) c.textContent = `${this.data.credits} cr`;
      const sb = this.ctx.panel.querySelector('.shell-btn'); if (sb) sb.textContent = this.v.shellOn ? 'Remove body' : 'Refit body';
    }, { collapsible: true });
    this.sheet.selected = this.selectedPart;
    this.sheet.render();
    const body = h('div', { class: 'stack tight' },
      h('div', { class: 'row' },
        h('button', { class: 'btn shell-btn', onclick: () => this.toggleShell() }, v.shellOn ? 'Remove body' : 'Refit body'),
        h('span', { class: 'muted small grow' }, v.shellOn ? 'Body on: internal parts are dimmed through it.' : 'Body is resting on the bench mat.'),
      ),
      h('div', { class: 'row' },
        h('button', { class: 'btn grow', 'data-setup': '', onclick: () => this.showSetup() }, 'Setup sheet'),
        h('button', { class: 'btn grow', 'data-paint': '', onclick: () => this.showPaint() }, 'Paint shop')),
      this.sheet.el,
    );
    const footer = h('div', { class: 'session-bar two' },
      h('button', { class: 'btn ghost', onclick: () => this.storeOnShelf() }, 'Return to shelf'),
      h('button', { class: 'btn primary', onclick: () => this.go('departure') }, 'Go to Track'),
    );
    return { body, footer };
  }

  /** Rebuild the bench model if paint or visible hop-ups changed. */
  private refreshLook() {
    if (this.buggy.root.userData.lookKey === lookKey(this.data.activeBuggy, lookFor(this.v))) return;
    const part = this.selectedPart;
    this.rebuildActiveModel();
    this.placeCarImmediate();
    this.syncShellImmediate();
    this.selectedPart = part;
  }

  // ---------------------------------------------------------------- setup sheet + paint shop
  private showSetup() {
    const v = this.v, close = () => { this.ctx.overlay.replaceChildren(); this.render(); };
    const fxBox = h('div', { class: 'setup-fx' });
    const pctTxt = (m: number) => { const p = Math.round((m - 1) * 100); return p === 0 ? '±0%' : `${p > 0 ? '+' : '−'}${Math.abs(p)}%`; };
    const refreshFx = () => {
      // everything the hop-ups and this sheet do, relative to a stock car on the baseline sheet
      const fx = vehicleFx(v), st = setupFx(DEFAULT_SETUP), sh = SHOCK_SETTINGS[v.shockSetting];
      const rows: [string, number, boolean][] = [
        ['Grip', fx.grip / st.grip! * sh.gripMul, true],
        ['Steering', fx.steer / st.steer! * sh.steerResp, true],
        ['Top speed', fx.top / st.top!, true],
        ['Punch', fx.power / st.power!, true],
        ['Rear looseness', fx.slide / st.slide!, false],
        ['Landing hits', fx.absorb / st.absorb! * sh.absorb / SHOCK_SETTINGS.medium.absorb, false],
        ['Battery use', fx.drain / st.drain!, false],
      ];
      fxBox.replaceChildren(h('div', { class: 'eyebrow' }, 'Versus the stock car'), ...rows.map(([k, m, upGood]) => {
        const p = Math.round((m - 1) * 100), good = p === 0 ? '' : (p > 0) === upGood ? 'good' : 'bad';
        return h('div', { class: 'setup-row-fx' }, h('span', {}, k), h('b', { class: good }, pctTxt(m)));
      }));
    };
    const stepper = (k: keyof SetupSheet) => {
      const r = SETUP_RANGES[k], val = h('b', { class: 'setup-val' }, r.units(v.setup[k]));
      const set = (dv: number) => { v.setup[k] = THREE.MathUtils.clamp(v.setup[k] + dv, r.min, r.max); val.textContent = r.units(v.setup[k]); this.ctx.store.save(); refreshFx(); };
      return h('div', { class: 'setup-item' },
        h('div', { class: 'row between' }, h('strong', {}, r.label),
          h('div', { class: 'stepper' }, h('button', { class: 'btn small', 'aria-label': `${r.label} down`, 'data-step': `${k}-`, onclick: () => set(-1) }, '−'), val, h('button', { class: 'btn small', 'aria-label': `${r.label} up`, 'data-step': `${k}+`, onclick: () => set(1) }, '+'))),
        h('div', { class: 'muted small' }, r.help));
    };
    const shockChips = h('div', { class: 'chips' }, (Object.keys(SHOCK_SETTINGS) as (keyof typeof SHOCK_SETTINGS)[]).map((k) => h('button', {
      class: `chip ${v.shockSetting === k ? 'on' : ''}`, onclick: (e: Event) => {
        v.shockSetting = k; this.ctx.store.save(); refreshFx();
        (e.currentTarget as HTMLElement).parentElement!.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === e.currentTarget));
      },
    }, `${SHOCK_SETTINGS[k].label} springs`)));
    refreshFx();
    this.ctx.overlay.replaceChildren(h('div', { class: 'sheet-overlay', onclick: (e: Event) => { if (e.target === e.currentTarget) close(); } },
      h('div', { class: 'modal-card scroll-ok setup-card' },
        h('div', { class: 'eyebrow' }, `${BUGGY_CLASSES[v.id].name} · setup sheet`),
        h('h2', {}, 'Setup'),
        h('p', { class: 'muted small' }, 'Free adjustments with the tools on the bench. Changes apply next time you drive.'),
        h('div', { class: 'setup-item' }, h('strong', {}, 'Springs'), shockChips),
        ...(Object.keys(SETUP_RANGES) as (keyof SetupSheet)[]).map(stepper),
        fxBox,
        h('div', { class: 'row between' },
          h('button', { class: 'btn ghost', onclick: () => { v.setup = { ...DEFAULT_SETUP }; v.shockSetting = 'medium'; this.ctx.store.save(); this.showSetup(); } }, 'Reset to baseline'),
          h('button', { class: 'btn primary', onclick: close }, 'Done')))));
  }

  private showPaint() {
    const v = this.v, close = () => { this.ctx.overlay.replaceChildren(); this.render(); };
    const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
    const apply = () => { this.ctx.store.save(); this.refreshLook(); this.sync(); this.showPaint(); };
    const swatches = (list: number[], cur: number, pick: (c: number) => void, label: string) => h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': label },
      list.map((c) => h('button', { class: `swatch-btn ${c === cur ? 'on' : ''}`, 'aria-label': `${label} ${hex(c)}`, 'aria-checked': c === cur, role: 'radio', style: { background: hex(c) }, onclick: () => { pick(c); apply(); } })));
    const podBody = v.id === 'buggy' || v.id === 'buggy2wd' || v.id === 'truggy';
    this.ctx.overlay.replaceChildren(h('div', { class: 'sheet-overlay paint-overlay', onclick: (e: Event) => { if (e.target === e.currentTarget) close(); } },
      h('div', { class: 'modal-card scroll-ok paint-card' },
        h('div', { class: 'eyebrow' }, `${BUGGY_CLASSES[v.id].name} · paint shop`),
        h('h2', {}, 'Paint'),
        h('div', { class: 'eyebrow' }, 'Body colour'), swatches(PAINT_COLORS, v.paint.body, (c) => { v.paint.body = c; }, 'Body colour'),
        h('div', { class: 'eyebrow' }, 'Accent'), swatches(ACCENT_COLORS, v.paint.accent, (c) => { v.paint.accent = c; }, 'Accent colour'),
        podBody ? h('div', { class: 'eyebrow' }, 'Livery') : null,
        podBody ? h('div', { class: 'chips' }, LIVERIES.map((name, i) => h('button', { class: `chip ${v.paint.livery === i ? 'on' : ''}`, onclick: () => { v.paint.livery = i; apply(); } }, name))) : h('div', { class: 'muted small' }, 'This truck body takes the colours in its own graphic.'),
        h('div', { class: 'row between' },
          h('button', { class: 'btn ghost', onclick: () => { v.paint = { body: BUGGY_CLASSES[v.id].color, accent: BUGGY_CLASSES[v.id].accent, livery: 0 }; apply(); } }, 'Factory paint'),
          h('button', { class: 'btn primary', onclick: close }, 'Done')))));
  }

  private toggleShell() {
    if (this.shellAnim) return;
    toast(this.ctx.service.perform('shell-toggle'), 'good');
    this.sync();
    this.render();
  }

  private chargingBody() {
    const d = this.data;
    const v = this.v;
    return h('div', { class: 'stack' },
      ...d.batteries.map((b) => {
        const installed = v.batteryId === b.id;
        const place = installed ? 'car' : d.garage.batteryPlace[b.id] ?? 'charger';
        const status = place === 'car' ? 'In the buggy' : place === 'bench' ? 'On the bench tray' : this.chargeAnim?.id === b.id ? 'Charging…' : 'On the charger';
        const actions: HTMLElement[] = [];
        const busy = !!this.chargeAnim;
        if (place === 'charger' && b.charge < 100) actions.push(h('button', { class: 'btn primary', disabled: busy, onclick: () => this.charge(b) }, 'Charge now'));
        if (place === 'bench') actions.push(h('button', { class: 'btn primary', onclick: () => this.act(`bat-tocharger:${b.id}`) }, 'Put on charger'));
        if (place === 'car' && b.charge < 100) actions.push(h('button', { class: 'btn', disabled: busy, onclick: () => this.removeAndCharge(b) }, 'Remove from buggy and charge'));
        if (place !== 'car') actions.push(h('button', { class: 'btn', onclick: () => this.act(`bat-install:${b.id}`) }, v.batteryId ? 'Swap into buggy' : 'Install in buggy'));
        return h('div', { class: 'card' },
          h('div', { class: 'row between' }, h('strong', {}, `Pack ${packLetter(b.name)} · ${b.capacity} mAh`), h('span', { class: `tag ${place === 'car' ? 'good' : ''}` }, status)),
          h('div', { class: 'muted small' }, `${Math.round(b.charge)}% charge`),
          bar(b.charge),
          actions.length ? h('div', { class: 'actions' }, ...actions) : null,
        );
      }),
      h('div', { class: 'muted small' }, 'Charging is instant in this build: a short animation, no waiting. A pack must be out of the buggy to go on the charger.'),
    );
  }

  private act(id: string) {
    const msg = this.ctx.service.perform(id);
    if (msg) toast(msg, msg.startsWith('Remove') || msg.startsWith('Not') ? 'warn' : 'good');
    this.sync();
    this.render();
  }

  private charge(b: BatteryState) {
    if (this.chargeAnim) return;
    const from = b.charge;
    const msg = this.ctx.service.perform(`bat-charge:${b.id}`); // state committed once, immediately
    if (msg.startsWith('Remove')) { toast(msg, 'warn'); return; }
    this.chargeAnim = { id: b.id, t: 0, from };
    toast(msg, 'good');
    this.sync();
    this.render();
  }

  private removeAndCharge(b: BatteryState) {
    if (this.chargeAnim) return;
    const from = b.charge;
    const msg = this.ctx.service.perform(`bat-remove-charge:${b.id}`);
    if (!msg) return;
    this.chargeAnim = { id: b.id, t: 0, from };
    toast(`${msg}. Install it again at the workbench or below.`, 'good', 2600);
    this.sync();
    this.render();
  }

  private partsBody() {
    const d = this.data;
    const v = this.v;
    const spares = (Object.keys(TIRE_COMPOUNDS) as TireCompound[]).filter((k) => d.spares.tires[k] > 0);
    const looseBats = d.batteries.filter((b) => b.id !== v.batteryId);
    return h('div', { class: 'stack' },
      h('div', { class: 'section-label' }, 'Installed'),
      h('div', { class: 'card small-card' },
        h('div', {}, `Tires: ${TIRE_COMPOUNDS[v.tireCompound].name} · ${Math.round(v.condition.tires)}% tread`),
        h('div', {}, `Shocks: ${SHOCK_SETTINGS[v.shockSetting].label} · ${Math.round(v.condition.shocks)}% health`),
        h('div', {}, `Battery: ${installedBattery(d) ? `pack ${packLetter(installedBattery(d)!.name)}` : 'none'}`)),
      h('div', { class: 'section-label' }, 'Owned spares'),
      h('div', { class: 'card small-card' },
        ...looseBats.map((b) => h('div', {}, `Battery pack ${packLetter(b.name)} · ${Math.round(b.charge)}% · ${d.garage.batteryPlace[b.id] === 'bench' ? 'on the bench tray' : 'on the charger'}`)),
        ...spares.map((k) => h('div', {}, `${TIRE_COMPOUNDS[k].name} tire set ×${d.spares.tires[k]}`)),
        !looseBats.length && !spares.length ? h('div', { class: 'muted' }, 'No spares yet.') : null,
        spares.length ? h('div', { class: 'muted small' }, 'Fit spare tires at the workbench (Tires).') : null),
      h('div', { class: 'section-label' }, 'Shop · tire sets'),
      ...(Object.keys(TIRE_COMPOUNDS) as TireCompound[]).map((k) => {
        const t = TIRE_COMPOUNDS[k];
        return h('div', { class: 'shop-row' },
          h('div', { class: 'grow' }, h('strong', {}, t.name), h('div', { class: 'muted small' }, `${t.note} Owned: ${d.spares.tires[k]}${k === v.tireCompound ? ' · this type is fitted' : ''}`)),
          h('button', { class: `btn ${d.credits >= this.ctx.service.price(t.price) ? '' : 'disabled'}`, disabled: d.credits < this.ctx.service.price(t.price), onclick: (e: Event) => this.buy(k, e.currentTarget as HTMLButtonElement) },
            h('span', {}, 'Buy'), h('span', { class: 'cost' }, `${this.ctx.service.price(t.price)} cr`)));
      }),
    );
  }

  private buyBusy = false;
  private buy(k: TireCompound, btn: HTMLButtonElement) {
    if (this.buyBusy) return; // double taps can't buy twice
    this.buyBusy = true;
    btn.disabled = true;
    this.act(`shop-tires:${k}`);
    window.setTimeout(() => { this.buyBusy = false; }, 350);
  }

  // ---------------------------------------------------------------- departure
  readiness() {
    const d = this.data;
    const v = this.v;
    const bat = installedBattery(d);
    const fullest = d.batteries.filter((b) => b.id !== v.batteryId).sort((a, b) => b.charge - a.charge)[0];
    type Item = { ok: boolean; required: boolean; label: string; fix?: { label: string; run: () => void } };
    const items: Item[] = [];
    items.push({ ok: d.selectedVehicle != null, required: true, label: 'Vehicle chosen', fix: { label: 'Pick a car', run: () => this.go('storage') } });
    items.push({
      ok: !!bat, required: true, label: bat ? `Battery installed (pack ${packLetter(bat.name)})` : 'No battery installed',
      fix: fullest ? { label: `Install pack ${packLetter(fullest.name)} (${Math.round(fullest.charge)}%)`, run: () => this.act(`bat-install:${fullest.id}`) } : undefined,
    });
    if (bat) {
      const better = fullest && fullest.charge > bat.charge + 10 ? fullest : null;
      items.push({
        ok: bat.charge >= 20, required: true, label: `Charge ${Math.round(bat.charge)}%${bat.charge < 20 ? ' (too low for a run)' : ''}`,
        fix: better ? { label: `Swap to pack ${packLetter(better.name)} (${Math.round(better.charge)}%)`, run: () => this.act(`bat-install:${better.id}`) }
          : { label: 'Charge it now', run: () => { this.ctx.service.perform(`bat-remove-charge:${bat.id}`); this.act(`bat-install:${bat.id}`); toast('Pack charged and refitted', 'good'); } },
      });
    }
    items.push({ ok: v.shellOn, required: true, label: v.shellOn ? 'Body fitted' : 'Body is off (driving needs it on)', fix: { label: 'Refit body', run: () => this.toggleShell() } });
    items.push({ ok: v.condition.tires >= 25, required: false, label: `Tires ${Math.round(v.condition.tires)}%${v.condition.tires < 25 ? ' — worn, grip is reduced' : ''}`, fix: this.carOnBench ? { label: 'Service at workbench', run: () => this.go('bench') } : undefined });
    items.push({ ok: v.condition.shocks >= 40, required: false, label: `Shocks ${Math.round(v.condition.shocks)}%${v.condition.shocks < 40 ? ' — damaged' : ''}`, fix: this.carOnBench ? { label: 'Service at workbench', run: () => this.go('bench') } : undefined });
    return items;
  }

  private departureBody() {
    const items = this.readiness();
    const ready = items.every((i) => i.ok || !i.required);
    return h('div', { class: 'stack' },
      h('div', { class: 'muted small' }, 'Brackenbank Dirt Circuit · practice or the 3-lap trial from the pit.'),
      h('ul', { class: 'ready-list' },
        items.map((i) => h('li', { class: i.ok ? 'ok' : i.required ? 'bad' : 'warn' },
          h('span', { class: 'tick', 'aria-hidden': 'true' }, i.ok ? '✓' : i.required ? '✕' : '!'),
          h('span', { class: 'grow' }, i.label),
          !i.ok && i.fix ? h('button', { class: 'btn small', onclick: i.fix.run }, i.fix.label) : null))),
      h('button', { class: `btn primary ${ready ? '' : 'disabled'}`, disabled: !ready, onclick: () => this.depart() }, ready ? 'Load up and go to the track' : 'Fix the items above first'),
    );
  }

  private depart() {
    const d = this.data;
    departSnapshot = {
      at: Date.now(),
      charges: Object.fromEntries(d.batteries.map((b) => [b.id, b.charge])),
      cond: { ...this.v.condition },
    };
    this.ctx.store.save();
    this.ctx.go('pit');
  }

  private showReturnSummary(snap: Snapshot) {
    const d = this.data;
    const v = this.v;
    const lines: string[] = [];
    for (const b of d.batteries) {
      const used = (snap.charges[b.id] ?? b.charge) - b.charge;
      if (used > 0.5) lines.push(`Pack ${packLetter(b.name)} used ${Math.round(used)}% (now ${Math.round(b.charge)}%)`);
    }
    for (const [k, label] of [['tires', 'Tires'], ['shocks', 'Shocks'], ['chassis', 'Chassis'], ['motor', 'Motor']] as const) {
      const diff = (snap.cond[k] ?? 100) - v.condition[k];
      if (diff > 0.5) lines.push(`${label} −${Math.round(diff)}% (now ${Math.round(v.condition[k])}%)`);
    }
    const runs = d.results.filter((r) => r.at >= snap.at);
    const suggestions: string[] = [];
    const bat = installedBattery(d);
    if (!bat || bat.charge < 40) suggestions.push('Charge or swap the battery');
    if (v.condition.tires < 60) suggestions.push('Fresh tires at the workbench');
    if (v.condition.shocks < 70) suggestions.push('Rebuild the shocks');
    if (v.condition.chassis < 70) suggestions.push('Repair the chassis');
    const close = () => this.ctx.overlay.replaceChildren();
    this.ctx.overlay.replaceChildren(h('div', { class: 'sheet-overlay' },
      h('div', { class: 'modal-card scroll-ok' },
        h('div', { class: 'eyebrow' }, 'Back at Ruttworks Garage'),
        h('h2', {}, 'Session summary'),
        runs.length ? h('div', { class: 'small' }, ...runs.slice(0, 3).map((r) => h('div', {}, r.mode === 'trial' && r.total ? `3-lap trial ${fmtTime(r.total)}${r.pb ? ' · new best' : ''} · +${r.credits} cr` : `Practice · ${r.laps.length} lap${r.laps.length === 1 ? '' : 's'}`))) : h('div', { class: 'muted small' }, 'No timed runs this trip.'),
        h('ul', { class: 'summary-list' }, lines.length ? lines.map((l) => h('li', {}, l)) : [h('li', {}, 'No noticeable wear.')]),
        suggestions.length ? h('div', { class: 'small' }, h('strong', {}, 'Suggested: '), suggestions.join(' · ')) : null,
        h('div', { class: 'row end' },
          h('button', { class: 'btn', onclick: close }, 'Look around'),
          h('button', { class: 'btn primary', onclick: () => { close(); this.go('bench'); } }, 'To the workbench')),
      )));
  }

  // ---------------------------------------------------------------- decor
  private showDecor(id: DecorId) {
    const d = this.data;
    const v = this.v;
    const close = () => this.ctx.overlay.replaceChildren();
    let title = '', content: HTMLElement;
    if (id === 'club') {
      title = 'Club board';
      content = h('div', { class: 'stack small' },
        h('div', {}, h('strong', {}, 'Brackenbank Dirt Circuit')),
        h('div', {}, 'Practice: free, no clock. Good for learning the berms and the tabletop.'),
        h('div', {}, `Brackenbank Three: 3-lap time trial. +25 cr, +15 more for a personal best.`),
        h('div', { class: 'muted' }, 'Start either one from the pit table at the track.'),
        h('button', { class: 'btn', onclick: () => this.showJobs() }, 'Odd jobs · earn credits'));
    } else if (id === 'notes') {
      title = 'Setup notes';
      const bat = installedBattery(d);
      content = h('div', { class: 'stack small' },
        h('div', {}, `Tires: ${TIRE_COMPOUNDS[v.tireCompound].name} (${Math.round(v.condition.tires)}%)`),
        h('div', {}, `Shocks: ${SHOCK_SETTINGS[v.shockSetting].label}. ${SHOCK_SETTINGS[v.shockSetting].note}`),
        h('div', {}, `Battery: ${bat ? `pack ${packLetter(bat.name)} at ${Math.round(bat.charge)}%` : 'none installed'}`),
        h('div', {}, `Odometer: ${(v.odometer / 1000).toFixed(2)} km`));
    } else {
      title = 'Trophy shelf';
      content = h('div', { class: 'stack small' },
        ...([['Dirt Classic', d.best], ['Hilltop Clay', d.trackBests.clay], ['Dune Run', d.trackBests.dunes]] as const).map(([n, b]) =>
          h('div', {}, `${n}: trial ${b.trial ? fmtTime(b.trial) : '--'} · lap ${b.lap ? `${b.lap.toFixed(2)} s` : '--'}`)),
        h('div', { class: 'muted' }, `${d.results.filter((r) => r.mode === 'trial').length} recorded trial${d.results.filter((r) => r.mode === 'trial').length === 1 ? '' : 's'}`));
    }
    this.ctx.overlay.replaceChildren(h('div', { class: 'sheet-overlay', onclick: (e: Event) => { if (e.target === e.currentTarget) close(); } },
      h('div', { class: 'modal-card scroll-ok' }, h('h2', {}, title), content, h('div', { class: 'row end' }, h('button', { class: 'btn primary', onclick: close }, 'Close')))));
  }
}
