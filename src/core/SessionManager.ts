// Practice / time-trial rules: countdown, ordered checkpoints, laps, penalties.
import { ECONOMY, TRIAL_LAPS } from '../data/specs';
import { Track } from '../sim/Track';

export type SessionMode = 'practice' | 'trial' | 'race';
export type SessionPhase = 'countdown' | 'running' | 'finished';

export type SessionEvent =
  | { type: 'go' }
  | { type: 'lapStart' }
  | { type: 'lap'; lap: number; time: number; best: boolean }
  | { type: 'checkpoint'; index: number }
  | { type: 'missed' }
  | { type: 'wrongWay' }
  | { type: 'penalty'; seconds: number }
  | { type: 'finish'; total: number };

export class SessionManager {
  phase: SessionPhase;
  countdown: number;
  /** Clock since green (seconds), excludes paused time because update() isn't called while paused. */
  time = 0;
  laps: number[] = [];
  lap = 0;            // 0 = not yet crossed the start line
  lapStart = 0;
  penalties = 0;
  /** gates passed this lap; -1 means "behind the line after reversing over it" */
  passed: number;
  events: SessionEvent[] = [];
  bestLapThisSession: number | null = null;
  private gates: number[];
  readonly totalLaps: number;

  constructor(private track: Track, public mode: SessionMode, private bestLapEver: number | null, laps = TRIAL_LAPS) {
    this.gates = track.checkpoints.map((s) => track.lapS(s)).sort((a, b) => a - b);
    this.passed = this.gates.length; // ready to start at the line
    const timed = mode !== 'practice';
    this.totalLaps = timed ? laps : Infinity;
    this.phase = timed ? 'countdown' : 'running';
    this.countdown = timed ? 3 : 0;
    if (mode === 'practice') this.events.push({ type: 'go' });
  }

  get controlsLocked() { return this.phase === 'countdown'; }
  get running() { return this.phase === 'running'; }
  get nextGateIndex() { return this.passed >= 0 && this.passed < this.gates.length ? this.passed : -1; }
  get total() { return this.time + this.penalties; }
  get currentLapTime() { return this.lap > 0 && this.phase === 'running' ? this.time - this.lapStart : 0; }

  /** Lap-relative s of the gate the player should drive through next (the line if all passed). */
  nextTargetS() {
    if (this.passed < 0 || this.passed >= this.gates.length) return this.track.startS;
    return this.track.wrapS(this.track.startS + this.gates[this.passed]);
  }

  update(dt: number) {
    if (this.phase === 'countdown') {
      this.countdown -= dt;
      if (this.countdown <= 0) {
        this.phase = 'running';
        this.events.push({ type: 'go' });
      }
    } else if (this.phase === 'running') {
      this.time += dt;
    }
  }

  /** Call after each physics step with the previous s and the signed distance travelled. */
  onMove(prevS: number, ds: number) {
    if (this.phase !== 'running' || ds === 0) return;
    const L = this.track.length;
    const a = this.track.lapS(prevS);
    const b = a + ds;
    if (ds > 0) {
      for (let k = 0; k < this.gates.length; k++) {
        const g = this.gates[k];
        if (a < g && g <= b && k === this.passed) {
          this.passed++;
          this.events.push({ type: 'checkpoint', index: k });
        }
      }
      if (b >= L) this.crossLineForward();
    } else {
      for (let k = this.gates.length - 1; k >= 0; k--) {
        const g = this.gates[k];
        if (b < g && g <= a && k === this.passed - 1) {
          this.passed--;
          this.events.push({ type: 'wrongWay' });
        }
      }
      if (b < 0) {
        // reversed back over the line: a lap can't be awarded until crossing forward again
        this.passed = -1;
        this.events.push({ type: 'wrongWay' });
      }
    }
  }

  private crossLineForward() {
    if (this.passed === -1) { this.passed = 0; return; }
    if (this.passed !== this.gates.length) {
      this.events.push({ type: 'missed' });
      return;
    }
    this.passed = 0;
    if (this.lap === 0) {
      this.lap = 1;
      this.lapStart = this.time;
      this.events.push({ type: 'lapStart' });
      return;
    }
    const t = this.time - this.lapStart;
    this.laps.push(t);
    const best = this.bestLapEver == null || t < this.bestLapEver;
    if (best) this.bestLapEver = t;
    if (this.bestLapThisSession == null || t < this.bestLapThisSession) this.bestLapThisSession = t;
    this.events.push({ type: 'lap', lap: this.lap, time: t, best });
    if (this.laps.length >= this.totalLaps) {
      this.phase = 'finished';
      this.events.push({ type: 'finish', total: this.total });
      return;
    }
    this.lap++;
    this.lapStart = this.time;
  }

  /** The car was moved back to a safe point. Undo any gates it now sits behind; add a penalty. */
  onReset(safeS: number) {
    const ls = this.track.lapS(safeS);
    if (this.passed > 0) {
      while (this.passed > 0 && this.gates[this.passed - 1] > ls) this.passed--;
    } else if (this.passed === 0 && this.lap > 0 && ls > this.gates[this.gates.length - 1]) {
      this.passed = -1;
    }
    if (this.mode !== 'practice' && this.phase === 'running') {
      this.penalties += ECONOMY.resetPenalty;
      this.events.push({ type: 'penalty', seconds: ECONOMY.resetPenalty });
    }
  }

  takeEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }
}
