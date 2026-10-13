// AI rival monster trucks for arena races: aim through the gate flags in order (looking ahead to the
// next flag once inside one), ease off for sharp turns, and get marshalled back onto their wheels.
import * as THREE from 'three';
import { CrawlerSim, TruckSpec } from './CrawlerSim';
import { ArenaTerrain } from './ArenaTerrain';

export interface TruckSkill { thr: number; turnThr: number }
export const truckSkillFor = (level: number, spread: number): TruckSkill => {
  const l = Math.max(0, Math.min(1.1, level + spread));
  return { thr: 0.58 + 0.3 * l, turnThr: 0.4 + 0.2 * l };
};

export class MonsterAI {
  sim: CrawlerSim;
  gate = 1;
  lap = 0;
  /** Gates passed in total (for running order), plus progress toward the next one. */
  passed = 0;
  finishTime: number | null = null;
  private stuck = 0;
  private rolledT = 0;
  private side: number;

  /** Per gate: where to line up before it when the run out of that gate is a jump (null otherwise). */
  private lineups: (THREE.Vector3 | null)[];
  private lineup: THREE.Vector3 | null = null;
  private lineFor = -1;

  constructor(private T: ArenaTerrain, spec: TruckSpec, public skill: TruckSkill, private laps: number, lane: number) {
    this.sim = new CrawlerSim(T, spec);
    this.side = lane;
    const G = T.gates;
    this.lineups = G.map((a, i) => {
      const b = G[(i + 1) % G.length], dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz);
      const jump = T.ramps.some((r) => r.h >= 0.3 && r.up >= 0.5 && Math.abs(a.z - r.z) < r.width / 2 && Math.abs(b.z - r.z) < r.width / 2 && Math.sign(dx) === r.dir);
      const pv = G[(i - 1 + G.length) % G.length], ix = a.x - pv.x, iz = a.z - pv.z;
      const turnIn = Math.abs(Math.atan2(ix * dz - iz * dx, ix * dx + iz * dz));
      if (!jump || turnIn < 0.6) return null; // only where you swing into a jump out of a corner
      return new THREE.Vector3(THREE.MathUtils.clamp(a.x - (dx / L) * 2, -16.4, 16.4), 0, a.z - (dz / L) * 2);
    });
  }

  place(x: number, z: number, heading: number) {
    this.sim.placePose(x, z, heading);
    for (let i = 0; i < 120; i++) this.sim.step(1 / 120, { steer: 0, throttle: 0 });
  }

  get finished() { return this.finishTime != null; }

  /** Distance-based progress score: gates passed, minus how far there is still to go to the next one. */
  progress() {
    const g = this.T.gates[this.gate], p = this.sim.pos;
    return this.passed * 100 - Math.hypot(p.x - g.x, p.z - g.z);
  }

  private target(out: THREE.Vector3) {
    // square up behind a jump gate first, even after the flag has counted
    if (this.lineFor !== this.gate) {
      this.lineFor = this.gate;
      if (this.lineups[this.gate]) this.lineup = this.lineups[this.gate];
    }
    if (this.lineup) {
      const p = this.sim.pos;
      if (Math.hypot(p.x - this.lineup.x, p.z - this.lineup.z) < 0.7) this.lineup = null;
      else return out.copy(this.lineup);
    }
    const G = this.T.gates, g = G[this.gate], n = G[(this.gate + 1) % G.length], p = this.sim.pos;
    const d = Math.hypot(p.x - g.x, p.z - g.z);
    // aim at the flag, offset a little to this driver's side, blending toward the next flag when close
    const k = THREE.MathUtils.clamp(1 - (d - g.r * 0.6) / 3, 0, 0.6);
    const dx = n.x - g.x, dz = n.z - g.z, L = Math.hypot(dx, dz) || 1;
    out.set(g.x + (dx / L) * k * 3 - (dz / L) * this.side * 0.5, 0, g.z + (dz / L) * k * 3 + (dx / L) * this.side * 0.5);
    return out;
  }

  private tmp = new THREE.Vector3();
  step(dt: number, live: boolean, time: number) {
    const sim = this.sim;
    let steer = 0, throttle = 0;
    if (live && !this.finished) {
      const t = this.target(this.tmp), p = sim.pos, f = sim.forward;
      const want = Math.atan2(-(t.z - p.z), t.x - p.x), have = Math.atan2(-f.z, f.x);
      let e = want - have;
      while (e > Math.PI) e -= 2 * Math.PI;
      while (e < -Math.PI) e += 2 * Math.PI;
      steer = THREE.MathUtils.clamp(-e * 1.6, -1, 1);
      const a = Math.abs(e);
      throttle = a > 0.9 ? this.skill.turnThr * 0.7 : a > 0.4 ? this.skill.turnThr : this.skill.thr;
      // brake for the corner at the coming flag, and don't yank the wheel at speed (tall trucks roll)
      const G = this.T.gates, g = G[this.gate], pv = G[(this.gate - 1 + G.length) % G.length], n = G[(this.gate + 1) % G.length];
      const turn = Math.abs(Math.atan2((g.x - pv.x) * (n.z - g.z) - (g.z - pv.z) * (n.x - g.x), (g.x - pv.x) * (n.x - g.x) + (g.z - pv.z) * (n.z - g.z)));
      const dg = Math.hypot(p.x - g.x, p.z - g.z);
      const vCorner = turn > 1.2 ? 2.6 + this.skill.turnThr * 2 : turn > 0.6 ? 3.4 + this.skill.turnThr * 2 : 99;
      const vmax = this.lineup ? 1.3 + 0.45 * Math.hypot(p.x - this.lineup.x, p.z - this.lineup.z) : dg < 4.5 ? vCorner : a > 0.6 ? 3.2 + this.skill.turnThr * 2 : 99;
      if (sim.speed > vmax + 0.4) throttle = -0.35; else if (sim.speed > vmax) throttle = Math.min(throttle, 0.15);
      if (sim.speed > 3.5) steer *= 3.5 / sim.speed;
      // commit to the jumps: casing a gap into the landing ramp's face is how trucks end up on their lids
      for (const r of this.T.ramps) {
        if (r.h < 0.3 || r.up < 0.5 || Math.abs(p.z - r.z) > r.width / 2) continue;
        const into = (p.x - r.x0) * r.dir;
        if (!this.lineup && into > -6.5 && into < r.up && f.x * r.dir > 0.8) {
          throttle = Math.max(throttle, 0.85);
          // hold the ramp's centre line
          let ej = Math.atan2(-(r.z - p.z), 3 * r.dir) - have;
          while (ej > Math.PI) ej -= 2 * Math.PI;
          while (ej < -Math.PI) ej += 2 * Math.PI;
          steer = THREE.MathUtils.clamp(-ej * 1.2, -0.5, 0.5);
        }
      }
      // in the air: blip the throttle to lift a dropping nose, brake to bring a high one down
      if (!sim.touching) {
        const pitch = Math.asin(THREE.MathUtils.clamp(f.y, -1, 1));
        throttle = pitch < -0.12 ? 1 : pitch > 0.3 ? -0.7 : 0.2;
        steer = 0;
      }
    } else if (this.finished) throttle = sim.speed > 1 ? -0.3 : 0;
    sim.step(dt, { steer, throttle });
    if (!live) return;
    if (!this.finished) {
      const g = this.T.gates[this.gate], p = sim.pos;
      if (Math.hypot(p.x - g.x, p.z - g.z) < g.r) {
        this.passed++;
        if (this.gate === 0) { this.lap++; if (this.lap >= this.laps) { this.finishTime = time; return; } }
        this.gate = (this.gate + 1) % this.T.gates.length;
      }
    }
    // marshals: back on its wheels after a roll, or back to the last flag when wedged
    if (sim.rolled) { this.rolledT += dt; if (this.rolledT > 1.5) this.reset(); } else this.rolledT = 0;
    if (!this.finished && sim.speed < 0.25) { this.stuck += dt; if (this.stuck > 2.5) this.reset(); } else this.stuck = 0;
  }

  reset() {
    const G = this.T.gates, g = G[(this.gate - 1 + G.length) % G.length], n = G[this.gate];
    const back = this.lineups[(this.gate - 1 + G.length) % G.length]; // a jump run-up: restart from the line-up point
    this.sim.placePose(back ? back.x : g.x, back ? back.z : g.z, Math.atan2(-(n.z - g.z), n.x - g.x));
    for (let i = 0; i < 40; i++) this.sim.step(1 / 120, { steer: 0, throttle: 0 });
    this.stuck = this.rolledT = 0; this.lineup = null;
  }
}

/** Monster trucks bump each other: discs in the ground plane. */
export function bumpTrucks(sims: CrawlerSim[], radius = 0.34) {
  const min = radius * 2;
  for (let i = 0; i < sims.length; i++) for (let j = i + 1; j < sims.length; j++) {
    const a = sims[i].pos, b = sims[j].pos;
    if (Math.abs(a.y - b.y) > 0.45) continue;
    const dx = b.x - a.x, dz = b.z - a.z, dd = dx * dx + dz * dz;
    if (dd >= min * min || dd < 1e-8) continue;
    const dist = Math.sqrt(dd), nx = dx / dist, nz = dz / dist, push = (min - dist) / 2;
    a.x -= nx * push; a.z -= nz * push; b.x += nx * push; b.z += nz * push;
    const va = sims[i].vel, vb = sims[j].vel;
    const vn = (vb.x - va.x) * nx + (vb.z - va.z) * nz;
    if (vn < 0) { const k = -vn * 0.6; va.x -= nx * k; va.z -= nz * k; vb.x += nx * k; vb.z += nz * k; }
  }
}
