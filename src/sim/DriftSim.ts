// 1/10 RWD drift car on a flat floor: a planar rigid body with a front axle (free-rolling, steered) and a
// driven rear axle. Each axle uses a combined-slip tyre model (normalised slip vector, a Pacejka-shaped
// curve that falls to a sliding level past the peak), so wheelspin eats lateral grip — that's what lets
// the rear step out under power. Load moves front/rear with acceleration. The steering gyro is a
// rate gyro, like the real thing: it adds counter-steer in proportion to the yaw rate, so a slide is
// caught and held instead of spinning, and the driver mostly sets the angle with throttle.
// Frame: forward F = (cos ψ, sin ψ) in (x, z); right R = (−sin ψ, cos ψ); +ψ / +r / +steer = turning right.
import * as THREE from 'three';
import { DriftTrack } from './DriftTrack';

export const DRIFT_SPEC = {
  name: 'Slideway RD-1',
  mass: 1.62,
  a: 0.124,            // CG → front axle
  b: 0.134,            // CG → rear axle
  track: 0.184,
  cgH: 0.036,
  Iz: 0.03,
  wheelR: 0.0315,
  wheelI: 0.00011,     // rear axle + drivetrain, reflected to the wheels
  muF: 0.58, muR: 0.66, slide: 0.86,  // peak friction and the fraction kept when fully sliding
  slipY: 0.15,         // tan(slip angle) at peak lateral force
  slipX: 0.14,         // slip ratio at peak drive force
  torque: 0.32,        // N·m at the rear wheels, full throttle, stalled
  vTop: 9.2,           // m/s, free-running
  brake: 0.16,         // N·m drag brake on the rear
  revTorque: 0.15, revTop: 2.6, reverseDelay: 0.25,
  maxSteer: 0.96,      // rad — modern RWD drift lock (~55°)
  servoRate: 10,
  gyroK: 0.25,         // counter-steer per rad/s of growing slip angle (stops over-rotation)
  authority: 0.55,     // how much driver steering the gyro takes away at full gain
  roll: 0.12, pitch: 0.09, // visual body roll/pitch per g
  length: 0.44, width: 0.196,
  denLat: 0.15,        // low-speed floor on the side-slip denominator (tyres still bite when nearly stopped)
};
export type DriftSpec = typeof DRIFT_SPEC;
const G = 9.81;
const SUB = 4;

export interface DriftInput { steer: number; throttle: number }
export type DriftEvent = { type: 'wall'; impact: number; inner: boolean };

export class DriftSim {
  x = 0; z = 0; psi = 0;
  vx = 0; vz = 0; r = 0;
  omega = 0;            // rear wheel speed (rad/s)
  steer = 0;            // front wheel angle actually reached (driver + gyro)
  steerCmd = 0;         // driver's part, through the servo
  gyro = 0.6;           // 0..1 gain
  spinF = 0; spinR = 0; // wheel rotation (visual)
  bodyRoll = 0; bodyPitch = 0;
  private rollV = 0; private pitchV = 0;
  ax = 0; ay = 0;       // body-frame accel (m/s²), filtered
  /** Rate the body slip angle is growing (yaw rate minus the turn rate of the velocity). */
  slipRate = 0;
  wheelspin = 0;        // rear slip ratio (0 = rolling)
  rearSlide = 0;        // how saturated the rear tyres are (0..~2)
  frontSlide = 0;
  reversing = false;
  private revTimer = 0;
  idx = -1; s = 0; d = 0;
  time = 0;
  events: DriftEvent[] = [];
  stats = { distance: 0, throttleEnergy: 0 };
  /** Off for open-floor tests. */
  walls = true;

  constructor(public track: DriftTrack, readonly S: DriftSpec = DRIFT_SPEC) {}

  get forward() { return new THREE.Vector3(Math.cos(this.psi), 0, Math.sin(this.psi)); }
  get speed() { return Math.hypot(this.vx, this.vz); }
  get u() { return this.vx * Math.cos(this.psi) + this.vz * Math.sin(this.psi); }
  get v() { return -this.vx * Math.sin(this.psi) + this.vz * Math.cos(this.psi); }
  /** Body slip angle (rad): + = sliding with the tail out to the left (car turning right). */
  get driftAngle() { const u = this.u, v = this.v; return Math.hypot(u, v) < 0.6 ? 0 : Math.atan2(-v, Math.abs(u)) * Math.sign(u || 1); }
  get forwardSpeed() { return this.u; }

  place(x: number, z: number, heading: number) {
    this.x = x; this.z = z; this.psi = heading;
    this.vx = this.vz = this.r = this.omega = 0;
    this.steer = this.steerCmd = 0; this.bodyRoll = this.bodyPitch = this.rollV = this.pitchV = 0;
    this.ax = this.ay = this.slipRate = 0; this.reversing = false; this.revTimer = 0; this.idx = -1;
    const q = this.track.query(x, z); this.idx = q.idx; this.s = q.s; this.d = q.d;
  }
  placeAt(s: number, d = 0) { const p = this.track.pointAt(s, d); this.place(p.x, p.z, p.heading); }

  /** Tyre curve: normalised slip ρ (1 = peak) → fraction of μFz. */
  private static curve(rho: number, slide: number) {
    // sin(C·atan(Bρ)) with the peak at ρ = 1, and the sliding asymptote set by `slide`
    const C = 2 - (2 / Math.PI) * Math.asin(slide), B = Math.tan(Math.PI / (2 * C));
    return Math.sin(C * Math.atan(B * rho));
  }

  step(dt: number, input: DriftInput) {
    const S = this.S;
    this.time += dt;
    const thr = THREE.MathUtils.clamp(input.throttle, -1, 1);
    // steering servo (driver) with a little expo for fine corrections
    const sAbs = Math.min(1, Math.abs(input.steer));
    const shaped = Math.sign(input.steer) * (0.4 * sAbs + 0.6 * sAbs * sAbs);
    const md = S.servoRate * dt;
    this.steerCmd += THREE.MathUtils.clamp(shaped * S.maxSteer - this.steerCmd, -md, md);

    // throttle / brake / reverse logic (ESC with a deliberate reverse delay)
    const uNow = this.u;
    let mode: 'drive' | 'brake' | 'rev' | 'coast' = 'coast';
    if (thr > 0.02) { mode = 'drive'; this.reversing = false; this.revTimer = 0; }
    else if (thr < -0.02) {
      if (!this.reversing && uNow > 0.3) { mode = 'brake'; this.revTimer = 0; }
      else { this.revTimer += dt; if (this.reversing || this.revTimer > S.reverseDelay) { this.reversing = true; mode = 'rev'; } else mode = 'brake'; }
    } else this.revTimer = 0;

    const h = dt / SUB;
    for (let k = 0; k < SUB; k++) this.sub(h, thr, mode);

    // visual body motion: roll/pitch as a sprung response to the accelerations
    const tRoll = -this.ay / G * S.roll, tPitch = -this.ax / G * S.pitch;
    this.rollV += ((tRoll - this.bodyRoll) * 260 - this.rollV * 22) * dt; this.bodyRoll += this.rollV * dt;
    this.pitchV += ((tPitch - this.bodyPitch) * 260 - this.pitchV * 22) * dt; this.bodyPitch += this.pitchV * dt;

    if (this.walls) this.collide();
    const q = this.track.query(this.x, this.z, this.idx); this.idx = q.idx; this.s = q.s; this.d = q.d;
    this.stats.distance += this.speed * dt;
    if (thr > 0) this.stats.throttleEnergy += thr * (0.35 + 0.65 * Math.min(1, Math.abs(this.omega * S.wheelR) / S.vTop)) * dt;
  }

  private sub(h: number, thr: number, mode: 'drive' | 'brake' | 'rev' | 'coast') {
    const S = this.S, c = Math.cos(this.psi), s = Math.sin(this.psi);
    const u = this.vx * c + this.vz * s, v = -this.vx * s + this.vz * c, r = this.r;
    const L = S.a + S.b, m = S.mass;
    // gyro: counter-steers toward the direction the front axle is actually travelling (what a rate gyro
    // plus quick thumbs achieve), with a little yaw-rate damping; the driver's input then sets the angle
    // relative to that, with less authority as the gain goes up. Fades out at walking pace.
    const fade = Math.min(1, Math.max(0, (Math.abs(u) - 0.3) / 0.8));
    const g = this.gyro * fade;
    const vel = Math.atan2(v + S.a * r, Math.max(Math.abs(u), 0.3)) * Math.sign(u || 1);
    const gyro = g * (vel - S.gyroK * this.slipRate);
    this.steer = THREE.MathUtils.clamp(this.steerCmd * (1 - S.authority * g) + gyro, -S.maxSteer, S.maxSteer);
    const d = this.steer;
    // axle loads with longitudinal transfer
    const shift = m * this.ax * S.cgH / L;
    const FzF = Math.max(0.15 * m * G, m * G * S.b / L - shift), FzR = Math.max(0.15 * m * G, m * G * S.a / L + shift);
    const den = (x: number) => Math.max(Math.abs(x), 0.5);

    // ---- front axle (free rolling): velocity in the wheel frame
    const vfx = u, vfy = v + S.a * r;
    const cd = Math.cos(d), sd = Math.sin(d);
    const wl = vfx * cd + vfy * sd, wy = -vfx * sd + vfy * cd;
    const kyF = wy / Math.max(Math.abs(wl), S.denLat);
    const rhoF = Math.abs(kyF) / S.slipY;
    const DF = S.muF * FzF;
    const fyW = -Math.sign(kyF) * DF * DriftSim.curve(rhoF, S.slide);
    const roll = -Math.sign(wl) * Math.min(1, Math.abs(wl) / 0.2) * 0.02 * FzF; // rolling resistance
    // to body frame
    let Fx = roll * cd - fyW * sd, Fy = roll * sd + fyW * cd;
    let Mz = S.a * (roll * sd + fyW * cd);
    this.frontSlide = rhoF;

    // ---- rear axle: combined slip from wheelspin and side slip
    const vry = v - S.b * r;
    const DR = S.muR * FzR, R = S.wheelR;
    const rearF = (om: number) => {
      const kx = (om * R - u) / den(u), ky = vry / Math.max(Math.abs(u), S.denLat);
      const ax = kx / S.slipX, ay = ky / S.slipY, rho = Math.hypot(ax, ay);
      if (rho < 1e-6) return [0, 0, 0];
      const f = DR * DriftSim.curve(rho, S.slide) / rho;
      return [f * ax, -f * ay, rho];
    };
    // motor / brake torque on the axle
    let T = 0;
    const om = this.omega;
    if (mode === 'drive') T = thr * S.torque * Math.max(0, 1 - Math.max(0, om * R) / S.vTop);
    else if (mode === 'rev') T = thr * S.revTorque * Math.max(0, 1 - Math.max(0, -om * R) / S.revTop);
    T -= 0.00008 * om; // drivetrain drag
    // implicit wheel update (the tyre is very stiff against a light wheel)
    const [fx0] = rearF(om), eps = 0.5;
    const kDer = Math.max(0, (rearF(om + eps)[0] - fx0) / eps);
    let omN = om + h * (T - R * fx0) / (S.wheelI + h * R * R * kDer);
    if (mode === 'brake') {
      // drag brake pulls the wheel toward stopped, never past it
      const dOm = (S.brake * Math.abs(thr) / S.wheelI) * h;
      omN = Math.abs(omN) <= dOm ? 0 : omN - Math.sign(omN) * dOm;
    }
    this.omega = omN;
    const [fxR, fyR, rhoR] = rearF(omN);
    this.rearSlide = rhoR;
    this.wheelspin = (omN * R - u) / den(u);
    Fx += fxR; Fy += fyR; Mz += -S.b * fyR;
    // aero + floor drag
    Fx -= 0.006 * u * Math.abs(u);

    // integrate in the world frame
    const axw = (Fx * c - Fy * s) / m, azw = (Fx * s + Fy * c) / m;
    const V2 = this.vx * this.vx + this.vz * this.vz;
    const pathRate = V2 > 0.25 ? (this.vx * azw - this.vz * axw) / V2 : r;
    this.slipRate += ((r - pathRate) - this.slipRate) * Math.min(1, h * 60);
    this.vx += axw * h; this.vz += azw * h;
    this.r += (Mz / S.Iz) * h;
    // a touch of yaw damping from tyre scrub at very low speed
    if (Math.abs(u) < 0.4 && Math.abs(v) < 0.4) this.r *= Math.exp(-6 * h);
    this.x += this.vx * h; this.z += this.vz * h; this.psi += this.r * h;
    const k = 1 - Math.exp(-h * 30);
    this.ax += (Fx / m - this.ax) * k; this.ay += (Fy / m - this.ay) * k;
    this.spinF += (wl / R) * h; this.spinR += omN * h;
  }

  /** Lane walls: body corners and side points against the outer boards and the inner kerb. */
  private collide() {
    const S = this.S, T = this.track;
    const c = Math.cos(this.psi), s = Math.sin(this.psi);
    const hl = S.length / 2, hw = S.width / 2;
    const pts: [number, number][] = [[hl, hw], [hl, -hw], [-hl, hw], [-hl, -hw], [0, hw], [0, -hw], [hl, 0], [-hl, 0]];
    let worst = 0, hit: { rx: number; rz: number; nx: number; nz: number; pen: number; inner: boolean } | null = null;
    for (const [fx, fy] of pts) {
      const rx = fx * c - fy * s, rz = fx * s + fy * c;
      const q = T.query(this.x + rx, this.z + rz, this.idx);
      const pen = Math.abs(q.d) - q.hw;
      if (pen > worst) {
        const sg = Math.sign(q.d), samp = T.samples[q.idx];
        worst = pen; hit = { rx, rz, nx: -sg * q.nx, nz: -sg * q.nz, pen, inner: Math.sign(samp.curv) === sg };
      }
    }
    if (!hit) return;
    this.x += hit.nx * hit.pen; this.z += hit.nz * hit.pen;
    // impulse at the contact point
    const vpx = this.vx - this.r * hit.rz, vpz = this.vz + this.r * hit.rx;
    const vn = vpx * hit.nx + vpz * hit.nz;
    if (vn >= 0) return;
    const e = 0.22, mu = 0.12, m = S.mass, I = S.Iz;
    const rn = hit.rx * hit.nz - hit.rz * hit.nx;
    const J = -(1 + e) * vn / (1 / m + rn * rn / I);
    // tangential (scrub along the wall), limited by friction
    const tx = -hit.nz, tz = hit.nx, vt = vpx * tx + vpz * tz;
    const rt = hit.rx * tz - hit.rz * tx;
    const Jt = THREE.MathUtils.clamp(-vt / (1 / m + rt * rt / I), -mu * J, mu * J);
    this.vx += (J * hit.nx + Jt * tx) / m; this.vz += (J * hit.nz + Jt * tz) / m;
    this.r += (rn * J + rt * Jt) / I;
    this.omega = Math.min(this.omega, Math.max(0, this.u) / S.wheelR + 40);
    if (-vn > 0.4) this.events.push({ type: 'wall', impact: -vn, inner: hit.inner });
  }

  takeStats() { const s = this.stats; this.stats = { distance: 0, throttleEnergy: 0 }; return s; }
}
