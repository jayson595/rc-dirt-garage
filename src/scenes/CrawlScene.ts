// Driving the rock crawler on Mossknuckle Ridge. The operator walks along a footpath beside the trail,
// keeping pace with the truck and looking down at it from standing height. Same hands + transmitter
// controls as the buggy. Free trail: timed from the first throttle to the finish arch.
import { EventDef, EVENTS, RIVALS, eventById, eventRecord, judgedPosition, ordinal, settleEvent } from '../data/events';
import * as THREE from 'three';
import { ECONOMY } from '../data/specs';
import { CrawlerSim, crawlerSpecFor } from '../sim/CrawlerSim';
import { COMP_NAME, PILE_NAME, TRAIL_NAME, YARD_NAME } from '../sim/CrawlTerrain';
import { Telemetry } from '../ui/Telemetry';
import { fmtTime, h, toast } from '../ui/dom';
import { TransmitterControls } from '../ui/TransmitterControls';
import { AppContext, Screen } from './common';
import { CrawlWorld } from './CrawlWorld';

const STEP = 1 / 120;
const EYE = 1.55;
const COMP_LIMIT = 300;

export class CrawlScene implements Screen {
  camera = new THREE.PerspectiveCamera(55, 1, 0.05, 200);
  sim: CrawlerSim;
  controls: TransmitterControls;
  paused = false;
  phase: 'ready' | 'running' | 'finished' = 'ready';
  time = 0;
  nextCp = 0;
  private overLog = false;
  rollovers = 0;
  resets = 0;
  private acc = 0;
  private els: Record<string, HTMLElement> = {};
  private W = 1; private H = 1;
  private opS = 0;              // operator position along the footpath (trail distance)
  private look = new THREE.Vector3();
  private lastSafeS = 0.8;
  private rolledShown = false;
  private msgTimer = 0;
  private hudTimer = 0;
  private resetHold: number | null = null;
  private minimap: { canvas: HTMLCanvasElement; base: HTMLCanvasElement; scale: number; ox: number; oz: number } | null = null;

  private tele = new Telemetry();
  private camMode: 'walk' | 'chase' | 'side' = 'walk';
  private get yard() { return this.world.terrain.layout === 'yard'; }
  private get pile() { return this.world.terrain.layout === 'pile'; }
  private get comp() { return this.world.terrain.layout === 'comp'; }
  private get venueName() { const L = this.world.terrain.layout; return L === 'yard' ? YARD_NAME : L === 'pile' ? PILE_NAME : L === 'comp' ? COMP_NAME : TRAIL_NAME; }
  private get screenName() { const L = this.world.terrain.layout; return L === 'yard' ? 'crawltest' as const : L === 'pile' ? 'crawlpile' as const : L === 'comp' ? 'crawlcomp' as const : 'crawl' as const; }
  // comp scoring: lower is better
  private cs = { points: 0, gate: 0, backing: false, touched: new Set<string>(), prevS: 0, tally: { backups: 0, markers: 0, bounds: 0, resets: 0, missed: 0 } };

  constructor(private ctx: AppContext, private world: CrawlWorld) {
    this.sim = new CrawlerSim(world.terrain);
    this.controls = new TransmitterControls(ctx.input, () => ctx.store.data.settings);
  }

  get scene() { return this.world.scene; }
  overlay() { return { scene: this.controls.scene, camera: this.controls.camera, height: this.controls.bandH }; }

  private event: EventDef | null = null;

  enter(opts?: Record<string, unknown>) {
    this.event = eventById(String(opts?.event ?? '')) ?? null;
    if (this.event && (this.event.vehicle !== 'crawler' || this.event.venue !== this.world.terrain.layout)) this.event = null;
    this.cs = { points: 0, gate: 0, backing: false, touched: new Set<string>(), prevS: 0, tally: { backups: 0, markers: 0, bounds: 0, resets: 0, missed: 0 } };
    this.phase = 'ready'; this.overLog = false; this.time = 0; this.nextCp = 0; this.rollovers = 0; this.resets = 0;
    this.paused = false; this.acc = 0; this.rolledShown = false; this.lastSafeS = 0.8;
    const cr = this.ctx.store.data.crawler;
    this.world.setStyle(cr.style, cr.fitted);
    this.sim = new CrawlerSim(this.world.terrain, crawlerSpecFor(cr.fitted)); // with the fitted hop-ups
    this.sim.placeAt(0.8);
    for (let i = 0; i < 120; i++) this.sim.step(STEP, { steer: 0, throttle: 0 }); // settle on the suspension
    this.opS = 0;
    this.world.crawler.pose(this.sim);
    this.look.copy(this.sim.pos);
    this.controls.mount(this.ctx.stage);
    this.controls.layout(this.W, this.H);
    this.buildUI();
    this.ctx.input.enabled = true;
    this.ctx.input.clear();
    this.ctx.input.onPause = () => (this.paused ? this.resume() : this.pause());
    this.ctx.input.onResetKey = () => this.doReset();
    this.tele.reset(); this.camMode = 'walk';
    if (this.event) this.message(`${this.event.name}: ${this.comp ? `lowest points wins — beat ${this.event.rivalMarks![0]} pts. +1 per backup, +10 marker or tape, +5 reset, +20 missed gate.` : `fastest to the summit — beat ${fmtTime(this.event.rivalMarks![0])}.`} The clock starts when you move.`, 7);
    else if (this.yard) this.message(`${YARD_NAME}: drive the lane through each station (steps, ramps, side slope, twister, log, rocks). Nothing is timed for pay; watch the telemetry.`, 6);
    else if (this.pile) this.message(`${PILE_NAME}: get to the summit flag. The orange stakes mark the easy line round the pile — or pick your own line straight up the boulders. The clock starts when you move.`, 7);
    else if (this.comp) this.message(`${COMP_NAME}: drive through the ${this.world.terrain.gates.length} numbered gates in order. Lowest points wins: +1 per backup, +10 touching a gate marker or leaving the tape, +5 per reset, +20 per missed gate. 5:00 limit.`, 8);
    else this.message(`${TRAIL_NAME}: follow the orange stakes to the finish arch. The clock starts when you move. Take it slow — crawlers win by not rolling.`, 6);
  }

  exit() {
    this.ctx.input.enabled = false;
    this.ctx.input.clear();
    this.controls.unmount();
    this.ctx.stage.style.removeProperty('--band');
    this.camera.clearViewOffset();
    this.ctx.input.onPause = null;
    this.ctx.input.onResetKey = null;
    this.cancelResetHold();
    this.ctx.store.save();
  }

  // ---------------- UI
  private buildUI() {
    const e = this.els = {} as Record<string, HTMLElement>;
    const cell = (label: string, id: string) => h('div', { class: 'hud-cell' }, h('small', {}, label), (e[id] = h('b', { id }, '')));
    e.batBar = h('i', {});
    if (this.comp) { h('div', { class: 'bar mini' }, e.batBar); e.batTxt = h('b', {}, ''); } // battery shows in the sub line
    const top = h('div', { class: 'hud-top' },
      cell(this.yard ? 'STATIONS' : this.comp ? 'GATE' : 'STAKES', 'cp'),
      this.comp ? cell('POINTS', 'pts') : null,
      cell(this.yard ? 'TEST TIME' : this.comp ? 'TIME LEFT' : this.pile ? 'SUMMIT TIME' : 'TRAIL TIME', 'time'),
      this.comp ? null : h('div', { class: 'hud-cell bat' }, h('small', {}, 'BATT'), h('div', { class: 'bar mini' }, e.batBar), (e.batTxt = h('b', {}, ''))),
      h('button', { class: 'icon-btn pause', 'aria-label': 'Pause', onclick: () => this.pause() }, '❚❚'),
    );
    e.sub1 = h('span', {}, ''); e.sub2 = h('span', {}, '');
    const sub = h('div', { class: 'hud-sub' }, e.sub1, e.sub2);
    const mm = h('canvas', { class: 'minimap', width: 120, height: 84, 'aria-label': 'Trail map' }) as HTMLCanvasElement;
    mm.style.display = this.ctx.store.data.settings.showMap ? '' : 'none';
    e.resetBtn = h('button', { class: 'tool-btn reset' }, h('span', { class: 'fill' }), h('span', { class: 'lbl' }, 'Hold\nRESET'));
    const camBtn = this.yard ? h('button', { class: 'tool-btn', onclick: () => { this.camMode = this.camMode === 'walk' ? 'chase' : this.camMode === 'chase' ? 'side' : 'walk'; camBtn!.textContent = `Cam\n${this.camMode}`; } }, 'Cam\nwalk') : null;
    const dataBtn = this.yard ? h('button', { class: 'tool-btn', onclick: () => this.tele.el.classList.toggle('hide') }, 'Data') : null;
    const tools = h('div', { class: 'hud-tools' }, h('button', { class: 'tool-btn', onclick: () => this.recenter() }, 'Re-\ncenter'), e.resetBtn, camBtn, dataBtn);
    e.message = h('div', { class: 'hud-message' }, '');
    this.ctx.hud.replaceChildren(top, sub, mm, tools, e.message);
    if (this.yard) this.ctx.hud.append(this.tele.el);
    this.setupMinimap(mm);
    const rb = e.resetBtn;
    rb.addEventListener('pointerdown', (ev) => { ev.preventDefault(); this.startResetHold(); });
    for (const t of ['pointerup', 'pointercancel', 'pointerleave']) rb.addEventListener(t, () => this.cancelResetHold());
    this.ctx.panel.className = 'panel drive-empty';
    this.ctx.panel.replaceChildren();
    this.ctx.overlay.replaceChildren();
  }

  private setupMinimap(canvas: HTMLCanvasElement) {
    const T = this.world.terrain;
    const span = T.half * 2;
    const scale = Math.min((canvas.width - 12) / span, (canvas.height - 12) / span);
    const ox = canvas.width / 2, oz = canvas.height / 2;
    const base = document.createElement('canvas'); base.width = canvas.width; base.height = canvas.height;
    const g = base.getContext('2d')!;
    g.fillStyle = 'rgba(20,24,16,0.6)'; g.fillRect(0, 0, base.width, base.height);
    g.strokeStyle = '#b08a5a'; g.lineWidth = 3; g.lineJoin = 'round'; g.beginPath();
    T.trail.forEach((p, i) => (i ? g.lineTo(p.x * scale + ox, p.z * scale + oz) : g.moveTo(p.x * scale + ox, p.z * scale + oz)));
    g.stroke();
    const f = T.pointAt(T.trailLength);
    g.fillStyle = '#f1eadb'; g.fillRect(f.x * scale + ox - 3, f.z * scale + oz - 3, 6, 6);
    this.minimap = { canvas, base, scale, ox, oz };
  }

  private drawMinimap() {
    const m = this.minimap;
    if (!m || m.canvas.style.display === 'none') return;
    const g = m.canvas.getContext('2d')!;
    g.clearRect(0, 0, m.canvas.width, m.canvas.height);
    g.drawImage(m.base, 0, 0);
    const T = this.world.terrain;
    if (this.nextCp < T.checkpoints.length) {
      const p = T.pointAt(T.checkpoints[this.nextCp]);
      g.fillStyle = '#ffd43b'; g.beginPath(); g.arc(p.x * m.scale + m.ox, p.z * m.scale + m.oz, 2.5, 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = '#ff3b30'; g.strokeStyle = '#fff'; g.lineWidth = 1.5;
    g.beginPath(); g.arc(this.sim.pos.x * m.scale + m.ox, this.sim.pos.z * m.scale + m.oz, 3.4, 0, Math.PI * 2); g.fill(); g.stroke();
  }

  private message(text: string, seconds = 2.2) {
    this.els.message.textContent = text;
    this.els.message.classList.toggle('show', !!text);
    this.msgTimer = seconds;
  }

  // ---------------- pause / reset
  pause() {
    if (this.paused || this.phase === 'finished') return;
    this.paused = true;
    this.ctx.input.clear();
    this.cancelResetHold();
    this.ctx.store.save();
    this.ctx.overlay.replaceChildren(h('div', { class: 'sheet-overlay' }, h('div', { class: 'modal-card scroll-ok' },
      h('h2', {}, 'Paused'),
      h('p', { class: 'muted' }, `${this.venueName} · the clock is frozen.`),
      h('div', { class: 'stack' },
        h('button', { class: 'btn primary', onclick: () => this.resume() }, 'Resume'),
        h('button', { class: 'btn', onclick: () => { this.ctx.overlay.replaceChildren(); this.ctx.go(this.screenName, this.event ? { event: this.event.id } : undefined); } }, 'Restart'),
        h('button', { class: 'btn', onclick: () => { this.resume(); this.controls.demo(); } }, 'Show control demo'),
        h('button', { class: 'btn ghost', onclick: () => this.ctx.go('garage', { view: 'storage' }) }, 'Back to the garage'),
      ))));
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    this.ctx.input.clear();
    this.ctx.overlay.replaceChildren();
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

  doReset(why: 'manual' | 'bounds' = 'manual') {
    if (this.paused || this.phase === 'finished') return;
    if (this.comp) {
      // back to the last gate cleared (or the start), facing down the course
      const T = this.world.terrain, g = this.cs.gate > 0 ? T.gates[this.cs.gate - 1].s + 0.3 : 0.8;
      this.lastSafeS = g; this.cs.prevS = g;
      if (this.phase === 'running') {
        if (why === 'bounds') this.penalty(10, 'Out of bounds', 'bounds'); else this.penalty(5, 'Reset', 'resets');
      }
    }
    this.sim.placeAt(this.lastSafeS);
    for (let i = 0; i < 60; i++) this.sim.step(STEP, { steer: 0, throttle: 0 });
    this.resets++;
    this.rolledShown = false;
    this.recenter();
    this.message('Back on the trail at the last stakes', 1.4);
  }

  recenter() {
    const n = this.world.terrain.nearest(this.sim.pos.x, this.sim.pos.z);
    if (n.s >= 0) this.opS = Math.max(0, n.s - 0.4);
    this.look.copy(this.sim.pos);
  }

  // ---------------- loop
  update(dt: number) {
    const input = this.ctx.input;
    const T = this.world.terrain;
    const d = this.ctx.store.data;
    if (!this.paused) {
      this.controls.feed(dt);
      input.update(dt);
      const done = this.phase === 'finished';
      // flat battery: limp along at a crawl
      const limp = d.crawler.charge <= 0 ? 0.3 : 1;
      const drive = done ? { steer: 0, throttle: 0 } : { steer: input.steer, throttle: input.throttle * limp };
      if (this.phase === 'ready' && Math.abs(input.throttle) > 0.15) { this.phase = 'running'; this.message('Clock running', 1); }
      this.acc += dt;
      let steps = 0;
      while (this.acc >= STEP && steps < 8) { this.sim.step(STEP, drive); this.acc -= STEP; steps++; }
      if (steps === 8) this.acc = 0;
      if (this.phase === 'running') {
        this.time += dt;
        const st = this.sim.takeStats();
        if (!this.yard && !this.pile) d.crawler.charge = Math.max(0, d.crawler.charge - (0.03 * dt + 0.25 * st.throttleEnergy));
      } else this.sim.takeStats();
      this.checkProgress();
      // rollovers + out of bounds
      if (this.sim.rolledTime > 1.0 && !this.rolledShown) { this.rolledShown = true; this.rollovers++; this.message('Rolled over! Hold RESET (or press R) to get back on the trail', 4); }
      if (!this.sim.rolled) this.rolledShown = false;
      if (Math.abs(this.sim.pos.x) > T.half - 0.3 || Math.abs(this.sim.pos.z) > T.half - 0.3 || this.sim.pos.y < -3) this.doReset('bounds');
      if (this.comp && this.phase === 'running') { this.compTick(); if (this.time >= COMP_LIMIT) this.compTimeout(); }
    }
    this.controls.pose(dt, this.paused ? 0 : input.steer, this.paused ? 0 : input.throttle, input.throttle < -0.05 && this.sim.forwardSpeed < 0);
    this.world.crawler.pose(this.sim);
    this.poseShadowAndGuide();
    this.updateCamera(dt);
    if (this.msgTimer > 0) { this.msgTimer -= dt; if (this.msgTimer <= 0) this.message('', 0); }
    this.hudTimer -= dt;
    if (this.hudTimer <= 0) { this.updateHud(); this.hudTimer = 1 / 15; }
    this.drawMinimap();
  }

  private checkProgress() {
    const T = this.world.terrain;
    const n = T.nearest(this.sim.pos.x, this.sim.pos.z);
    if (this.phase === 'finished') return;
    // rock pile: the summit counts whichever line you took, once you're parked on top the right way up
    if (this.pile && T.summit && this.phase === 'running') {
      const S = T.summit, p = this.sim.pos;
      if (Math.hypot(p.x - S.x, p.z - S.z) < S.r && !this.sim.rolled && this.sim.up.y > 0.8 && this.sim.speed < 0.6) { this.finish(); return; }
    }
    if (this.comp) return;
    if (n.s < 0) return;
    const onTrail = Math.abs(n.d) < 1.4;
    if (onTrail && !this.sim.rolled) this.lastSafeS = Math.max(this.lastSafeS, Math.min(n.s, this.nextCp > 0 ? T.checkpoints[this.nextCp - 1] + 2 : 2));
    // the big log (yard): drive over it, not round it, and land it without rolling
    const bl = T.bigLog;
    if (bl && this.yard) {
      if (Math.abs(n.s - bl.s) < 0.12 && Math.abs(n.d - bl.d) < 0.3) this.overLog = true;
      if (this.overLog && (this.sim.rolled || n.s < bl.s - 1)) this.overLog = false;
      if (this.overLog && n.s > bl.s + 0.6) {
        this.overLog = false;
        const d = this.ctx.store.data, first = !d.crawler.bigLog;
        d.crawler.bigLog = true; this.ctx.store.save();
        this.message(first ? 'BIG LOG CLEARED! 20 cm, all four wheels over.' : 'Big log cleared again.', 3);
        return;
      }
    }
    const cp = T.checkpoints[this.nextCp];
    // pass a stake pair by reaching it on the trail (no skipping ahead past more than one pair)
    if (onTrail && n.s >= cp - 0.2 && n.s < cp + 3) {
      this.nextCp++;
      this.lastSafeS = cp;
      if (this.nextCp >= T.checkpoints.length) { if (!this.pile) this.finish(); else this.message('Top of the line — park it inside the yellow summit ring', 2); }
      else this.message(this.yard ? `Station cleared: ${T.stations[this.nextCp - 1]?.label ?? ''}` : `Stakes ${this.nextCp}/${T.checkpoints.length - 1}`, 1.2);
    }
  }

  // ---------------- comp scoring
  private penalty(pts: number, label: string, key: keyof CrawlScene['cs']['tally']) {
    this.cs.points += pts; this.cs.tally[key] += key === 'backups' ? 1 : 1;
    this.message(`${label} +${pts}`, 1.4);
  }

  private compTick() {
    const T = this.world.terrain, sim = this.sim, cs = this.cs;
    // backups: each time the truck starts rolling backwards under reverse throttle
    if (!cs.backing && this.ctx.input.throttle < -0.1 && sim.forwardSpeed < -0.04) { cs.backing = true; this.penalty(1, 'Backup', 'backups'); }
    if (cs.backing && sim.forwardSpeed > 0.03) cs.backing = false;
    // gate markers: any part of the truck touching one
    const f = sim.forward, r = new THREE.Vector3(-f.z, 0, f.x).normalize();
    const pts = [[0.26, 0.15], [0.26, -0.15], [-0.25, 0.15], [-0.25, -0.15], [0, 0.16], [0, -0.16], [0.16, 0.15], [-0.16, 0.15], [0.16, -0.15], [-0.16, -0.15]]
      .map(([a, b]) => sim.pos.clone().addScaledVector(f, a).addScaledVector(r, b));
    for (let i = Math.max(0, cs.gate - 1); i < Math.min(T.gates.length, cs.gate + 2); i++) for (const side of [-1, 1]) {
      const key = `${i}:${side}`; if (cs.touched.has(key)) continue;
      const m = T.gateMarker(T.gates[i], side);
      if (pts.some((p) => Math.hypot(p.x - m.x, p.z - m.z) < 0.05)) { cs.touched.add(key); this.penalty(10, `Gate ${T.gates[i].n} marker touched`, 'markers'); }
    }
    // gates in order: pass between the markers
    const n = T.nearest(sim.pos.x, sim.pos.z);
    if (n.s < 0 || Math.abs(n.d) > T.compBound) { this.doReset('bounds'); return; }
    const g = T.gates[cs.gate];
    if (g && cs.prevS < g.s && n.s >= g.s && n.s - cs.prevS < 1) {
      if (Math.abs(n.d) < g.half) this.clearGate(true);
    }
    if (g && n.s > g.s + 0.5 && n.s - g.s < 3) this.clearGate(false);
    cs.prevS = n.s;
    this.lastSafeS = cs.gate > 0 ? T.gates[cs.gate - 1].s + 0.3 : 0.8;
  }

  private clearGate(ok: boolean) {
    const T = this.world.terrain, g = T.gates[this.cs.gate];
    if (!ok) this.penalty(20, `Gate ${g.n} missed`, 'missed');
    this.cs.gate++;
    if (this.cs.gate >= T.gates.length) { this.finish(); return; }
    if (ok) this.message(`Gate ${g.n} clean · next: ${T.gates[this.cs.gate].label}`, 1.4);
  }

  private compTimeout() {
    const left = this.world.terrain.gates.length - this.cs.gate;
    this.cs.points += 20 * left; this.cs.tally.missed += left;
    this.message(`Time! +${20 * left} for ${left} gates not reached`, 3);
    this.finish();
  }

  private finish() {
    this.phase = 'finished';
    this.ctx.input.clear();
    const d = this.ctx.store.data;
    if (this.comp || this.pile) { this.finishVenue(); return; }
    if (this.yard) {
      window.setTimeout(() => this.ctx.overlay.replaceChildren(h('div', { class: 'sheet-overlay' }, h('div', { class: 'modal-card result scroll-ok' },
        h('div', { class: 'eyebrow' }, `${YARD_NAME} · loop done`),
        h('div', { class: 'big-time' }, fmtTime(this.time)),
        h('table', { class: 'laps' },
          h('tr', {}, h('td', {}, 'Rollovers'), h('td', {}, String(this.rollovers))),
          h('tr', {}, h('td', {}, 'Resets'), h('td', {}, String(this.resets)))),
        h('div', { class: 'muted small' }, 'Test runs never pay or change your trail best.'),
        h('div', { class: 'row end' },
          h('button', { class: 'btn', onclick: () => this.ctx.go('crawltest') }, 'Run the yard again'),
          h('button', { class: 'btn primary', onclick: () => this.ctx.go('garage', { view: 'sandbox' }) }, 'Back to the sandbox')),
      ))), 900);
      return;
    }
    const pb = d.crawler.best == null || this.time < d.crawler.best;
    if (pb) d.crawler.best = this.time;
    const credits = ECONOMY.trailReward + (pb ? ECONOMY.trailPbBonus : 0);
    d.credits += credits;
    d.crawler.runs++;
    if (!d.monster.unlocked) {
      d.monster.unlocked = true;
      setTimeout(() => toast(`Unlocked: Mudhammer monster truck — buy it on the garage shelves (${ECONOMY.monsterPrice} cr)`, 'good', 4500), 1200);
    }
    this.ctx.store.save();
    window.setTimeout(() => this.ctx.overlay.replaceChildren(h('div', { class: 'sheet-overlay' }, h('div', { class: 'modal-card result scroll-ok' },
      h('div', { class: 'eyebrow' }, `${TRAIL_NAME} complete`),
      h('div', { class: 'big-time' }, fmtTime(this.time)),
      pb ? h('div', { class: 'tag good' }, 'New trail best!') : h('div', { class: 'muted small' }, `Best: ${fmtTime(d.crawler.best)}`),
      h('table', { class: 'laps' },
        h('tr', {}, h('td', {}, 'Rollovers'), h('td', {}, String(this.rollovers))),
        h('tr', {}, h('td', {}, 'Resets'), h('td', {}, String(this.resets)))),
      h('div', { class: 'earned' }, `+${credits} credits`),
      h('div', { class: 'row end' },
        h('button', { class: 'btn', onclick: () => this.ctx.go(this.screenName) }, 'Run it again'),
        h('button', { class: 'btn primary', onclick: () => this.ctx.go('garage', { view: 'storage' }) }, 'Back to the garage')),
    ))), 900);
    toast(`Trail finished · +${credits} cr`, 'good');
  }

  /** Event result: placed against the rivals' posted marks. */
  private finishEvent() {
    const d = this.ctx.store.data, c = d.crawler, ev = this.event!;
    const mark = this.comp ? this.cs.points : this.time;
    let pb: boolean;
    if (this.comp) { pb = c.compBest == null || mark < c.compBest; if (pb) c.compBest = mark; c.compRuns++; }
    else { pb = c.pileBest == null || mark < c.pileBest; if (pb) c.pileBest = mark; c.pileRuns++; }
    const pos = judgedPosition(ev, mark);
    const fmt = (v: number) => this.comp ? `${v} pts` : fmtTime(v);
    const names = [0, 1, 2].map((k) => RIVALS[(EVENTS.indexOf(ev) * 2 + k) % RIVALS.length].name);
    const all = [{ name: 'You', v: mark, you: true }, ...ev.rivalMarks!.map((v, i) => ({ name: names[i], v, you: false }))].sort((a, b) => a.v - b.v || (a.you ? 1 : -1));
    const prize = settleEvent(d, ev, pos), rec = eventRecord(d, ev.id);
    this.ctx.store.save();
    window.setTimeout(() => this.ctx.overlay.replaceChildren(h('div', { class: 'sheet-overlay' }, h('div', { class: 'modal-card result scroll-ok' },
      h('div', { class: 'eyebrow' }, `${ev.name} · ${ev.venueName}`),
      h('div', { class: 'big-time' }, `${fmt(mark)}`),
      pos === 1 ? h('div', { class: 'tag good' }, rec.wins === 1 ? 'First win here!' : 'Winner!') : h('div', { class: 'muted small' }, `${ordinal(pos)} · best finish here ${ordinal(rec.best ?? pos)}${pb ? ' · personal best' : ''}`),
      h('table', { class: 'laps' }, all.map((r, i) => h('tr', { class: r.you ? 'you' : '' }, h('td', {}, `${i + 1}. ${r.name}`), h('td', {}, fmt(r.v))))),
      h('div', { class: 'earned' }, prize ? `+${prize} credits prize money` : 'No prize this time: top three get paid'),
      h('div', { class: 'row end' },
        h('button', { class: 'btn', onclick: () => this.ctx.go(this.screenName, { event: ev.id }) }, 'Run it again'),
        h('button', { class: 'btn primary', onclick: () => this.ctx.go('garage', { view: 'storage' }) }, 'Back to the garage')),
    ))), 900);
  }

  private finishVenue() {
    if (this.event) { this.finishEvent(); return; }
    const d = this.ctx.store.data, c = d.crawler, T = this.world.terrain;
    let credits = 0, pb = false, big = '', sub = '';
    const rows: [string, string][] = [];
    if (this.comp) {
      const pts = this.cs.points, t = this.cs.tally;
      pb = c.compBest == null || pts < c.compBest;
      if (pb) c.compBest = pts;
      credits = Math.max(15, 150 - pts * 2) + (pb ? 25 : 0);
      big = `${pts} pts`;
      sub = `${Math.min(this.cs.gate, T.gates.length)}/${T.gates.length} gates · ${fmtTime(this.time)}`;
      rows.push(['Backups', `${t.backups} × 1`], ['Gate markers', `${t.markers} × 10`], ['Out of bounds', `${t.bounds} × 10`], ['Resets', `${t.resets} × 5`], ['Missed gates', `${t.missed} × 20`]);
      c.compRuns++;
    } else {
      pb = c.pileBest == null || this.time < c.pileBest;
      if (pb) c.pileBest = this.time;
      credits = 40 + (pb ? 20 : 0);
      big = fmtTime(this.time);
      rows.push(['Rollovers', String(this.rollovers)], ['Resets', String(this.resets)]);
      c.pileRuns++;
    }
    d.credits += credits;
    this.ctx.store.save();
    window.setTimeout(() => this.ctx.overlay.replaceChildren(h('div', { class: 'sheet-overlay' }, h('div', { class: 'modal-card result scroll-ok' },
      h('div', { class: 'eyebrow' }, this.comp ? `${COMP_NAME} · scorecard` : `${PILE_NAME} · summit!`),
      h('div', { class: 'big-time' }, big),
      sub ? h('div', { class: 'muted small' }, sub) : null,
      pb ? h('div', { class: 'tag good' }, this.comp ? 'New best score!' : 'New summit best!') : h('div', { class: 'muted small' }, this.comp ? `Best: ${c.compBest} pts` : `Best: ${fmtTime(c.pileBest)}`),
      h('table', { class: 'laps' }, ...rows.map(([k, v]) => h('tr', {}, h('td', {}, k), h('td', {}, v)))),
      h('div', { class: 'earned' }, `+${credits} credits`),
      h('div', { class: 'row end' },
        h('button', { class: 'btn', onclick: () => this.ctx.go(this.screenName) }, 'Run it again'),
        h('button', { class: 'btn primary', onclick: () => this.ctx.go('garage', { view: 'storage' }) }, 'Back to the garage')),
    ))), 900);
    toast(`${this.comp ? 'Comp run scored' : 'Summit!'} · +${credits} cr`, 'good');
  }

  private updateHud() {
    const e = this.els, T = this.world.terrain, d = this.ctx.store.data;
    e.cp.textContent = this.comp ? `${Math.min(this.cs.gate + 1, T.gates.length)}/${T.gates.length}` : `${Math.min(this.nextCp, T.checkpoints.length - 1)}/${T.checkpoints.length - 1}`;
    e.time.textContent = this.comp ? fmtTime(Math.max(0, COMP_LIMIT - this.time)) : fmtTime(this.time);
    if (e.pts) e.pts.textContent = String(this.cs.points);
    const c = d.crawler.charge;
    e.batBar.style.width = `${c}%`;
    (e.batBar.parentElement as HTMLElement).className = `bar mini ${c > 60 ? 'ok' : c > 25 ? 'mid' : 'low'}`;
    e.batTxt.textContent = `${Math.round(c)}%`;
    e.sub1.textContent = this.phase === 'ready' ? 'Pull the trigger to start the clock' : `Rollovers ${this.rollovers}`;
    if (this.yard) {
      const sm = this.sim, S = sm.S;
      const eu = new THREE.Euler().setFromQuaternion(sm.q, 'YZX');
      this.tele.update({
        speed: sm.forwardSpeed, scale: 10, throttle: this.ctx.input.throttle, steer: this.ctx.input.steer, steerDeg: THREE.MathUtils.radToDeg(sm.steer),
        susp: sm.susp.map((v) => (S.restLen + S.travel - v) / (2 * S.travel)), grounded: sm.grounded.slice(),
        pitch: THREE.MathUtils.radToDeg(eu.z), roll: THREE.MathUtils.radToDeg(eu.x), extra: `Surface: ${T.surfaceAt(sm.pos.x, sm.pos.z)} · grip ×${T.gripAt(sm.pos.x, sm.pos.z).toFixed(2)}`,
      });
      e.sub2.textContent = this.camMode === 'walk' ? 'Walk-along view' : this.camMode === 'chase' ? 'Chase view' : 'Side view';
      return;
    }
    if (this.comp) { e.sub1.textContent = this.phase === 'ready' ? 'Pull the trigger to start' : `Next: ${T.gates[this.cs.gate]?.label ?? 'done'} · batt ${Math.round(c)}%`; e.sub2.textContent = this.event ? `Win: <${this.event.rivalMarks![0]} pts` : `Best ${d.crawler.compBest != null ? `${d.crawler.compBest} pts` : '--'}`; return; }
    e.sub2.textContent = this.event ? `Win: <${fmtTime(this.event.rivalMarks![0])}` : this.pile ? `Best ${d.crawler.pileBest != null ? fmtTime(d.crawler.pileBest) : '--'}` : `Best ${d.crawler.best != null ? fmtTime(d.crawler.best) : '--'}`;
  }

  private poseShadowAndGuide() {
    const w = this.world, T = w.terrain, p = this.sim.pos;
    const g = T.heightAt(p.x, p.z);
    w.shadow.position.set(p.x, g + 0.012, p.z);
    const f = this.sim.forward;
    w.shadow.rotation.z = Math.atan2(-f.z, f.x);
    (w.shadow.material as THREE.MeshBasicMaterial).opacity = THREE.MathUtils.clamp(0.8 - (p.y - g - 0.1) * 3, 0.2, 0.8);
    const nextS = this.comp ? T.gates[this.cs.gate]?.s : this.nextCp < T.checkpoints.length ? T.checkpoints[this.nextCp] : undefined;
    if (nextS != null && this.phase !== 'finished') {
      const s = nextS;
      const q = T.pointAt(s), t = T.tangentAt(s);
      w.guide.visible = true;
      w.guide.position.set(q.x, T.groundAt(q.x, q.z), q.z);
      w.guide.rotation.set(0, Math.atan2(t.x, t.z), 0);
    } else w.guide.visible = false;
  }

  private updateCamera(dt: number) {
    const T = this.world.terrain, cam = this.camera, p = this.sim.pos;
    // the operator walks the footpath, staying a little behind the truck's progress along the trail
    const n = T.nearest(p.x, p.z);
    if (n.s >= 0) {
      const want = Math.max(0, n.s - 0.5);
      const maxStep = 1.6 * dt; // walking pace
      this.opS += THREE.MathUtils.clamp(want - this.opS, -maxStep, maxStep);
    }
    const foot = T.walkPoint(this.opS);
    const eye = new THREE.Vector3(foot.x, foot.y + EYE, foot.z);
    if (this.camMode !== 'walk') {
      const f = this.sim.forward.clone(); f.y = 0; f.normalize();
      if (this.camMode === 'chase') eye.copy(p).addScaledVector(f, -0.95).add(new THREE.Vector3(0, 0.42, 0));
      else eye.copy(p).add(new THREE.Vector3(-f.z, 0, f.x).multiplyScalar(0.9)).add(new THREE.Vector3(0, 0.18, 0));
      eye.y = Math.max(eye.y, T.heightAt(eye.x, eye.z) + 0.12);
    }
    cam.position.lerp(eye, 1 - Math.exp(-dt * 6));
    if (cam.position.distanceTo(eye) > 4) cam.position.copy(eye);
    this.look.lerp(p, 1 - Math.exp(-dt * 8));
    cam.lookAt(this.look);
    // keep the truck in the clear area above the transmitter band
    const band = this.controls.bandH;
    const trackH = Math.max(1, this.H - band);
    const cy = Math.min(this.H / 2, (70 + trackH) / 2);
    const fullH = 2 * (this.H - cy);
    const dist = cam.position.distanceTo(p);
    const fovTrack = THREE.MathUtils.clamp(THREE.MathUtils.mapLinear(dist, 1.5, 4, 50, 34), 30, 52);
    cam.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(fovTrack) / 2) * fullH / trackH));
    cam.aspect = this.W / fullH;
    cam.setViewOffset(this.W, fullH, 0, fullH - this.H, this.W, this.H);
    cam.updateProjectionMatrix();
    this.world.focusShadows(p);
  }

  resize(w: number, hgt: number) {
    this.W = Math.max(1, w); this.H = Math.max(1, hgt);
    this.controls.layout(this.W, this.H);
    this.ctx.stage.style.setProperty('--band', `${this.controls.bandH}px`);
  }
}
