// Track-side pit table: battery swaps, quick repairs and setup changes on the same vehicle state.
import { EVENTS, ordinal } from '../data/events';
import * as THREE from 'three';
import { PartId } from '../data/specs';
import { activeVehicle, installedBattery, trackBest, trackUnlocked } from '../core/state';
import { RACE_TRACKS } from '../sim/Track';
import { lookFor } from '../assets/buggyModel';
import { PartsSheet } from '../ui/PartsSheet';
import { bar, fmtTime, h, toast } from '../ui/dom';
import { AppContext, INTERNAL_PARTS, OrbitInspect, Screen, fovFor, ghostShell, pickPart, syncBuggy } from './common';
import { VenueWorld } from './VenueWorld';

export class PitScene implements Screen {
  camera = new THREE.PerspectiveCamera(50, 1, 0.05, 200);
  private orbit: OrbitInspect;
  private sheet: PartsSheet | null = null;
  private selected: PartId | null = null;
  private ray = new THREE.Raycaster();
  private aspect = 1;
  private time = 0;
  private tmp = new THREE.Vector3();

  constructor(private ctx: AppContext, private world: VenueWorld) {
    // default view: from the pit chair side looking over the table toward the track
    this.orbit = new OrbitInspect(world.pitCarPos.clone().add(new THREE.Vector3(0, 0.08, 0)), 1.1, 0.25, 0.5, 0.2, 1.2);
  }

  get scene() { return this.world.scene; }

  enter() {
    const w = this.world;
    { const av = activeVehicle(this.ctx.store.data); w.useClass(av.id, lookFor(av)); }
    w.car.root.visible = false;
    w.shadow.visible = false;
    w.marker.visible = false;
    w.placeGuide(null);
    w.pitCar.root.visible = true;
    w.focusShadows(w.pitCarPos);
    this.selected = null;
    this.ctx.store.save();
    this.sync();
    this.render();
  }

  exit() {
    this.world.pitCar.root.visible = false;
    this.world.pitCar.highlight(null, 0);
    ghostShell(this.world.pitCar, false);
    this.sheet = null;
    this.ctx.store.save();
  }

  private sync() {
    syncBuggy(this.world.pitCar, this.ctx.store.data);
    const d = this.ctx.store.data;
    ghostShell(this.world.pitCar, !!this.selected && activeVehicle(d).shellOn && INTERNAL_PARTS.includes(this.selected));
  }

  private render() {
    const d = this.ctx.store.data;
    const bat = installedBattery(d);
    const v = activeVehicle(d);
    this.sheet = new PartsSheet(this.ctx.service, 'pit', (p) => { this.selected = p; this.sync(); }, () => { this.sync(); this.render(); });
    if (this.selected) this.sheet.selected = this.selected; else this.selected = this.sheet.selected;
    this.sheet.render();
    this.sync();
    const last = d.results[0];
    const low = !bat || bat.charge < 15;
    this.ctx.panel.className = 'panel pit';
    this.ctx.panel.replaceChildren(
      h('div', { class: 'panel-head' },
        h('div', {}, h('div', { class: 'eyebrow' }, `${RACE_TRACKS.find((t) => t.id === d.raceTrack)?.name ?? 'Dirt Classic'} · pit table`), h('div', { class: 'title' }, 'Pit area')),
        h('div', { class: 'row' },
          h('span', { class: 'credits' }, `${d.credits} cr`),
          h('button', { class: 'icon-btn', 'aria-label': 'Settings', onclick: () => this.ctx.openSettings() }, '⚙'),
        ),
      ),
      h('div', { class: 'panel-body scroll-ok' },
        h('div', { class: 'grid4' },
          h('div', {}, h('small', {}, 'Battery'), bar(bat?.charge ?? 0)),
          h('div', {}, h('small', {}, 'Tires'), bar(v.condition.tires)),
          h('div', {}, h('small', {}, 'Shocks'), bar(v.condition.shocks)),
          h('div', {}, h('small', {}, 'Chassis'), bar(v.condition.chassis)),
        ),
        last ? h('div', { class: 'muted small last' },
          last.mode === 'trial' && last.total
            ? `Last run: ${fmtTime(last.total)}${last.penalties ? ` (incl. +${last.penalties}s)` : ''}${last.pb ? ' · new best!' : ''} · +${last.credits} cr`
            : `Last run: practice · ${last.laps.length} lap${last.laps.length === 1 ? '' : 's'}`) : null,
        low ? h('div', { class: 'warn-line' }, 'Battery is low — swap or charge it before you run.') : null,
        this.sheet.el,
      ),
      this.trackPicker(),
      this.eventRow(),
      h('div', { class: 'session-bar' },
        h('button', { class: 'btn ghost', onclick: () => this.ctx.go('garage', { returning: true }) }, '⌂ Home'),
        h('button', { class: 'btn', onclick: () => this.start('practice') }, 'Practice'),
        h('button', { class: 'btn primary', onclick: () => this.start('trial') }, '3-Lap Trial'),
      ),
    );
    this.ctx.hud.replaceChildren(h('div', { class: 'hint-chip' }, 'Drag to rotate · tap a part'));
    this.ctx.overlay.replaceChildren();
  }

  /** Race track chips: changing track reloads the pit at the new venue. */
  private trackPicker() {
    const d = this.ctx.store.data, cur = RACE_TRACKS.find((t) => t.id === d.raceTrack)!;
    const B = trackBest(d);
    return h('div', { class: 'track-pick' },
      h('div', { class: 'chips' }, RACE_TRACKS.map((t) => {
        const open = trackUnlocked(d, t.id);
        return h('button', {
          class: `chip ${t.id === d.raceTrack ? 'on' : ''} ${open ? '' : 'locked'}`, 'data-track': t.id, 'aria-pressed': t.id === d.raceTrack, disabled: !open,
          onclick: () => { if (!open || t.id === d.raceTrack) return; d.raceTrack = t.id; this.ctx.store.save(); this.ctx.go('pit'); },
        }, open ? t.name : `🔒 ${t.name}`);
      })),
      h('div', { class: 'muted small' }, `${cur.blurb}. Best trial ${B.trial ? fmtTime(B.trial) : '--'} · best lap ${B.lap ? B.lap.toFixed(2) : '--'}`,
        (() => { const nx = RACE_TRACKS[RACE_TRACKS.indexOf(cur) + 1]; return nx && !trackUnlocked(d, nx.id) ? ` · finish a 3-lap trial here to open ${nx.name}` : ''; })()),
    );
  }

  /** Events on the events board that run at this track: race the AI field from here. */
  private eventRow() {
    const d = this.ctx.store.data;
    const evs = EVENTS.filter((e) => e.vehicle === 'buggy' && e.venue === d.raceTrack);
    if (!evs.length) return document.createDocumentFragment();
    return h('div', { class: 'event-row' }, evs.map((e) => {
      const open = e.unlock(d), rec = d.events[e.id];
      return h('div', { class: `event-line ${open ? '' : 'locked'}` },
        h('span', { class: 'trophy', 'aria-hidden': 'true' }, '🏆'),
        h('div', { class: 'grow' }, h('strong', {}, e.name),
          h('div', { class: 'muted small' }, open
            ? `${e.laps} laps vs 3 rivals · ${e.prizes.join(' / ')} cr${rec?.best ? ` · best ${ordinal(rec.best)}` : ''}${rec?.wins ? ` · ${rec.wins} win${rec.wins > 1 ? 's' : ''}` : ''}`
            : `🔒 ${e.lockHint}`)),
        h('button', { class: `btn small ${open ? 'primary' : 'disabled'}`, disabled: !open, 'data-event': e.id, onclick: () => this.start('race', e.id) }, 'Race'));
    }));
  }

  private start(mode: 'practice' | 'trial' | 'race', event?: string) {
    const d = this.ctx.store.data;
    const v = activeVehicle(d);
    if (!v.batteryId) { toast('Install a battery first', 'warn'); return; }
    if (!v.shellOn) { v.shellOn = true; toast('Shell refitted', 'info'); }
    this.ctx.go('drive', { mode, event });
  }

  tap(ndc: THREE.Vector2) {
    this.ray.setFromCamera(ndc, this.camera);
    const d = this.ctx.store.data;
    const p = pickPart(this.ray, this.world.pitCar, !!this.selected && activeVehicle(d).shellOn && INTERNAL_PARTS.includes(this.selected));
    if (p && this.sheet) this.sheet.select(p);
  }

  drag(dx: number, dy: number) { this.orbit.drag(dx, dy); }

  update(dt: number) {
    this.time += dt;
    this.orbit.dist = THREE.MathUtils.clamp(0.95 / Math.min(1, this.aspect + 0.15), 0.95, 1.5);
    const k = 1 - Math.exp(-dt * 8);
    this.camera.position.lerp(this.orbit.position(this.tmp), k);
    this.camera.lookAt(this.orbit.target);
    this.world.pitCar.highlight(this.selected, this.time);
  }

  resize(w: number, hgt: number) {
    this.aspect = w / Math.max(1, hgt);
    this.camera.aspect = this.aspect;
    this.camera.fov = fovFor(55, this.aspect, 40, 80);
    this.camera.updateProjectionMatrix();
    if (this.time === 0) this.camera.position.copy(this.orbit.position(this.tmp));
  }
}
