// Pure gesture interpreters for the transmitter. No DOM, no rendering: easy to unit test.
// Screen coordinates are CSS pixels with y pointing down, so an increasing atan2 angle is clockwise
// on screen. Clockwise wheel rotation = steer right.

export const WHEEL_STOP_DEG = 65;
const STOP = (WHEEL_STOP_DEG * Math.PI) / 180;

/** Shortest signed difference b - a, wrapped to (-π, π]. Handles the ±180° seam. */
export function angleDelta(a: number, b: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

export type SteerMode = 'circular' | 'horizontal';

export class WheelGesture {
  /** Wheel rotation in radians, clamped to the mechanical stops. */
  angle = 0;
  active = false;
  private last: number | null = null;
  private startX = 0;
  private startAngle = 0;
  hitStop = false;

  constructor(
    public cx = 0, public cy = 0,
    /** Inside this radius the angle is too unstable to read: hold the last value. */
    public deadRadius = 18,
    public sensitivity = 1,
    public mode: SteerMode = 'circular',
    /** Horizontal mode: px of drag for full lock. */
    public horizontalRange = 130,
  ) {}

  setCenter(cx: number, cy: number) { this.cx = cx; this.cy = cy; }

  start(x: number, y: number) {
    this.active = true;
    this.startX = x;
    this.startAngle = this.angle; // never snap to the touch position
    this.last = this.readAngle(x, y);
  }

  move(x: number, y: number) {
    if (!this.active) return;
    const before = this.angle;
    if (this.mode === 'horizontal') {
      this.angle = this.startAngle + ((x - this.startX) / this.horizontalRange) * STOP * this.sensitivity;
    } else {
      const a = this.readAngle(x, y);
      if (a === null) { this.last = null; return; } // near centre: hold, re-anchor on exit
      if (this.last === null) { this.last = a; return; }
      this.angle += angleDelta(this.last, a) * this.sensitivity;
      this.last = a;
    }
    const clamped = Math.max(-STOP, Math.min(STOP, this.angle));
    this.hitStop = clamped !== this.angle && Math.abs(before) < STOP;
    this.angle = clamped;
  }

  end() { this.active = false; this.last = null; }

  /** Spring back to centre after release (~160 ms). */
  relax(dt: number, ms = 160) {
    if (this.active) return;
    const step = (STOP / (ms / 1000)) * dt;
    if (Math.abs(this.angle) <= step) this.angle = 0;
    else this.angle -= Math.sign(this.angle) * step;
  }

  /** Normalised -1..1 steering. */
  get value() { return this.angle / STOP; }

  private readAngle(x: number, y: number): number | null {
    const dx = x - this.cx, dy = y - this.cy;
    if (Math.hypot(dx, dy) < this.deadRadius) return null;
    return Math.atan2(dy, dx);
  }
}

export class TriggerGesture {
  value = 0;
  active = false;
  private y0 = 0;
  constructor(public travel = 52, public deadzone = 5) {}
  start(_x: number, y: number) { this.active = true; this.y0 = y; this.value = 0; }
  /** Drag down (toward the player) pulls the trigger = throttle. Drag up pushes = brake. */
  move(_x: number, y: number) {
    if (!this.active) return;
    const dy = y - this.y0;
    if (Math.abs(dy) <= this.deadzone) { this.value = 0; return; }
    const v = (dy - Math.sign(dy) * this.deadzone) / this.travel;
    this.value = Math.max(-1, Math.min(1, v));
  }
  end() { this.active = false; this.value = 0; }
}
