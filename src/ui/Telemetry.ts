// Live telemetry for the proving grounds: speed (real and scale), throttle, steering, per-wheel
// suspension travel, pitch/roll and airtime. A compact translucent card under the HUD.
import { h } from './dom';

export interface TelemetryFrame {
  speed: number;          // m/s (signed, forward +)
  scale: number;          // model scale divisor (8 for 1/8, 10 for 1/10)
  throttle: number;       // -1..1 input
  steer: number;          // -1..1 input
  steerDeg: number;       // actual wheel angle (deg)
  susp: number[];         // 0 = full droop .. 1 = full bump, FL FR RL RR
  grounded: boolean[];    // per wheel
  pitch: number; roll: number; // deg
  air?: number;           // seconds airborne (buggy)
  extra?: string;         // free text line
}

export class Telemetry {
  el: HTMLElement;
  private rows: Record<string, HTMLElement> = {};
  private bars: HTMLElement[] = [];
  private maxSpeed = 0;

  constructor() {
    const row = (k: string, label: string) => h('div', { class: 'tm-row' }, h('small', {}, label), (this.rows[k] = h('b', {}, '–')));
    const wheels = h('div', { class: 'tm-wheels' }, ['FL', 'FR', 'RL', 'RR'].map((n) => {
      const fill = h('i', {}); this.bars.push(fill);
      return h('div', { class: 'tm-wheel' }, h('div', { class: 'tm-bar' }, fill), h('small', {}, n));
    }));
    this.el = h('div', { class: 'telemetry', 'aria-label': 'Telemetry' },
      h('div', { class: 'tm-title' }, 'TELEMETRY'),
      row('spd', 'Speed'), row('scale', 'Scale speed'), row('max', 'Top speed'), row('thr', 'Throttle'), row('str', 'Steering'),
      row('pr', 'Pitch / roll'), row('air', 'Air / wheels down'),
      h('div', { class: 'tm-sub' }, 'Suspension travel'), wheels,
      (this.rows.extra = h('div', { class: 'tm-extra' }, '')));
  }

  reset() { this.maxSpeed = 0; }

  update(f: TelemetryFrame) {
    const r = this.rows;
    const kmh = Math.abs(f.speed) * 3.6;
    this.maxSpeed = Math.max(this.maxSpeed, kmh);
    r.spd.textContent = `${f.speed.toFixed(2)} m/s · ${kmh.toFixed(1)} km/h`;
    r.scale.textContent = `${(kmh * f.scale).toFixed(0)} km/h at 1:1 (1/${f.scale})`;
    r.max.textContent = `${this.maxSpeed.toFixed(1)} km/h`;
    r.thr.textContent = `${Math.round(f.throttle * 100)}%`;
    r.str.textContent = `${Math.round(f.steer * 100)}% · ${f.steerDeg.toFixed(1)}°`;
    r.pr.textContent = `${f.pitch.toFixed(1)}° / ${f.roll.toFixed(1)}°`;
    r.air.textContent = `${f.air != null ? `${f.air.toFixed(2)} s · ` : ''}${f.grounded.filter(Boolean).length}/4`;
    f.susp.forEach((v, i) => {
      const b = this.bars[i]; if (!b) return;
      b.style.height = `${Math.round(Math.min(1, Math.max(0, v)) * 100)}%`;
      b.parentElement!.classList.toggle('off', !f.grounded[i]);
    });
    r.extra.textContent = f.extra ?? '';
  }
}
