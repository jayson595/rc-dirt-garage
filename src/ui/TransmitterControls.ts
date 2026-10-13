// Driving controls: an operator's hands holding a pistol-grip transmitter, drawn as a
// camera-attached overlay along the bottom of the screen. The wheel and trigger ARE the controls.
// Gesture interpretation (core/gestures) -> InputController (single owner of intent) -> simulation.
import * as THREE from 'three';
import { createTransmitter, TransmitterRig } from '../assets/transmitterModel';
import { SteerMode, TriggerGesture, WheelGesture } from '../core/gestures';
import type { InputController } from '../core/InputController';

type Control = 'wheel' | 'trigger';

export interface ControlSettings {
  steerSensitivity: number;
  steerMode: SteerMode;
  controllerScale: number;
  reducedMotion: boolean;
}

const SVGNS = 'http://www.w3.org/2000/svg';

export class TransmitterControls {
  scene = new THREE.Scene();
  camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 50);
  rig: TransmitterRig;
  /** Height of the overlay band in CSS px (bottom of the stage). */
  bandH = 240;
  private W = 390;
  surface: HTMLDivElement;
  private hints: SVGSVGElement;
  private revBadge: HTMLDivElement;
  wheel = new WheelGesture();
  trigger = new TriggerGesture();
  private owners = new Map<number, Control>();
  geo = { wheel: { x: 0, y: 0, r: 50, touchR: 75 }, trig: { x: 0, y: 0, w: 124, h: 150 }, steer: { x0: 0, x1: 0, y0: 0, y1: 0 } };
  private demoT = -1;
  private hintsOn = false;
  private idle = 0;
  private unsubCancel: () => void;

  constructor(private input: InputController, private settings: () => ControlSettings) {
    this.rig = createTransmitter();
    this.scene.add(this.rig.root);
    this.scene.add(new THREE.HemisphereLight(0xfff4e6, 0x3a3430, 1.25));
    const key = new THREE.DirectionalLight(0xffffff, 1.7);
    key.position.set(-3, 5, 6);
    const rim = new THREE.DirectionalLight(0xffe2b8, 0.8);
    rim.position.set(4, 2, -3);
    this.scene.add(key, rim);
    this.camera.position.set(0, 2.2, 10);
    this.camera.lookAt(0, 0, 0);

    this.surface = document.createElement('div');
    this.surface.className = 'ctrl-surface';
    this.surface.setAttribute('aria-label', 'Transmitter: turn the wheel on the right to steer; drag down on the trigger on the left to accelerate, up to brake');
    this.hints = document.createElementNS(SVGNS, 'svg');
    this.hints.setAttribute('class', 'ctrl-hints');
    this.hints.setAttribute('aria-hidden', 'true');
    this.revBadge = document.createElement('div');
    this.revBadge.className = 'rev-badge';
    this.revBadge.textContent = 'R';
    this.revBadge.title = 'Reverse engaged';
    this.surface.append(this.hints, this.revBadge);

    this.surface.addEventListener('pointerdown', this.down);
    this.surface.addEventListener('pointermove', this.move);
    for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) this.surface.addEventListener(t, this.up as EventListener);
    this.unsubCancel = this.input.onCancel(() => this.cancel());
  }

  mount(stage: HTMLElement) { stage.appendChild(this.surface); }
  unmount() { this.cancel(); this.surface.remove(); }
  dispose() { this.unmount(); this.unsubCancel(); }

  /** Release every pointer and return both controls to neutral. */
  cancel() {
    for (const id of this.owners.keys()) {
      try { this.surface.releasePointerCapture(id); } catch { /* already gone */ }
    }
    this.owners.clear();
    this.wheel.end();
    this.wheel.angle = 0;
    this.trigger.end();
    this.input.setTouchSteer(null);
    this.input.setTouchThrottle(null);
  }

  // ---------------- layout
  layout(W: number, H: number) {
    // a resize/orientation change invalidates any gesture geometry: cancel safely
    this.cancel();
    const s = this.settings();
    this.W = W;
    this.bandH = Math.round(Math.min(310, Math.max(200, H * 0.3)) * Math.min(1.12, Math.max(0.88, s.controllerScale)));
    // keep at least ~55% of the stage for the track
    this.bandH = Math.min(this.bandH, Math.round(H * 0.42));
    const U = 4.95 / Math.max(0.85, Math.min(1.15, s.controllerScale));
    const h = (U * this.bandH) / W;
    const top = 1.3;
    Object.assign(this.camera, { left: -U / 2, right: U / 2, top, bottom: top - h });
    this.camera.updateProjectionMatrix();
    this.surface.style.height = `${this.bandH}px`;
    this.hints.setAttribute('viewBox', `0 0 ${W} ${this.bandH}`);
    this.rig.pose(0, 0, 1, 0);
    this.computeHitRegions();
  }

  private project(o: THREE.Object3D) {
    const v = o.getWorldPosition(new THREE.Vector3()).project(this.camera);
    return { x: ((v.x + 1) / 2) * this.W, y: ((1 - v.y) / 2) * this.bandH };
  }

  private computeHitRegions() {
    const a = this.rig.anchors;
    const c = this.project(a.wheelCenter), rim = this.project(a.wheelRim);
    const r = Math.hypot(rim.x - c.x, rim.y - c.y);
    const touchR = Math.min(Math.max(r * 1.5, 72), this.W * 0.24);
    this.geo.wheel = { x: c.x, y: c.y, r, touchR };
    this.wheel.setCenter(c.x, c.y);
    this.wheel.deadRadius = Math.max(14, r * 0.28);
    // Big, forgiving zones (thumbs on a phone are imprecise): the whole left part of the band drives the
    // trigger, the whole right part steers. They never overlap the wheel's own touch circle.
    const maxRight = c.x - touchR - 10;
    const w = Math.max(96, maxRight - 4), h = this.bandH - 8;
    const x = 4 + w / 2, y = this.bandH / 2;
    this.geo.trig = { x, y, w, h };
    this.geo.steer = { x0: x + w / 2 + 8, x1: this.W, y0: 0, y1: this.bandH };
    this.revBadge.style.left = `${x - w / 2}px`;
    this.revBadge.style.top = `${Math.max(4, y - h / 2 - 2)}px`;
    this.drawHints();
  }

  hit(x: number, y: number): Control | null {
    const wg = this.geo.wheel, tg = this.geo.trig;
    if (Math.hypot(x - wg.x, y - wg.y) <= wg.touchR) return 'wheel';
    if (Math.abs(x - tg.x) <= tg.w / 2 && Math.abs(y - tg.y) <= tg.h / 2) return 'trigger';
    const sz = this.geo.steer;
    if (x >= sz.x0 && x <= sz.x1 && y >= sz.y0 && y <= sz.y1) return 'wheel';
    return null;
  }

  // ---------------- pointers
  private local(e: PointerEvent) {
    const r = this.surface.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private down = (e: PointerEvent) => {
    e.preventDefault();
    const { x, y } = this.local(e);
    const ctl = this.hit(x, y);
    if (!ctl) return;
    // an occupied control can't be taken over by another finger
    for (const owned of this.owners.values()) if (owned === ctl) return;
    this.owners.set(e.pointerId, ctl);
    try { this.surface.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
    this.demoT = -1;
    const s = this.settings();
    if (ctl === 'wheel') {
      this.wheel.sensitivity = s.steerSensitivity;
      // on the wheel itself: turn it (or slide, if chosen in settings); anywhere else in the steering
      // zone a simple sideways slide steers, which is far easier for a thumb than circling
      const wg = this.geo.wheel;
      const onWheel = Math.hypot(x - wg.x, y - wg.y) <= wg.r * 1.25;
      this.wheel.mode = onWheel ? s.steerMode : 'horizontal';
      this.wheel.start(x, y);
    } else {
      this.trigger.start(x, y);
    }
  };

  private move = (e: PointerEvent) => {
    const ctl = this.owners.get(e.pointerId);
    if (!ctl) return;
    e.preventDefault();
    const { x, y } = this.local(e);
    if (ctl === 'wheel') {
      this.wheel.move(x, y);
      if (this.wheel.hitStop) { try { navigator.vibrate?.(8); } catch { /* optional */ } }
    } else this.trigger.move(x, y);
  };

  private up = (e: PointerEvent) => {
    const ctl = this.owners.get(e.pointerId);
    if (!ctl) return;
    this.owners.delete(e.pointerId);
    try { this.surface.releasePointerCapture(e.pointerId); } catch { /* fine */ }
    if (ctl === 'wheel') this.wheel.end();
    else { this.trigger.end(); this.input.setTouchThrottle(null); }
  };

  // ---------------- per frame
  /** Push touch intent into the input controller (call before input.update). */
  feed(dt: number) {
    if (this.wheel.active) this.input.setTouchSteer(this.wheel.value);
    else if (this.wheel.angle !== 0) { this.wheel.relax(dt); this.input.setTouchSteer(this.wheel.value); }
    else this.input.setTouchSteer(null);
    this.input.setTouchThrottle(this.trigger.active ? this.trigger.value : null);
  }

  /** Animate the hands and transmitter from the final input (touch or keyboard). */
  pose(dt: number, steer: number, throttle: number, reversing: boolean) {
    const reduced = this.settings().reducedMotion;
    if (!reduced) this.idle += dt;
    let s = steer, t = throttle;
    if (this.demoT >= 0) {
      this.demoT += dt;
      const d = this.demoT;
      s = d < 2.2 ? Math.sin(d * Math.PI / 1.1) * 0.8 : 0;
      t = d >= 2.2 && d < 4.6 ? (d < 3.4 ? Math.sin((d - 2.2) * Math.PI / 1.2) : -Math.sin((d - 3.4) * Math.PI / 1.2) * 0.7) : 0;
      if (d > 4.8) { this.demoT = -1; this.setHints(this.hintsOn); }
    }
    this.rig.pose(s, t, dt, this.idle);
    this.revBadge.classList.toggle('on', reversing);
  }

  /** Short animated demonstration of both controls (onboarding). */
  demo() {
    this.demoT = 0;
    this.hints.classList.add('show');
  }

  setHints(on: boolean) {
    this.hintsOn = on;
    this.hints.classList.toggle('show', on || this.demoT >= 0);
  }

  private drawHints() {
    const { x, y, touchR } = this.geo.wheel;
    const t = this.geo.trig;
    const R = touchR * 0.92;
    const p = (deg: number) => {
      const a = ((deg - 90) * Math.PI) / 180;
      return `${(x + Math.cos(a) * R).toFixed(1)} ${(y + Math.sin(a) * R).toFixed(1)}`;
    };
    const arc = `M ${p(-55)} A ${R} ${R} 0 0 1 ${p(55)}`;
    const ty0 = t.y - t.h / 2 + 18, ty1 = t.y + t.h / 2 - 18;
    const tx = t.x - t.w / 2 - 2;
    const sz = this.geo.steer;
    this.hints.innerHTML = `
      <rect x="${t.x - t.w / 2}" y="${t.y - t.h / 2}" width="${t.w}" height="${t.h}" rx="14" class="hint-zone"/>
      <rect x="${sz.x0}" y="${sz.y0 + 4}" width="${sz.x1 - sz.x0 - 4}" height="${sz.y1 - sz.y0 - 8}" rx="14" class="hint-zone"/>
      <text x="${(sz.x0 + sz.x1) / 2}" y="${sz.y1 - 14}" class="hint-text" text-anchor="middle">SLIDE ← → TO STEER</text>
      <defs><marker id="hint-arrow" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" class="hint-head"/></marker></defs>
      <path d="${arc}" class="hint-line" marker-start="url(#hint-arrow)" marker-end="url(#hint-arrow)"/>
      <text x="${x}" y="${Math.max(14, y - R - 8)}" class="hint-text" text-anchor="middle">TURN</text>
      <path d="M ${tx} ${ty0} L ${tx} ${ty1}" class="hint-line" marker-start="url(#hint-arrow)" marker-end="url(#hint-arrow)"/>
      <text x="${tx + 8}" y="${ty0 + 4}" class="hint-text">PUSH = BRAKE</text>
      <text x="${tx + 8}" y="${ty1}" class="hint-text">PULL = GO</text>`;
  }
}
