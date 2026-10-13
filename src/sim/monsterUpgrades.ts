// Hop-ups for the Cragweld Mudhammer monster truck. Same shape as the crawler's: the first entry of each
// slot is stock, a part is bought once and can be swapped in and out for free.
import { MONSTER_CG_DROP, MONSTER_SPEC } from './ArenaTerrain';
import { TruckSpec } from './CrawlerSim';

/** Wheelie-bar wheels, body frame (touch down at about 30° of wheelie). */
const BAR_Y = MONSTER_CG_DROP - 0.075;
export type MonsterSlot = 'power' | 'shocks' | 'tyres' | 'flywheel' | 'steering' | 'wheelieBar';
export interface MonsterUpgrade { id: string; slot: MonsterSlot; name: string; price: number; note: string; apply: (s: TruckSpec) => void }

export const MONSTER_SLOT_NAMES: Record<MonsterSlot, string> = {
  power: 'Motor + battery', shocks: 'Shocks', tyres: 'Tyres', flywheel: 'Air control', steering: 'Steering', wheelieBar: 'Wheelie bar',
};

export const MONSTER_UPGRADES: Record<MonsterSlot, MonsterUpgrade[]> = {
  power: [
    { id: 'mt-power-stock', slot: 'power', name: 'Stock 550 brushed + 3S', price: 0, note: 'Stock.', apply: () => {} },
    { id: 'mt-power-4s', slot: 'power', name: 'Brushless 2200 kV + 4S', price: 200, note: 'More punch off the line and a higher top speed; full trigger from slow pops the nose. Uses a bit more battery.', apply: (s) => { s.maxFwd = 12; s.maxForce = 15.5; s.drainMul = 1.15; s.torqueReact = 0.6; } },
    { id: 'mt-power-6s', slot: 'power', name: 'Brushless 1700 kV + 6S', price: 380, note: 'Brutal. Big air from short run-ups and huge wheelies — feather the trigger or it loops over backwards (fit a wheelie bar). Drinks the pack.', apply: (s) => { s.maxFwd = 13.5; s.maxForce = 17.5; s.drainMul = 1.4; s.torqueReact = 0.9; } },
  ],
  shocks: [
    { id: 'mt-shocks-stock', slot: 'shocks', name: 'Stock plastic shocks', price: 0, note: 'Stock.', apply: () => {} },
    { id: 'mt-shocks-bigbore', slot: 'shocks', name: 'Big-bore aluminium shocks', price: 160, note: 'Thicker oil and longer travel: soaks up big landings instead of bouncing, easier to land clean.', apply: (s) => { s.c *= 1.45; s.travel += 0.008; s.suspMax *= 1.15; s.bumpK *= 0.85; } },
  ],
  tyres: [
    { id: 'mt-tyres-stock', slot: 'tyres', name: 'Stock chevron tyres', price: 0, note: 'Stock. 164 mm tall, hard compound.', apply: () => {} },
    { id: 'mt-tyres-soft', slot: 'tyres', name: 'Soft-compound chevrons', price: 140, note: 'Same size, much more bite on the dirt: tighter corners, faster laps, harder to slide.', apply: (s) => { s.mu = 0.96; s.lateralGain *= 1.1; } },
    { id: 'mt-tyres-mega', slot: 'tyres', name: 'Mega 180 mm tyres', price: 260, note: 'Taller and heavier: rolls over cars and lips without a hitch and floats the bumps. A bit tippier.', apply: (s) => { s.wheelR = 0.09; s.mu = 0.88; s.mass += 0.2; s.mountY += 0.004; s.hull = s.hull.map(([x, y, z]) => [x, y + 0.004, z] as [number, number, number]); } },
  ],
  flywheel: [
    { id: 'mt-fly-stock', slot: 'flywheel', name: 'No air control', price: 0, note: 'Stock: blip the throttle to lift the nose, brake to drop it.', apply: () => {} },
    { id: 'mt-fly-gyro', slot: 'flywheel', name: 'Air-control flywheel', price: 220, note: 'A spinning flywheel in the chassis: much stronger nose up/down in the air, and steering rolls the truck: barrel rolls off the bus jump and the kicker.', apply: (s) => { s.airBoost = 0.8; s.airRoll = 0.9; } },
  ],
  steering: [
    { id: 'mt-steer-stock', slot: 'steering', name: 'Single servo', price: 0, note: 'Stock.', apply: () => {} },
    { id: 'mt-steer-dual', slot: 'steering', name: 'Dual servos + more rear steer', price: 110, note: 'Quicker, stronger steering and more crab from the rear axle: tighter donuts and gate turns.', apply: (s) => { s.servoRate *= 1.5; s.maxSteer += 0.06; s.rearSteer = 0.85; } },
  ],
  wheelieBar: [
    { id: 'mt-bar-none', slot: 'wheelieBar', name: 'No wheelie bar', price: 0, note: 'Stock.', apply: () => {} },
    { id: 'mt-bar', slot: 'wheelieBar', name: 'Wheelie bar', price: 90, note: 'Two little wheels out the back: ride long wheelies on the bar instead of looping it over backwards.', apply: (s) => { s.rollers = [[-0.43, BAR_Y, -0.05], [-0.43, BAR_Y, 0.05]]; } },
  ],
};
export const MONSTER_SLOTS = Object.keys(MONSTER_UPGRADES) as MonsterSlot[];
export const monsterUpgradeById = (id: string) => MONSTER_SLOTS.flatMap((s) => MONSTER_UPGRADES[s]).find((u) => u.id === id);

/** The monster truck spec with the fitted hop-ups applied. */
export function monsterSpecFor(fitted?: Partial<Record<MonsterSlot, string>>): TruckSpec {
  if (!fitted || !Object.keys(fitted).length) return MONSTER_SPEC;
  const s: TruckSpec = { ...MONSTER_SPEC, inertia: [...MONSTER_SPEC.inertia] as [number, number, number], hull: MONSTER_SPEC.hull.map((p) => [...p] as [number, number, number]), tyreAngles: [...MONSTER_SPEC.tyreAngles], rollers: [] };
  for (const slot of MONSTER_SLOTS) monsterUpgradeById(fitted[slot] ?? '')?.apply(s);
  const m = s.mass / MONSTER_SPEC.mass; s.inertia = s.inertia.map((v) => v * m) as [number, number, number];
  return s;
}
