import * as THREE from 'three';
import type { BuggyModel } from '../assets/buggyModel';
import type { InputController } from '../core/InputController';
import type { SaveStore } from '../core/SaveStore';
import type { ServiceSystem } from '../core/ServiceSystem';
import { PartId } from '../data/specs';
import { SaveData, activeVehicle } from '../core/state';

export type ScreenName = 'garage' | 'pit' | 'drive' | 'crawl' | 'mow' | 'crawltest' | 'crawlpile' | 'crawlcomp' | 'proving' | 'monster' | 'drift';

export interface AppContext {
  renderer: THREE.WebGLRenderer;
  store: SaveStore;
  service: ServiceSystem;
  input: InputController;
  hud: HTMLElement;
  overlay: HTMLElement;
  panel: HTMLElement;
  canvas: HTMLCanvasElement;
  stage: HTMLElement;
  go(screen: ScreenName, opts?: Record<string, unknown>): void;
  openSettings(): void;
  applyGraphics(): void;
}

export interface Screen {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  enter(opts?: Record<string, unknown>): void;
  exit(): void;
  update(dt: number, t: number): void;
  resize(w: number, h: number): void;
  tap?(ndc: THREE.Vector2): void;
  drag?(dx: number, dy: number): void;
  /** Pinch/wheel: factor > 1 = zoom out. */
  zoom?(factor: number): void;
  pause?(): void;
  /** Optional camera-attached overlay rendered into the bottom band of the stage. */
  overlay?(): { scene: THREE.Scene; camera: THREE.Camera; height: number } | null;
}

/** Vertical FOV that keeps a target horizontal FOV on narrow portrait screens. */
export function fovFor(hfovDeg: number, aspect: number, minV = 35, maxV = 78) {
  const h = THREE.MathUtils.degToRad(hfovDeg);
  const v = 2 * Math.atan(Math.tan(h / 2) / aspect);
  return THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(v), minV, maxV);
}

/** Keep a buggy model's visible state in sync with the saved vehicle. */
export function syncBuggy(model: BuggyModel, s: SaveData, opts: { batteryInCar?: boolean } = {}) {
  const v = activeVehicle(s);
  model.setShell(v.shellOn);
  model.setTires(v.tireCompound, v.condition.tires);
  model.setBatteryVisible(opts.batteryInCar ?? v.batteryId !== null);
}

/** Make the shell see-through when an internal part is selected so its location is visible. */
export function ghostShell(model: BuggyModel, ghost: boolean) {
  for (const m of model.parts.get('shell') ?? []) {
    const mat = m.material as THREE.MeshStandardMaterial;
    mat.transparent = ghost;
    mat.opacity = ghost ? 0.22 : 1;
    mat.depthWrite = !ghost;
  }
}

export const INTERNAL_PARTS: PartId[] = ['chassis', 'motor', 'esc', 'battery', 'servo', 'shocks', 'diff', 'gears'];

/** Drag-to-rotate inspection camera around a point. */
export class OrbitInspect {
  az: number; el: number;
  constructor(public target: THREE.Vector3, public dist: number, az = 0.6, el = 0.55, public minEl = 0.15, public maxEl = 1.25) {
    this.az = az; this.el = el;
  }
  drag(dx: number, dy: number) {
    this.az -= dx * 0.008;
    this.el = THREE.MathUtils.clamp(this.el + dy * 0.006, this.minEl, this.maxEl);
  }
  position(out: THREE.Vector3) {
    return out.set(
      this.target.x + Math.sin(this.az) * Math.cos(this.el) * this.dist,
      this.target.y + Math.sin(this.el) * this.dist,
      this.target.z + Math.cos(this.az) * Math.cos(this.el) * this.dist,
    );
  }
}

export function pickPart(ray: THREE.Raycaster, model: BuggyModel, shellPassThrough: boolean): PartId | null {
  const meshes: THREE.Object3D[] = [];
  for (const [id, list] of model.parts) {
    if (id === 'shell' && shellPassThrough) continue;
    for (const m of list) if (m.visible && (m.parent?.visible ?? true)) meshes.push(m);
  }
  const hits = ray.intersectObjects(meshes, false);
  for (const hit of hits) {
    if (isVisibleChain(hit.object)) return hit.object.userData.partId as PartId;
  }
  return null;
}

function isVisibleChain(o: THREE.Object3D) {
  let p: THREE.Object3D | null = o;
  while (p) { if (!p.visible) return false; p = p.parent; }
  return true;
}
