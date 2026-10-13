// Rock crawler physics: a rigid body on four raycast suspension corners over the baked trail heightfield.
// Crawler character: very low gearing (slow, huge torque), a drag brake that holds the truck on a slope
// when the trigger is released, soft long-travel suspension, sticky tyres, and chassis/body contact so
// it can high-centre on rocks or roll over.
import * as THREE from 'three';

export const CRAWLER_SPEC = {
  name: 'Cragweld CW-C1 Stoneamble',
  mass: 2.3,
  wheelbase: 0.32,
  track: 0.25,
  wheelR: 0.058,
  restLen: 0.06,       // mount -> wheel centre at mid travel; full droop is restLen + travel
  travel: 0.045,
  k: 190,              // per corner, N/m
  c: 10,               // per corner, N·s/m
  maxFwd: 1.15,        // m/s
  maxRev: 0.8,
  driveGain: 22,       // N per (m/s) of speed error, per wheel
  lateralGain: 40,
  mu: 1.25,            // crawler tyre on rock/dirt
  maxSteer: 0.62,      // rad
  servoRate: 3.0,      // rad/s
  mountY: 0.045,       // suspension mounts above the centre of mass (heavy wheels, axles and brass keep the mass low)
  inertia: [0.024, 0.07, 0.058] as [number, number, number], // roll, yaw, pitch
  hull: [[0, -0.015, 0], [0.05, -0.008, 0], [-0.05, -0.008, 0], [0.25, 0.02, 0], [-0.24, 0.02, 0],
    [0.05, 0.07, 0.14], [0.05, 0.07, -0.14], [-0.1, 0.07, 0.14], [-0.1, 0.07, -0.14],
    [0.0, 0.19, 0.09], [0.0, 0.19, -0.09], [-0.15, 0.17, 0.09], [-0.15, 0.17, -0.09]] as [number, number, number][],
  coast: false,        // crawler: drag brake holds the truck when the trigger is released
  maxForce: 1e9,       // per-wheel drive force cap (N)
  airPitch: 0,         // throttle/brake pitch torque while airborne (N·m)
  steerTaper: 0,       // fraction of lock removed at top speed
  contactK: 9000,      // tyre tread/sidewall contact stiffness (N/m)
  contactC: 120,       // ... and damping (N·s/m)
  bumpK: 6000,         // bump-stop stiffness past full compression
  torqueReact: 0,      // fraction of the axle drive-torque reaction fed back into body pitch
  hullK: 18000,        // chassis/body contact stiffness
  hullC: 260,          // ... and damping
  contactMax: 1e9,     // cap on any single tread/hull contact force (N)
  rearSteer: 0,        // 4-wheel steer: rear wheels turn opposite by this fraction (fades with speed)
  twist: 0.28,         // driveshaft torque twist: chassis roll per N·m of drive torque
  brakeMul: 1.6,       // braking / drag-brake force as a multiple of maxForce
  maxCompRate: 3,      // cap on the damper speed used for the damping force (m/s)
  maxSpin: 1e9,
  suspMax: 1e9,        // cap on any one corner's spring + bump-stop force (N)
  tangentDrive: 1,     // 1 = drive along the rim tangent (climbs faces), 0 = along the wheel's heading
  treadWheelMax: 1e9,  // cap on one tyre's total tread/sidewall contact force, in quarter-truck weights
  treadDriveMax: 14,
  pitchDamp: 0.25,        // body pitch damping while any wheel is down (N·m·s)
  treadLift: 0.7,
  liftGrip: 0.6,       // how much of the lifted wheel's squash still counts for tread grip        // fraction of an edge's height the wheel rides up its suspension (vs the chassis taking it)
  wheelDriveMax: 1e9,  // cap on one wheel's total drive force, patch + tread (motor torque / tyre radius)   // cap on the drive force any one tread/sidewall point can make (N)
  sidewallGrip: 0.6,   // grip of the tyre shoulder/sidewall vs the tread (wall climbing)
  diffDrop: 0.02,      // how far the diff housing hangs below the wheel centre (portal axles lift it)        // cap on body angular speed (rad/s) — keeps violent crashes from exploding
  rollers: [] as [number, number, number][], // small free-rolling wheels on the body (wheelie bar), body frame
  airBoost: 0,         // extra air pitch authority from a flywheel, only when fully airborne
  airRoll: 0,          // steering rolls the truck while airborne (N·m at full lock) — air-control flywheel
  drainMul: 1,         // battery use multiplier
  tyreAngles: [0.42, 0.75, 1.2, 1.57, -0.42, -0.75, -1.2] as number[], // tread/sidewall contact points (rad from straight down, + = ahead)
};
export type TruckSpec = typeof CRAWLER_SPEC;

/** What the truck sim needs from the ground. */
export interface Ground {
  heightAt(x: number, z: number): number;
  normalAt(x: number, z: number, out?: THREE.Vector3): THREE.Vector3;
  pointAt?(s: number): THREE.Vector3;
  tangentAt?(s: number): THREE.Vector3;
  /** Optional surface grip multiplier (1 = nominal). */
  gripAt?(x: number, z: number): number;
}
const SUB = 4; // physics substeps per fixed step

export interface CrawlInput { steer: number; throttle: number }

export class CrawlerSim {
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  q = new THREE.Quaternion();
  w = new THREE.Vector3();
  steer = 0;
  /** Per corner (FL, FR, RL, RR): suspension length (mount -> wheel centre) and wheel spin. */
  susp = [0, 0, 0, 0];
  spin = [0, 0, 0, 0];
  grounded = [false, false, false, false];
  private prevComp = [0, 0, 0, 0];
  private patchDrive = [0, 0, 0, 0];
  /** debug: pitch torque per force group, summed over substeps (set to {} to enable) */
  dbg: Record<string, number> | null = null;
  private tag = '';
  rolledTime = 0;
  /** Distance travelled (m) and battery-energy proxy for wear/drain. */
  stats = { distance: 0, throttleEnergy: 0 };
  readonly invIBody: THREE.Vector3; // roll(x), yaw(y), pitch(z)
  private mounts: THREE.Vector3[];
  // chassis contact points (body frame): skid plate, bumpers, sides, roof/cage corners
  private hull: THREE.Vector3[];
  /** Seconds with all four wheels off the ground (0 when any wheel touches). */
  airTime = 0;
  /** any tread, hull or roller contact this substep */
  private touch = false;
  /** Anything touching the ground after the last step: a wheel, a tyre shoulder, the chassis or the wheelie bar. */
  get touching() { return this.touch || this.grounded.some(Boolean); }
  private airWheelV = 0;

  constructor(public terrain: Ground, readonly S: TruckSpec = CRAWLER_SPEC) {
    const sp = this.S, y = sp.mountY;
    this.invIBody = new THREE.Vector3(1 / sp.inertia[0], 1 / sp.inertia[1], 1 / sp.inertia[2]);
    this.mounts = [
      new THREE.Vector3(sp.wheelbase / 2, y, -sp.track / 2), new THREE.Vector3(sp.wheelbase / 2, y, sp.track / 2),
      new THREE.Vector3(-sp.wheelbase / 2, y, -sp.track / 2), new THREE.Vector3(-sp.wheelbase / 2, y, sp.track / 2),
    ];
    this.hull = sp.hull.map(([a, b, c]) => new THREE.Vector3(a, b, c));
  }

  /** Put the truck on the trail at distance `s`, upright and at rest. */
  placeAt(s: number) {
    const T = this.terrain;
    const p = T.pointAt!(s), t = T.tangentAt!(s);
    this.placePose(p.x, p.z, Math.atan2(-t.z, t.x));
  }

  /** Put the truck at (x, z) facing `heading` (rotation about +y that turns +x toward travel), at rest. */
  placePose(x: number, z: number, heading: number) {
    const T = this.terrain;
    const p = new THREE.Vector3(x, 0, z);
    this.q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading);
    // sit it at roughly the static ride height over the highest point under the wheels
    let g = -Infinity;
    for (const m of this.mounts) { const w = m.clone().applyQuaternion(this.q).add(p); g = Math.max(g, T.heightAt(w.x, w.z)); }
    this.pos.set(p.x, g + this.S.wheelR + this.S.restLen + this.S.travel - 0.028 - this.S.mountY + 0.012, p.z);
    this.vel.set(0, 0, 0); this.w.set(0, 0, 0);
    this.steer = 0; this.rolledTime = 0; this.airTime = 0;
    for (let i = 0; i < 4; i++) { this.susp[i] = this.S.restLen; this.prevComp[i] = 0; }
  }

  get forward() { return new THREE.Vector3(1, 0, 0).applyQuaternion(this.q); }
  get up() { return new THREE.Vector3(0, 1, 0).applyQuaternion(this.q); }
  get speed() { return this.vel.length(); }
  get forwardSpeed() { return this.vel.dot(this.forward); }
  get rolled() { return this.up.y < 0.2; }

  /** Current rear-steer fraction (full at low speed, half at top speed). */
  get rearSteerNow() { return this.S.rearSteer * (1 - 0.5 * Math.min(1, Math.abs(this.forwardSpeed) / this.S.maxFwd)); }

  step(dt: number, input: CrawlInput) {
    const taper = 1 - this.S.steerTaper * Math.min(1, Math.abs(this.forwardSpeed) / this.S.maxFwd);
    const target = THREE.MathUtils.clamp(input.steer, -1, 1) * this.S.maxSteer * taper;
    const md = this.S.servoRate * dt;
    this.steer += THREE.MathUtils.clamp(target - this.steer, -md, md);
    const h = dt / SUB;
    for (let i = 0; i < SUB; i++) this.substep(h, input);
    this.rolledTime = this.rolled ? this.rolledTime + dt : 0;
    this.airTime = this.grounded.some(Boolean) ? 0 : this.airTime + dt;
    const v = this.vel.length();
    this.stats.distance += v * dt;
    this.stats.throttleEnergy += Math.abs(input.throttle) * dt;
  }

  private tmp = { f: new THREE.Vector3(), t: new THREE.Vector3(), r: new THREE.Vector3(), p: new THREE.Vector3(), n: new THREE.Vector3(), vp: new THREE.Vector3(), a: new THREE.Vector3(), b: new THREE.Vector3() };

  private substep(dt: number, input: CrawlInput) {
    const T = this.terrain;
    const { f: F, t: TQ, r, p, n, vp, a, b } = this.tmp;
    F.set(0, -9.81 * this.S.mass, 0);
    TQ.set(0, 0, 0);
    this.touch = false;
    const fwd = new THREE.Vector3(1, 0, 0).applyQuaternion(this.q);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.q);
    const addForce = (force: THREE.Vector3, at: THREE.Vector3) => {
      F.add(force);
      r.copy(at).sub(this.pos);
      TQ.add(a.crossVectors(r, force));
      if (this.dbg) { const z = new THREE.Vector3(0, 0, 1).applyQuaternion(this.q); this.dbg[this.tag] = (this.dbg[this.tag] ?? 0) + a.dot(z); this.dbg[this.tag + 'F'] = (this.dbg[this.tag + 'F'] ?? 0) + force.dot(up); }
    };
    const pointVel = (at: THREE.Vector3, out: THREE.Vector3) => out.crossVectors(this.w, r.copy(at).sub(this.pos)).add(this.vel);

    const thr = THREE.MathUtils.clamp(input.throttle, -1, 1);
    const targetV = thr >= 0 ? thr * this.S.maxFwd : thr * this.S.maxRev;

    // --- suspension corners
    this.tag = 'susp';
    let driveTorque = 0;
    for (let i = 0; i < 4; i++) {
      const mount = this.mounts[i].clone().applyQuaternion(this.q).add(this.pos);
      const maxT = this.S.restLen + this.S.travel + this.S.wheelR;
      // march down the suspension axis to the ground, then refine
      let hit = -1, lo = 0;
      for (let t = 0; t <= maxT; t += 0.008) {
        p.copy(mount).addScaledVector(up, -t);
        if (p.y <= T.heightAt(p.x, p.z)) { hit = t; break; }
        lo = t;
      }
      if (hit < 0) { this.patchDrive[i] = 0; this.grounded[i] = false; this.susp[i] = this.S.restLen + this.S.travel; this.prevComp[i] = 0; continue; }
      let hi = hit;
      for (let k = 0; k < 6; k++) { const m = (lo + hi) / 2; p.copy(mount).addScaledVector(up, -m); if (p.y <= T.heightAt(p.x, p.z)) hi = m; else lo = m; }
      const tHit = hi;
      this.grounded[i] = true;
      const comp = maxT - tHit; // spring compression from full droop
      this.susp[i] = THREE.MathUtils.clamp(tHit - this.S.wheelR, this.S.restLen - this.S.travel, this.S.restLen + this.S.travel);
      // compression rate from the mount's actual velocity along the strut (a finite difference would spike
      // on the first contact after a jump, when the previous compression was zero)
      pointVel(mount, vp);
      const rate = THREE.MathUtils.clamp(-vp.dot(up), -this.S.maxCompRate, this.S.maxCompRate);
      this.prevComp[i] = comp;
      let fs = this.S.k * comp + this.S.c * rate;
      const bump = tHit - this.S.wheelR - (this.S.restLen - this.S.travel);
      if (bump < 0) fs += -bump * this.S.bumpK; // bump stop
      p.copy(mount).addScaledVector(up, -tHit);
      T.normalAt(p.x, p.z, n);
      // the ground can only push the strut as far as it faces it (a truck on its nose doesn't get launched
      // sideways by its own springs), and no single corner takes more than the spec allows
      fs = Math.min(this.S.suspMax, Math.max(0, fs) * THREE.MathUtils.clamp(up.dot(n) * 1.5, 0, 1));
      // tyre frame on the ground plane
      const steerA = i < 2 ? -this.steer : this.steer * this.rearSteerNow; // +steer = right turn (clockwise from above)
      b.copy(fwd).applyAxisAngle(up, steerA);
      b.addScaledVector(n, -b.dot(n)).normalize();             // wheel forward along the ground
      const lat = new THREE.Vector3().crossVectors(n, b);        // wheel lateral
      pointVel(p, vp);
      const vLong = vp.dot(b), vLat = vp.dot(lat);
      const N = fs * Math.max(0.2, up.dot(n));
      const lim = this.S.mu * N * (T.gripAt ? T.gripAt(p.x, p.z) : 1);
      let fl = this.S.coast && Math.abs(thr) < 0.04
        ? -Math.sign(vLong) * Math.min(Math.abs(vLong) * 2.2, 1.2)            // coasting: rolling resistance only
        : THREE.MathUtils.clamp(this.S.driveGain * (targetV - vLong), -this.S.maxForce * (thr * vLong < 0 || Math.abs(thr) < 0.04 ? this.S.brakeMul : 1), this.S.maxForce);
      let ft = -this.S.lateralGain * vLat;
      const mag = Math.hypot(fl, ft);
      if (mag > lim) { fl *= lim / mag; ft *= lim / mag; }
      driveTorque += fl * this.S.wheelR;
      this.patchDrive[i] = Math.abs(fl);
      const force = new THREE.Vector3().addScaledVector(up, fs).addScaledVector(b, fl).addScaledVector(lat, ft);
      addForce(force, p);
      this.spin[i] += (vLong / this.S.wheelR) * dt;
    }
    // --- tyre sidewall/tread contacts ahead of and behind the contact patch: lets a round tyre meet a
    // rock face or log and climb it (grip along the face, pushed back by its normal) instead of a
    // single ray falling through the obstacle
    this.tag = 'tread';
    for (let i = 0; i < 4; i++) {
      const mount = this.mounts[i].clone().applyQuaternion(this.q).add(this.pos);
      const centre = mount.clone().addScaledVector(up, -this.susp[i]);
      const steerA = i < 2 ? -this.steer : this.steer * this.rearSteerNow;
      const wf = new THREE.Vector3().copy(fwd).applyAxisAngle(up, steerA);
      // the wheel rides up its suspension over an edge below its centre (a step, a log) instead of the
      // chassis taking the hit: lift it until the lower tread clears, as far as the travel allows, and let
      // the (soft) spring carry that extra compression
      let lift = 0;
      if (this.S.treadLift > 0) {
        let need = 0;
        for (const ang of this.S.tyreAngles) {
          if (Math.abs(ang) > 1.0) continue;
          p.copy(centre).addScaledVector(wf, Math.sin(ang) * this.S.wheelR).addScaledVector(up, -Math.cos(ang) * this.S.wheelR);
          const pen = T.heightAt(p.x, p.z) - p.y;
          if (pen > need) need = pen;
        }
        const room = this.susp[i] - (this.S.restLen - this.S.travel);
        lift = Math.min(room, need / Math.max(0.5, up.y)) * this.S.treadLift;
        if (lift > 1e-5) {
          this.susp[i] -= lift;
          centre.addScaledVector(up, lift);
          addForce(a.copy(up).multiplyScalar(this.S.k * lift), mount);
          if (!this.grounded[i]) this.grounded[i] = true;
        }
      }
      // gather this tyre's contacts first, then cap the tyre's total so a hard hit on a face can't kick the
      // chassis harder than the tyre and suspension could really pass on
      const hits: { f: THREE.Vector3; d: THREE.Vector3; at: THREE.Vector3; fn: number; fl: number }[] = [];
      for (const ang of this.S.tyreAngles) {
        p.copy(centre).addScaledVector(wf, Math.sin(ang) * this.S.wheelR).addScaledVector(up, -Math.cos(ang) * this.S.wheelR);
        const pen = T.heightAt(p.x, p.z) - p.y;
        // a wheel that rode up its suspension still has the drive pressing its tread into the edge: grip
        // comes from the un-lifted squash, the push on the chassis from what's left after the lift
        const penGrip = pen + lift * this.S.liftGrip;
        if (pen <= 0 && penGrip <= 0) continue;
        T.normalAt(p.x, p.z, n);
        // the face normal leans toward the wheel centre for a round tyre
        n.add(a.copy(centre).sub(p).normalize()).normalize();
        pointVel(p, vp);
        const vn = vp.dot(n);
        const fn = pen <= 0 ? 0 : Math.min(this.S.contactMax, Math.max(0, this.S.contactK * pen - this.S.contactC * vn));
        const fnGrip = this.S.treadLift > 0 ? Math.max(fn, Math.min(this.S.contactMax, this.S.contactK * penGrip)) : fn;
        // drive acts along the rim tangent at this point (forward at the bottom, straight up at the front),
        // laid onto the contact face
        b.copy(wf).multiplyScalar(Math.cos(ang)).addScaledVector(up, Math.sin(ang) * this.S.tangentDrive);
        b.addScaledVector(n, -b.dot(n));
        if (b.lengthSq() < 1e-6) continue;
        b.normalize();
        const lat = new THREE.Vector3().crossVectors(n, b);
        // the sidewall bites less than the tread as the contact wraps toward the front of the tyre
        const side = Math.abs(ang) > 0.9 ? this.S.sidewallGrip : 1;
        const lim = this.S.mu * side * fnGrip * (T.gripAt ? T.gripAt(p.x, p.z) : 1);
        let fl = THREE.MathUtils.clamp(this.S.driveGain * 2 * (targetV - vp.dot(b)), -this.S.treadDriveMax, this.S.treadDriveMax);
        let ft = -this.S.lateralGain * vp.dot(lat);
        const mag = Math.hypot(fl, ft);
        if (mag > lim) { fl *= lim / mag; ft *= lim / mag; }
        this.touch = true;
        hits.push({ f: new THREE.Vector3().addScaledVector(n, fn).addScaledVector(lat, ft), d: b.clone().multiplyScalar(fl), at: p.clone(), fn, fl: Math.abs(fl) });
      }
      const total = hits.reduce((acc, h) => acc + h.fn, 0), cap = this.S.treadWheelMax * this.S.mass * 9.81 / 4;
      const k = total > cap ? cap / total : 1;
      // one motor drives this wheel: the tread points share what's left of its torque after the contact patch
      const budget = Math.max(0, this.S.wheelDriveMax - this.patchDrive[i]);
      const dsum = hits.reduce((acc, h) => acc + h.fl, 0), kd = dsum > budget ? budget / dsum : 1;
      for (const h of hits) addForce(h.f.multiplyScalar(k).addScaledVector(h.d, kd), h.at);
    }
    for (let i = 0; i < 4; i++) if (!this.grounded[i]) this.spin[i] += (targetV / this.S.wheelR) * dt * 0.6;

    // --- diff housings + axle tubes: they hang below the wheel centres and drag on whatever is under them
    this.tag = 'diff';
    for (let ax = 0; ax < 2; ax++) {
      const cL = this.mounts[ax * 2].clone().applyQuaternion(this.q).add(this.pos).addScaledVector(up, -this.susp[ax * 2]);
      const cR = this.mounts[ax * 2 + 1].clone().applyQuaternion(this.q).add(this.pos).addScaledVector(up, -this.susp[ax * 2 + 1]);
      for (const t of [0.3, 0.45, 0.6]) {
        p.copy(cL).lerp(cR, t).addScaledVector(up, -(t === 0.45 ? this.S.diffDrop + 0.012 : this.S.diffDrop));
        const pen = T.heightAt(p.x, p.z) - p.y;
        if (pen <= 0) continue;
        T.normalAt(p.x, p.z, n);
        pointVel(p, vp);
        const vn = vp.dot(n);
        const fn = Math.min(this.S.contactMax, Math.max(0, this.S.hullK * pen - this.S.hullC * vn));
        const vt = vp.clone().addScaledVector(n, -vn), vtl = vt.length();
        const fric = vtl > 1e-4 ? vt.multiplyScalar(-Math.min(0.7 * fn, 30 * vtl) / vtl) : vt.set(0, 0, 0);
        addForce(new THREE.Vector3().addScaledVector(n, fn).add(fric), p);
      }
    }

    // --- chassis / body contacts (high-centring, rollovers)
    this.tag = 'hull';
    for (const hp of this.hull) {
      p.copy(hp).applyQuaternion(this.q).add(this.pos);
      const g = T.heightAt(p.x, p.z);
      const pen = g - p.y;
      if (pen <= 0) continue;
      T.normalAt(p.x, p.z, n);
      pointVel(p, vp);
      const vn = vp.dot(n);
      const fn = Math.min(this.S.contactMax * 1.5, Math.max(0, this.S.hullK * pen - this.S.hullC * vn));
      this.touch = true;
      const vt = vp.clone().addScaledVector(n, -vn);
      const vtl = vt.length();
      const fric = vtl > 1e-4 ? vt.multiplyScalar(-Math.min(0.6 * fn, 30 * vtl) / vtl) : vt.set(0, 0, 0);
      addForce(new THREE.Vector3().addScaledVector(n, fn).add(fric), p);
    }

    // --- wheelie-bar rollers: push back like the chassis but roll freely along the ground
    this.tag = 'roller';
    for (const rp of this.S.rollers) {
      p.set(rp[0], rp[1], rp[2]).applyQuaternion(this.q).add(this.pos);
      const pen = T.heightAt(p.x, p.z) - p.y;
      if (pen <= 0) continue;
      T.normalAt(p.x, p.z, n);
      pointVel(p, vp);
      const vn = vp.dot(n);
      this.touch = true;
      const fn = Math.min(400, Math.max(0, this.S.hullK * pen - this.S.hullC * vn));
      const side = a.crossVectors(n, fwd); // roller axle direction on the ground
      const vs = side.lengthSq() > 1e-6 ? vp.dot(side.normalize()) : 0;
      addForce(new THREE.Vector3().addScaledVector(n, fn).addScaledVector(side, -Math.sign(vs) * Math.min(0.5 * fn, 20 * Math.abs(vs))), p);
    }

    // --- driveshaft torque twist: the spinning prop shaft rolls the chassis (one side squats, the other lifts)
    if (this.S.twist > 0) TQ.addScaledVector(fwd, driveTorque * this.S.twist);

    // --- the axles push back on the chassis as they drive the wheels (solid-axle trucks lift the nose)
    if (this.S.torqueReact > 0) {
      const fade = 1 - THREE.MathUtils.smoothstep(Math.abs(this.forwardSpeed), 2, 5); // mostly felt when punching it from low speed
      // with the wheels turned the truck slides and scrubs instead of lifting the nose (and a wheelie in a
      // donut would just tip it sideways)
      const steerCut = 1 - 0.9 * Math.min(1, Math.abs(this.steer) / (0.6 * this.S.maxSteer));
      TQ.addScaledVector(new THREE.Vector3(0, 0, 1).applyQuaternion(this.q), driveTorque * this.S.torqueReact * fade * thr * thr * steerCut); // feather the trigger to ride it
    }

    // --- in the air the spinning wheels act as a flywheel: throttle lifts the nose, brake drops it
    // (reaction torque only while the wheels change speed: throttle blip = nose up, brake = nose down)
    if (this.S.airPitch > 0) {
      if (this.grounded.some(Boolean)) this.airWheelV = this.forwardSpeed;
      else {
        const prev = this.airWheelV;
        this.airWheelV += THREE.MathUtils.clamp(targetV - this.airWheelV, -45 * dt, 28 * dt);
        const zAxis = new THREE.Vector3(0, 0, 1).applyQuaternion(this.q);
        // a free flywheel (only when nothing at all touches) multiplies the pitch effect
        const fly = this.touch ? 0 : this.S.airBoost;
        TQ.addScaledVector(zAxis, this.S.airPitch * (1 + fly) * (this.airWheelV - prev) / dt);
        // a touch of aerodynamic / gyro damping so a clean launch stays a clean launch
        TQ.addScaledVector(zAxis, -0.06 * this.w.dot(zAxis));
        if (this.S.airRoll > 0 && !this.touch) {
          const xAxis = new THREE.Vector3(1, 0, 0).applyQuaternion(this.q);
          TQ.addScaledVector(xAxis, this.S.airRoll * THREE.MathUtils.clamp(input.steer, -1, 1) - 0.06 * this.w.dot(xAxis));
        }
      }
    }

    // --- pitch damping through the planted tyres and shocks (soft foams and links soak up a nose-first landing)
    if (this.S.pitchDamp > 0 && this.grounded.some(Boolean)) {
      const zAxis = new THREE.Vector3(0, 0, 1).applyQuaternion(this.q);
      TQ.addScaledVector(zAxis, -this.S.pitchDamp * this.w.dot(zAxis));
    }

    // --- integrate (semi-implicit Euler, inertia in the body frame)
    this.vel.addScaledVector(F, dt / this.S.mass);
    const qi = this.q.clone().invert();
    const tb = TQ.clone().applyQuaternion(qi).multiply(this.invIBody);
    const wb = this.w.clone().applyQuaternion(qi).addScaledVector(tb, dt);
    this.w.copy(wb.applyQuaternion(this.q));
    this.w.multiplyScalar(1 - 1.2 * dt);   // light angular damping
    const wl = this.w.length(); if (wl > this.S.maxSpin) this.w.multiplyScalar(this.S.maxSpin / wl);
    this.vel.multiplyScalar(1 - 0.05 * dt);
    this.pos.addScaledVector(this.vel, dt);
    const wq = new THREE.Quaternion(this.w.x * dt * 0.5, this.w.y * dt * 0.5, this.w.z * dt * 0.5, 0).multiply(this.q);
    this.q.set(this.q.x + wq.x, this.q.y + wq.y, this.q.z + wq.z, this.q.w + wq.w).normalize();

    // hard floor safety: never fall through the field
    const gC = T.heightAt(this.pos.x, this.pos.z);
    if (this.pos.y < gC - 0.05) { this.pos.y = gC + 0.05; if (this.vel.y < 0) this.vel.y = 0; }
  }

  takeStats() { const s = { ...this.stats }; this.stats = { distance: 0, throttleEnergy: 0 }; return s; }
}

// ====================================================================================== crawler upgrades
export type CrawlerSlot = 'tyres' | 'axles' | 'suspension' | 'weights' | 'servo' | 'motor';
export interface CrawlerUpgrade { id: string; slot: CrawlerSlot; name: string; price: number; note: string; apply: (s: TruckSpec) => void }
/** Hop-ups for the Cragweld crawler (shared by both bodies). The first entry of each slot is stock. */
const LOW = 0.75;     // share of a tyre/axle lift that is unsprung (keeps the CG down)
const LIFTLOW = 0.375; // a lift kit raises the chassis and more of the mass with it
export const CRAWLER_UPGRADES: Record<CrawlerSlot, CrawlerUpgrade[]> = {
  tyres: [
    { id: 'tyres-stock', slot: 'tyres', name: '1.9" all-terrain tyres', price: 0, note: 'Stock. 116 mm tall, medium compound.', apply: () => {} },
    { id: 'tyres-claw', slot: 'tyres', name: '2.2" Rock Claw tyres', price: 120, note: '128 mm tall, soft compound: more clearance and much more bite on rock and logs.', apply: (s) => { s.wheelR = 0.064; s.mu = 1.38; s.sidewallGrip = 0.72; raise(s, 0.006, LOW); } },
    { id: 'tyres-boulder', slot: 'tyres', name: '2.2" Boulder XL tyres', price: 230, note: '140 mm tall, super-soft with foams. Huge clearance and grip, a little heavier.', apply: (s) => { s.wheelR = 0.07; s.mu = 1.46; s.sidewallGrip = 0.8; s.mass += 0.15; raise(s, 0.012, LOW); } },
  ],
  axles: [
    { id: 'axles-stock', slot: 'axles', name: 'Straight axles', price: 0, note: 'Stock. The diff housings hang low.', apply: () => {} },
    { id: 'axles-portal', slot: 'axles', name: 'Portal axles', price: 260, note: 'Gear boxes at each hub: the axles and diffs sit 16 mm higher, the chassis rides higher, and the extra reduction adds torque.', apply: (s) => { s.diffDrop = 0.004; s.restLen += 0.014; raise(s, 0.014, LOW); s.driveGain *= 1.25; s.maxFwd *= 0.92; } },
  ],
  suspension: [
    { id: 'susp-stock', slot: 'suspension', name: 'Stock links and shocks', price: 0, note: 'Stock ride height.', apply: () => {} },
    { id: 'susp-lift', slot: 'suspension', name: 'Lift kit + long-travel shocks', price: 140, note: '+10 mm ride height and more articulation. The truck sits higher, so it rolls more easily.', apply: (s) => { s.restLen += 0.01; s.travel += 0.012; s.k *= 0.92; raise(s, 0.01, LIFTLOW); } },
  ],
  weights: [
    { id: 'weights-stock', slot: 'weights', name: 'No extra weight', price: 0, note: 'Stock.', apply: () => {} },
    { id: 'weights-brass', slot: 'weights', name: 'Brass knuckles + diff covers', price: 90, note: 'Heavy brass down low: lower centre of gravity, so it stays planted on steep climbs and side slopes.', apply: (s) => { s.mountY += 0.012; s.mass += 0.3; } },
  ],
  servo: [
    { id: 'servo-stock', slot: 'servo', name: 'Stock servo', price: 0, note: 'Stock.', apply: () => {} },
    { id: 'servo-ht', slot: 'servo', name: 'High-torque steel-gear servo', price: 80, note: 'Turns the wheels faster and further, even pinned against a rock.', apply: (s) => { s.servoRate *= 1.6; s.maxSteer += 0.06; } },
  ],
  motor: [
    { id: 'motor-stock', slot: 'motor', name: 'Stock 35T brushed motor', price: 0, note: 'Stock.', apply: () => {} },
    { id: 'motor-torque', slot: 'motor', name: 'Low-kV brushless torque motor', price: 110, note: 'Smooth, strong low-speed torque and a bit more wheel speed.', apply: (s) => { s.driveGain *= 1.3; s.maxFwd += 0.15; } },
  ],
};
/** Raise the chassis by `dh` while most of the new height is unsprung (tyres, portal boxes): the body and
 *  hull go up by dh but the centre of gravity only by (1 - low) * dh. */
function raise(s: TruckSpec, dh: number, low: number) {
  s.mountY += dh * low;
  s.hull = s.hull.map(([x, y, z]) => [x, y + dh * low, z] as [number, number, number]);
}
export const CRAWLER_SLOTS = Object.keys(CRAWLER_UPGRADES) as CrawlerSlot[];
export const crawlerUpgradeById = (id: string) => CRAWLER_SLOTS.flatMap((s) => CRAWLER_UPGRADES[s]).find((u) => u.id === id);

/** The crawler spec with the fitted upgrades applied. */
export function crawlerSpecFor(fitted?: Partial<Record<CrawlerSlot, string>>): TruckSpec {
  const s: TruckSpec = { ...CRAWLER_SPEC, inertia: [...CRAWLER_SPEC.inertia] as [number, number, number], hull: CRAWLER_SPEC.hull.map((p) => [...p] as [number, number, number]), tyreAngles: [...CRAWLER_SPEC.tyreAngles] };
  for (const slot of CRAWLER_SLOTS) crawlerUpgradeById(fitted?.[slot] ?? '')?.apply(s);
  // heavier truck: scale the inertia with it
  const m = s.mass / CRAWLER_SPEC.mass; s.inertia = s.inertia.map((v) => v * m) as [number, number, number];
  return s;
}
