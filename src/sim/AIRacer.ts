// AI rival for buggy races: drives its own VehicleSimulation round the track centreline (plus a lane
// offset), brakes for corners using the track curvature ahead, steps aside for cars in front, and
// resets itself when it flips or gets stuck. It uses fresh-car handling (no wear, no battery fade).
import type { Handling } from '../core/ServiceSystem';
import { SessionManager } from '../core/SessionManager';
import type { BuggyClass } from '../data/specs';
import { Track } from './Track';
import { VehicleSimulation } from './VehicleSimulation';

export interface RacerSkill {
  /** Straight-line throttle (0..1). */
  thr: number;
  /** Corner speed target as lateral g. */
  cornerG: number;
  /** How far ahead (m) it looks for corners; better drivers brake later. */
  look: number;
}

/** Skill 0 (club) … 1 (pro), with a little per-driver spread. */
export function skillFor(level: number, spread: number): RacerSkill {
  const l = Math.max(0, Math.min(1.1, level + spread));
  return { thr: 0.6 + 0.32 * l, cornerG: 0.5 + 0.3 * l, look: 7.5 - 1.5 * l };
}

export class AIRacer {
  sim: VehicleSimulation;
  session: SessionManager;
  /** Signed distance driven since the green flag (for running order). */
  prog = 0;
  finishTime: number | null = null;
  private lane: number;
  private laneNow: number;
  private stuck = 0;
  private flipT = 0;
  private wobble = Math.random() * 10;
  private kickers: number[];

  constructor(track: Track, spec: BuggyClass, private handling: Handling, public skill: RacerSkill, laps: number, lane: number) {
    this.sim = new VehicleSimulation(track);
    this.sim.spec = spec;
    this.session = new SessionManager(track, 'race', null, laps);
    this.lane = this.laneNow = lane;
    this.kickers = track.features.filter((f) => f.kind === 'kicker').map((f) => f.s);
  }

  place(s: number, d: number) {
    this.sim.placeAt(s, d);
    this.sim.resetSafePoints();
    this.laneNow = d;
  }

  get finished() { return this.session.phase === 'finished'; }

  /** Drive one physics step. `others` are the other cars, for traffic avoidance. */
  step(dt: number, others: VehicleSimulation[]) {
    const sim = this.sim, T = sim.track, S = this.session;
    const locked = S.controlsLocked;
    let steer = 0, throttle = 0;
    if (this.finished) {
      throttle = sim.speed > 1.5 ? -0.3 : 0.15; // cool-down lap at a crawl
      steer = this.steerTo(this.laneNow, 1.8);
    } else if (!locked) {
      // pick a lane: the preferred one, unless someone slower is right in front of it
      let want = this.lane;
      for (const o of others) {
        const ahead = T.deltaS(sim.s, o.s);
        if (ahead > 0.2 && ahead < 2.2 && Math.abs(o.d - this.laneNow) < 0.55 && o.speed < sim.speed + 0.5) {
          want = o.d > 0 ? o.d - 0.75 : o.d + 0.75;
        }
      }
      want = Math.max(-1.05, Math.min(1.05, want));
      this.laneNow += (want - this.laneNow) * Math.min(1, dt * 1.8);
      steer = this.steerTo(this.laneNow, 2.2);
      // corner speed: the tightest curvature in the look-ahead window sets the target speed
      let k = 0;
      for (let q = 0; q < this.skill.look; q += 0.5) k = Math.max(k, Math.abs(T.curvatureAt(sim.s + q)));
      const vmax = Math.sqrt(this.skill.cornerG * 9.81 * T.grip / Math.max(k, 1e-3));
      this.wobble += dt;
      const thr = this.skill.thr * (0.97 + 0.03 * Math.sin(this.wobble * 0.7));
      throttle = sim.speed > vmax + 0.3 ? -0.45 : sim.speed > vmax ? 0.1 : thr;
      // commit to jumps: everyone hits the kickers on the gas so nobody cases a double
      for (const ks of this.kickers) { const to = T.deltaS(sim.s, ks); if (to > -0.3 && to < 5.5 && sim.grounded) throttle = Math.max(throttle, 0.88); }
    }
    const prevS = sim.s;
    sim.step(dt, { steer, throttle }, this.handling);
    sim.events.length = 0;
    if (!locked) {
      S.onMove(prevS, sim.ds);
      if (!this.finished) this.prog += sim.ds;
      S.takeEvents();
    }
    // recover from flips and wedges like a marshal would
    if (sim.flipped) { this.flipT += dt; if (this.flipT > 1.4) this.reset(); } else this.flipT = 0;
    if (!locked && !this.finished && sim.speed < 0.3) { this.stuck += dt; if (this.stuck > 2.2) this.reset(); } else this.stuck = 0;
  }

  private steerTo(lane: number, ahead: number) {
    const sim = this.sim;
    const p = sim.track.pointAt(sim.s + ahead, lane);
    let e = Math.atan2(p.z - sim.z, p.x - sim.x) - sim.heading;
    while (e > Math.PI) e -= 2 * Math.PI;
    while (e < -Math.PI) e += 2 * Math.PI;
    return Math.max(-1, Math.min(1, e * 2));
  }

  reset() {
    const sim = this.sim;
    const s = sim.pickSafePoint();
    this.prog += sim.track.deltaS(sim.s, s);
    sim.placeAt(s, 0);
    this.laneNow = 0;
    this.session.onReset(s);
    this.session.takeEvents();
    this.stuck = this.flipT = 0;
  }

  /** Session clock tick (call once per frame, like the player's session). */
  tick(dt: number) {
    this.session.update(dt);
    if (this.finished && this.finishTime == null) this.finishTime = this.session.total;
  }
}

/** Push overlapping cars apart and trade some of their closing speed (simple discs). */
export function collideCars(cars: VehicleSimulation[], radius = 0.21) {
  const min = radius * 2;
  for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length; j++) {
    const a = cars[i], b = cars[j];
    if (Math.abs(a.y - b.y) > 0.3) continue; // one is flying over the other
    const dx = b.x - a.x, dz = b.z - a.z, dd = dx * dx + dz * dz;
    if (dd >= min * min || dd < 1e-8) continue;
    const dist = Math.sqrt(dd), nx = dx / dist, nz = dz / dist, push = (min - dist) / 2;
    a.x -= nx * push; a.z -= nz * push; b.x += nx * push; b.z += nz * push;
    const vn = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
    if (vn < 0) {
      const j2 = -vn * 0.6; // inelastic: plastic bodies, not billiard balls
      a.vx -= nx * j2; a.vz -= nz * j2; b.vx += nx * j2; b.vz += nz * j2;
      a.yawRate += (Math.random() - 0.5) * 0.6; b.yawRate += (Math.random() - 0.5) * 0.6;
    }
  }
}
