// Driving from the elevated driver's stand. The camera never leaves the platform: it only pans,
// tilts and zooms modestly to follow the buggy.
import * as THREE from 'three';
import { STAND } from '../assets/venueProps';
import { Telemetry } from '../ui/Telemetry';
import { BUGGY_CLASSES, ECONOMY, TRACK_ID } from '../data/specs';
import { computeHandling, Handling } from '../core/ServiceSystem';
import { SessionManager, SessionMode } from '../core/SessionManager';
import { activeVehicle, installedBattery, trackBest } from '../core/state';
import { RACE_TRACKS } from '../sim/Track';
import { VehicleSimulation } from '../sim/VehicleSimulation';
import { fmtTime, h, toast } from '../ui/dom';
import { TransmitterControls } from '../ui/TransmitterControls';
import { AppContext, Screen, syncBuggy } from './common';
import { VenueWorld } from './VenueWorld';
import { lookFor } from '../assets/buggyModel';
import { AIRacer, collideCars, skillFor } from '../sim/AIRacer';
import { EventDef, RIVALS, eventById, eventRecord, ordinal, settleEvent, EVENTS } from '../data/events';
import { defaultSave, defaultVehicle } from '../core/state';
import type { BuggyId } from '../data/specs';

/** Handling of a fresh, stock car of a class (what the AI rivals drive). */
function freshHandling(id: BuggyId) {
  const s = defaultSave(); s.vehicles[id] = defaultVehicle(id); s.activeBuggy = id; s.vehicles[id]!.batteryId = 'bat-a';
  return computeHandling(s);
}
const GRID: [number, number][] = [[-1.2, -0.55], [-1.2, 0.55], [-2.2, -0.55], [-2.2, 0.55]];
const SPREAD = [0.08, -0.02, -0.1];

const STEP = 1 / 120;
export const STAND_EYE = new THREE.Vector3(STAND.x, STAND.eye, STAND.z - 0.85);

export class TrackScene implements Screen {
  camera = new THREE.PerspectiveCamera(45, 1, 0.15, 260);
  sim: VehicleSimulation;
  session!: SessionManager;
  paused = false;
  private acc = 0;
  private handling!: Handling;
  private handlingTimer = 0;
  private look = new THREE.Vector3();
  private mode: SessionMode = 'practice';
  private els: Record<string, HTMLElement> = {};
  private minimap: { canvas: HTMLCanvasElement; base: HTMLCanvasElement; scale: number; ox: number; oz: number } | null = null;
  private stuckTimer = 0;
  private batteryWarned = false;
  private resetHold: number | null = null;
  private resultShown = false;
  private hudTimer = 0;
  private wearAcc = { distance: 0, slipDistance: 0, throttleEnergy: 0, dt: 0 };
  private tmp = new THREE.Vector3();
  private trackFov = 45;
  controls: TransmitterControls;
  private W = 1;
  private H = 1;
  /** Height of the virtual frame used to lift the look point above the transmitter. */
  private fullH = 1;

  private tele = new Telemetry();
  private camMode: 'stand' | 'chase' | 'side' = 'stand';
  private lastImpact = 0;
  /** Sandbox proving loop: no wear, no battery drain, nothing recorded. */
  private get proving() { return this.world.layout === 'proving'; }
  /** Race against AI rivals (events board). */
  private event: EventDef | null = null;
  private racers: AIRacer[] = [];
  private prog = 0;
  private finishTimer = -1;
  private get racing() { return this.mode === 'race' && !!this.event; }
  private get timed() { return this.mode !== 'practice'; }

  constructor(private ctx: AppContext, private world: VenueWorld) {
    this.sim = new VehicleSimulation(world.track);
    this.controls = new TransmitterControls(ctx.input, () => ctx.store.data.settings);
  }

  overlay() {
    return { scene: this.controls.scene, camera: this.controls.camera, height: this.controls.bandH };
  }

  get scene() { return this.world.scene; }

  enter(opts?: Record<string, unknown>) {
    this.mode = this.world.layout === 'proving' ? 'practice' : (opts?.mode as SessionMode) ?? 'practice';
    this.event = this.mode === 'race' ? eventById(String(opts?.event ?? '')) ?? null : null;
    if (this.mode === 'race' && !this.event) this.mode = 'trial';
    this.camMode = 'stand'; this.lastImpact = 0;
    const d = this.ctx.store.data;
    const cls = activeVehicle(d).id;
    this.world.useClass(cls, lookFor(activeVehicle(d)));
    this.sim.spec = BUGGY_CLASSES[cls];
    this.session = new SessionManager(this.world.track, this.mode, trackBest(d).lap, this.event?.laps);
    this.racers = [];
    this.prog = 0; this.finishTimer = -1;
    const T = this.world.track;
    if (this.event) {
      const hnd = freshHandling(cls), ev = this.event;
      // a different trio of rivals per event, all in the player's class
      const pick = [0, 1, 2].map((k) => RIVALS[(EVENTS.indexOf(ev) * 2 + k) % RIVALS.length]);
      this.racers = pick.map((_, i) => {
        const a = new AIRacer(T, BUGGY_CLASSES[cls], hnd, skillFor(ev.skill, SPREAD[i]), ev.laps ?? 3, GRID[i][1]);
        a.place(T.startS + GRID[i][0], GRID[i][1]);
        a.prog = GRID[i][0];
        return a;
      });
      this.rivalNames = pick.map((r) => r.name);
      this.rivalColors = pick.map((r) => r.color);
      this.world.setRivals(cls, pick.map((r) => ({ body: r.color, accent: r.accent, livery: r.livery })));
      this.sim.placeAt(T.startS + GRID[3][0], GRID[3][1]);
      this.prog = GRID[3][0];
    } else {
      this.world.hideRivals();
      this.sim.placeAt(T.startS - 1.4, 0);
    }
    this.sim.resetSafePoints();
    this.sim.events.length = 0;
    this.sim.takeStats();
    this.handling = computeHandling(d);
    this.paused = false;
    this.acc = 0;
    this.stuckTimer = 0;
    this.batteryWarned = false;
    this.resultShown = false;
    this.wearAcc = { distance: 0, slipDistance: 0, throttleEnergy: 0, dt: 0 };
    const w = this.world;
    w.car.root.visible = true;
    w.shadow.visible = true;
    w.marker.visible = true;
    w.pitCar.root.visible = false;
    syncBuggy(w.car, d);
    w.car.freeze(); // the driven car is never picked: fewer draw calls
    w.poseCar(this.sim);
    this.look.set(this.sim.x, this.sim.y, this.sim.z);
    this.controls.mount(this.ctx.stage);
    this.controls.layout(this.W, this.H);
    this.buildUI();
    this.ctx.input.enabled = true;
    this.ctx.input.clear();
    this.ctx.input.onPause = () => (this.paused ? this.resume() : this.pause());
    this.ctx.input.onResetKey = () => this.doReset();
  }

  private rivalNames: string[] = [];
  private rivalColors: number[] = [];

  exit() {
    this.world.hideRivals();
    this.racers = [];
    this.ctx.input.enabled = false;
    this.ctx.input.clear();
    this.controls.unmount();
    this.ctx.stage.style.removeProperty('--band');
    this.camera.clearViewOffset();
    this.ctx.input.onPause = null;
    this.ctx.input.onResetKey = null;
    this.flushWear();
    this.cancelResetHold();
    this.ctx.store.save();
  }

  // ---------------- UI
  private buildUI() {
    const e = this.els = {} as Record<string, HTMLElement>;
    const cell = (label: string, id: string, extra?: HTMLElement) =>
      h('div', { class: 'hud-cell' }, h('small', {}, label), (e[id] = h('b', { id }, '')), extra ?? null);
    e.batBar = h('i', {});
    const top = h('div', { class: 'hud-top' },
      cell('LAP', 'lap'),
      this.racing ? cell('POS', 'pos') : null,
      cell(this.mode === 'trial' ? 'TIME' : this.racing ? 'TIME' : 'PRACTICE', 'time'),
      h('div', { class: 'hud-cell bat' }, h('small', {}, 'BATT'), h('div', { class: 'bar mini' }, e.batBar), (e.batTxt = h('b', {}, ''))),
      h('button', { class: 'icon-btn pause', 'aria-label': 'Pause', onclick: () => this.pause() }, '❚❚'),
    );
    e.split = h('span', {}, '');
    e.best = h('span', {}, '');
    const sub = h('div', { class: 'hud-sub' }, e.split, e.best);
    const mm = h('canvas', { class: 'minimap', width: 120, height: 84, 'aria-label': 'Track map' }) as HTMLCanvasElement;
    mm.style.display = this.ctx.store.data.settings.showMap ? '' : 'none';
    e.resetBtn = h('button', { class: 'tool-btn reset' }, h('span', { class: 'fill' }), h('span', { class: 'lbl' }, 'Hold\nRESET'));
    const camBtn = this.proving ? h('button', { class: 'tool-btn', onclick: () => { this.camMode = this.camMode === 'stand' ? 'chase' : this.camMode === 'chase' ? 'side' : 'stand'; camBtn!.textContent = `Cam\n${this.camMode}`; } }, 'Cam\nstand') : null;
    const dataBtn = this.proving ? h('button', { class: 'tool-btn', onclick: () => this.tele.el.classList.toggle('hide') }, 'Data') : null;
    const tools = h('div', { class: 'hud-tools' },
      h('button', { class: 'tool-btn', onclick: () => this.recenter() }, 'Re-\ncenter'),
      e.resetBtn, camBtn, dataBtn,
    );
    e.message = h('div', { class: 'hud-message' }, '');
    this.ctx.hud.replaceChildren(top, sub, mm, tools, e.message);
    if (this.proving) { this.tele.reset(); this.ctx.hud.append(this.tele.el); }
    this.setupMinimap(mm);

    const rb = e.resetBtn;
    rb.addEventListener('pointerdown', (ev) => { ev.preventDefault(); this.startResetHold(); });
    for (const t of ['pointerup', 'pointercancel', 'pointerleave']) rb.addEventListener(t, () => this.cancelResetHold());

    // the hand-held transmitter overlay replaces the old slider panel
    this.ctx.panel.className = 'panel drive-empty';
    this.ctx.panel.replaceChildren();
    this.ctx.overlay.replaceChildren();
    if (this.proving) this.message('Test loop: graded jumps on the front straight, whoops and a table on the back. No wear, no battery drain, nothing recorded.', 6);
    else if (this.racing) { this.showCountdown(); this.message(`${this.event!.name} · ${this.event!.laps} laps · you start at the back`, 2.6); }
    else if (this.mode === 'trial') this.showCountdown();
    else if (!this.ctx.store.data.tutorial.controlsDemoSeen || !this.ctx.store.data.tutorial.practiceDone) {
      this.message('Turn the wheel to steer. Pull down on the trigger to accelerate; push up to brake. Hold it up at a stop to reverse.', 7);
      this.controls.demo();
      this.ctx.store.data.tutorial.controlsDemoSeen = true;
      this.ctx.store.save();
    } else this.message('Practice — no clock pressure. Pause to end the session.', 3);
  }

  private setupMinimap(canvas: HTMLCanvasElement) {
    const T = this.world.track;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const s of T.samples) { minX = Math.min(minX, s.x); maxX = Math.max(maxX, s.x); minZ = Math.min(minZ, s.z); maxZ = Math.max(maxZ, s.z); }
    const pad = 8;
    const scale = Math.min((canvas.width - pad * 2) / (maxX - minX), (canvas.height - pad * 2) / (maxZ - minZ));
    const ox = pad - minX * scale + ((canvas.width - pad * 2) - (maxX - minX) * scale) / 2;
    const oz = pad - minZ * scale + ((canvas.height - pad * 2) - (maxZ - minZ) * scale) / 2;
    const base = document.createElement('canvas'); base.width = canvas.width; base.height = canvas.height;
    const g = base.getContext('2d')!;
    g.fillStyle = 'rgba(20,18,16,0.55)'; g.fillRect(0, 0, base.width, base.height);
    g.strokeStyle = '#c99a62'; g.lineWidth = T.halfWidth * 2 * scale; g.lineJoin = 'round';
    g.beginPath();
    T.samples.forEach((s, i) => (i ? g.lineTo(s.x * scale + ox, s.z * scale + oz) : g.moveTo(s.x * scale + ox, s.z * scale + oz)));
    g.closePath(); g.stroke();
    const sp = T.sampleAt(T.startS);
    g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath();
    g.moveTo((sp.x - sp.nx * 2) * scale + ox, (sp.z - sp.nz * 2) * scale + oz);
    g.lineTo((sp.x + sp.nx * 2) * scale + ox, (sp.z + sp.nz * 2) * scale + oz); g.stroke();
    // the stand
    g.fillStyle = '#7a5532'; g.fillRect(STAND.x * scale + ox - 9, (STAND.z - 1.2) * scale + oz, 18, 3);
    this.minimap = { canvas, base, scale, ox, oz };
  }

  private drawMinimap() {
    const m = this.minimap;
    if (!m || m.canvas.style.display === 'none') return;
    const g = m.canvas.getContext('2d')!;
    g.clearRect(0, 0, m.canvas.width, m.canvas.height);
    g.drawImage(m.base, 0, 0);
    if (this.session.nextGateIndex >= 0 || this.session.lap > 0) {
      const p = this.world.track.sampleAt(this.session.nextTargetS());
      g.fillStyle = '#ffd43b';
      g.beginPath(); g.arc(p.x * m.scale + m.ox, p.z * m.scale + m.oz, 2.5, 0, Math.PI * 2); g.fill();
    }
    this.racers.forEach((r, i) => {
      g.fillStyle = `#${this.rivalColors[i].toString(16).padStart(6, '0')}`;
      g.beginPath(); g.arc(r.sim.x * m.scale + m.ox, r.sim.z * m.scale + m.oz, 2.8, 0, Math.PI * 2); g.fill();
    });
    const x = this.sim.x * m.scale + m.ox, z = this.sim.z * m.scale + m.oz;
    g.fillStyle = '#ff3b30'; g.strokeStyle = '#fff'; g.lineWidth = 1.5;
    g.beginPath(); g.arc(x, z, 3.6, 0, Math.PI * 2); g.fill(); g.stroke();
  }

  private msgTimer = 0;
  private message(text: string, seconds = 2.2) {
    this.els.message.textContent = text;
    this.els.message.classList.toggle('show', !!text);
    this.msgTimer = seconds;
  }

  private showCountdown() {
    const lights = h('div', { class: 'countdown' }, h('i', {}), h('i', {}), h('i', {}), h('b', {}, ''));
    this.ctx.overlay.replaceChildren(lights);
    this.els.countdown = lights;
  }

  private updateCountdown() {
    const c = this.els.countdown;
    if (!c) return;
    const n = this.session.countdown;
    const lit = n > 2 ? 1 : n > 1 ? 2 : n > 0 ? 3 : 0;
    c.querySelectorAll('i').forEach((el, i) => el.classList.toggle('on', i < lit));
    (c.querySelector('b') as HTMLElement).textContent = n > 0 ? String(Math.ceil(n)) : 'GO!';
    if (n <= 0) {
      c.classList.add('go');
      setTimeout(() => c.remove(), 700);
      delete this.els.countdown;
    }
  }

  // ---------------- pause / reset
  pause() {
    if (this.paused || this.resultShown) return;
    this.paused = true;
    this.ctx.input.clear();
    this.cancelResetHold();
    this.flushWear();
    this.ctx.store.save();
    const restartLabel = this.racing ? 'Restart race' : this.mode === 'trial' ? 'Restart trial' : 'Restart practice';
    this.ctx.overlay.replaceChildren(
      h('div', { class: 'sheet-overlay' },
        h('div', { class: 'modal-card scroll-ok' },
          h('h2', {}, 'Paused'),
          h('p', { class: 'muted' }, 'Timer, battery and wear are frozen.'),
          h('div', { class: 'stack' },
            h('button', { class: 'btn primary', onclick: () => this.resume() }, 'Resume'),
            h('button', { class: 'btn', onclick: () => { this.ctx.overlay.replaceChildren(); this.ctx.go(this.proving ? 'proving' : 'drive', { mode: this.mode, event: this.event?.id }); } }, this.proving ? 'Restart test loop' : restartLabel),
            h('button', {
              class: 'btn', onclick: () => {
                this.ctx.store.data.settings.showMap = !this.ctx.store.data.settings.showMap;
                this.ctx.store.save();
                if (this.minimap) this.minimap.canvas.style.display = this.ctx.store.data.settings.showMap ? '' : 'none';
                this.resume();
              },
            }, this.ctx.store.data.settings.showMap ? 'Hide map' : 'Show map'),
            h('button', { class: 'btn', onclick: () => { this.resume(); this.controls.demo(); this.message('Turn the wheel to steer. Pull down on the trigger to accelerate; push up to brake.', 5); } }, 'Show control demo'),
            h('button', { class: 'btn ghost', onclick: () => this.endToPit() }, this.proving ? 'Back to the sandbox' : this.racing ? 'Retire from the race → pit' : this.mode === 'trial' ? 'Abandon run → pit' : 'End session → pit'),
          ),
        ),
      ),
    );
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    this.ctx.input.clear();
    this.ctx.overlay.replaceChildren();
    if (this.session.phase === 'countdown') this.showCountdown();
  }

  private endToPit() {
    if (this.proving) { this.ctx.go('garage', { view: 'sandbox' }); return; }
    if (this.mode === 'practice' && this.session.laps.length > 0) this.recordResult(false);
    this.ctx.go('pit');
  }

  private startResetHold() {
    if (this.paused) return;
    this.cancelResetHold();
    this.els.resetBtn.classList.add('holding');
    this.resetHold = window.setTimeout(() => { this.resetHold = null; this.els.resetBtn.classList.remove('holding'); this.doReset(); }, 600);
  }

  private cancelResetHold() {
    if (this.resetHold != null) window.clearTimeout(this.resetHold);
    this.resetHold = null;
    this.els.resetBtn?.classList.remove('holding');
  }

  doReset() {
    if (this.paused || this.session.phase !== 'running') return;
    const s = this.sim.pickSafePoint();
    this.prog += this.world.track.deltaS(this.sim.s, s);
    this.sim.placeAt(s, 0);
    this.session.onReset(s);
    this.stuckTimer = 0;
    this.recenter();
    if (this.timed) this.message(`Reset · +${ECONOMY.resetPenalty.toFixed(1)} s penalty`, 1.6);
    else this.message('Reset to the track', 1.2);
  }

  recenter() {
    this.look.set(this.sim.x, this.sim.y, this.sim.z);
  }

  // ---------------- loop
  update(dt: number) {
    const input = this.ctx.input;
    if (!this.paused) {
      this.controls.feed(dt);
      input.update(dt);
      this.session.update(dt);
      for (const r of this.racers) r.tick(dt);
      if (this.session.phase === 'countdown') this.updateCountdown();
      else if (this.els.countdown) this.updateCountdown();

      this.handlingTimer -= dt;
      if (this.handlingTimer <= 0) { this.handling = computeHandling(this.ctx.store.data); this.handlingTimer = 0.25; }

      const locked = this.session.controlsLocked || this.session.phase === 'finished';
      const drive = locked ? { steer: 0, throttle: this.session.phase === 'finished' ? -0.2 : 0 } : { steer: input.steer, throttle: input.throttle };
      this.acc += dt;
      let steps = 0;
      while (this.acc >= STEP && steps < 8) {
        const prevS = this.sim.s;
        this.sim.step(STEP, drive, this.handling);
        if (!locked) this.session.onMove(prevS, this.sim.ds);
        if (this.racers.length) this.stepRacers(STEP, locked);
        this.acc -= STEP;
        steps++;
      }
      if (steps === 8) this.acc = 0;

      if (this.session.phase !== 'countdown') {
        const st = this.sim.takeStats();
        this.wearAcc.distance += st.distance; this.wearAcc.slipDistance += st.slipDistance;
        this.wearAcc.throttleEnergy += st.throttleEnergy; this.wearAcc.dt += dt;
        if (this.wearAcc.dt > 0.5 && !this.proving) this.flushWear();
        if (this.proving) this.wearAcc = { distance: 0, slipDistance: 0, throttleEnergy: 0, dt: 0 };
      } else this.sim.takeStats();

      for (const ev of this.sim.events) {
        if (ev.type === 'flip') { this.message('Flipped! Hold RESET (or press R)', 4); continue; }
        if (this.proving) { if (ev.type === 'landing' || ev.type === 'barrier') { this.lastImpact = ev.impact; if (ev.damage > 0) this.message(`Hit ${ev.impact.toFixed(1)} m/s · would cost ${ev.damage.toFixed(1)}% wear`, 1.6); } continue; }
        const msg = this.ctx.service.applyEvent(ev);
        if (msg) toast(msg, 'warn', 1600);
      }
      this.sim.events.length = 0;
      this.handleSessionEvents();
      this.watchStuck(dt);
    }

    this.controls.pose(dt, this.paused ? 0 : input.steer, this.paused ? 0 : input.throttle, this.sim.reversing);
    this.world.poseCar(this.sim);
    this.racers.forEach((r, i) => this.world.poseRival(i, r.sim));
    if (this.finishTimer > 0 && !this.paused) { this.finishTimer -= dt; if (this.finishTimer <= 0) this.showRaceResult(); }
    this.updateCamera(dt);
    this.updateMarker();
    this.world.placeGuide(this.mode === 'practice' && this.session.phase === 'running' ? this.session.nextTargetS() : null);

    if (this.msgTimer > 0) { this.msgTimer -= dt; if (this.msgTimer <= 0) this.message('', 0); }
    this.hudTimer -= dt;
    if (this.hudTimer <= 0) { this.updateHud(); this.hudTimer = 1 / 20; }
    this.drawMinimap();
  }

  private flushWear() {
    if (this.wearAcc.dt <= 0 || this.proving) { this.wearAcc = { distance: 0, slipDistance: 0, throttleEnergy: 0, dt: 0 }; return; }
    const emptied = this.ctx.service.applyDriving(this.wearAcc, this.wearAcc.dt, this.handling);
    this.wearAcc = { distance: 0, slipDistance: 0, throttleEnergy: 0, dt: 0 };
    const bat = installedBattery(this.ctx.store.data);
    if (emptied) this.message('Battery empty — limp mode. Swap packs at the pit.', 4);
    else if (bat && bat.charge < 15 && !this.batteryWarned) { this.batteryWarned = true; toast('Battery low — power fading', 'warn'); }
  }

  private watchStuck(dt: number) {
    const moving = this.sim.speed > 0.3;
    const trying = Math.abs(this.ctx.input.throttle) > 0.4;
    if (!moving && trying && this.session.phase === 'running' && !this.sim.flipped) this.stuckTimer += dt;
    else this.stuckTimer = 0;
    if (this.stuckTimer > 3.5) { this.message('Stuck? Hold RESET to go back to the track', 3); this.stuckTimer = -4; }
  }

  private handleSessionEvents() {
    const d = this.ctx.store.data;
    for (const ev of this.session.takeEvents()) {
      switch (ev.type) {
        case 'go': if (this.timed) this.message('GO!', 0.9); break;
        case 'lapStart': this.message(this.timed ? 'Lap 1' : 'Lap timer started', 1); break;
        case 'checkpoint': break;
        case 'missed': this.message('Missed a checkpoint — lap not counted', 2.4); break;
        case 'wrongWay': this.message('Wrong way!', 1.2); break;
        case 'penalty': break;
        case 'lap': {
          if (this.proving) { this.message(`Test lap: ${ev.time.toFixed(2)} s`, 2); break; }
          const B = trackBest(d), isBestEver = B.lap == null || ev.time < B.lap;
          if (isBestEver) { B.lap = ev.time; }
          if (this.racing && ev.lap === (this.event!.laps ?? 3) - 1) this.message(`Final lap! You're ${ordinal(this.position())}`, 2);
          else this.message(`Lap ${ev.lap}: ${ev.time.toFixed(2)} s${isBestEver ? ' · best lap!' : ''}`, 2);
          if (this.mode === 'practice' && !d.tutorial.practiceDone) {
            d.tutorial.practiceDone = true;
            toast('Practice lap done — try the 3-lap trial from the pit', 'good', 3000);
          }
          this.ctx.store.save();
          break;
        }
        case 'finish': if (this.racing) this.finishRace(); else this.finishTrial(); break;
      }
    }
  }

  private recordResult(trial: boolean): { credits: number; pb: boolean } {
    const d = this.ctx.store.data;
    let credits = 0, pb = false;
    if (trial) {
      const total = this.session.total;
      const B = trackBest(d), firstHere = B.trial == null;
      pb = B.trial == null || total < B.trial;
      // longer tracks pay a bit more
      credits = Math.round((ECONOMY.trialReward + (pb ? ECONOMY.pbBonus : 0)) * Math.max(1, this.world.track.length / 102));
      if (pb) B.trial = total;
      if (firstHere && d.raceTrack !== 'dunes') {
        const next = RACE_TRACKS[RACE_TRACKS.findIndex((t) => t.id === d.raceTrack) + 1];
        if (next) setTimeout(() => toast(`Unlocked: ${next.name} — pick it in the pit`, 'good', 4500), 2200);
      }
      d.credits += credits;
      if (!d.crawler.unlocked) {
        d.crawler.unlocked = true;
        setTimeout(() => toast(`Unlocked: Cragweld rock crawler — buy it on the garage shelves (${ECONOMY.crawlerPrice} cr)`, 'good', 4500), 1200);
      }
    }
    d.results.unshift({
      mode: trial ? 'trial' : 'practice', total: trial ? this.session.total : null, laps: [...this.session.laps],
      penalties: this.session.penalties, credits, pb, at: Date.now(),
    });
    d.results.length = Math.min(d.results.length, 8);
    void TRACK_ID;
    this.flushWear();
    this.ctx.store.save();
    return { credits, pb };
  }

  private finishTrial() {
    this.resultShown = true;
    this.ctx.input.clear();
    const { credits, pb } = this.recordResult(true);
    const s = this.session;
    this.ctx.overlay.replaceChildren(
      h('div', { class: 'sheet-overlay' },
        h('div', { class: 'modal-card result scroll-ok' },
          h('div', { class: 'eyebrow' }, `${RACE_TRACKS.find((t) => t.id === this.ctx.store.data.raceTrack)?.name ?? ''} · time trial complete`),
          h('div', { class: 'big-time' }, fmtTime(s.total)),
          pb ? h('div', { class: 'tag good' }, 'New personal best!') : h('div', { class: 'muted small' }, `Best: ${fmtTime(trackBest(this.ctx.store.data).trial)}`),
          h('table', { class: 'laps' },
            ...s.laps.map((t, i) => h('tr', {}, h('td', {}, `Lap ${i + 1}`), h('td', {}, `${t.toFixed(2)} s`))),
            s.penalties ? h('tr', { class: 'pen' }, h('td', {}, 'Reset penalties'), h('td', {}, `+${s.penalties.toFixed(1)} s`)) : null,
          ),
          h('div', { class: 'earned' }, `+${credits} credits`),
          h('div', { class: 'row end' },
            h('button', { class: 'btn', onclick: () => this.ctx.go('drive', { mode: 'trial' }) }, 'Run again'),
            h('button', { class: 'btn primary', onclick: () => this.ctx.go('pit') }, 'To the pit'),
          ),
        ),
      ),
    );
  }

  // ---------------- racing against the AI field
  private stepRacers(dt: number, locked: boolean) {
    const all = [this.sim, ...this.racers.map((r) => r.sim)];
    for (const r of this.racers) r.step(dt, all.filter((o) => o !== r.sim));
    if (!locked && this.session.phase === 'running') this.prog += this.sim.ds;
    collideCars(all);
  }

  /** Running order: finishers by time, then everyone else by distance covered. */
  private order(): { name: string; time: number | null; prog: number; you: boolean }[] {
    const you = { name: 'You', time: this.session.phase === 'finished' ? this.session.total : null, prog: this.prog, you: true };
    const list = [you, ...this.racers.map((r, i) => ({ name: this.rivalNames[i], time: r.finishTime, prog: r.prog, you: false }))];
    return list.sort((a, b) => (a.time != null && b.time != null ? a.time - b.time : a.time != null ? -1 : b.time != null ? 1 : b.prog - a.prog));
  }

  private position() { return this.order().findIndex((o) => o.you) + 1; }

  private gapText() {
    const o = this.order(), i = o.findIndex((x) => x.you);
    if (this.session.phase !== 'running' || this.session.lap === 0) return '';
    if (i === 0) { const b = o[1]; return b ? `Leading by ${Math.max(0, this.prog - b.prog).toFixed(1)} m` : 'Leading'; }
    return `${o[i - 1].name} ${Math.max(0, o[i - 1].prog - this.prog).toFixed(1)} m ahead`;
  }

  private finishRace() {
    this.resultShown = true; // no pause menu now
    this.ctx.input.clear();
    this.message(`Finished ${ordinal(this.position())}!`, 2.5);
    this.finishTimer = 2.2;
  }

  private showRaceResult() {
    const d = this.ctx.store.data, ev = this.event!, T = this.world.track;
    // rivals still out on track: project their finish from their average pace
    const total = (ev.laps ?? 3) * T.length + 1.4;
    const rows = this.order().map((o) => {
      if (o.time != null || o.you) return { ...o, est: false };
      const r = this.racers[this.rivalNames.indexOf(o.name)];
      const pace = Math.max(1, r.prog / Math.max(1, r.session.time));
      return { ...o, time: r.session.total + Math.max(0, total - r.prog) / pace, est: true };
    }).sort((a, b) => a.time! - b.time!);
    const pos = rows.findIndex((r) => r.you) + 1;
    const before = Object.values(d.events).filter((e) => e.wins > 0).length;
    const prize = settleEvent(d, ev, pos);
    const after = Object.values(d.events).filter((e) => e.wins > 0).length;
    if (before < 3 && after >= 3) setTimeout(() => toast('Unlocked: the Brackenbank Championship Final — see the Events board', 'good', 5000), 1500);
    this.flushWear();
    this.ctx.store.save();
    const rec = eventRecord(d, ev.id);
    this.ctx.overlay.replaceChildren(
      h('div', { class: 'sheet-overlay' },
        h('div', { class: 'modal-card result scroll-ok' },
          h('div', { class: 'eyebrow' }, `${ev.name} · ${ev.venueName}`),
          h('div', { class: 'big-time' }, ordinal(pos)),
          pos === 1 ? h('div', { class: 'tag good' }, rec.wins === 1 ? 'First win here!' : 'Winner!') : h('div', { class: 'muted small' }, `Best finish here: ${ordinal(rec.best ?? pos)}`),
          h('table', { class: 'laps' },
            ...rows.map((r, i) => h('tr', { class: r.you ? 'you' : '' },
              h('td', {}, `${i + 1}. ${r.name}`),
              h('td', {}, `${fmtTime(r.time!)}${r.est ? ' *' : ''}`))),
          ),
          rows.some((r) => r.est) ? h('div', { class: 'muted small' }, '* still on track: projected from their pace') : null,
          h('div', { class: 'earned' }, prize ? `+${prize} credits prize money` : 'No prize this time: top three get paid'),
          h('div', { class: 'row end' },
            h('button', { class: 'btn', onclick: () => this.ctx.go('drive', { mode: 'race', event: ev.id }) }, 'Race again'),
            h('button', { class: 'btn primary', onclick: () => this.ctx.go('pit') }, 'To the pit'),
          ),
        ),
      ),
    );
  }

  private updateHud() {
    const e = this.els;
    const s = this.session;
    const d = this.ctx.store.data;
    if (this.racing) e.pos.textContent = `${this.position()}/${this.racers.length + 1}`;
    if (this.timed) e.lap.textContent = `${Math.min(Math.max(s.lap, 1), s.totalLaps)}/${s.totalLaps}`;
    else e.lap.textContent = s.lap > 0 ? String(s.lap) : '–';
    e.time.textContent = this.timed
      ? fmtTime(s.phase === 'countdown' ? 0 : s.total)
      : fmtTime(s.currentLapTime);
    const bat = installedBattery(d);
    const charge = bat?.charge ?? 0;
    e.batBar.style.width = `${charge}%`;
    (e.batBar.parentElement as HTMLElement).className = `bar mini ${charge > 60 ? 'ok' : charge > 25 ? 'mid' : 'low'}`;
    e.batTxt.textContent = `${Math.round(charge)}%`;
    const lastLap = s.laps[s.laps.length - 1];
    e.split.textContent = this.timed
      ? (s.lap > 0 ? `Lap ${fmtTime(s.currentLapTime)}${lastLap ? ` · last ${lastLap.toFixed(2)}` : ''}${s.penalties ? ` · +${s.penalties}s` : ''}` : 'Cross the line to start lap 1')
      : (lastLap ? `Last ${lastLap.toFixed(2)} s` : '');
    { const B = trackBest(d); e.best.textContent = this.racing ? this.gapText() : this.mode === 'trial' ? `PB ${B.trial ? B.trial.toFixed(2) : '--'}` : `Best lap ${B.lap ? B.lap.toFixed(2) : '--'}`; }
    if (this.proving) {
      const sm = this.sim, c = THREE.MathUtils.clamp(sm.compression / 0.05, 0, 1);
      this.tele.update({
        speed: sm.forwardSpeed, scale: sm.spec.scale === '1/10' ? 10 : 8, throttle: this.ctx.input.throttle, steer: this.ctx.input.steer, steerDeg: THREE.MathUtils.radToDeg(sm.steerAngle),
        susp: [c, c, c, c], grounded: [sm.grounded, sm.grounded, sm.grounded, sm.grounded],
        pitch: THREE.MathUtils.radToDeg(sm.pitch), roll: THREE.MathUtils.radToDeg(sm.roll), air: sm.airTime,
        extra: `Last impact ${this.lastImpact.toFixed(1)} m/s · no wear in the test loop`,
      });
      e.best.textContent = this.camMode === 'stand' ? 'Stand view' : this.camMode === 'chase' ? 'Chase view' : 'Trackside view';
    }
  }

  private updateCamera(dt: number) {
    const cam = this.camera;
    const sim = this.sim;
    if (this.proving && this.camMode !== 'stand') { this.followCamera(dt); return; }
    cam.position.copy(STAND_EYE); // fixed on the platform
    // lead slightly in the direction of travel so the car isn't always at the edge of frame
    this.tmp.set(sim.x + sim.vx * 0.18, sim.y + 0.05, sim.z + sim.vz * 0.18);
    const k = 1 - Math.exp(-dt * 7);
    this.look.lerp(this.tmp, k);
    cam.lookAt(this.look);
    // modest zoom with distance so a 0.5 m buggy stays readable across the course
    const dist = STAND_EYE.distanceTo(this.look);
    // the track area is the stage above the transmitter; frame the buggy in the middle of it
    const trackH = Math.max(1, this.H - this.controls.bandH);
    const aspectTrack = this.W / trackH;
    const portraitBoost = aspectTrack < 0.8 ? 1 + (0.8 - aspectTrack) * 0.5 : 1;
    const target = THREE.MathUtils.clamp(THREE.MathUtils.mapLinear(dist, 6, 28, 58, 24), 22, 62) * portraitBoost;
    this.trackFov += (target - this.trackFov) * (1 - Math.exp(-dt * 3));
    const hudTop = 70;
    const cy = Math.min(this.H / 2, (hudTop + trackH) / 2);
    this.fullH = 2 * (this.H - cy);
    const fovFull = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(this.trackFov) / 2) * this.fullH / trackH));
    cam.fov = fovFull;
    cam.aspect = this.W / this.fullH;
    cam.setViewOffset(this.W, this.fullH, 0, this.fullH - this.H, this.W, this.H);
    cam.updateProjectionMatrix();
    this.world.focusShadows(this.look);
  }

  /** Proving-loop chase / trackside cameras (stand view is the normal one). */
  private followCamera(dt: number) {
    const cam = this.camera, sim = this.sim;
    const fx = Math.cos(sim.heading), fz = Math.sin(sim.heading);
    const side = sim.d > 0 ? -1 : 1; // stay on the track side of the car, away from the barrier
    const want = this.camMode === 'chase'
      ? this.tmp.set(sim.x - fx * 1.05, sim.y + 0.42, sim.z - fz * 1.05)
      : this.tmp.set(sim.x - fz * 1.25 * side + fx * 0.3, sim.y + 0.34, sim.z + fx * 1.25 * side + fz * 0.3);
    if (cam.position.distanceTo(want) > 8) cam.position.copy(want); else cam.position.lerp(want, 1 - Math.exp(-dt * 12));
    this.look.lerp(new THREE.Vector3(sim.x, sim.y + 0.08, sim.z), 1 - Math.exp(-dt * 10));
    cam.lookAt(this.look);
    const trackH = Math.max(1, this.H - this.controls.bandH);
    const cy = Math.min(this.H / 2, (70 + trackH) / 2);
    this.fullH = 2 * (this.H - cy);
    cam.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(42) / 2) * this.fullH / trackH));
    cam.aspect = this.W / this.fullH;
    cam.setViewOffset(this.W, this.fullH, 0, this.fullH - this.H, this.W, this.H);
    cam.updateProjectionMatrix();
    this.world.focusShadows(this.look);
  }

  private updateMarker() {
    const m = this.world.marker;
    m.visible = !(this.proving && this.camMode !== 'stand');
    const sim = this.sim;
    const dist = STAND_EYE.distanceTo(this.tmp.set(sim.x, sim.y, sim.z));
    // constant-ish screen size; fades in when the car gets far away
    const worldPerPx = (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2) * dist) / Math.max(200, this.fullH);
    m.scale.setScalar(worldPerPx * 30);
    m.position.set(sim.x, sim.y + 0.3 + worldPerPx * 12, sim.z);
    (m.material as THREE.SpriteMaterial).opacity = Math.max(this.racing ? 0.75 : 0, THREE.MathUtils.clamp((dist - 9) / 8, 0, 0.95));
  }

  resize(w: number, hgt: number) {
    this.W = Math.max(1, w); this.H = Math.max(1, hgt);

    this.controls.layout(this.W, this.H);
    this.ctx.stage.style.setProperty('--band', `${this.controls.bandH}px`);
  }
}
