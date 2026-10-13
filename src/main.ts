// App shell: renderer, screen state machine, shared systems, global input safety.
import * as THREE from 'three';
import './style.css';
import { InputController } from './core/InputController';
import { SaveStore } from './core/SaveStore';
import { ServiceSystem } from './core/ServiceSystem';
import { GarageScene } from './scenes/GarageScene';
import { PitScene } from './scenes/PitScene';
import { TrackScene } from './scenes/TrackScene';
import { VenueWorld } from './scenes/VenueWorld';
import { CrawlScene } from './scenes/CrawlScene';
import { MowScene } from './scenes/MowScene';
import { MonsterScene } from './scenes/MonsterScene';
import { MonsterWorld } from './scenes/MonsterWorld';
import { CrawlWorld } from './scenes/CrawlWorld';
import { DriftScene } from './scenes/DriftScene';
import { DriftWorld } from './scenes/DriftWorld';
import { AppContext, Screen, ScreenName } from './scenes/common';
import { $, confirmModal, h, toast } from './ui/dom';

class App implements AppContext {
  renderer: THREE.WebGLRenderer;
  store = new SaveStore();
  service = new ServiceSystem(() => this.store.data, () => this.store.save());
  input = new InputController();
  hud = $('hud');
  overlay = $('overlay');
  panel = $('panel');
  canvas = $('gl') as HTMLCanvasElement;
  stage = $('stage');

  private screens: Partial<Record<ScreenName, Screen>> = {};
  private venue: VenueWorld | null = null;
  private crawlWorld: CrawlWorld | null = null;
  private yardWorld: CrawlWorld | null = null;
  private pileWorld: CrawlWorld | null = null;
  private compWorld: CrawlWorld | null = null;
  private provingWorld: VenueWorld | null = null;
  private monsterWorld: MonsterWorld | null = null;
  private driftWorld: DriftWorld | null = null;
  current: Screen | null = null;
  currentName: ScreenName | null = null;
  private clock = new THREE.Clock();
  private size = { w: 1, h: 1 };
  private transitioning = false;

  constructor() {
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: !this.store.data.settings.reducedGfx, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // shader error checks force a synchronous compile + log read for every program (seconds on phones)
    this.renderer.debug.checkShaderErrors = import.meta.env.DEV;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.applyGraphics();

    // a lost GPU context (backgrounded tab, driver reset) shouldn't kill the session
    this.canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.input.clear(); if (this.currentName === 'drive') this.current?.pause?.(); });
    this.canvas.addEventListener('webglcontextrestored', () => this.applyGraphics());
    new ResizeObserver(() => this.resize()).observe(this.stage);
    this.resize();
    this.bindCanvasPointer();
    this.bindSafety();

    if (this.store.recoveredFromCorrupt) setTimeout(() => toast('Your save was unreadable, so a fresh one was started.', 'warn', 4000), 400);
    this.go('garage');
    this.renderer.setAnimationLoop(() => this.frame());
  }

  applyGraphics() {
    const reduced = this.store.data.settings.reducedGfx;
    this.maxRatio = Math.min(window.devicePixelRatio || 1, reduced ? 1 : 2);
    this.renderRatio = Math.min(this.renderRatio || this.maxRatio, this.maxRatio);
    this.renderer.setPixelRatio(this.renderRatio);
    this.renderer.shadowMap.enabled = !reduced;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // materials need recompiling after toggling shadows
    for (const s of [this.screens.garage?.scene, this.venue?.scene, this.crawlWorld?.scene, this.yardWorld?.scene, this.pileWorld?.scene, this.compWorld?.scene, this.provingWorld?.scene, this.monsterWorld?.scene, this.driftWorld?.scene]) s?.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(m)) m.forEach((x) => (x.needsUpdate = true)); else if (m) m.needsUpdate = true;
    });
    this.resize();
  }

  private getVenue() {
    const want = this.store.data.raceTrack;
    if (this.venue && this.venue.layout !== want) {
      // another race track was picked: rebuild the venue and the screens that drew it
      this.venue.scene.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); });
      this.venue = null; delete this.screens.pit; delete this.screens.drive;
    }
    if (!this.venue) this.venue = new VenueWorld(this.renderer, want);
    return this.venue;
  }

  private getScreen(name: ScreenName): Screen {
    if ((name === 'pit' || name === 'drive') && this.venue && this.venue.layout !== this.store.data.raceTrack) this.getVenue();
    if (name === 'drift' && this.driftWorld && this.driftWorld.track.layout !== this.store.data.drift.venue) {
      disposeScene(this.driftWorld.scene); this.driftWorld = null; delete this.screens.drift;
    }
    if (name === 'monster' && this.monsterWorld && this.monsterWorld.terrain.layout !== this.store.data.monster.venue) {
      disposeScene(this.monsterWorld.scene); this.monsterWorld = null; delete this.screens.monster;
    }
    let s = this.screens[name];
    if (!s) {
      if (name === 'garage') s = new GarageScene(this);
      else if (name === 'pit') s = new PitScene(this, this.getVenue());
      else if (name === 'mow') s = new MowScene(this);
      else if (name === 'crawl') { if (!this.crawlWorld) this.crawlWorld = new CrawlWorld(this.renderer); s = new CrawlScene(this, this.crawlWorld); }
      else if (name === 'monster') { if (!this.monsterWorld) this.monsterWorld = new MonsterWorld(this.renderer, this.store.data.monster.venue); s = new MonsterScene(this, this.monsterWorld); }
      else if (name === 'drift') { if (!this.driftWorld) this.driftWorld = new DriftWorld(this.renderer, this.store.data.drift.venue); s = new DriftScene(this, this.driftWorld); }
      else if (name === 'crawlpile') { if (!this.pileWorld) this.pileWorld = new CrawlWorld(this.renderer, 'pile'); s = new CrawlScene(this, this.pileWorld); }
      else if (name === 'crawlcomp') { if (!this.compWorld) this.compWorld = new CrawlWorld(this.renderer, 'comp'); s = new CrawlScene(this, this.compWorld); }
      else if (name === 'crawltest') { if (!this.yardWorld) this.yardWorld = new CrawlWorld(this.renderer, 'yard'); s = new CrawlScene(this, this.yardWorld); }
      else if (name === 'proving') { if (!this.provingWorld) this.provingWorld = new VenueWorld(this.renderer, 'proving'); s = new TrackScene(this, this.provingWorld); }
      else s = new TrackScene(this, this.getVenue());
      this.screens[name] = s;
      s.resize(this.size.w, this.size.h);
    }
    return s;
  }

  /** Only one driving venue stays loaded (plus the garage): entering another frees the previous one's GPU memory. */
  private releaseOtherWorlds(next: ScreenName) {
    const key = (n: ScreenName) => n === 'pit' || n === 'drive' ? 'venue' : n === 'garage' || n === 'mow' ? null : n;
    const want = key(next);
    if (!want) return;
    const slots: [string, ScreenName[], () => { scene: THREE.Scene } | null, () => void][] = [
      ['venue', ['pit', 'drive'], () => this.venue, () => { this.venue = null; }],
      ['proving', ['proving'], () => this.provingWorld, () => { this.provingWorld = null; }],
      ['crawl', ['crawl'], () => this.crawlWorld, () => { this.crawlWorld = null; }],
      ['crawltest', ['crawltest'], () => this.yardWorld, () => { this.yardWorld = null; }],
      ['crawlpile', ['crawlpile'], () => this.pileWorld, () => { this.pileWorld = null; }],
      ['crawlcomp', ['crawlcomp'], () => this.compWorld, () => { this.compWorld = null; }],
      ['monster', ['monster'], () => this.monsterWorld, () => { this.monsterWorld = null; }],
      ['drift', ['drift'], () => this.driftWorld, () => { this.driftWorld = null; }],
    ];
    for (const [k, screens, get, clear] of slots) {
      const w = get();
      if (k === want || !w) continue;
      disposeScene(w.scene);
      clear();
      for (const sn of screens) delete this.screens[sn];
    }
  }

  go(name: ScreenName, opts?: Record<string, unknown>) {
    if (this.transitioning) return;
    this.transitioning = true;
    const needsVenue = name === 'crawl' ? !this.crawlWorld : name === 'crawltest' ? !this.yardWorld : name === 'crawlpile' ? !this.pileWorld : name === 'crawlcomp' ? !this.compWorld : name === 'proving' ? !this.provingWorld : name === 'monster' ? (!this.monsterWorld || this.monsterWorld.terrain.layout !== this.store.data.monster.venue) : name === 'drift' ? (!this.driftWorld || this.driftWorld.track.layout !== this.store.data.drift.venue) : name !== 'garage' && name !== 'mow' && (!this.venue || this.venue.layout !== this.store.data.raceTrack);
    if (needsVenue) {
      this.panel.replaceChildren(h('div', { class: 'loading' }, 'Loading up the truck…'));
      this.overlay.replaceChildren();
      this.hud.replaceChildren();
    }
    // let the loading message paint before building the venue
    const run = () => {
      try {
        this.input.clear();
        this.current?.exit();
        this.releaseOtherWorlds(name);
        const s = this.getScreen(name);
        this.current = s;
        this.currentName = name;
        document.body.dataset.screen = name;
        this.overlay.replaceChildren();
        s.resize(this.size.w, this.size.h);
        s.enter(opts);
        this.resize();
        if (needsVenue) {
          // compile the new venue's shaders in the background (parallel where the GPU driver allows) before the first frame
          this.warming = true; document.body.classList.add('warming');
          const done = () => { this.warming = false; document.body.classList.remove('warming'); };
          this.renderer.compileAsync(s.scene, s.camera).then(done, done);
          window.setTimeout(done, 8000); // never hang on a driver that doesn't report back
        }
      } finally {
        this.transitioning = false;
      }
    };
    if (needsVenue) requestAnimationFrame(() => setTimeout(run, 0)); else run();
  }

  private resize() {
    const r = this.stage.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width)), hgt = Math.max(1, Math.round(r.height));
    const changed = w !== this.size?.w || hgt !== this.size?.h;
    this.size = { w, h: hgt };
    if (changed) this.renderer.setSize(w, hgt, false); // reallocating the drawing buffer is expensive
    for (const s of Object.values(this.screens)) s?.resize(w, hgt);
  }

  // adaptive resolution: when frames run long the render scale steps down (and back up when there is headroom)
  private maxRatio = 1;
  private renderRatio = 0;
  private perf = { acc: 0, n: 0, t: 0, hold: 0 };
  private adaptResolution(rawDt: number) {
    const p = this.perf;
    if (this.transitioning || document.hidden || rawDt > 0.25) { p.acc = 0; p.n = 0; p.t = 0; return; } // loading hitches don't count
    p.acc += rawDt; p.n++; p.t += rawDt;
    if (p.t < 2) return;
    const avg = p.acc / p.n; p.acc = 0; p.n = 0; p.t = 0;
    if (p.hold > 0) { p.hold--; return; }
    let next = this.renderRatio;
    if (avg > 1 / 45) next = Math.max(0.75, this.renderRatio - 0.25);            // under ~45 fps: render fewer pixels
    else if (avg < 1 / 58 && this.renderRatio < this.maxRatio) next = Math.min(this.maxRatio, this.renderRatio + 0.25);
    if (next !== this.renderRatio) {
      p.hold = next < this.renderRatio ? 1 : 2; // after a step up, wait longer before judging again
      this.renderRatio = next; this.renderer.setPixelRatio(next);
    }
  }

  private warming = false;
  private frameNo = 0;
  private lastShadowScreen = '';
  private frame() {
    if (this.warming) { this.clock.getDelta(); return; }
    const raw = this.clock.getDelta();
    const dt = Math.min(0.05, raw);
    const s = this.current;
    if (!s) return;
    this.adaptResolution(raw);
    s.update(dt, this.clock.elapsedTime);
    // shadow maps: the garage is nearly static, so refresh its shadows every 4th frame; venues every frame
    // (every 2nd once the adaptive resolution has had to step down)
    const every = this.currentName === 'garage' ? 4 : this.renderRatio < Math.min(1, this.maxRatio) ? 2 : 1;
    this.renderer.shadowMap.autoUpdate = false;
    if (this.frameNo++ % every === 0 || this.lastShadowScreen !== this.currentName) { this.renderer.shadowMap.needsUpdate = true; this.lastShadowScreen = this.currentName ?? ''; }
    this.renderer.render(s.scene, s.camera);
    const ov = s.overlay?.();
    if (ov) {
      // hands + transmitter: separate scene, depth cleared, drawn only into the bottom band
      const r = this.renderer;
      r.autoClear = false;
      r.clearDepth();
      r.setScissorTest(true);
      r.setViewport(0, 0, this.size.w, ov.height);
      r.setScissor(0, 0, this.size.w, ov.height);
      r.render(ov.scene, ov.camera);
      r.setScissorTest(false);
      r.setViewport(0, 0, this.size.w, this.size.h);
      r.autoClear = true;
    }
  }

  /** Taps raycast into the scene; drags rotate inspection views. Not used while driving. */
  private bindCanvasPointer() {
    // One finger: tap (raycast) or drag (look/orbit). Two fingers: pinch zoom. A drag that ends on a
    // hotspot never counts as a tap (6 px threshold), and a pinch never produces a tap.
    const pts = new Map<number, { x: number; y: number; sx: number; sy: number }>();
    let moved = false, pinched = false, lastPinch = 0;
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      if (this.currentName === 'drive' || pts.size >= 2) return;
      if (pts.size === 0) { moved = false; pinched = false; }
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY });
      try { c.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      if (pts.size === 2) { const [a, b] = [...pts.values()]; lastPinch = Math.hypot(a.x - b.x, a.y - b.y); pinched = true; }
    });
    c.addEventListener('pointermove', (e) => {
      const p = pts.get(e.pointerId);
      if (!p) return;
      if (pts.size === 2) {
        p.x = e.clientX; p.y = e.clientY;
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (lastPinch > 0 && d > 0) this.current?.zoom?.(lastPinch / d);
        lastPinch = d;
        return;
      }
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      if (!moved && Math.hypot(e.clientX - p.sx, e.clientY - p.sy) < 6) return;
      moved = true;
      this.current?.drag?.(dx, dy);
      p.x = e.clientX; p.y = e.clientY;
    });
    const end = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      if (pts.size === 0 && !moved && !pinched && e.type === 'pointerup') {
        const r = c.getBoundingClientRect();
        const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
        this.current?.tap?.(ndc);
      }
      if (pts.size < 2) lastPinch = 0;
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('wheel', (e) => {
      if (this.currentName === 'drive') return;
      e.preventDefault();
      this.current?.zoom?.(Math.exp(e.deltaY * 0.0012));
    }, { passive: false });
  }

  /** Never let a held input survive a blur, background or gesture. */
  private bindSafety() {
    const stop = () => {
      this.input.clear();
      if (this.currentName === 'drive') this.current?.pause?.();
      this.store.save();
    };
    window.addEventListener('blur', stop);
    document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
    window.addEventListener('pagehide', () => this.store.save());
    // block page scroll / pinch / double-tap zoom while playing
    document.addEventListener('touchmove', (e) => { if (!(e.target as HTMLElement).closest('.scroll-ok')) e.preventDefault(); }, { passive: false });
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('dblclick', (e) => e.preventDefault());
  }

  private rangeField(label: string, id: string, min: number, max: number, step: number, value: number, fmt: (v: number) => string, set: (v: number) => void) {
    const out = h('b', {}, fmt(value));
    return h('label', { class: 'field scroll-ok', for: id },
      h('span', {}, label, out),
      h('input', {
        id, type: 'range', min, max, step, value,
        oninput: (e: Event) => { const v = Number((e.target as HTMLInputElement).value); set(v); out.textContent = fmt(v); },
        onchange: () => this.store.save(),
      }));
  }

  openSettings() {
    const d = this.store.data;
    const root = this.overlay;
    const close = () => { root.replaceChildren(); };
    root.replaceChildren(
      h('div', { class: 'sheet-overlay' },
        h('div', { class: 'modal-card scroll-ok' },
          h('h2', {}, 'Settings'),
          h('label', { class: 'toggle' },
            h('input', { type: 'checkbox', checked: d.settings.reducedGfx, onchange: (e: Event) => { d.settings.reducedGfx = (e.target as HTMLInputElement).checked; this.store.save(); this.applyGraphics(); } }),
            h('span', {}, 'Reduced graphics (no shadows, 1× resolution)')),
          h('label', { class: 'toggle' },
            h('input', { type: 'checkbox', checked: d.settings.showMap, onchange: (e: Event) => { d.settings.showMap = (e.target as HTMLInputElement).checked; this.store.save(); } }),
            h('span', {}, 'Show track overview map while driving')),
          h('div', { class: 'settings-section' }, 'Transmitter'),
          this.rangeField('Steering sensitivity', 'set-sens', 0.5, 1.8, 0.05, d.settings.steerSensitivity, (v) => `${Math.round(v * 100)}%`, (v) => { d.settings.steerSensitivity = v; }),
          this.rangeField('Transmitter size', 'set-size', 0.88, 1.12, 0.02, d.settings.controllerScale, (v) => `${Math.round(v * 100)}%`, (v) => { d.settings.controllerScale = v; }),
          h('div', { class: 'field' }, h('span', {}, 'Wheel gesture'),
            h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Wheel gesture' },
              ...(['circular', 'horizontal'] as const).map((m) => h('button', {
                class: `btn ${d.settings.steerMode === m ? 'on' : ''}`, role: 'radio', 'aria-checked': d.settings.steerMode === m,
                onclick: (e: Event) => {
                  d.settings.steerMode = m; this.store.save();
                  const seg = (e.currentTarget as HTMLElement).parentElement!;
                  seg.querySelectorAll('button').forEach((b) => { const on = b === e.currentTarget; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
                },
              }, m === 'circular' ? 'Turn in a circle' : 'Slide sideways')))),
          h('label', { class: 'toggle' },
            h('input', { id: 'set-motion', type: 'checkbox', checked: d.settings.reducedMotion, onchange: (e: Event) => { d.settings.reducedMotion = (e.target as HTMLInputElement).checked; this.store.save(); } }),
            h('span', {}, 'Reduce decorative motion')),
          h('div', { class: 'muted small' }, 'Turn the wheel (right) to steer. Pull down on the trigger (left) to accelerate, push up to brake. Keyboard: WASD or arrows, R reset, Esc pause.'),
          h('div', { class: 'row between' },
            h('button', {
              class: 'btn danger', onclick: async () => {
                close();
                const ok = await confirmModal('Reset save?', 'This wipes credits, best times, part condition and setup on this device. It cannot be undone.', 'Reset everything', true);
                if (ok) { this.store.reset(); toast('Save reset', 'info'); this.go('garage'); }
              },
            }, 'Reset save…'),
            h('button', { class: 'btn primary', onclick: close }, 'Done'),
          ),
        ),
      ),
    );
  }
}

const app = new App();
// Exposed for automated behaviour checks and debugging.
(window as unknown as { __rc: App }).__rc = app;
(window as unknown as { __THREE: typeof THREE }).__THREE = THREE; // debug / test hooks

/** Free a scene's GPU resources (geometry buffers, textures, programs, shadow maps). Shared env maps are kept. */
function disposeScene(scene: THREE.Scene) {
  const tex = new Set<THREE.Texture>(), mats = new Set<THREE.Material>();
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mm = m.material as THREE.Material | THREE.Material[] | undefined;
    for (const mat of Array.isArray(mm) ? mm : mm ? [mm] : []) {
      mats.add(mat);
      for (const v of Object.values(mat)) if (v && (v as THREE.Texture).isTexture) tex.add(v as THREE.Texture);
    }
    const l = o as THREE.DirectionalLight;
    if (l.isLight && l.shadow?.map) { l.shadow.map.dispose(); l.shadow.map = null as unknown as THREE.WebGLRenderTarget; }
  });
  for (const t of tex) if (!(t as THREE.Texture & { isRenderTargetTexture?: boolean }).isRenderTargetTexture && t !== scene.environment) t.dispose();
  for (const m of mats) m.dispose();
}
