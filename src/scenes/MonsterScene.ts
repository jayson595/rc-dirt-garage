// Monster truck at the Grindstone Bowl, watched from the top of the near bleachers. Two modes:
//  · Freestyle: 75 s to score — big air, flips, barrel rolls, wheelies, donuts, car crushes, the bus jump.
//    Tricks only count when you land back on your wheels.
//  · Race: three laps through the gate flags (gap jump, mound, bus jump, car crush, donut corner).
import * as THREE from 'three';
import { CrawlerSim } from '../sim/CrawlerSim';
import { MONSTER_SPEC, arenaName } from '../sim/ArenaTerrain';
import { monsterSpecFor } from '../sim/monsterUpgrades';
import { fmtTime, h, toast } from '../ui/dom';
import { monsterBest } from '../core/state';
import { TransmitterControls } from '../ui/TransmitterControls';
import { AppContext, Screen } from './common';
import { ARENA_EYE, MonsterWorld } from './MonsterWorld';
import { EventDef, EVENTS, RIVALS, eventById, eventRecord, judgedPosition, ordinal, settleEvent } from '../data/events';
import { MonsterAI, bumpTrucks, truckSkillFor } from '../sim/MonsterAI';

const TRUCK_SPREAD = [0.1, 0, -0.1];

const STEP = 1 / 120;
const S = MONSTER_SPEC;
export const MONSTER_PAY = { freestyleMax: 120, perPoints: 10, pbBonus: 25, race: 50, racePb: 25, laps: 3, freestyleTime: 75 };
export type MonsterMode = 'freestyle' | 'race';

interface Trick { name: string; pts: number }

export class MonsterScene implements Screen {
  camera = new THREE.PerspectiveCamera(45, 1, 0.15, 300);
  sim: CrawlerSim;
  controls: TransmitterControls;
  mode: MonsterMode = 'freestyle';
  phase: 'count' | 'running' | 'done' = 'count';
  paused = false;
  time = 0;
  score = 0;
  private countdown = 3;
  private acc = 0;
  private W = 1; private H = 1;
  private look = new THREE.Vector3();
  private fov = 40;
  private els: Record<string, HTMLElement> = {};
  private msgTimer = 0; private hudTimer = 0; private boardTimer = 0;
  private resetHold: number | null = null;
  // trick state
  private air = { t: 0, pitch: 0, roll: 0, fromBusRamp: false };
  private pending: { tricks: Trick[]; at: number } | null = null;
  private wheelieT = 0;
  private yawAcc = 0; private yawIdle = 0; private donuts = 0;
  private crushes = 0;
  private tally: Record<string, number> = {};
  private crashShown = false;
  private lastTrick = '';
  // race state
  private gate = 1; private lap = 0; private lapStart = 0; private laps: number[] = [];
  // events board
  private event: EventDef | null = null;
  private racers: MonsterAI[] = [];
  private rivalNames: string[] = [];
  private passed = 0;

  constructor(private ctx: AppContext, private world: MonsterWorld) {
    this.sim = new CrawlerSim(world.terrain, S);
    this.controls = new TransmitterControls(ctx.input, () => ctx.store.data.settings);
  }

  get scene() { return this.world.scene; }
  overlay() { return { scene: this.controls.scene, camera: this.controls.camera, height: this.controls.bandH }; }

  enter(opts?: Record<string, unknown>) {
    this.mode = (opts?.mode as MonsterMode) ?? 'freestyle';
    this.event = eventById(String(opts?.event ?? '')) ?? null;
    if (this.event && (this.event.vehicle !== 'monster' || this.event.venue !== this.world.terrain.layout)) this.event = null;
    if (this.event) this.mode = this.event.format === 'race' ? 'race' : 'freestyle';
    const T = this.world.terrain, mk = this.ctx.store.data.monster.fitted;
    this.world.setKit(mk);
    this.sim = new CrawlerSim(T, monsterSpecFor(mk)); // with the fitted hop-ups
    T.resetCars(); this.world.resetCars();
    const sp = this.mode === 'race' ? T.spawnRace : T.spawnFree;
    this.racers = []; this.passed = 0;
    if (this.event?.format === 'race') {
      // a grid of four: three rivals ahead, you at the back
      const ev = this.event, pick = [0, 1, 2].map((k) => RIVALS[(EVENTS.indexOf(ev) * 2 + k + 1) % RIVALS.length]);
      const grid: [number, number][] = [[1.4, -0.6], [1.4, 0.6], [0.2, -0.6], [-0.1, 0.6]];
      this.racers = pick.map((_, i) => { const a = new MonsterAI(T, MONSTER_SPEC, truckSkillFor(ev.skill, TRUCK_SPREAD[i]), ev.laps ?? MONSTER_PAY.laps, grid[i][1] > 0 ? 1 : -1); a.place(sp.x + grid[i][0], sp.z + grid[i][1], 0); return a; });
      this.rivalNames = pick.map((r) => r.name);
      this.world.setRivals(pick.map((r, i) => ({ body: r.color, flame1: r.accent === 0x1c1c1e ? 0xf1f0ec : r.accent, flame2: [0xf0782a, 0x2ab0c8, 0xf2c230][i], flame3: 0x1c1c1e })));
      this.sim.placePose(sp.x + grid[3][0], sp.z + grid[3][1], sp.heading);
    } else {
      this.world.hideRivals();
      this.sim.placePose(sp.x, sp.z, sp.heading);
    }
    for (let i = 0; i < 120; i++) this.sim.step(STEP, { steer: 0, throttle: 0 });
    this.phase = 'count'; this.countdown = 3; this.paused = false; this.time = 0; this.score = 0; this.acc = 0;
    this.air = { t: 0, pitch: 0, roll: 0, fromBusRamp: false }; this.pending = null; this.wheelieT = 0; this.yawAcc = 0; this.yawIdle = 0;
    this.donuts = 0; this.crushes = 0; this.tally = {}; this.crashShown = false; this.lastTrick = '';
    this.gate = 1; this.lap = 0; this.lapStart = 0; this.laps = [];
    this.world.gates.visible = this.mode === 'race';
    this.world.truck.pose(this.sim);
    this.look.copy(this.sim.pos);
    this.controls.mount(this.ctx.stage);
    this.controls.layout(this.W, this.H);
    this.buildUI();
    this.ctx.input.enabled = true; this.ctx.input.clear();
    this.ctx.input.onPause = () => (this.paused ? this.resume() : this.pause());
    this.ctx.input.onResetKey = () => this.doReset();
    this.showCountdown();
    this.board();
  }

  exit() {
    this.world.hideRivals(); this.racers = [];
    this.ctx.input.enabled = false; this.ctx.input.clear();
    this.controls.unmount();
    this.ctx.stage.style.removeProperty('--band');
    this.camera.clearViewOffset();
    this.ctx.input.onPause = null; this.ctx.input.onResetKey = null;
    this.cancelResetHold();
    this.ctx.store.save();
  }

  // ---------------------------------------------------------------- UI
  private buildUI() {
    const e = this.els = {} as Record<string, HTMLElement>;
    const cell = (label: string, id: string) => h('div', { class: 'hud-cell' }, h('small', {}, label), (e[id] = h('b', { id }, '')));
    e.batBar = h('i', {});
    const top = h('div', { class: 'hud-top' },
      cell(this.mode === 'race' ? 'LAP' : 'SCORE', 'main'),
      this.racers.length ? cell('POS', 'pos') : null,
      cell(this.mode === 'race' ? 'RACE TIME' : 'TIME LEFT', 'time'),
      h('div', { class: 'hud-cell bat' }, h('small', {}, 'BATT'), h('div', { class: 'bar mini' }, e.batBar), (e.batTxt = h('b', {}, ''))),
      h('button', { class: 'icon-btn pause', 'aria-label': 'Pause', onclick: () => this.pause() }, '❚❚'),
    );
    e.sub1 = h('span', {}, ''); e.sub2 = h('span', {}, '');
    e.resetBtn = h('button', { class: 'tool-btn reset' }, h('span', { class: 'fill' }), h('span', { class: 'lbl' }, 'Hold\nRESET'));
    const tools = h('div', { class: 'hud-tools' }, h('button', { class: 'tool-btn', onclick: () => this.look.copy(this.sim.pos) }, 'Re-\ncenter'), e.resetBtn);
    e.message = h('div', { class: 'hud-message' }, '');
    e.trick = h('div', { class: 'trick-pop' }, '');
    this.ctx.hud.replaceChildren(top, h('div', { class: 'hud-sub' }, e.sub1, e.sub2), tools, e.message, e.trick);
    const rb = e.resetBtn;
    rb.addEventListener('pointerdown', (ev) => { ev.preventDefault(); this.startResetHold(); });
    for (const t of ['pointerup', 'pointercancel', 'pointerleave']) rb.addEventListener(t, () => this.cancelResetHold());
    this.ctx.panel.className = 'panel drive-empty'; this.ctx.panel.replaceChildren();
  }

  private message(text: string, seconds = 2.2) {
    this.els.message.textContent = text; this.els.message.classList.toggle('show', !!text); this.msgTimer = seconds;
  }

  private pop(t: Trick[]) {
    const el = this.els.trick;
    el.replaceChildren(...t.map((k) => h('div', {}, h('b', {}, k.name), h('span', {}, ` +${k.pts}`))));
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  }

  private showCountdown() {
    this.ctx.overlay.replaceChildren(h('div', { class: 'countdown', style: { top: '48%' } }, h('i', {}), h('i', {}), h('i', {}), h('b', {}, '3')));
    if (this.event) { this.message(this.event.format === 'race' ? `${this.event.name}: ${this.event.laps} laps through the flags against three rival trucks. You start at the back.` : `${this.event.name}: ${MONSTER_PAY.freestyleTime} s for the judges. Beat ${this.event.rivalMarks!.join(' / ')} pts to place. Land your tricks!`, 5); return; }
    this.message(this.mode === 'race'
      ? `${arenaName(this.world.terrain.layout)} race: ${MONSTER_PAY.laps} laps through the flags.${this.world.terrain.mud ? ' Watch the mud pit — it is slick.' : ' Gap jump, bus jump, car crush, donut corner.'}`
      : `${arenaName(this.world.terrain.layout)} freestyle: ${MONSTER_PAY.freestyleTime} s to score. Big air, flips, wheelies, donuts and crushing cars. Land it to keep it! Blip throttle in the air to lift the nose, brake to drop it.${this.sim.S.airRoll > 0 ? ' Flywheel fitted: steer in the air to barrel roll.' : ''}`, 6);
  }

  private updateCountdown(dt: number) {
    const c = this.ctx.overlay.querySelector('.countdown') as HTMLElement | null;
    this.countdown -= dt;
    const n = this.countdown, lit = n > 2 ? 1 : n > 1 ? 2 : n > 0 ? 3 : 0;
    if (c) { c.querySelectorAll('i').forEach((el, i) => el.classList.toggle('on', i < lit)); (c.querySelector('b') as HTMLElement).textContent = n > 0 ? String(Math.ceil(n)) : 'GO!'; }
    if (n <= 0) { if (c) { c.classList.add('go'); setTimeout(() => c.remove(), 700); } this.phase = 'running'; this.lapStart = 0; }
  }

  // ---------------------------------------------------------------- pause / reset
  pause() {
    if (this.paused || this.phase === 'done') return;
    this.paused = true; this.ctx.input.clear(); this.cancelResetHold();
    this.ctx.overlay.replaceChildren(h('div', { class: 'sheet-overlay' }, h('div', { class: 'modal-card scroll-ok' },
      h('h2', {}, 'Paused'), h('p', { class: 'muted' }, `${arenaName(this.world.terrain.layout)} · ${this.mode === 'race' ? 'race' : 'freestyle'} · the clock is frozen.`),
      h('div', { class: 'stack' },
        h('button', { class: 'btn primary', onclick: () => this.resume() }, 'Resume'),
        h('button', { class: 'btn', onclick: () => { this.ctx.overlay.replaceChildren(); this.ctx.go('monster', { mode: this.mode, event: this.event?.id }); } }, this.mode === 'race' ? 'Restart race' : 'Restart freestyle'),
        this.event ? null : h('button', { class: 'btn', onclick: () => { this.ctx.overlay.replaceChildren(); this.ctx.go('monster', { mode: this.mode === 'race' ? 'freestyle' : 'race' }); } }, this.mode === 'race' ? 'Switch to freestyle' : 'Switch to race'),
        h('button', { class: 'btn ghost', onclick: () => this.ctx.go('garage', { view: 'storage' }) }, 'Back to the garage')))));
  }
  resume() {
    if (!this.paused) return;
    this.paused = false; this.ctx.input.clear();
    this.ctx.overlay.replaceChildren();
    if (this.phase === 'count') this.showCountdown();
  }
  private startResetHold() {
    if (this.paused) return; this.cancelResetHold();
    this.els.resetBtn.classList.add('holding');
    this.resetHold = window.setTimeout(() => { this.resetHold = null; this.els.resetBtn.classList.remove('holding'); this.doReset(); }, 600);
  }
  private cancelResetHold() { if (this.resetHold != null) window.clearTimeout(this.resetHold); this.resetHold = null; this.els.resetBtn?.classList.remove('holding'); }

  /** Put the truck back on its wheels: freestyle where it is (nudged off obstacles), race at the last gate. */
  doReset() {
    if (this.paused || this.phase === 'done') return;
    const T = this.world.terrain;
    if (this.mode === 'race') {
      const g = T.gates[(this.gate - 1 + T.gates.length) % T.gates.length], n = T.gates[this.gate % T.gates.length];
      this.sim.placePose(g.x, g.z, Math.atan2(-(n.z - g.z), n.x - g.x));
    } else {
      const p = this.sim.pos, f = this.sim.forward;
      this.sim.placePose(THREE.MathUtils.clamp(p.x, -15.5, 15.5), THREE.MathUtils.clamp(p.z, -9.5, 9.5), Math.atan2(-f.z, f.x));
    }
    for (let i = 0; i < 40; i++) this.sim.step(STEP, { steer: 0, throttle: 0 });
    this.pending = null; this.air.t = 0; this.crashShown = false;
    this.message('Back on its wheels', 1.2);
  }

  // ---------------------------------------------------------------- loop
  update(dt: number) {
    const input = this.ctx.input, d = this.ctx.store.data;
    if (!this.paused) {
      this.controls.feed(dt);
      input.update(dt);
      if (this.phase === 'count') this.updateCountdown(dt);
      const live = this.phase === 'running';
      const limp = d.monster.charge <= 0 ? 0.35 : 1;
      const drive = live ? { steer: input.steer, throttle: input.throttle * limp } : { steer: 0, throttle: this.phase === 'done' ? 0 : 0 };
      this.acc += dt;
      let steps = 0;
      while (this.acc >= STEP && steps < 10) {
        this.sim.step(STEP, drive); this.acc -= STEP; steps++; if (live) this.tickTricks(STEP);
        if (this.racers.length) {
          for (const r of this.racers) { r.step(STEP, live || this.phase === 'done', this.time); this.keepInside(r.sim); }
          bumpTrucks([this.sim, ...this.racers.map((r) => r.sim)]);
        }
      }
      if (steps === 10) this.acc = 0;
      this.keepInside(this.sim);
      if (live) {
        this.time += dt;
        const st = this.sim.takeStats();
        d.monster.charge = Math.max(0, d.monster.charge - (0.04 * dt + 0.55 * st.throttleEnergy) * this.sim.S.drainMul);
        this.checkCrush();
        if (this.mode === 'race') this.checkGates(); else if (this.time >= MONSTER_PAY.freestyleTime) this.finish();
        if (this.sim.rolledTime > 1.2 && !this.crashShown) {
          this.crashShown = true;
          if (this.mode === 'freestyle') { this.award([{ name: 'CRASH', pts: -100 }]); }
          this.message('On its lid! Hold RESET (or press R) to flip it back', 3);
        }
      } else this.sim.takeStats();
    }
    this.controls.pose(dt, this.paused ? 0 : input.steer, this.paused ? 0 : input.throttle, input.throttle < -0.05 && this.sim.forwardSpeed < 0);
    this.world.truck.pose(this.sim);
    this.racers.forEach((r, i) => this.world.poseRival(i, r.sim));
    const p = this.sim.pos, g = this.world.terrain.heightAt(p.x, p.z);
    this.world.shadow.position.set(p.x, g + 0.015, p.z);
    this.world.shadow.rotation.z = Math.atan2(-this.sim.forward.z, this.sim.forward.x);
    (this.world.shadow.material as THREE.MeshBasicMaterial).opacity = THREE.MathUtils.clamp(0.75 - (p.y - g - 0.17) * 1.2, 0.15, 0.75);
    this.updateCamera(dt);
    if (this.msgTimer > 0) { this.msgTimer -= dt; if (this.msgTimer <= 0) this.message('', 0); }
    this.hudTimer -= dt; if (this.hudTimer <= 0) { this.updateHud(); this.hudTimer = 1 / 15; }
    this.boardTimer -= dt; if (this.boardTimer <= 0) { this.board(); this.boardTimer = 0.5; }
  }

  /** The board walls: nothing gets past them (the dirt bank in front only slows you). */
  private keepInside(sim: CrawlerSim) {
    const p = sim.pos, v = sim.vel, LX = 16.85, LZ = 10.85;
    if (Math.abs(p.x) > LX) { p.x = Math.sign(p.x) * LX; if (v.x * Math.sign(p.x) > 0) v.x *= -0.25; v.z *= 0.8; }
    if (Math.abs(p.z) > LZ) { p.z = Math.sign(p.z) * LZ; if (v.z * Math.sign(p.z) > 0) v.z *= -0.25; v.x *= 0.8; }
  }

  // ---------------------------------------------------------------- tricks
  private tickTricks(dt: number) {
    if (this.mode !== 'freestyle') return;
    const sim = this.sim, g = sim.grounded, nDown = g.filter(Boolean).length;
    const zAxis = new THREE.Vector3(0, 0, 1).applyQuaternion(sim.q), xAxis = new THREE.Vector3(1, 0, 0).applyQuaternion(sim.q);
    if (nDown === 0 && !sim.touching) {
      if (this.air.t === 0) { this.air.pitch = 0; this.air.roll = 0; const J = this.world.terrain.bigJump; this.air.fromBusRamp = Math.abs(sim.pos.z - J.z) < 1.6 && sim.pos.x > J.x0 && sim.pos.x < J.x1; }
      this.air.t += dt;
      this.air.pitch += sim.w.dot(zAxis) * dt;
      this.air.roll += sim.w.dot(xAxis) * dt;
    } else if (this.air.t > 0) {
      // touchdown: work out what was done in the air; confirm once it is still on its wheels
      const tr: Trick[] = [];
      const a = this.air.t;
      if (a > 0.35) tr.push({ name: a > 1.0 ? `HUGE AIR ${a.toFixed(1)}s` : `BIG AIR ${a.toFixed(1)}s`, pts: Math.round(a * 120) });
      const flips = Math.floor((Math.abs(this.air.pitch) + 0.9) / (Math.PI * 2));
      if (flips > 0) tr.push({ name: `${flips > 1 ? `${flips}× ` : ''}${this.air.pitch > 0 ? 'BACKFLIP' : 'FRONTFLIP'}`, pts: 500 * flips });
      const rolls = Math.floor((Math.abs(this.air.roll) + 0.9) / (Math.PI * 2));
      if (rolls > 0) tr.push({ name: `${rolls > 1 ? `${rolls}× ` : ''}BARREL ROLL`, pts: 600 * rolls });
      { const J = this.world.terrain.bigJump; if (this.air.fromBusRamp && sim.pos.x > J.land) tr.push({ name: J.label, pts: J.pts }); }
      if (tr.length) this.pending = { tricks: tr, at: this.time };
      this.air.t = 0;
    }
    if (this.pending && this.time - this.pending.at > 0.7) {
      if (!sim.rolled && sim.up.y > 0.6) {
        const t = this.pending.tricks;
        if (t.some((k) => k.name.includes('AIR') || k.name.includes('FLIP') || k.name.includes('ROLL'))) t.push({ name: 'CLEAN LANDING', pts: 50 });
        this.award(t);
      } else this.message('Landed on its lid — tricks don\'t count unless you land them', 2.4);
      this.pending = null;
    }
    // wheelie: fronts up, at least one rear down, moving
    const pitch = Math.asin(THREE.MathUtils.clamp(xAxis.y, -1, 1));
    if (!g[0] && !g[1] && (g[2] || g[3] || sim.touching) && pitch > 0.12 && sim.forwardSpeed > 1) this.wheelieT += dt; // riding the rears or the wheelie bar
    else if (this.wheelieT > 0) {
      if (this.wheelieT > 0.6) this.award([{ name: `WHEELIE ${this.wheelieT.toFixed(1)}s`, pts: Math.round(this.wheelieT * 90) }]);
      this.wheelieT = 0;
    }
    // donuts: sustained yaw on the ground
    const yawRate = sim.w.y;
    if (nDown >= 3 && Math.abs(yawRate) > 1.4) {
      this.yawAcc += yawRate * dt; this.yawIdle = 0;
      if (Math.abs(this.yawAcc) >= Math.PI * 2) { this.yawAcc = 0; this.donuts++; this.award([{ name: this.donuts > 1 ? `DONUT ×${this.donuts}` : 'DONUT', pts: 80 + 20 * Math.min(this.donuts, 6) }]); }
    } else { this.yawIdle += dt; if (this.yawIdle > 0.6) { this.yawAcc = 0; if (this.yawIdle > 3) this.donuts = 0; } }
  }

  private award(t: Trick[]) {
    let sum = 0;
    for (const k of t) { sum += k.pts; const key = k.name.replace(/[0-9.×s ]+$/g, '').replace(/^[0-9]+× /, ''); this.tally[key] = (this.tally[key] ?? 0) + k.pts; }
    this.score = Math.max(0, this.score + sum);
    this.lastTrick = t.map((k) => k.name).join(' + ');
    this.pop(t);
  }

  /** Any wheel (or the front bumper) reaching a junk car flattens it. */
  private checkCrush() {
    const T = this.world.terrain, sim = this.sim;
    const pts: THREE.Vector3[] = [];
    for (const [sx, sz] of [[1, -1], [1, 1], [-1, -1], [-1, 1]]) pts.push(new THREE.Vector3(sx * S.wheelbase / 2 + sx * 0.04, 0, sz * S.track / 2).applyQuaternion(sim.q).add(sim.pos));
    pts.push(new THREE.Vector3(0.3, 0, 0).applyQuaternion(sim.q).add(sim.pos));
    T.cars.forEach((c, i) => {
      if (c.crushed) return;
      for (const p of pts) {
        if (Math.abs(p.x - c.x) < c.wid / 2 + 0.05 && Math.abs(p.z - c.z) < c.len / 2 + 0.03 && p.y < T.groundAt(p.x, p.z) + c.h + 0.25) {
          T.crush(i); this.world.crushCar(i); this.crushes++;
          if (this.mode === 'freestyle') this.award([{ name: this.crushes > 1 ? `CAR CRUSH ×${this.crushes}` : 'CAR CRUSH', pts: 75 }]);
          break;
        }
      }
    });
  }

  // ---------------------------------------------------------------- race
  private checkGates() {
    const T = this.world.terrain, p = this.sim.pos;
    const g = T.gates[this.gate];
    if (Math.hypot(p.x - g.x, p.z - g.z) < g.r) {
      this.passed++;
      if (this.gate === 0) {
        this.lap++;
        const lt = this.time - this.lapStart; this.lapStart = this.time; this.laps.push(lt);
        if (this.lap >= (this.event?.laps ?? MONSTER_PAY.laps)) { this.finish(); return; }
        if (this.racers.length && this.lap === (this.event!.laps ?? 3) - 1) { this.message(`Final lap! You're ${ordinal(this.position())}`, 1.8); this.gate = 1; return; }
        this.message(`Lap ${this.lap}: ${lt.toFixed(2)} s`, 1.6);
      }
      this.gate = (this.gate + 1) % T.gates.length;
    }
  }

  // ---------------------------------------------------------------- finish
  private finish() {
    if (this.phase === 'done') return;
    this.phase = 'done'; this.ctx.input.clear();
    const d = this.ctx.store.data, m = d.monster, B = monsterBest(d);
    m.runs++;
    if (!d.drift.unlocked) { d.drift.unlocked = true; window.setTimeout(() => toast('New in the garage: the Slideway RD-1 drift car is unlocked', 'good', 4200), 2600); }
    if (this.event) { this.finishEvent(); return; }
    let credits = 0, pb = false;
    const rows: HTMLElement[] = [];
    if (this.mode === 'freestyle') {
      pb = this.score > B.bestScore;
      if (pb) B.bestScore = this.score;
      credits = Math.min(MONSTER_PAY.freestyleMax, Math.round(this.score / MONSTER_PAY.perPoints)) + (pb && this.score > 0 ? MONSTER_PAY.pbBonus : 0);
      for (const [k, v] of Object.entries(this.tally).sort((a, b) => b[1] - a[1])) rows.push(h('tr', { class: v < 0 ? 'pen' : '' }, h('td', {}, k.toLowerCase().replace(/^./, (c) => c.toUpperCase())), h('td', {}, `${v > 0 ? '+' : ''}${v}`)));
    } else {
      const total = this.time;
      pb = B.bestRace == null || total < B.bestRace;
      if (pb) B.bestRace = total;
      credits = MONSTER_PAY.race + (pb ? MONSTER_PAY.racePb : 0);
      this.laps.forEach((l, i) => rows.push(h('tr', {}, h('td', {}, `Lap ${i + 1}`), h('td', {}, `${l.toFixed(2)} s`))));
    }
    d.credits += credits;
    this.ctx.store.save();
    this.board();
    window.setTimeout(() => this.ctx.overlay.replaceChildren(h('div', { class: 'sheet-overlay' }, h('div', { class: 'modal-card result scroll-ok' },
      h('div', { class: 'eyebrow' }, `${arenaName(this.world.terrain.layout)} · ${this.mode === 'race' ? 'race' : 'freestyle'}`),
      h('div', { class: 'big-time' }, this.mode === 'race' ? fmtTime(this.time) : `${this.score} pts`),
      pb ? h('div', { class: 'tag good' }, this.mode === 'race' ? 'New best race!' : 'New best score!') : h('div', { class: 'muted small' }, this.mode === 'race' ? `Best: ${fmtTime(B.bestRace)}` : `Best: ${B.bestScore} pts`),
      rows.length ? h('table', { class: 'laps' }, rows) : h('div', { class: 'muted small' }, 'No tricks landed this time — try the ramps and the car row.'),
      h('div', { class: 'earned' }, `+${credits} credits`),
      h('div', { class: 'row end' },
        h('button', { class: 'btn', onclick: () => this.ctx.go('monster', { mode: this.mode }) }, 'Go again'),
        h('button', { class: 'btn primary', onclick: () => this.ctx.go('garage', { view: 'storage' }) }, 'Back to the garage')),
    ))), 1100);
    toast(`${this.mode === 'race' ? 'Race' : 'Freestyle'} done · +${credits} cr`, 'good');
  }

  // ---------------------------------------------------------------- events
  private progress() { const g = this.world.terrain.gates[this.gate], p = this.sim.pos; return this.passed * 100 - Math.hypot(p.x - g.x, p.z - g.z); }

  private order() {
    const you = { name: 'You', time: this.phase === 'done' ? this.time : null as number | null, prog: this.progress(), you: true };
    const list = [you, ...this.racers.map((r, i) => ({ name: this.rivalNames[i], time: r.finishTime, prog: r.progress(), you: false }))];
    return list.sort((a, b) => (a.time != null && b.time != null ? a.time - b.time : a.time != null ? -1 : b.time != null ? 1 : b.prog - a.prog));
  }
  private position() { return this.order().findIndex((o) => o.you) + 1; }

  /** Event finish: race placings against the AI trucks, or the freestyle score against the posted marks. */
  private finishEvent() {
    const d = this.ctx.store.data, ev = this.event!, B = monsterBest(d);
    let rows: { name: string; val: string; you: boolean; est?: boolean }[], pos: number, head: string, pb = false;
    if (ev.format === 'race') {
      pb = B.bestRace == null || this.time < B.bestRace; if (pb) B.bestRace = this.time;
      const G = this.world.terrain.gates.length, total = (ev.laps ?? 3) * G;
      const list = this.order().map((o) => {
        if (o.time != null || o.you) return { ...o, est: false };
        const r = this.racers[this.rivalNames.indexOf(o.name)];
        const per = this.time / Math.max(1, r.passed);
        return { ...o, time: this.time + Math.max(1, total - r.passed) * per, est: true };
      }).sort((a, b) => a.time! - b.time!);
      pos = list.findIndex((r) => r.you) + 1;
      rows = list.map((r) => ({ name: r.name, val: fmtTime(r.time!) + (r.est ? ' *' : ''), you: r.you, est: r.est }));
      head = ordinal(pos);
    } else {
      pb = this.score > B.bestScore; if (pb) B.bestScore = this.score;
      pos = judgedPosition(ev, this.score);
      const names = [0, 1, 2].map((k) => RIVALS[(EVENTS.indexOf(ev) * 2 + k) % RIVALS.length].name);
      const all = [{ name: 'You', v: this.score, you: true }, ...ev.rivalMarks!.map((v, i) => ({ name: names[i], v, you: false }))];
      all.sort((a, b) => b.v - a.v || (a.you ? -1 : 1));
      rows = all.map((r) => ({ name: r.name, val: `${r.v} pts`, you: r.you }));
      head = `${this.score} pts · ${ordinal(pos)}`;
    }
    const prize = settleEvent(d, ev, pos), rec = eventRecord(d, ev.id);
    this.ctx.store.save(); this.board();
    window.setTimeout(() => this.ctx.overlay.replaceChildren(h('div', { class: 'sheet-overlay' }, h('div', { class: 'modal-card result scroll-ok' },
      h('div', { class: 'eyebrow' }, `${ev.name} · ${ev.venueName}`),
      h('div', { class: 'big-time' }, head),
      pos === 1 ? h('div', { class: 'tag good' }, rec.wins === 1 ? 'First win here!' : 'Winner!') : h('div', { class: 'muted small' }, `Best finish here: ${ordinal(rec.best ?? pos)}${pb ? ' · new personal best' : ''}`),
      h('table', { class: 'laps' }, rows.map((r, i) => h('tr', { class: r.you ? 'you' : '' }, h('td', {}, `${i + 1}. ${r.name}`), h('td', {}, r.val)))),
      rows.some((r) => r.est) ? h('div', { class: 'muted small' }, '* still on track: projected from their pace') : null,
      h('div', { class: 'earned' }, prize ? `+${prize} credits prize money` : 'No prize this time: top three get paid'),
      h('div', { class: 'row end' },
        h('button', { class: 'btn', onclick: () => this.ctx.go('monster', { mode: this.mode, event: ev.id }) }, 'Go again'),
        h('button', { class: 'btn primary', onclick: () => this.ctx.go('garage', { view: 'storage' }) }, 'Back to the garage')),
    ))), 1100);
    toast(prize ? `${ordinal(pos)} · +${prize} cr prize` : `${ordinal(pos)} place`, prize ? 'good' : 'info');
  }

  private updateHud() {
    const e = this.els, d = this.ctx.store.data, m = monsterBest(d), mc = d.monster;
    if (this.mode === 'race') {
      e.main.textContent = `${Math.min(this.lap + 1, MONSTER_PAY.laps)}/${MONSTER_PAY.laps}`;
      e.time.textContent = fmtTime(this.time);
      e.sub1.textContent = this.phase === 'count' ? 'Get ready…' : `Next flag ${this.gate === 0 ? '(finish line)' : this.gate}`;
      e.sub2.textContent = `Best ${m.bestRace != null ? fmtTime(m.bestRace) : '--'}`;
      if (this.racers.length) e.pos.textContent = `${this.position()}/${this.racers.length + 1}`;
    } else {
      e.main.textContent = String(this.score);
      e.time.textContent = `${Math.max(0, Math.ceil(MONSTER_PAY.freestyleTime - this.time))} s`;
      e.sub1.textContent = this.phase === 'count' ? 'Get ready…' : this.lastTrick ? `Last: ${this.lastTrick}` : 'Hit a ramp!';
      e.sub2.textContent = this.event?.rivalMarks ? `To win: ${this.event.rivalMarks[0]} pts` : `Best ${m.bestScore} pts`;
    }
    const c = mc.charge;
    e.batBar.style.width = `${c}%`;
    (e.batBar.parentElement as HTMLElement).className = `bar mini ${c > 60 ? 'ok' : c > 25 ? 'mid' : 'low'}`;
    e.batTxt.textContent = `${Math.round(c)}%`;
  }

  private board() {
    if (this.mode === 'race') this.world.setScoreboard(`RACE · LAP ${Math.min(this.lap + 1, MONSTER_PAY.laps)}/${MONSTER_PAY.laps}`, fmtTime(this.time), this.laps.length ? `LAST LAP ${this.laps[this.laps.length - 1].toFixed(2)}` : 'MUDHAMMER');
    else this.world.setScoreboard(`FREESTYLE · ${Math.max(0, Math.ceil(MONSTER_PAY.freestyleTime - this.time))} S`, `${this.score}`, this.lastTrick || 'MUDHAMMER');
  }

  // ---------------------------------------------------------------- camera (from the top of the bleachers)
  private updateCamera(dt: number) {
    const cam = this.camera, sim = this.sim;
    cam.position.copy(ARENA_EYE);
    const lead = new THREE.Vector3(sim.vel.x * 0.15, 0.1, sim.vel.z * 0.15).add(sim.pos);
    this.look.lerp(lead, 1 - Math.exp(-dt * 6));
    cam.lookAt(this.look);
    const dist = ARENA_EYE.distanceTo(this.look);
    const trackH = Math.max(1, this.H - this.controls.bandH);
    const portrait = this.W / trackH < 0.8 ? 1 + (0.8 - this.W / trackH) * 0.5 : 1;
    const target = THREE.MathUtils.clamp(THREE.MathUtils.mapLinear(dist, 8, 30, 38, 13), 11, 42) * portrait;
    this.fov += (target - this.fov) * (1 - Math.exp(-dt * 3));
    const cy = Math.min(this.H / 2, (70 + trackH) / 2), fullH = 2 * (this.H - cy);
    cam.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(this.fov) / 2) * fullH / trackH));
    cam.aspect = this.W / fullH;
    cam.setViewOffset(this.W, fullH, 0, fullH - this.H, this.W, this.H);
    cam.updateProjectionMatrix();
    this.world.focusShadows(this.look);
  }

  resize(w: number, hgt: number) {
    this.W = Math.max(1, w); this.H = Math.max(1, hgt);
    this.controls.layout(this.W, this.H);
    this.ctx.stage.style.setProperty('--band', `${this.controls.bandH}px`);
  }
}
