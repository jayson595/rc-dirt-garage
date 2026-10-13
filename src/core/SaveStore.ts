// Local persistence with schema versioning and safe recovery from bad data.
import { BUGGY_ORDER, LIVERIES, SCHEMA_VERSION, SETUP_RANGES, SetupSheet, TIRE_COMPOUNDS, SHOCK_SETTINGS, UPGRADE_SLOTS, UPGRADES, upgradeById } from '../data/specs';
import { SaveData, activeVehicle, defaultSave, defaultVehicle, trackUnlocked } from './state';
import { CRAWLER_SLOTS, crawlerUpgradeById } from '../sim/CrawlerSim';
import { MONSTER_SLOTS, monsterUpgradeById } from '../sim/monsterUpgrades';
import { DRIFT_SLOTS, driftUpgradeById } from '../sim/driftUpgrades';

const KEY = 'rcsim.save';
const CORRUPT_KEY = 'rcsim.save.corrupt';

let memoryFallback: string | null = null;

function storageGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return key === KEY ? memoryFallback : null; }
}
function storageSet(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { if (key === KEY) memoryFallback = value; }
}
function storageRemove(key: string) {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
  if (key === KEY) memoryFallback = null;
}

const num = (v: unknown, def: number, min = -Infinity, max = Infinity) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def;
const bool = (v: unknown, def: boolean) => (typeof v === 'boolean' ? v : def);
const numOrNull = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);

/** Merge an untrusted object onto defaults, keeping only well-typed values. */
export function sanitize(raw: unknown): SaveData {
  const d = defaultSave();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Record<string, any>;
  if (r.schema !== SCHEMA_VERSION) {
    // Future migrations go here. Unknown versions fall through to best-effort merge.
  }
  d.credits = Math.round(num(r.credits, d.credits, 0, 1e7));
  for (const id of BUGGY_ORDER) {
    const rv = r.vehicles?.[id];
    if (!rv || typeof rv !== 'object') continue;
    const v = d.vehicles[id] ?? (d.vehicles[id] = defaultVehicle(id));
    v.shellOn = bool(rv.shellOn, true);
    for (const k of Object.keys(v.condition) as (keyof typeof v.condition)[]) {
      v.condition[k] = num(rv.condition?.[k], 100, 0, 100);
    }
    if (rv.tireCompound in TIRE_COMPOUNDS) v.tireCompound = rv.tireCompound;
    if (rv.shockSetting in SHOCK_SETTINGS) v.shockSetting = rv.shockSetting;
    v.batteryId = typeof rv.batteryId === 'string' || rv.batteryId === null ? rv.batteryId : v.batteryId;
    v.odometer = num(rv.odometer, 0, 0);
    if (Array.isArray(rv.owned)) for (const u of rv.owned) if (typeof u === 'string' && upgradeById(u) && !v.owned.includes(u)) v.owned.push(u);
    for (const slot of UPGRADE_SLOTS) { const f = rv.fitted?.[slot]; if (typeof f === 'string' && UPGRADES[slot].some((u) => u.id === f) && v.owned.includes(f)) v.fitted[slot] = f; }
    for (const k of Object.keys(SETUP_RANGES) as (keyof SetupSheet)[]) { const r = SETUP_RANGES[k]; v.setup[k] = Math.round(num(rv.setup?.[k], v.setup[k], r.min, r.max)); }
    if (rv.paint && typeof rv.paint === 'object') {
      v.paint.body = Math.round(num(rv.paint.body, v.paint.body, 0, 0xffffff));
      v.paint.accent = Math.round(num(rv.paint.accent, v.paint.accent, 0, 0xffffff));
      v.paint.livery = Math.round(num(rv.paint.livery, 0, 0, LIVERIES.length - 1));
    }
    if (Array.isArray(rv.damageLog)) {
      v.damageLog = rv.damageLog
        .filter((e: any) => e && typeof e.cause === 'string' && typeof e.part === 'string' && e.part in v.condition)
        .slice(0, 12)
        .map((e: any) => ({ part: e.part, amount: num(e.amount, 0, 0, 100), cause: e.cause.slice(0, 80), at: num(e.at, 0) }));
    }
  }
  d.activeBuggy = BUGGY_ORDER.find((k) => k === r.activeBuggy && d.vehicles[k]) ?? 'buggy';
  d.selectedVehicle = r.selectedVehicle && (r.selectedVehicle === 'buggy' || r.selectedVehicle === d.activeBuggy) ? d.activeBuggy : null;

  if (Array.isArray(r.batteries)) {
    for (const b of d.batteries) {
      const rb = r.batteries.find((x: any) => x && x.id === b.id);
      if (rb) b.charge = num(rb.charge, 100, 0, 100);
    }
  }
  // An installed battery id must exist, and a pack can only be in one car (the active one wins).
  const act = activeVehicle(d);
  if (act.batteryId !== null && !d.batteries.some((b) => b.id === act.batteryId)) act.batteryId = d.batteries[0].id;
  for (const id of BUGGY_ORDER) { const v = d.vehicles[id]; if (v && v !== act && v.batteryId !== null && (v.batteryId === act.batteryId || !d.batteries.some((b) => b.id === v.batteryId))) v.batteryId = null; }

  d.best.trial = numOrNull(r.best?.trial);
  for (const k of ['clay', 'dunes'] as const) { d.trackBests[k].trial = numOrNull(r.trackBests?.[k]?.trial); d.trackBests[k].lap = numOrNull(r.trackBests?.[k]?.lap); }
  d.raceTrack = (['course', 'clay', 'dunes'] as const).find((k) => k === r.raceTrack) ?? 'course';
  if (!trackUnlocked(d, d.raceTrack)) d.raceTrack = 'course';
  d.best.lap = numOrNull(r.best?.lap);
  if (Array.isArray(r.results)) {
    d.results = r.results
      .filter((x: any) => x && (x.mode === 'practice' || x.mode === 'trial'))
      .slice(0, 8)
      .map((x: any) => ({
        mode: x.mode, total: numOrNull(x.total),
        laps: Array.isArray(x.laps) ? x.laps.filter((n: any) => typeof n === 'number').slice(0, 10) : [],
        penalties: num(x.penalties, 0, 0), credits: num(x.credits, 0, 0), pb: bool(x.pb, false), at: num(x.at, 0),
      }));
  }
  d.settings.reducedGfx = bool(r.settings?.reducedGfx, false);
  d.settings.showMap = bool(r.settings?.showMap, true);
  d.settings.steerSensitivity = num(r.settings?.steerSensitivity, 1, 0.5, 1.8);
  d.settings.steerMode = r.settings?.steerMode === 'horizontal' ? 'horizontal' : 'circular';
  d.settings.controllerScale = num(r.settings?.controllerScale, 1, 0.88, 1.12);
  d.settings.reducedMotion = bool(r.settings?.reducedMotion, false);
  d.tutorial.practiceDone = bool(r.tutorial?.practiceDone, false);
  d.tutorial.controlsDemoSeen = bool(r.tutorial?.controlsDemoSeen, false);
  d.tutorial.garageLookHint = bool(r.tutorial?.garageLookHint, false);
  // garage placement (added later): older saves that had picked the buggy keep it on the bench
  const vp = r.garage?.vehiclePlace;
  d.garage.vehiclePlace = vp === 'bench' || vp === 'shelf' ? vp : d.selectedVehicle ? 'bench' : 'shelf';
  if (d.garage.vehiclePlace === 'bench') d.selectedVehicle = d.activeBuggy;
  d.garage.batteryPlace = {};
  for (const b of d.batteries) {
    if (BUGGY_ORDER.some((id) => d.vehicles[id]?.batteryId === b.id)) continue;
    const p = r.garage?.batteryPlace?.[b.id];
    d.garage.batteryPlace[b.id] = p === 'bench' ? 'bench' : 'charger';
  }
  for (const k of Object.keys(d.spares.tires) as (keyof typeof d.spares.tires)[]) {
    d.spares.tires[k] = Math.round(num(r.spares?.tires?.[k], 0, 0, 20));
  }
  // crawler (added later): any finished trial in an older save counts as the unlocking race
  const rc = r.crawler ?? {};
  d.crawler.unlocked = bool(rc.unlocked, false) || d.best.trial != null || d.results.some((x) => x.mode === 'trial');
  d.crawler.owned = bool(rc.owned, false) && d.crawler.unlocked;
  d.crawler.charge = num(rc.charge, 100, 0, 100);
  d.crawler.best = numOrNull(rc.best);
  d.crawler.runs = Math.round(num(rc.runs, 0, 0));
  d.crawler.style = rc.style === 'utb' ? 'utb' : 'wagon';
  d.crawler.parts = Array.isArray(rc.parts) ? [...new Set((rc.parts as unknown[]).filter((x): x is string => typeof x === 'string' && !!crawlerUpgradeById(x)))] : [];
  d.crawler.fitted = {};
  if (rc.fitted && typeof rc.fitted === 'object') for (const slot of CRAWLER_SLOTS) {
    const id = (rc.fitted as Record<string, unknown>)[slot], u = typeof id === 'string' ? crawlerUpgradeById(id) : undefined;
    if (u && u.slot === slot && (u.price === 0 || d.crawler.parts.includes(u.id))) d.crawler.fitted[slot] = u.id;
  }
  d.crawler.bigLog = bool(rc.bigLog, false);
  d.crawler.pileBest = numOrNull(rc.pileBest); d.crawler.pileRuns = Math.round(num(rc.pileRuns, 0, 0));
  d.crawler.compBest = numOrNull(rc.compBest); d.crawler.compRuns = Math.round(num(rc.compRuns, 0, 0));
  // monster truck (added later): a finished crawler trail in an older save counts as the unlock
  const rm = r.monster ?? {};
  d.monster.unlocked = bool(rm.unlocked, false) || d.crawler.best != null;
  d.monster.owned = bool(rm.owned, false) && d.monster.unlocked;
  d.monster.charge = num(rm.charge, 100, 0, 100);
  d.monster.bestScore = Math.round(num(rm.bestScore, 0, 0));
  d.monster.bestRace = numOrNull(rm.bestRace);
  d.monster.runs = Math.round(num(rm.runs, 0, 0));
  d.monster.venue = rm.venue === 'fair' && d.monster.runs > 0 ? 'fair' : 'bowl';
  d.monster.fair.bestScore = Math.round(num(rm.fair?.bestScore, 0, 0)); d.monster.fair.bestRace = numOrNull(rm.fair?.bestRace);
  d.monster.parts = Array.isArray(rm.parts) ? [...new Set((rm.parts as unknown[]).filter((x): x is string => typeof x === 'string' && !!monsterUpgradeById(x)))] : [];
  d.monster.fitted = {};
  if (rm.fitted && typeof rm.fitted === 'object') for (const slot of MONSTER_SLOTS) {
    const id = (rm.fitted as Record<string, unknown>)[slot], u = typeof id === 'string' ? monsterUpgradeById(id) : undefined;
    if (u && u.slot === slot && u.price > 0 && d.monster.parts.includes(u.id)) d.monster.fitted[slot] = u.id;
  }
  // drift car (added later): an older save with a monster truck run counts as the unlock
  const rd = r.drift ?? {};
  d.drift.unlocked = bool(rd.unlocked, false) || d.monster.runs > 0;
  d.drift.owned = bool(rd.owned, false) && d.drift.unlocked;
  d.drift.charge = num(rd.charge, 100, 0, 100);
  d.drift.gyro = num(rd.gyro, 0.8, 0, 1);
  d.drift.bestDrift = num(rd.bestDrift, 0, 0);
  d.drift.bestAngle = Math.round(num(rd.bestAngle, 0, 0, 180));
  d.drift.bestLap = numOrNull(rd.bestLap);
  d.drift.sessions = Math.round(num(rd.sessions, 0, 0));
  d.drift.venue = rd.venue === 'lot' && d.drift.sessions > 0 ? 'lot' : 'hall';
  d.drift.parts = Array.isArray(rd.parts) ? [...new Set((rd.parts as unknown[]).filter((x): x is string => typeof x === 'string' && !!driftUpgradeById(x)))] : [];
  d.drift.fitted = {};
  if (rd.fitted && typeof rd.fitted === 'object') for (const slot of DRIFT_SLOTS) {
    const id = (rd.fitted as Record<string, unknown>)[slot], u = typeof id === 'string' ? driftUpgradeById(id) : undefined;
    if (u && u.slot === slot && u.price > 0 && d.drift.parts.includes(u.id)) d.drift.fitted[slot] = u.id;
  }
  const rj = r.jobs ?? {};
  d.jobs.mowBest = numOrNull(rj.mowBest);
  d.jobs.mowRuns = Math.round(num(rj.mowRuns, 0, 0));
  d.jobs.sortBest = Math.round(num(rj.sortBest, 0, 0));
  d.jobs.sortRuns = Math.round(num(rj.sortRuns, 0, 0));
  if (r.events && typeof r.events === 'object') for (const [k, e] of Object.entries(r.events as Record<string, any>)) {
    if (!/^[a-z0-9-]{1,40}$/.test(k) || !e || typeof e !== 'object') continue;
    const best = numOrNull(e.best);
    d.events[k] = { best: best == null ? null : Math.max(1, Math.round(best)), wins: Math.round(num(e.wins, 0, 0)), runs: Math.round(num(e.runs, 0, 0)), earned: Math.round(num(e.earned, 0, 0)) };
  }
  d.sandbox.free = bool(r.sandbox?.free, false);
  d.sandbox.preview = ([...BUGGY_ORDER, 'wagon', 'utb', 'mower', 'monster', 'drift'] as const).find((k) => k === r.sandbox?.preview) ?? 'wagon';
  return d;
}

export class SaveStore {
  data: SaveData;
  /** Set when an unreadable save was replaced, so the UI can tell the player. */
  recoveredFromCorrupt = false;

  constructor() {
    const raw = storageGet(KEY);
    if (raw == null) {
      this.data = defaultSave();
      return;
    }
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') throw new Error('not an object');
      this.data = sanitize(parsed);
    } catch {
      storageSet(CORRUPT_KEY, raw);
      this.data = defaultSave();
      this.recoveredFromCorrupt = true;
      this.save();
    }
  }

  save() {
    this.data.schema = SCHEMA_VERSION;
    storageSet(KEY, JSON.stringify(this.data));
  }

  reset() {
    storageRemove(KEY);
    this.data = defaultSave();
    this.save();
  }
}
