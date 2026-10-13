// Lightweight arcade-assisted RC buggy physics.
// Represents throttle, steering servo, longitudinal velocity, heading, lateral slip, grip, drag,
// ground contact, a single spring/damper for suspension, airtime rotation and barrier collisions.
import { BUGGY_SPEC, BuggyClass, WEAR } from '../data/specs';
import type { Handling } from '../core/ServiceSystem';
import { Track } from './Track';

export const GRAVITY = 9.81;

export interface DriveInput { steer: number; throttle: number }

export type SimEvent =
  | { type: 'landing'; impact: number; damage: number }
  | { type: 'barrier'; impact: number; damage: number }
  | { type: 'flip' };

export interface SafePoint { s: number; t: number }

export class VehicleSimulation {
  // world state
  x = 0; y = 0; z = 0;
  vx = 0; vy = 0; vz = 0;
  heading = 0; yawRate = 0;
  pitch = 0; pitchRate = 0; roll = 0;
  steerAngle = 0;
  compression = 0;
  wheelSpin = 0;
  grounded = true;
  airTime = 0;
  flipped = false;
  reversing = false;
  private reverseTimer = 0;
  private prevGround = 0;
  private lastLongAccel = 0;
  private lastLatAccel = 0;

  // tracking
  trackIdx = 0;
  s = 0;
  d = 0;
  /** Signed travel along the route since last read (for lap logic). */
  ds = 0;

  // per-frame accumulators read by the session for wear/battery
  stats = { distance: 0, slipDistance: 0, throttleEnergy: 0 };
  sliding = 0;
  wheelspin = 0;
  time = 0;
  private safe: SafePoint[] = [];
  private safeTimer = 0;

  events: SimEvent[] = [];

  /** Vehicle class being driven (set per session). */
  spec: BuggyClass = BUGGY_SPEC;

  constructor(public track: Track) {}

  get speed() { return Math.hypot(this.vx, this.vz); }
  get forwardSpeed() { return this.vx * Math.cos(this.heading) + this.vz * Math.sin(this.heading); }

  placeAt(s: number, d = 0) {
    const p = this.track.pointAt(s, d);
    const q = this.track.queryGlobal(p.x, p.z);
    this.x = p.x; this.z = p.z;
    this.heading = p.heading;
    this.vx = this.vz = this.vy = 0;
    this.yawRate = this.pitchRate = this.pitch = this.roll = 0;
    this.steerAngle = 0;
    this.trackIdx = q.idx; this.s = q.s; this.d = q.d;
    const g = this.track.heightAt(q.s, q.d);
    this.y = g + this.spec.springRest - 0.02;
    this.prevGround = g;
    this.compression = 0.02;
    this.grounded = true;
    this.airTime = 0;
    this.flipped = false;
    this.reversing = false;
    this.reverseTimer = 0;
    this.ds = 0;
  }

  resetSafePoints() { this.safe = []; }

  /** Most recent safe point at least ~0.8 s old so a reset doesn't drop you back into the crash. */
  pickSafePoint(): number {
    for (let i = this.safe.length - 1; i >= 0; i--) {
      if (this.time - this.safe[i].t > 0.8) return this.safe[i].s;
    }
    return this.safe.length ? this.safe[0].s : this.s;
  }

  step(dt: number, input: DriveInput, h: Handling) {
    this.time += dt;
    const T = this.track;
    const prevS = this.s;

    if (this.flipped) {
      // Upside down: wheels spin uselessly, the car slides to a stop.
      const k = Math.exp(-4 * dt);
      this.vx *= k; this.vz *= k;
      this.x += this.vx * dt; this.z += this.vz * dt;
      this.trackAndCollide(dt);
      this.ds = 0;
      return;
    }

    const cosH = Math.cos(this.heading), sinH = Math.sin(this.heading);
    // forward F = (cos, sin); right R = (-sin, cos) in (x, z)
    let vLong = this.vx * cosH + this.vz * sinH;
    let vLat = -this.vx * sinH + this.vz * cosH;

    // --- steering servo
    // Steering feel: an expo curve keeps small corrections gentle (full lock is unchanged), and the
    // available lock tapers with speed, like the dual-rate/expo a racer sets on a real transmitter.
    const sAbs = Math.min(1, Math.abs(input.steer));
    const shaped = Math.sign(input.steer) * (0.35 * sAbs + 0.65 * sAbs * sAbs);
    const speedFactor = 1 - 0.62 * Math.min(1, Math.abs(vLong) / this.spec.topSpeed);
    const targetSteer = shaped * this.spec.maxSteer * speedFactor + h.steerBias;
    const maxDelta = this.spec.servoRate * h.steerResp * dt;
    this.steerAngle += Math.max(-maxDelta, Math.min(maxDelta, targetSteer - this.steerAngle));

    // --- ground / suspension
    const q = T.queryLocal(this.x, this.z, this.trackIdx);
    const ground = T.groundAt(q);
    const groundVy = (ground.h - this.prevGround) / dt;
    this.prevGround = ground.h;

    const wasAir = !this.grounded;
    this.vy -= GRAVITY * dt;
    let gap = this.y - ground.h;
    let comp = this.spec.springRest - gap;
    if (comp > 0) {
      const relVy = this.vy - groundVy;
      const a = h.spring * comp - h.damping * relVy;
      if (a > 0) this.vy += a * dt;
    }
    this.y += this.vy * dt;
    gap = this.y - ground.h;
    comp = this.spec.springRest - gap;

    // touchdown after real airtime: judge the landing by the closing speed at first contact
    if (wasAir && comp > -0.004 && this.airTime > 0.12) {
      this.onLanding(Math.max(0, groundVy - this.vy), ground, h);
    }
    if (comp > (this.spec.maxCompression * h.compressionMul)) {
      // bottomed out: chassis rides on the ground
      this.y = ground.h + this.spec.springRest - (this.spec.maxCompression * h.compressionMul);
      const relVy = this.vy - groundVy;
      if (relVy < 0) this.vy = groundVy + -relVy * h.rebound;
      comp = (this.spec.maxCompression * h.compressionMul);
    }
    this.compression = comp;
    this.grounded = comp > -0.012;
    if (this.grounded) this.airTime = 0; else this.airTime += dt;

    const slopePitch = Math.atan(ground.gx * cosH + ground.gz * sinH);
    const slopeRoll = Math.atan(-ground.gx * sinH + ground.gz * cosH);

    if (this.grounded && !this.flipped) {
      // --- longitudinal
      let a = 0;
      const thr = input.throttle;
      if (thr > 0.02) {
        this.reverseTimer = 0;
        this.reversing = false;
        if (vLong < -0.4) a = thr * this.spec.brake; // forward throttle while rolling backwards brakes
        else {
          const top = this.spec.topSpeed * h.topSpeedMul;
          a = thr * this.spec.accel * h.powerMul * Math.max(0, 1 - Math.max(0, vLong) / top);
        }
        this.stats.throttleEnergy += thr * (0.4 + 0.6 * Math.min(1, Math.abs(vLong) / this.spec.topSpeed)) * dt;
      } else if (thr < -0.02) {
        if (!this.reversing && vLong > 0.35) {
          a = thr * this.spec.brake; // brake
          this.reverseTimer = 0;
        } else {
          this.reverseTimer += dt;
          if (this.reversing || this.reverseTimer > this.spec.reverseDelay) {
            this.reversing = true;
            a = thr * this.spec.reverseAccel * h.powerMul * Math.max(0, 1 - Math.max(0, -vLong) / this.spec.reverseTop);
            this.stats.throttleEnergy += -thr * 0.4 * dt;
          } else {
            a = -vLong * 10; // hold still during the deliberate reverse delay
          }
        }
      } else {
        this.reverseTimer = 0;
      }
      // traction limit on drive/brake
      const maxTrac = this.spec.mu * GRAVITY * h.gripMul * this.track.grip * Math.min(1, this.spec.driveTrac * h.tracMul);
      this.wheelspin = Math.max(0, Math.abs(a) - maxTrac) / maxTrac;
      a = Math.max(-maxTrac, Math.min(maxTrac, a));
      // drag
      a -= vLong * this.spec.rolling + Math.sign(vLong) * vLong * vLong * this.spec.aero;
      vLong += a * dt;
      this.lastLongAccel = a;

      // --- yaw from a kinematic bicycle model, capped by available grip
      const maxLat = this.spec.mu * GRAVITY * h.gripMul * this.track.grip;
      let targetYaw = (vLong * Math.tan(this.steerAngle)) / this.spec.wheelbase;
      const yawCap = (maxLat * 1.08) / Math.max(0.6, Math.abs(vLong));
      targetYaw = Math.max(-yawCap, Math.min(yawCap, targetYaw));
      this.yawRate += (targetYaw - this.yawRate) * Math.min(1, 12 * dt);

      // --- lateral grip; power-on loosens the rear on dirt
      const powerSlide = 1 - Math.min(0.75, this.spec.powerSlide * h.slideMul) * Math.max(0, input.throttle) * Math.min(1, Math.abs(input.steer) * 1.5) * Math.min(1, Math.abs(vLong) / 5);
      const latLimit = maxLat * powerSlide * dt;
      const want = -vLat * Math.min(1, 14 * dt);
      const dv = Math.max(-latLimit, Math.min(latLimit, want));
      vLat += dv;
      this.lastLatAccel = vLong * this.yawRate;
      this.sliding = Math.abs(vLat);

      // rebuild world velocity in the old frame, then rotate the car
      this.vx = vLong * cosH - vLat * sinH;
      this.vz = vLong * sinH + vLat * cosH;
      this.heading += this.yawRate * dt;

      // slope gravity
      this.vx -= GRAVITY * ground.gx * dt * 0.9;
      this.vz -= GRAVITY * ground.gz * dt * 0.9;

      // body follows terrain
      const prevPitch = this.pitch;
      this.pitch += (slopePitch - this.pitch) * Math.min(1, 18 * dt);
      // carry a damped share of the terrain's pitch rate into any takeoff
      const rate = (this.pitch - prevPitch) / dt;
      this.pitchRate += (Math.max(-2.2, Math.min(2.2, rate * 0.3)) - this.pitchRate) * Math.min(1, 20 * dt);
      this.roll += (slopeRoll - this.roll) * Math.min(1, 18 * dt);

      // stats
      const dist = Math.hypot(this.vx, this.vz) * dt;
      this.stats.distance += dist;
      this.stats.slipDistance += Math.min(this.sliding, 4) * dt + this.wheelspin * dist;

      this.recordSafe(dt, q);
    } else {
      // --- airborne: throttle pitches nose up, brake nose down (like a real RC)
      this.yawRate *= Math.exp(-1.5 * dt);
      this.heading += this.yawRate * dt;
      const thr = input.throttle;
      this.pitchRate += thr * this.spec.airPitchAccel * dt;
      // mild assist toward a level-ish attitude
      this.pitchRate += (-0.12 - this.pitch) * 2.2 * dt;
      this.pitchRate *= Math.exp(-0.6 * dt);
      this.pitch += this.pitchRate * dt;
      this.roll *= Math.exp(-1.2 * dt);
      const drag = Math.exp(-0.05 * dt);
      this.vx *= drag; this.vz *= drag;
      this.lastLongAccel = 0; this.lastLatAccel = 0;
      this.sliding = 0;
      this.wheelspin = Math.max(0, thr);
    }

    this.x += this.vx * dt;
    this.z += this.vz * dt;
    this.wheelSpin += (this.grounded ? vLong : vLong + input.throttle * 25 * dt) / this.spec.wheelRadius * dt;

    this.trackAndCollide(dt);
    this.ds = T.deltaS(prevS, this.s);
  }

  private onLanding(impact: number, ground: { gx: number; gz: number }, h: Handling) {
    const cosH = Math.cos(this.heading), sinH = Math.sin(this.heading);
    const slopePitch = Math.atan(ground.gx * cosH + ground.gz * sinH);
    const mismatch = Math.abs(this.pitch - slopePitch);
    if (mismatch > 1.15 || Math.abs(this.roll) > 1.1) {
      this.flipped = true;
      this.events.push({ type: 'flip' });
    }
    // softer springs soak up more of the hit; worn shocks soak up less
    const effective = (impact + Math.max(0, mismatch - 0.35) * 3) * h.absorb;
    let damage = 0;
    if (effective > WEAR.landingThreshold) {
      damage = Math.min(WEAR.maxSingleHit, (effective - WEAR.landingThreshold) * WEAR.landingScale);
    }
    // nose-heavy landings scrub speed
    const scrub = Math.min(0.5, Math.max(0, mismatch - 0.25) * 0.6);
    this.vx *= 1 - scrub; this.vz *= 1 - scrub;
    this.pitchRate = 0;
    this.events.push({ type: 'landing', impact: effective, damage });
  }

  private recordSafe(dt: number, q: { d: number }) {
    this.safeTimer += dt;
    if (this.safeTimer < 0.35) return;
    this.safeTimer = 0;
    if (Math.abs(q.d) < this.track.halfWidth - 0.45 && Math.abs(this.pitch) < 0.25 && !this.flipped) {
      this.safe.push({ s: this.s, t: this.time });
      if (this.safe.length > 40) this.safe.shift();
    }
  }

  /** Update tracker and keep the car inside the pipe barriers. */
  private trackAndCollide(dt: number) {
    const T = this.track;
    const q = T.queryLocal(this.x, this.z, this.trackIdx);
    this.trackIdx = q.idx;
    this.s = q.s;
    this.d = q.d;
    const limit = T.halfWidth - 0.2;
    if (Math.abs(q.d) > limit) {
      const sign = Math.sign(q.d);
      const push = Math.abs(q.d) - limit;
      this.x -= q.nx * sign * push;
      this.z -= q.nz * sign * push;
      this.d = sign * limit;
      const nx = q.nx * sign, nz = q.nz * sign;
      const vn = this.vx * nx + this.vz * nz;
      if (vn > 0) {
        const tx = this.vx - vn * nx, tz = this.vz - vn * nz;
        const restitution = 0.3;
        this.vx = tx * 0.9 - vn * restitution * nx;
        this.vz = tz * 0.9 - vn * restitution * nz;
        // glancing blows nudge the nose along the barrier
        this.yawRate *= 0.5;
        let damage = 0;
        if (vn > WEAR.barrierThreshold && !this.flipped) {
          damage = Math.min(WEAR.maxSingleHit, (vn - WEAR.barrierThreshold) * WEAR.barrierScale);
          this.events.push({ type: 'barrier', impact: vn, damage });
        }
        // very hard hits at speed can roll the car over
        if (vn > 9.5 && !this.flipped && this.grounded) {
          this.flipped = true;
          this.events.push({ type: 'flip' });
        }
      }
    }
    void dt;
  }

  /** Accelerations for cosmetic body pitch/roll. */
  get bodyLean() {
    return { pitch: -this.lastLongAccel * 0.006, roll: this.lastLatAccel * 0.008 };
  }

  takeStats() {
    const s = this.stats;
    this.stats = { distance: 0, slipDistance: 0, throttleEnergy: 0 };
    return s;
  }
}
