// Hop-ups for the Slideway RD-1 drift car. Same shape as the crawler's and the monster truck's: the first
// entry of each slot is stock; a part is bought once and swapped in and out for free after that.
import { DRIFT_COLORS } from '../assets/driftModel';
import { DRIFT_SPEC, DriftSpec } from './DriftSim';

export type DriftSlot = 'motor' | 'tyres' | 'gyro' | 'angle' | 'servo' | 'layout' | 'livery';
export interface DriftUpgrade { id: string; slot: DriftSlot; name: string; price: number; note: string; apply: (s: DriftSpec) => void; colors?: typeof DRIFT_COLORS }

export const DRIFT_SLOT_NAMES: Record<DriftSlot, string> = {
  motor: 'Motor', tyres: 'Tyres', gyro: 'Gyro', angle: 'Steering angle', servo: 'Servo', layout: 'Chassis layout', livery: 'Livery',
};

export const DRIFT_UPGRADES: Record<DriftSlot, DriftUpgrade[]> = {
  motor: [
    { id: 'dr-motor-stock', slot: 'motor', name: 'Stock 21.5T brushed', price: 0, note: 'Stock.', apply: () => {} },
    { id: 'dr-motor-105', slot: 'motor', name: '10.5T sensored brushless', price: 180, note: 'Smooth, strong pull: kicks the tail out on demand and carries more speed between corners.', apply: (s) => { s.torque = 0.38; s.vTop = 10.2; } },
  ],
  tyres: [
    { id: 'dr-tyres-stock', slot: 'tyres', name: 'Stock hard plastic', price: 0, note: 'Stock. Medium grip on the polished floor.', apply: () => {} },
    { id: 'dr-tyres-lf', slot: 'tyres', name: 'LF-4 compound', price: 120, note: 'More bite front and rear: faster, steadier drifts and quicker laps, but it takes more throttle to break loose.', apply: (s) => { s.muF = 0.64; s.muR = 0.73; s.slide = 0.88; } },
  ],
  gyro: [
    { id: 'dr-gyro-stock', slot: 'gyro', name: 'Stock gyro', price: 0, note: 'Stock.', apply: () => {} },
    { id: 'dr-gyro-pro', slot: 'gyro', name: 'Competition gyro', price: 140, note: 'Catches a slide faster and leaves you more steering to place the car: more angle, fewer spins.', apply: (s) => { s.gyroK = 0.33; s.authority = 0.42; } },
  ],
  angle: [
    { id: 'dr-angle-stock', slot: 'angle', name: 'Stock knuckles (55°)', price: 0, note: 'Stock.', apply: () => {} },
    { id: 'dr-angle-kit', slot: 'angle', name: 'High-angle knuckles (65°)', price: 160, note: 'More counter-steer before you run out of lock: hold much bigger angles without spinning.', apply: (s) => { s.maxSteer = 1.13; } },
  ],
  servo: [
    { id: 'dr-servo-stock', slot: 'servo', name: 'Stock servo', price: 0, note: 'Stock.', apply: () => {} },
    { id: 'dr-servo-fast', slot: 'servo', name: 'Low-profile fast servo', price: 90, note: 'The gyro and your thumbs get the wheels there sooner: snappier transitions.', apply: (s) => { s.servoRate = 16; } },
  ],
  layout: [
    { id: 'dr-layout-stock', slot: 'layout', name: 'Mid-motor (stock)', price: 0, note: 'Stock.', apply: () => {} },
    { id: 'dr-layout-rmr', slot: 'layout', name: 'Rear-motor conversion', price: 220, note: 'Weight over the rear tyres: more drive while sideways, longer smoother drifts, a little lazier to turn in.', apply: (s) => { s.a = 0.131; s.b = 0.127; s.slide += 0.03; } },
  ],
  livery: [
    { id: 'dr-liv-stock', slot: 'livery', name: 'Kanjo white', price: 0, note: 'Stock: white and charcoal, red stripe.', apply: () => {} },
    { id: 'dr-liv-purple', slot: 'livery', name: 'Midnight purple', price: 40, note: 'Deep purple, gold stripe, teal pinline.', apply: () => {}, colors: { body: 0x3b1f63, lower: 0x141416, stripe: 0xf2c230, stripe2: 0x2fd0c8 } },
    { id: 'dr-liv-yellow', slot: 'livery', name: 'Rally yellow', price: 40, note: 'Yellow over black, black stripe, red pinline.', apply: () => {}, colors: { body: 0xf2c230, lower: 0x1b1b1d, stripe: 0x1b1b1d, stripe2: 0xd2232a } },
    { id: 'dr-liv-gun', slot: 'livery', name: 'Gunmetal', price: 40, note: 'Gunmetal grey, orange stripe, cream pinline.', apply: () => {}, colors: { body: 0x4a4f57, lower: 0x1b1b1d, stripe: 0xf07a1a, stripe2: 0xe8e2d4 } },
  ],
};
export const DRIFT_SLOTS = Object.keys(DRIFT_UPGRADES) as DriftSlot[];
export const driftUpgradeById = (id: string) => DRIFT_SLOTS.flatMap((s) => DRIFT_UPGRADES[s]).find((u) => u.id === id);

export function driftSpecFor(fitted?: Partial<Record<DriftSlot, string>>): DriftSpec {
  const s: DriftSpec = { ...DRIFT_SPEC };
  for (const slot of DRIFT_SLOTS) driftUpgradeById(fitted?.[slot] ?? '')?.apply(s);
  return s;
}
export function driftColorsFor(fitted?: Partial<Record<DriftSlot, string>>) {
  return driftUpgradeById(fitted?.livery ?? '')?.colors ?? DRIFT_COLORS;
}
