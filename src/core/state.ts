// VehicleInventory: the single source of truth for garage + pit + track.
import { BUGGY_CLASSES, BuggyId, DEFAULT_SETUP, ECONOMY, PaintJob, SCHEMA_VERSION, SetupSheet, ShockSetting, TireCompound, UPGRADE_SLOTS, UPGRADES, UpgradeSlot, WearPart } from '../data/specs';

export type VehiclePlace = 'shelf' | 'bench';
export type PackPlace = 'charger' | 'bench';

export interface BatteryState {
  id: string;
  name: string;
  capacity: number; // mAh
  charge: number;   // 0–100
}

export interface DamageEvent {
  part: WearPart;
  amount: number;
  cause: string;
  at: number; // epoch ms
}

export interface VehicleState {
  id: BuggyId;
  shellOn: boolean;
  condition: Record<WearPart, number>;
  tireCompound: TireCompound;
  shockSetting: ShockSetting;
  batteryId: string | null;
  odometer: number; // meters
  /** Fitted hop-up per slot (upgrade id) and every part bought for this car. */
  fitted: Record<UpgradeSlot, string>;
  owned: string[];
  setup: SetupSheet;
  paint: PaintJob;
  damageLog: DamageEvent[];
}

export interface SessionResult {
  mode: 'practice' | 'trial';
  total: number | null; // seconds incl. penalties
  laps: number[];
  penalties: number;
  credits: number;
  pb: boolean;
  at: number;
}

export interface SaveData {
  schema: number;
  credits: number;
  /** The active buggy has been picked (and is on the bench when vehiclePlace is 'bench'). */
  selectedVehicle: BuggyId | null;
  /** Owned buggy-class vehicles (the Dirt Dart is always owned). */
  vehicles: Partial<Record<BuggyId, VehicleState>> & { buggy: VehicleState };
  /** Which buggy the workbench, battery, pit and track use. */
  activeBuggy: BuggyId;
  batteries: BatteryState[];
  best: { trial: number | null; lap: number | null };
  /** Buggy race track picked in the pit (Dirt Classic is 'course'), and bests on the newer tracks */
  raceTrack: 'course' | 'clay' | 'dunes';
  trackBests: { clay: { trial: number | null; lap: number | null }; dunes: { trial: number | null; lap: number | null } };
  results: SessionResult[];
  settings: {
    reducedGfx: boolean; showMap: boolean;
    steerSensitivity: number; steerMode: 'circular' | 'horizontal'; controllerScale: number; reducedMotion: boolean;
  };
  tutorial: { practiceDone: boolean; controlsDemoSeen: boolean; garageLookHint: boolean };
  /** Where things physically sit in the garage. Installed packs live in the car and have no entry. */
  garage: { vehiclePlace: VehiclePlace; batteryPlace: Record<string, PackPlace> };
  /** Owned, uninstalled spare parts. */
  spares: { tires: Record<TireCompound, number> };
  /** Cragweld CW-C1 Stoneamble rock crawler: unlocked by finishing a 3-lap race, then bought with credits. */
  crawler: { unlocked: boolean; owned: boolean; charge: number; best: number | null; runs: number; style: 'wagon' | 'utb';
    /** hop-ups fitted per slot (upgrade id) and every hop-up bought */
    fitted: Partial<Record<string, string>>; parts: string[]; bigLog: boolean;
    /** Rock pile best summit time, comp course best (lowest) points */
    pileBest: number | null; pileRuns: number; compBest: number | null; compRuns: number };
  /** Cragweld Mudhammer monster truck: unlocked by finishing the crawler trail, then bought. */
  monster: { unlocked: boolean; owned: boolean; charge: number; bestScore: number; bestRace: number | null; runs: number;
    /** arena picked (Grindstone Bowl or the County Fair) and the fair's own bests */
    venue: 'bowl' | 'fair'; fair: { bestScore: number; bestRace: number | null };
    /** hop-ups fitted per slot (upgrade id) and every hop-up bought */
    fitted: Partial<Record<string, string>>; parts: string[] };
  /** Slideway RD-1 drift car: unlocked after the first monster truck run, then bought. Practice only for now. */
  drift: { unlocked: boolean; owned: boolean; charge: number; gyro: number; bestDrift: number; bestAngle: number; bestLap: number | null; sessions: number;
    /** hop-ups fitted per slot (upgrade id) and every hop-up bought */
    fitted: Partial<Record<string, string>>; parts: string[] 
    /** venue: Kanjo Hall or the Bayside car park */
    venue: 'hall' | 'lot'; };
  /** Odd jobs (money mini-games). */
  jobs: { mowBest: number | null; mowRuns: number; sortBest: number; sortRuns: number };
  /** Events board results, by event id. */
  events: Record<string, { best: number | null; wins: number; runs: number; earned: number }>;
  /** Sandbox table: free play switch (parts, services and vehicles cost nothing). */
  sandbox: { free: boolean; preview: BuggyId | 'wagon' | 'utb' | 'mower' | 'monster' | 'drift' };
}

export function defaultVehicle(id: BuggyId = 'buggy'): VehicleState {
  return {
    id,
    shellOn: true,
    condition: { chassis: 100, motor: 100, shocks: 100, tires: 100, servo: 100, esc: 100, diff: 100, gears: 100 },
    tireCompound: 'pin',
    shockSetting: 'medium',
    batteryId: id === 'buggy' ? 'bat-a' : null,
    fitted: Object.fromEntries(UPGRADE_SLOTS.map((s) => [s, UPGRADES[s][0].id])) as Record<UpgradeSlot, string>,
    owned: UPGRADE_SLOTS.map((s) => UPGRADES[s][0].id),
    setup: { ...DEFAULT_SETUP },
    paint: { body: BUGGY_CLASSES[id].color, accent: BUGGY_CLASSES[id].accent, livery: 0 },
    odometer: 0,
    damageLog: [],
  };
}

export function defaultSave(): SaveData {
  return {
    schema: SCHEMA_VERSION,
    credits: ECONOMY.startCredits,
    selectedVehicle: null,
    vehicles: { buggy: defaultVehicle() },
    activeBuggy: 'buggy',
    batteries: [
      { id: 'bat-a', name: '2S 5000 LiPo (A)', capacity: 5000, charge: 100 },
      { id: 'bat-b', name: '2S 5000 LiPo (B)', capacity: 5000, charge: 100 },
    ],
    best: { trial: null, lap: null },
    raceTrack: 'course',
    trackBests: { clay: { trial: null, lap: null }, dunes: { trial: null, lap: null } },
    results: [],
    settings: { reducedGfx: false, showMap: true, steerSensitivity: 1, steerMode: 'circular', controllerScale: 1, reducedMotion: false },
    tutorial: { practiceDone: false, controlsDemoSeen: false, garageLookHint: false },
    garage: { vehiclePlace: 'shelf', batteryPlace: { 'bat-b': 'charger' } },
    spares: { tires: { pin: 0, soft: 0, block: 0 } },
    crawler: { unlocked: false, owned: false, charge: 100, best: null, runs: 0, style: 'wagon', fitted: {}, parts: [], bigLog: false, pileBest: null, pileRuns: 0, compBest: null, compRuns: 0 },
    monster: { unlocked: false, owned: false, charge: 100, bestScore: 0, bestRace: null, runs: 0, venue: 'bowl', fair: { bestScore: 0, bestRace: null }, fitted: {}, parts: [] },
    drift: { unlocked: false, owned: false, charge: 100, gyro: 0.8, bestDrift: 0, bestAngle: 0, bestLap: null, sessions: 0, fitted: {}, parts: [], venue: 'hall' },
    jobs: { mowBest: null, mowRuns: 0, sortBest: 0, sortRuns: 0 },
    events: {},
    sandbox: { free: false, preview: 'wagon' },
  };
}

/** The buggy the garage, pit and track are working with. */
/** Monster bests for the arena currently picked. */
export function monsterBest(s: SaveData) { return s.monster.venue === 'fair' ? s.monster.fair : s.monster; }

/** Best trial/lap record for the race track currently picked. */
export function trackBest(s: SaveData) { return s.raceTrack === 'course' ? s.best : s.trackBests[s.raceTrack]; }
/** Which race tracks are open: Hilltop Clay after a Dirt Classic trial, Dune Run after a Hilltop Clay trial. */
export function trackUnlocked(s: SaveData, id: SaveData['raceTrack']) { return id === 'course' || (id === 'clay' ? s.best.trial != null : s.trackBests.clay.trial != null); }

export function activeVehicle(s: SaveData): VehicleState {
  return s.vehicles[s.activeBuggy] ?? s.vehicles.buggy;
}

export function installedBattery(s: SaveData): BatteryState | null {
  const id = activeVehicle(s).batteryId;
  return s.batteries.find((b) => b.id === id) ?? null;
}

export function logDamage(v: VehicleState, part: WearPart, amount: number, cause: string) {
  v.condition[part] = Math.max(0, v.condition[part] - amount);
  if (amount >= 0.5) {
    v.damageLog.unshift({ part, amount: Math.round(amount * 10) / 10, cause, at: Date.now() });
    v.damageLog.length = Math.min(v.damageLog.length, 12);
  }
}
