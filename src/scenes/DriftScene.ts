// Drift practice at Kanjo Hall. Free practice: no timer, no pay. Feedback only: live drift angle gauge,
// current drift (time + angle), session bests, practice lap times, and a nod when you clip a CP or run
// your tail through an outer zone while sideways. The gyro gain is adjustable on the fly.
import * as THREE from 'three';
import { DriftSim, DRIFT_SPEC } from '../sim/DriftSim';
import { driftSpecFor } from '../sim/driftUpgrades';
import { driftVenueName } from '../sim/DriftTrack';
import { fmtTime, h } from '../ui/dom';
import { Telemetry } from '../ui/Telemetry';
import { TransmitterControls } from '../ui/TransmitterControls';
import { AppContext, Screen } from './common';
import { DriftWorld } from './DriftWorld';
import { EventDef, EVENTS, RIVALS, eventById, eventRecord, judgedPosition, ordinal, settleEvent } from '../data/events';

/** Judged event runs: laps scored, points per drift (seconds × average angle × 3), zone/CP bonus. */
const JUDGED_LAPS = 2;
const ZONE_PTS = 100;

const STEP = 1 / 120;
const S = DRIFT_SPEC;
const GYRO_STEPS = [0.4, 0.6, 0.8, 1.0];
/** A slide counts as a drift above this angle (deg) and above walking pace. */
const DRIFT_MIN = 12;

export class DriftScene implements Screen {
  camera = new THREE.PerspectiveCamera(45, 1, 0.05, 120);
  sim: DriftSim;
  controls: TransmitterControls;
  paused = false;
  time = 0;
  private acc = 0;
  private W = 1; private H = 1;
  private look = new THREE.Vector3();
  private fov = 30;
  private camMode: 'stand' | 'chase' = 'stand';
  private camPos = new THREE.Vector3();
  private els: Record<string, HTMLElement> = {};
  private msgTimer = 0; private hudTimer = 0;
  private resetHold: number | null = null;
  private tele = new Telemetry();
  // drift tracking
  private drift = { t: 0, peak: 0, sum: 0, dist: 0, wall: false };
  private event: EventDef | null = null;
  private judge = { score: 0, laps: 0, done: false, drifts: 0, zones: 0, best: 0 };
  private get judging() { return !!this.event && this.lap.start >= 0 && !this.judge.done; }
  private best = { t: 0, peak: 0 };
  private zoneHit = new Set<string>();
  private lap = { start: -1, last: null as number | null, best: null as number | null, prevS: 0, run: 0 };
  private hazeAcc = 0;
  private wallMsg = 0;
  private stuckT = 0;

  constructor(private ctx: AppContext, private world: DriftWorld) {
    this.sim = new DriftSim(world.track);
    this.controls = new TransmitterControls(ctx.input, () => ctx.store.data.settings);
  }

  get scene() { return this.world.scene; }
  overlay() { return { scene: this.controls.scene, camera: this.controls.camera, height: this.controls.bandH }; }

  enter(opts?: Record<string, unknown>) {
    const d = this.ctx.store.data;
    this.event = eventById(String(opts?.event ?? '')) ?? null;
    if (this.event && (this.event.vehicle !== 'drift' || this.event.venue !== this.world.track.layout)) this.event = null;
    this.judge = { score: 0, laps: 0, done: false, drifts: 0, zones: 0, best: 0 };
    this.world.setKit(d.drift.fitted);
    this.sim = new DriftSim(this.world.track, driftSpecFor(d.drift.fitted)); // with the fitted hop-ups
    // judged runs roll up to the line so the clock starts on it
    this.sim.placeAt(this.world.track.start.s + (this.event ? -1.6 : 0.6), 0);
    this.sim.gyro = d.drift.gyro;
    this.paused = false; this.time = 0; this.acc = 0;
    this.drift = { t: 0, peak: 0, sum: 0, dist: 0, wall: false }; this.best = { t: 0, peak: 0 };
    this.lap = { start: -1, last: null, best: null, prevS: this.sim.s, run: 0 };
    this.zoneHit.clear();
    this.world.marks.clear(); this.world.haze.clear();
    this.world.car.pose(this.sim);
    this.look.set(this.sim.x, 0.05, this.sim.z);
    this.camMode = 'stand'; this.tele.reset(); this.tele.el.classList.add('hide');
    this.controls.mount(this.ctx.stage);
    this.controls.layout(this.W, this.H);
    this.buildUI();
    this.ctx.input.enabled = true; this.ctx.input.clear();
    this.ctx.input.onPause = () => (this.paused ? this.resume() : this.pause());
    this.ctx.input.onResetKey = () => this.doReset();
    d.drift.sessions++;
    this.ctx.store.save();
    if (this.event) { this.message(`${this.event.name}: cross the line to start the judged run — ${JUDGED_LAPS} laps. Points for every drift (time × angle), +${ZONE_PTS} for each CP and zone. Wall taps halve a drift. Beat ${this.event.rivalMarks![0]} to win.`, 7); return; }
    this.message(`${driftVenueName(this.world.track.layout)} practice. Throttle kicks the tail out, the gyro catches it; steer to hold your line. Clip the orange CP posts and run your tail through the yellow outer zones.`, 6);
  }

  exit() {
    this.ctx.input.enabled = false; this.ctx.input.clear();
    this.controls.unmount();
    this.ctx.stage.style.removeProperty('--band');
    this.camera.clearViewOffset();
    this.ctx.input.onPause = null; this.ctx.input.onResetKey = null;
    this.cancelResetHold();
    this.saveBests();
    this.ctx.store.save();
  }

  private saveBests() {
    const b = this.ctx.store.data.drift;
    b.bestDrift = Math.max(b.bestDrift, Math.round(this.best.t * 10) / 10);
    b.bestAngle = Math.max(b.bestAngle, Math.round(this.best.peak));
    if (this.lap.best != null && (b.bestLap == null || this.lap.best < b.bestLap)) b.bestLap = this.lap.best;
  }

  // ---------------------------------------------------------------- UI
  private buildUI() {
    const e = this.els = {} as Record<string, HTMLElement>;
    const cell = (label: string, id: string) => h('div', { class: 'hud-cell' }, h('small', {}, label), (e[id] = h('b', { id }, '')));
    e.batBar = h('i', {});
    const top = h('div', { class: 'hud-top' },
      cell('ANGLE', 'ang'), cell('SPEED', 'spd'),
      h('div', { class: 'hud-cell bat' }, h('small', {}, 'BATT'), h('div', { class: 'bar mini' }, e.batBar), (e.batTxt = h('b', {}, ''))),
      h('button', { class: 'icon-btn pause', 'aria-label': 'Pause', onclick: () => this.pause() }, '❚❚'),
    );
    e.sub1 = h('span', {}, ''); e.sub2 = h('span', {}, '');
    // drift gauge: a half-dial with a needle for the body slip angle
    e.needle = h('i', { class: 'dg-needle' });
    e.gaugeFill = h('i', { class: 'dg-fill' });
    const gauge = h('div', { class: 'drift-gauge', 'aria-hidden': 'true' }, h('i', { class: 'dg-arc' }), e.gaugeFill, e.needle, (e.gaugeTxt = h('b', {}, '0°')));
    e.resetBtn = h('button', { class: 'tool-btn reset' }, h('span', { class: 'fill' }), h('span', { class: 'lbl' }, 'Hold\nRESET'));
    e.gyroBtn = h('button', { class: 'tool-btn', 'data-gyro': '', onclick: () => this.cycleGyro() }, '');
    e.camBtn = h('button', { class: 'tool-btn', 'data-cam': '', onclick: () => { this.camMode = this.camMode === 'stand' ? 'chase' : 'stand'; this.syncTools(); } }, '');
    const dataBtn = h('button', { class: 'tool-btn', onclick: () => this.tele.el.classList.toggle('hide') }, 'Data');
    const tools = h('div', { class: 'hud-tools' }, e.resetBtn, e.gyroBtn, e.camBtn, dataBtn);
    e.message = h('div', { class: 'hud-message' }, '');
    e.trick = h('div', { class: 'trick-pop' }, '');
    this.ctx.hud.replaceChildren(top, h('div', { class: 'hud-sub' }, e.sub1, e.sub2), gauge, tools, e.message, e.trick, this.tele.el);
    const rb = e.resetBtn;
    rb.addEventListener('pointerdown', (ev) => { ev.preventDefault(); this.startResetHold(); });
    for (const t of ['pointerup', 'pointercancel', 'pointerleave']) rb.addEventListener(t, () => this.cancelResetHold());
    this.ctx.panel.className = 'panel drive-empty'; this.ctx.panel.replaceChildren();
    this.ctx.overlay.replaceChildren();
    this.syncTools();
  }

  private syncTools() {
    this.els.gyroBtn.textContent = `Gyro\n${Math.round(this.sim.gyro * 100)}%`;
    this.els.camBtn.textContent = this.camMode === 'stand' ? 'Cam\nstand' : 'Cam\nchase';
  }

  private cycleGyro() {
    const i = GYRO_STEPS.findIndex((g) => g >= this.sim.gyro - 0.01);
    this.setGyro(GYRO_STEPS[(i + 1) % GYRO_STEPS.length]);
  }

  private setGyro(g: number) {
    this.sim.gyro = THREE.MathUtils.clamp(g, 0, 1);
    this.ctx.store.data.drift.gyro = this.sim.gyro;
    this.ctx.store.save();
    this.syncTools();
    this.message(`Gyro gain ${Math.round(this.sim.gyro * 100)}%${this.sim.gyro >= 0.95 ? ' · max assist' : this.sim.gyro <= 0.45 ? ' · you do the counter-steer' : ''}`, 1.4);
  }

  private message(text: string, seconds = 2.2) {
    this.els.message.textContent = text; this.els.message.classList.toggle('show', !!text); this.msgTimer = seconds;
  }

  private pop(lines: [string, string][]) {
    const el = this.els.trick;
    el.replaceChildren(...lines.map(([a, b]) => h('div', {}, h('b', {}, a), h('span', {}, b ? ` ${b}` : ''))));
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  }

  // ---------------------------------------------------------------- pause / reset
  pause() {
    if (this.paused) return;
    this.paused = true; this.ctx.input.clear(); this.cancelResetHold();
    const d = this.ctx.store.data.drift;
    const out = h('b', {}, `${Math.round(this.sim.gyro * 100)}%`);
    this.ctx.overlay.replaceChildren(h('div', { class: 'sheet-overlay' }, h('div', { class: 'modal-card scroll-ok' },
      h('h2', {}, 'Paused'), h('p', { class: 'muted' }, `${driftVenueName(this.world.track.layout)} · free practice · nothing is timed for pay.`),
      h('label', { class: 'field', for: 'gyro-gain' }, h('span', {}, 'Steering gyro gain', out),
        h('input', { id: 'gyro-gain', type: 'range', min: 0, max: 1, step: 0.05, value: this.sim.gyro,
          oninput: (ev: Event) => { const v = Number((ev.target as HTMLInputElement).value); this.sim.gyro = v; out.textContent = `${Math.round(v * 100)}%`; },
          onchange: () => { d.gyro = this.sim.gyro; this.ctx.store.save(); this.syncTools(); } })),
      h('div', { class: 'muted small' }, 'Higher gain catches slides for you; lower gain needs your own counter-steer (more angle, more spins).'),
      h('table', { class: 'laps' },
        h('tr', {}, h('td', {}, 'Longest drift (session)'), h('td', {}, `${this.best.t.toFixed(1)} s`)),
        h('tr', {}, h('td', {}, 'Biggest angle (session)'), h('td', {}, `${Math.round(this.best.peak)}°`)),
        h('tr', {}, h('td', {}, 'Best practice lap'), h('td', {}, this.lap.best != null ? fmtTime(this.lap.best) : '--')),
        h('tr', {}, h('td', {}, 'All-time longest / angle'), h('td', {}, `${Math.max(d.bestDrift, this.best.t).toFixed(1)} s · ${Math.max(d.bestAngle, Math.round(this.best.peak))}°`))),
      h('div', { class: 'stack' },
        h('button', { class: 'btn primary', onclick: () => this.resume() }, 'Resume'),
        this.event ? h('button', { class: 'btn', onclick: () => { this.ctx.overlay.replaceChildren(); this.ctx.go('drift', { event: this.event!.id }); } }, 'Restart judged run')
          : h('button', { class: 'btn', onclick: () => { this.ctx.overlay.replaceChildren(); this.paused = false; this.doReset(true); } }, 'Back to the start line'),
        h('button', { class: 'btn ghost', onclick: () => this.ctx.go('garage', { view: 'storage' }) }, 'Back to the garage')))));
  }
  resume() {
    if (!this.paused) return;
    this.paused = false; this.ctx.input.clear();
    this.ctx.overlay.replaceChildren();
  }
  private startResetHold() {
    if (this.paused) return; this.cancelResetHold();
    this.els.resetBtn.classList.add('holding');
    this.resetHold = window.setTimeout(() => { this.resetHold = null; this.els.resetBtn.classList.remove('holding'); this.doReset(); }, 600);
  }
  private cancelResetHold() { if (this.resetHold != null) window.clearTimeout(this.resetHold); this.resetHold = null; this.els.resetBtn?.classList.remove('holding'); }

  /** Straighten the car up on the lane where it is (or back at the start line). */
  doReset(toStart = false) {
    if (this.paused) return;
    const T = this.world.track;
    const s = toStart ? T.start.s + 0.6 : this.sim.s;
    const d = toStart ? 0 : THREE.MathUtils.clamp(this.sim.d, -0.6, 0.6);
    this.sim.placeAt(s, d);
    this.world.marks.lift(0); this.world.marks.lift(1);
    this.endDrift();
    if (toStart) this.lap = { start: -1, last: this.lap.last, best: this.lap.best, prevS: this.sim.s, run: 0 };
    this.message(toStart ? 'Back on the start line' : 'Straightened up', 1.2);
  }

  // ---------------------------------------------------------------- loop
  update(dt: number) {
    const input = this.ctx.input, d = this.ctx.store.data;
    if (!this.paused) {
      this.controls.feed(dt);
      input.update(dt);
      const limp = d.drift.charge <= 0 ? 0.35 : 1;
      const drive = { steer: input.steer, throttle: input.throttle * (input.throttle > 0 ? limp : 1) };
      this.acc += dt;
      let steps = 0;
      while (this.acc >= STEP && steps < 10) { this.sim.step(STEP, drive); this.acc -= STEP; steps++; }
      if (steps === 10) this.acc = 0;
      this.time += dt;
      const st = this.sim.takeStats();
      d.drift.charge = Math.max(0, d.drift.charge - (0.035 * dt + 0.5 * st.throttleEnergy));
      this.tickDrift(dt);
      this.tickLap();
      this.effects(dt);
      for (const ev of this.sim.events) if (ev.type === 'wall' && ev.impact > 1.2) {
        if (this.drift.t > 0) this.drift.wall = true;
        if (this.time - this.wallMsg > 1.5) { this.wallMsg = this.time; this.message(ev.inner ? 'Kissed the kerb' : 'Wall tap', 0.9); }
      }
      this.sim.events.length = 0;
      // nose parked in a wall: point at reverse
      const stuck = this.sim.speed < 0.25 && input.throttle > 0.2 && Math.abs(Math.abs(this.sim.d) - this.world.track.sampleAt(this.sim.s).hw) < 0.45;
      this.stuckT = stuck ? this.stuckT + dt : 0;
      if (this.stuckT > 1.5) { this.stuckT = -3; this.message('Nose in the wall: push the trigger up to reverse out, or hold RESET', 2.6); }
    }
    this.controls.pose(dt, this.paused ? 0 : input.steer, this.paused ? 0 : input.throttle, this.sim.reversing);
    this.world.car.pose(this.sim, input.throttle < -0.05 && !this.paused);
    this.world.shadow.position.set(this.sim.x, 0.004, this.sim.z);
    this.world.shadow.rotation.z = -this.sim.psi;
    this.world.haze.update(this.paused ? 0 : dt);
    this.updateCamera(dt);
    if (this.msgTimer > 0) { this.msgTimer -= dt; if (this.msgTimer <= 0) this.message('', 0); }
    this.hudTimer -= dt; if (this.hudTimer <= 0) { this.updateHud(); this.hudTimer = 1 / 15; }
  }

  /** Rubber marks + haze from the rear tyres. */
  private effects(dt: number) {
    const sim = this.sim, c = Math.cos(sim.psi), s = Math.sin(sim.psi);
    const slide = sim.rearSlide, spin = Math.abs(sim.wheelspin);
    const strength = THREE.MathUtils.clamp((slide - 1.1) * 0.6, 0, 1) * Math.min(1, sim.speed / 1.5) + THREE.MathUtils.clamp((spin - 0.6) * 0.5, 0, 0.6);
    for (let i = 0; i < 2; i++) {
      const lx = -S.b, lz = (i ? 1 : -1) * 0.086;
      const x = sim.x + lx * c - lz * s, z = sim.z + lx * s + lz * c;
      if (strength > 0.05) this.world.marks.add(i, x, z, strength); else this.world.marks.lift(i);
      if (strength > 0.35) {
        this.hazeAcc += dt * 26 * strength;
        while (this.hazeAcc > 1) { this.hazeAcc -= 1; this.world.haze.emit(x, z, sim.vx, sim.vz, strength); }
      }
    }
    // keep the haze sprite size right for the current view height
    this.world.haze.setScale(this.H * 0.9 / Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2));
  }

  private tickDrift(dt: number) {
    const ang = Math.abs(this.sim.driftAngle) * 57.3;
    const sliding = ang > DRIFT_MIN && this.sim.speed > 1.2 && this.sim.forwardSpeed > 0;
    if (sliding) {
      this.drift.t += dt; this.drift.peak = Math.max(this.drift.peak, ang); this.drift.sum += ang * dt; this.drift.dist += this.sim.speed * dt;
      this.checkZones(ang);
    } else if (this.drift.t > 0 && (ang < DRIFT_MIN * 0.6 || this.sim.speed < 1.2)) {
      this.endDrift(); // a brief dip in angle between linked corners keeps the drift alive
    }
  }

  private endDrift() {
    const dr = this.drift;
    if (this.judging && dr.t > 0.8) {
      const avg = dr.sum / dr.t, pts = Math.round(dr.t * avg * 3 * (dr.wall ? 0.5 : 1));
      this.judge.score += pts; this.judge.drifts++; this.judge.best = Math.max(this.judge.best, pts);
      this.best.t = Math.max(this.best.t, dr.t); this.best.peak = Math.max(this.best.peak, dr.peak);
      this.pop([[`+${pts}`, `${dr.t.toFixed(1)}s · ${Math.round(avg)}°${dr.wall ? ' · wall ½' : ''}`]]);
    } else if (dr.t > 1.2) {
      const avg = dr.sum / dr.t;
      const pb = dr.t > this.best.t;
      this.best.t = Math.max(this.best.t, dr.t); this.best.peak = Math.max(this.best.peak, dr.peak);
      this.pop([[`DRIFT ${dr.t.toFixed(1)}s`, `· ${Math.round(avg)}° avg`], ...(pb && dr.t > 2 ? [['SESSION BEST', ''] as [string, string]] : [])]);
    }
    this.drift = { t: 0, peak: 0, sum: 0, dist: 0, wall: false };
    this.zoneHit.clear();
  }

  /** CP: the front of the car passes close to the post. OZ: the tail runs near the outer wall in the box. */
  private checkZones(ang: number) {
    if (ang < 18) return;
    const T = this.world.track, sim = this.sim, c = Math.cos(sim.psi), s = Math.sin(sim.psi);
    for (const zn of T.zones) {
      if (this.zoneHit.has(zn.label)) continue;
      const ds = T.deltaS(zn.s, sim.s);
      if (Math.abs(ds) > zn.len / 2 + 0.2) continue;
      const p = T.sampleAt(zn.s);
      if (zn.kind === 'inner') {
        const fx = sim.x + c * 0.2, fz = sim.z + s * 0.2;
        const px = p.x + p.nx * zn.side * p.hw, pz = p.z + p.nz * zn.side * p.hw;
        if (Math.hypot(fx - px, fz - pz) < 0.42) { this.zoneHit.add(zn.label); this.zoneBonus(); this.pop([[`${zn.label} CLIPPED`, this.judging ? `+${ZONE_PTS}` : '']]); }
      } else {
        const rx = sim.x - c * 0.21, rz = sim.z - s * 0.21;
        const q = T.query(rx, rz, sim.idx);
        if (Math.sign(q.d) === zn.side && Math.abs(q.d) > q.hw - 0.5) { this.zoneHit.add(zn.label); this.zoneBonus(); this.pop([[`${zn.label} ✓`, this.judging ? `+${ZONE_PTS}` : 'tail in the zone']]); }
      }
    }
  }

  private zoneBonus() { if (this.judging) { this.judge.score += ZONE_PTS; this.judge.zones++; } }

  private tickLap() {
    const T = this.world.track, s = this.sim.s;
    const ds = T.deltaS(this.lap.prevS, s);
    this.lap.prevS = s;
    this.lap.run += ds;
    // crossing the start line forwards
    const rel = (x: number) => ((x - T.start.s) % T.length + T.length) % T.length;
    const before = rel(s - ds), after = rel(s);
    if (ds > 0 && before > T.length - 2 && after < 2) {
      if (this.lap.start >= 0 && this.lap.run > T.length * 0.85) {
        const lt = this.time - this.lap.start;
        this.lap.last = lt;
        const pb = this.lap.best == null || lt < this.lap.best;
        if (pb) this.lap.best = lt;
        this.message(`Lap ${fmtTime(lt)}${pb ? ' · best this session' : ''}`, 1.6);
        if (this.judging && ++this.judge.laps >= JUDGED_LAPS) { this.endDrift(); this.finishJudged(); return; }
      }
      if (this.event && this.lap.start < 0) this.message('Judged run: GO!', 1.2);
      this.lap.start = this.time; this.lap.run = 0;
    }
  }

  private finishJudged() {
    const d = this.ctx.store.data, ev = this.event!, J = this.judge;
    J.done = true;
    this.ctx.input.clear();
    const pos = judgedPosition(ev, J.score);
    const names = [0, 1, 2].map((k) => RIVALS[(EVENTS.indexOf(ev) * 2 + k) % RIVALS.length].name);
    const all = [{ name: 'You', v: J.score, you: true }, ...ev.rivalMarks!.map((v, i) => ({ name: names[i], v, you: false }))].sort((a, b) => b.v - a.v || (a.you ? -1 : 1));
    const prize = settleEvent(d, ev, pos), rec = eventRecord(d, ev.id);
    this.saveBests();
    this.ctx.store.save();
    window.setTimeout(() => this.ctx.overlay.replaceChildren(h('div', { class: 'sheet-overlay' }, h('div', { class: 'modal-card result scroll-ok' },
      h('div', { class: 'eyebrow' }, `${ev.name} · ${ev.venueName}`),
      h('div', { class: 'big-time' }, `${J.score} pts`),
      pos === 1 ? h('div', { class: 'tag good' }, rec.wins === 1 ? 'First win here!' : 'Winner!') : h('div', { class: 'muted small' }, `${ordinal(pos)} · best finish here ${ordinal(rec.best ?? pos)}`),
      h('div', { class: 'muted small' }, `${J.drifts} scored drifts (best +${J.best}) · ${J.zones} CPs and zones`),
      h('table', { class: 'laps' }, all.map((r, i) => h('tr', { class: r.you ? 'you' : '' }, h('td', {}, `${i + 1}. ${r.name}`), h('td', {}, `${r.v} pts`)))),
      h('div', { class: 'earned' }, prize ? `+${prize} credits prize money` : 'No prize this time: top three get paid'),
      h('div', { class: 'row end' },
        h('button', { class: 'btn', onclick: () => this.ctx.go('drift', { event: ev.id }) }, 'Run again'),
        h('button', { class: 'btn primary', onclick: () => this.ctx.go('garage', { view: 'storage' }) }, 'Back to the garage')),
    ))), 900);
  }

  private updateHud() {
    const e = this.els, d = this.ctx.store.data.drift, sim = this.sim;
    const ang = sim.driftAngle * 57.3, aAbs = Math.abs(ang);
    e.ang.textContent = `${Math.round(aAbs)}°`;
    e.spd.textContent = `${(sim.speed * 3.6).toFixed(0)} km/h`;
    if (this.event) {
      e.sub1.textContent = this.judge.done ? `Final: ${this.judge.score} pts` : this.lap.start < 0 ? 'Roll over the line to start' : `Judged · lap ${Math.min(this.judge.laps + 1, JUDGED_LAPS)}/${JUDGED_LAPS} · ${this.judge.score} pts`;
      e.sub2.textContent = `To win: ${this.event.rivalMarks![0]} pts`;
    } else
    e.sub1.textContent = this.drift.t > 0.3 ? `Drifting ${this.drift.t.toFixed(1)} s · peak ${Math.round(this.drift.peak)}°` : this.lap.last != null ? `Last lap ${fmtTime(this.lap.last)}` : 'Practice · no clock';
    if (!this.event) e.sub2.textContent = `Best ${Math.max(this.best.t, 0).toFixed(1)} s · ${Math.round(this.best.peak)}°${this.lap.best != null ? ` · lap ${fmtTime(this.lap.best)}` : ''}`;
    const clamped = THREE.MathUtils.clamp(ang, -70, 70);
    e.needle.style.transform = `rotate(${clamped * 1.2857}deg)`;
    e.gaugeTxt.textContent = `${Math.round(aAbs)}°`;
    e.gaugeFill.style.opacity = String(THREE.MathUtils.clamp((aAbs - DRIFT_MIN) / 20, 0, 1));
    const c = d.charge;
    e.batBar.style.width = `${c}%`;
    (e.batBar.parentElement as HTMLElement).className = `bar mini ${c > 60 ? 'ok' : c > 25 ? 'mid' : 'low'}`;
    e.batTxt.textContent = `${Math.round(c)}%`;
    if (!this.tele.el.classList.contains('hide')) {
      this.tele.update({
        speed: sim.forwardSpeed, scale: 10, throttle: this.ctx.input.throttle, steer: this.ctx.input.steer, steerDeg: sim.steer * 57.3,
        susp: [0.5, 0.5, 0.5, 0.5], grounded: [true, true, true, true], pitch: sim.bodyPitch * 57.3, roll: sim.bodyRoll * 57.3,
        extra: `Slip ${Math.round(ang)}° · rear spin ${(sim.wheelspin * 100).toFixed(0)}% · rear tyres ${(Math.min(sim.rearSlide, 9.9)).toFixed(1)}× peak · gyro ${Math.round(sim.gyro * 100)}%`,
      });
    }
  }

  // ---------------------------------------------------------------- camera
  private updateCamera(dt: number) {
    const cam = this.camera, sim = this.sim, W = this.world;
    const car = new THREE.Vector3(sim.x, 0.05, sim.z);
    const trackH = Math.max(1, this.H - this.controls.bandH);
    const cy = Math.min(this.H / 2, (70 + trackH) / 2), fullH = 2 * (this.H - cy);
    let fovTrack: number;
    if (this.camMode === 'stand') {
      cam.position.copy(W.eye);
      const lead = new THREE.Vector3(sim.vx * 0.18, 0, sim.vz * 0.18).add(car);
      this.look.lerp(lead, 1 - Math.exp(-dt * 6));
      cam.lookAt(this.look);
      const dist = W.eye.distanceTo(this.look);
      const portrait = this.W / trackH < 0.8 ? 1 + (0.8 - this.W / trackH) * 0.5 : 1;
      const target = THREE.MathUtils.clamp(THREE.MathUtils.mapLinear(dist, 3, 14, 32, 10.5), 9.5, 36) * portrait;
      this.fov += (target - this.fov) * (1 - Math.exp(-dt * 3));
      fovTrack = this.fov;
    } else {
      // chase along the direction of travel, so the drift angle shows
      const V = sim.speed;
      const dir = V > 0.8 ? new THREE.Vector3(sim.vx / V, 0, sim.vz / V) : new THREE.Vector3(Math.cos(sim.psi), 0, Math.sin(sim.psi));
      const want = car.clone().addScaledVector(dir, -1.15).add(new THREE.Vector3(0, 0.5, 0));
      this.camPos.lerp(want, 1 - Math.exp(-dt * 5));
      if (this.camPos.distanceTo(want) > 3) this.camPos.copy(want);
      cam.position.copy(this.camPos);
      this.look.lerp(car.clone().addScaledVector(dir, 0.5), 1 - Math.exp(-dt * 8));
      cam.lookAt(this.look);
      fovTrack = 52;
    }
    cam.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(fovTrack) / 2) * fullH / trackH));
    cam.aspect = this.W / fullH;
    cam.setViewOffset(this.W, fullH, 0, fullH - this.H, this.W, this.H);
    cam.updateProjectionMatrix();
    W.focusShadows(car);
  }

  resize(w: number, hgt: number) {
    this.W = Math.max(1, w); this.H = Math.max(1, hgt);
    this.controls.layout(this.W, this.H);
    this.ctx.stage.style.setProperty('--band', `${this.controls.bandH}px`);
  }
}

