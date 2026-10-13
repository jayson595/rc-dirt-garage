// All tunable game data lives here so values aren't scattered through UI or scene code.

export const SCHEMA_VERSION = 1;

export type PartId =
  | 'shell' | 'chassis' | 'motor' | 'esc' | 'battery'
  | 'servo' | 'shocks' | 'tires' | 'diff' | 'gears';

/** Parts with a 0–100 condition value. */
export type WearPart = 'chassis' | 'motor' | 'shocks' | 'tires' | 'servo' | 'esc' | 'diff' | 'gears';

export interface PartDef {
  id: PartId;
  name: string;
  blurb: string;
  /** First build: some parts are visible and labelled but inspection-only. */
  inspectOnly: boolean;
}

export const PART_DEFS: Record<PartId, PartDef> = {
  shell:   { id: 'shell',   name: 'Body Shell',      blurb: 'Lexan body and wing. Remove it to reach the chassis.', inspectOnly: false },
  chassis: { id: 'chassis', name: 'Chassis',         blurb: 'Aluminium plate and arms. Takes damage from hard barrier hits.', inspectOnly: false },
  motor:   { id: 'motor',   name: 'Brushless Motor', blurb: 'Drives acceleration and top speed. Wears slowly with use.', inspectOnly: false },
  esc:     { id: 'esc',     name: 'ESC & Receiver',  blurb: 'Speed controller and radio receiver, with the power and motor wiring.', inspectOnly: false },
  battery: { id: 'battery', name: 'Battery',         blurb: 'LiPo pack. Charge drains while driving; low charge cuts power.', inspectOnly: false },
  servo:   { id: 'servo',   name: 'Steering Servo',  blurb: 'Turns the front wheels. Sets steering response.', inspectOnly: false },
  shocks:  { id: 'shocks',  name: 'Shocks',          blurb: 'Oil shocks. Hard landings wear them; stiffness changes handling.', inspectOnly: false },
  tires:   { id: 'tires',   name: 'Tires & Wheels',  blurb: 'Grip comes from here. Distance and sliding wear them down.', inspectOnly: false },
  diff:    { id: 'diff',    name: 'Differentials',   blurb: 'Front, centre and rear diffs. Thicker oil puts power down out of corners.', inspectOnly: false },
  gears:   { id: 'gears',   name: 'Gear Set',        blurb: 'Spur and pinion. A bigger pinion trades punch for top speed (set it on the setup sheet).', inspectOnly: false },
};

export const PART_ORDER: PartId[] = ['shell', 'battery', 'tires', 'shocks', 'chassis', 'motor', 'servo', 'esc', 'diff', 'gears'];

export type TireCompound = 'pin' | 'soft' | 'block';
export const TIRE_COMPOUNDS: Record<TireCompound, { name: string; grip: number; wear: number; price: number; note: string; stripe: number }> = {
  pin:   { name: 'Mini-Pin (Medium)', grip: 1.0,  wear: 1.0,  price: 20, note: 'All-round dirt tire.', stripe: 0xf2c230 },
  soft:  { name: 'Soft Mini-Pin',     grip: 1.14, wear: 1.8,  price: 30, note: 'More grip, wears fast.', stripe: 0xd63a2f },
  block: { name: 'Hard Block',        grip: 0.86, wear: 0.55, price: 16, note: 'Slides more, lasts long.', stripe: 0xe8e2d4 },
};

export type ShockSetting = 'soft' | 'medium' | 'stiff';
export const SHOCK_SETTINGS: Record<ShockSetting, {
  label: string; spring: number; damping: number; gripMul: number; steerResp: number; rebound: number; absorb: number; note: string;
}> = {
  // spring/damping are per-unit-mass (1/s² and 1/s). Equilibrium sag = g / spring.
  soft:   { label: 'Soft',   spring: 330, damping: 15, gripMul: 1.07, steerResp: 0.75, rebound: 0.05, absorb: 0.82, note: 'More grip and softer landings, lazier steering, bottoms out more.' },
  medium: { label: 'Medium', spring: 520, damping: 24, gripMul: 1.0,  steerResp: 1.0,  rebound: 0.12, absorb: 0.92, note: 'Balanced baseline.' },
  stiff:  { label: 'Stiff',  spring: 850, damping: 30, gripMul: 0.92, steerResp: 1.35, rebound: 0.22, absorb: 1.04, note: 'Sharp steering, less grip, bouncier landings.' },
};

/** Every buggy-class vehicle that races the dirt track (same garage, workbench, pit and battery flow). */
export type BuggyId = 'buggy' | 'buggy2wd' | 'truggy' | 'sct' | 'stadium';
export const BUGGY_ORDER: BuggyId[] = ['buggy', 'buggy2wd', 'stadium', 'sct', 'truggy'];

export interface BuggyClass {
  id: BuggyId;
  name: string;
  short: string;          // card / chip label
  scale: '1/8' | '1/10';
  kind: string;           // "4WD buggy", "short course truck", …
  blurb: string;
  price: number;          // 0 = the starter car
  color: number; accent: number;
  drive: '4wd' | '2wd';
  wheelbase: number;
  wheelRadius: number;
  maxSteer: number;       // rad
  servoRate: number;      // rad/s
  topSpeed: number;       // m/s
  accel: number;          // m/s² at zero speed
  brake: number;
  reverseAccel: number;
  reverseTop: number;
  reverseDelay: number;   // seconds of held brake at standstill before reverse engages
  mu: number;             // arcade tyre friction coefficient
  rolling: number;
  aero: number;
  springRest: number;     // chassis reference height when the spring is unloaded
  maxCompression: number;
  airPitchAccel: number;  // throttle/brake rotate the car in the air like a real RC
  springMul: number;      // × the shock setting's spring rate (long-travel trucks are softer)
  dampMul: number;
  powerSlide: number;     // how much power-on steering loosens the rear (2WD is loose)
  driveTrac: number;      // fraction of grip usable for drive (2WD only drives the rear)
  absorbMul: number;      // landing impact multiplier (big tyres + travel soak hits up)
}

const BASE = {
  servoRate: 6.5, brake: 22, reverseAccel: 7, reverseTop: 3.5, reverseDelay: 0.3, rolling: 0.35, aero: 0.012,
};

export const BUGGY_CLASSES: Record<BuggyId, BuggyClass> = {
  buggy: {
    ...BASE, id: 'buggy', name: 'Dirt Dart 1/8 Buggy', short: 'Dirt Dart 1/8', scale: '1/8', kind: '4WD race buggy',
    blurb: 'Your first race car. Balanced, quick and forgiving.', price: 0, color: 0x1667e6, accent: 0xf2c230, drive: '4wd',
    wheelbase: 0.33, wheelRadius: 0.06, maxSteer: 0.46, topSpeed: 12.5, accel: 15, mu: 1.35,
    springRest: 0.09, maxCompression: 0.07, airPitchAccel: 4.5, springMul: 1, dampMul: 1, powerSlide: 0.28, driveTrac: 1, absorbMul: 1,
  },
  buggy2wd: {
    ...BASE, id: 'buggy2wd', name: 'Ruttworks Kestrel 2WD', short: 'Kestrel 2WD', scale: '1/10', kind: '2WD buggy',
    blurb: 'Light, rear-drive and tail-happy. Feather the throttle out of corners.', price: 180, color: 0xe8622a, accent: 0x1c1c1e, drive: '2wd',
    wheelbase: 0.287, wheelRadius: 0.0476, maxSteer: 0.5, servoRate: 7.5, topSpeed: 12.8, accel: 15.5, mu: 1.24,
    springRest: 0.075, maxCompression: 0.055, airPitchAccel: 5.6, springMul: 1.05, dampMul: 0.95, powerSlide: 0.52, driveTrac: 0.66, absorbMul: 0.94,
  },
  stadium: {
    ...BASE, id: 'stadium', name: 'Ruttworks Thumper ST', short: 'Thumper ST', scale: '1/10', kind: '2WD stadium truck',
    blurb: 'Big tyres, tall wing, lots of bounce. Floats over the whoops.', price: 240, color: 0x2fa84f, accent: 0xf1eadb, drive: '2wd',
    wheelbase: 0.292, wheelRadius: 0.062, maxSteer: 0.48, topSpeed: 11, accel: 12.5, mu: 1.18,
    springRest: 0.105, maxCompression: 0.088, airPitchAccel: 5, springMul: 0.8, dampMul: 0.78, powerSlide: 0.45, driveTrac: 0.7, absorbMul: 0.85,
  },
  sct: {
    ...BASE, id: 'sct', name: 'Dunewolf SC10 Short Course', short: 'Dunewolf SC10', scale: '1/10', kind: '4WD short course truck',
    blurb: 'Full-fender race truck. Heavy and planted, shrugs off bumps and barrier taps.', price: 300, color: 0xd2232a, accent: 0xf1f0ec, drive: '4wd',
    wheelbase: 0.324, wheelRadius: 0.061, maxSteer: 0.44, servoRate: 6, topSpeed: 10.5, accel: 11.5, mu: 1.24,
    springRest: 0.105, maxCompression: 0.085, airPitchAccel: 3.2, springMul: 0.85, dampMul: 1.05, powerSlide: 0.3, driveTrac: 1, absorbMul: 0.82,
  },
  truggy: {
    ...BASE, id: 'truggy', name: 'Ruttworks Brute T8 Truggy', short: 'Brute T8', scale: '1/8', kind: '4WD truggy',
    blurb: 'Wide, long-travel 1/8 monster of a race car. Stable, fast and hard to upset.', price: 380, color: 0x7a4fb0, accent: 0xf2c230, drive: '4wd',
    wheelbase: 0.39, wheelRadius: 0.076, maxSteer: 0.44, servoRate: 6, topSpeed: 13.2, accel: 14.5, mu: 1.34,
    springRest: 0.12, maxCompression: 0.1, airPitchAccel: 3.8, springMul: 0.72, dampMul: 0.9, powerSlide: 0.24, driveTrac: 1, absorbMul: 0.75,
  },
};

/** The starter buggy (kept for older code paths). */
export const BUGGY_SPEC = BUGGY_CLASSES.buggy;

/** Classes still to come (shown as locked cards). Empty for now: every class is in the game. */
export const FUTURE_CLASSES: { name: string; venue: string; color: number }[] = [];

export const BATTERY_DRAIN = {
  idle: 0.02,      // %/s while a session is running
  full: 0.45,      // %/s at full throttle, full speed (5000mAh baseline)
  lowCutoff: 20,   // below this % power fades
  emptyPower: 0.15 // LVC limp-home power fraction
};

export const WEAR = {
  tiresPerMeter: 0.022,       // % per meter at compound wear 1
  tiresSlipPerMeter: 0.06,    // extra % per meter of sliding
  motorPerSecond: 0.012,      // % per second at full throttle
  landingThreshold: 3.8,      // m/s relative impact before shocks take damage
  landingScale: 6,            // % per m/s over threshold
  barrierThreshold: 3.2,
  barrierScale: 4.5,
  maxSingleHit: 18,           // never take more than this from one event
};

export const ECONOMY = {
  startCredits: 150,
  trialReward: 25,
  pbBonus: 15,
  resetPenalty: 3,            // seconds added in timed sessions
  chassisPerPoint: 0.2,
  shocksPerPoint: 0.15,
  motorPerPoint: 0.15,
  minRepair: 3,
  patchTo: 60,                // free kit-box patch target when you can't afford a repair
  crawlerPrice: 300,          // unlocks after the first finished 3-lap race
  monsterPrice: 450,
  driftPrice: 500,            // unlocks after the first monster truck run          // unlocks after the first finished crawler trail
  trailReward: 20,
  trailPbBonus: 10,
};

export const TRACK_ID = 'dirt-classic';
export const TRIAL_LAPS = 3;

// ====================================================================================== upgrades & setup
/** Effects an upgrade or setup choice has on handling (multipliers, 1 = no change). */
export interface UpgradeFx { power?: number; top?: number; grip?: number; steer?: number; slide?: number; absorb?: number; damping?: number; drain?: number; barrier?: number; trac?: number; wear?: number; compression?: number }
export type UpgradeSlot = 'motor' | 'esc' | 'shocks' | 'chassis' | 'diff' | 'servo';
export interface UpgradeDef { id: string; slot: UpgradeSlot; name: string; price: number; note: string; fx: UpgradeFx }

/** Hop-ups for the buggy-class cars. The first entry of each slot is the stock part (free). Bought parts stay
 *  in that car's parts box, so swapping back and forth is free. */
export const UPGRADES: Record<UpgradeSlot, UpgradeDef[]> = {
  motor: [
    { id: 'motor-stock', slot: 'motor', name: 'Stock 13.5T brushless', price: 0, note: 'Smooth and frugal.', fx: {} },
    { id: 'motor-sport', slot: 'motor', name: 'Sport 8.5T brushless', price: 140, note: 'Harder launch and more top end. Uses a bit more battery.', fx: { power: 1.12, top: 1.06, drain: 1.1 } },
    { id: 'motor-pro', slot: 'motor', name: 'Pro 5.5T brushless', price: 300, note: 'Brutal. Big power, easy to spin the tyres, thirsty.', fx: { power: 1.25, top: 1.12, drain: 1.22, slide: 1.1 } },
  ],
  esc: [
    { id: 'esc-stock', slot: 'esc', name: 'Stock 60A ESC', price: 0, note: 'Basic throttle curve.', fx: {} },
    { id: 'esc-pro', slot: 'esc', name: 'Pro 120A ESC', price: 120, note: 'Smoother throttle and punch control: less wheelspin, a little more efficient.', fx: { power: 1.03, drain: 0.92, slide: 0.9, trac: 1.04 } },
  ],
  shocks: [
    { id: 'shocks-stock', slot: 'shocks', name: 'Stock threaded shocks', price: 0, note: 'Fine for most tracks.', fx: {} },
    { id: 'shocks-bigbore', slot: 'shocks', name: 'Big-bore aluminium shocks', price: 160, note: 'Soak up hard landings and keep the tyres on the dirt.', fx: { absorb: 0.85, damping: 1.15, grip: 1.03 } },
  ],
  chassis: [
    { id: 'chassis-stock', slot: 'chassis', name: 'Stock chassis', price: 0, note: 'Standard plate, no anti-roll bars.', fx: {} },
    { id: 'chassis-sway', slot: 'chassis', name: 'Sway bar kit', price: 90, note: 'Less body roll: sharper turn-in and a calmer rear.', fx: { steer: 1.12, slide: 0.92 } },
    { id: 'chassis-alloy', slot: 'chassis', name: '7075 alloy chassis + sway bars', price: 220, note: 'Stiff alloy plate: barrier hits do far less damage. Includes sway bars.', fx: { steer: 1.12, slide: 0.92, barrier: 0.6 } },
  ],
  diff: [
    { id: 'diff-stock', slot: 'diff', name: 'Stock diff oils', price: 0, note: 'Free-spinning: easy to turn, spins the inside wheel.', fx: {} },
    { id: 'diff-tuned', slot: 'diff', name: 'Tuned diff oils', price: 80, note: 'Puts power down out of corners. Great on 2WD cars.', fx: { slide: 0.85, trac: 1.08 } },
  ],
  servo: [
    { id: 'servo-stock', slot: 'servo', name: 'Stock servo', price: 0, note: 'Adequate.', fx: {} },
    { id: 'servo-ht', slot: 'servo', name: 'High-torque metal-gear servo', price: 110, note: 'Faster, stronger steering.', fx: { steer: 1.25 } },
  ],
};
export const UPGRADE_SLOTS = Object.keys(UPGRADES) as UpgradeSlot[];
export const upgradeById = (id: string) => UPGRADE_SLOTS.flatMap((s) => UPGRADES[s]).find((u) => u.id === id);

/** Workbench setup sheet: free adjustments, each a small integer step. */
export interface SetupSheet { ride: number; camber: number; toeF: number; toeR: number; pinion: number }
export const SETUP_RANGES: Record<keyof SetupSheet, { min: number; max: number; label: string; units: (v: number) => string; help: string }> = {
  ride:   { min: -2, max: 2, label: 'Ride height', units: (v) => `${v > 0 ? '+' : ''}${v * 2} mm`, help: 'Low = more grip and sharper on smooth dirt, but bottoms out on jumps. High = soaks up rough ground, less grip.' },
  camber: { min: 0, max: 4, label: 'Camber', units: (v) => `−${(v * 0.75).toFixed(1)}°`, help: 'A little negative camber adds cornering grip (best around −1.5°). Too much wears tyres and loses grip.' },
  toeF:   { min: -2, max: 2, label: 'Front toe', units: (v) => (v === 0 ? '0°' : `${Math.abs(v)}° ${v < 0 ? 'out' : 'in'}`), help: 'Toe-out = quicker turn-in. Toe-in = calmer on the straights.' },
  toeR:   { min: 0, max: 4, label: 'Rear toe-in', units: (v) => `${v}°`, help: 'More rear toe-in keeps the tail planted under power, at a small cost to top speed.' },
  pinion: { min: -2, max: 2, label: 'Pinion', units: (v) => `${v > 0 ? '+' : ''}${v}T`, help: 'Bigger pinion = more top speed, softer launch and more battery. Smaller = punchy.' },
};
export const DEFAULT_SETUP: SetupSheet = { ride: 0, camber: 2, toeF: 0, toeR: 2, pinion: 0 };

/** Handling effects of a setup sheet (camber 2 = −1.5° and toe-in 2° rear are the neutral baseline). */
export function setupFx(s: SetupSheet): UpgradeFx {
  const camberGrip = 1 + 0.04 * (1 - Math.abs(s.camber - 2) / 2) - 0.02;      // peak +2 % at −1.5°, −2 % at 0° or −3°
  return {
    grip: camberGrip * (1 - 0.025 * s.ride),
    steer: (1 - 0.025 * s.ride) * (1 - 0.06 * s.toeF),
    slide: (1 - 0.07 * (s.toeR - 2)),
    top: (1 + 0.04 * s.pinion) * (1 - 0.008 * (s.toeR - 2)),
    power: 1 - 0.05 * s.pinion,
    drain: 1 + 0.04 * s.pinion,
    absorb: 1 - 0.06 * s.ride,
    compression: 1 + 0.12 * s.ride,
    wear: 1 + 0.12 * Math.max(0, s.camber - 2),
  };
}

/** Paint shop. */
export const PAINT_COLORS = [0x1667e6, 0xd2232a, 0xe8622a, 0xf2c230, 0x2fa84f, 0x7a4fb0, 0x1c1c1e, 0xf1f0ec, 0x2ab0c8, 0xe0457b];
export const ACCENT_COLORS = [0xf2c230, 0xf1f0ec, 0x1c1c1e, 0xd2232a, 0x2ab0c8, 0x7fe39a];
export const LIVERIES = ['Sweep', 'Split', 'Pinstripe'] as const;
export interface PaintJob { body: number; accent: number; livery: number }
