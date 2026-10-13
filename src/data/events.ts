// The events board: free-entry events at the venues, paying prize money for the top three.
// Buggy and monster events are wheel-to-wheel races against AI rivals on the track; crawler and drift
// events are judged runs scored against the rivals' posted results.
import type { SaveData } from '../core/state';

export type EventVehicle = 'buggy' | 'monster' | 'crawler' | 'drift';
export type EventFormat = 'race' | 'score' | 'time' | 'points';

export interface RivalDef { name: string; color: number; accent: number; livery: number }

export interface EventDef {
  id: string;
  name: string;
  vehicle: EventVehicle;
  /** Venue key: buggy track id, monster arena, crawler venue, drift venue. */
  venue: string;
  venueName: string;
  format: EventFormat;
  blurb: string;
  laps?: number;
  /** 0 (club) … 1 (pro). Sets AI pace or the rivals' posted results. */
  skill: number;
  prizes: [number, number, number];
  /** Rivals' posted results for judged events: higher is better for 'score', lower for 'time'/'points'. */
  rivalMarks?: [number, number, number];
  unlock: (d: SaveData) => boolean;
  lockHint: string;
}

export const RIVALS: RivalDef[] = [
  { name: 'Kyle Marsh', color: 0xd2232a, accent: 0xf1f0ec, livery: 0 },
  { name: 'Tomo Sato', color: 0x2fa84f, accent: 0x1c1c1e, livery: 1 },
  { name: 'Priya Dhillon', color: 0x7a4fb0, accent: 0xf2c230, livery: 2 },
  { name: 'Bram Okafor', color: 0xf2c230, accent: 0x1c1c1e, livery: 1 },
  { name: 'Lena Voss', color: 0x2ab0c8, accent: 0xf1f0ec, livery: 0 },
  { name: 'Mick Tully', color: 0xe8622a, accent: 0x1c1c1e, livery: 2 },
];

const wins = (d: SaveData) => Object.values(d.events).filter((e) => e.wins > 0).length;

export const EVENTS: EventDef[] = [
  {
    id: 'club-classic', name: 'Dirt Classic Club Race', vehicle: 'buggy', venue: 'course', venueName: 'Dirt Classic', format: 'race', laps: 3,
    blurb: 'Saturday club night: three locals, three laps. A friendly first race.',
    skill: 0.1, prizes: [120, 70, 40], unlock: () => true, lockHint: '',
  },
  {
    id: 'clay-night', name: 'Hilltop Clay Night Series', vehicle: 'buggy', venue: 'clay', venueName: 'Hilltop Clay', format: 'race', laps: 3,
    blurb: 'Under the lights on grippy clay. The regulars here know every rut.',
    skill: 0.45, prizes: [200, 120, 70], unlock: (d) => d.best.trial != null, lockHint: 'Open Hilltop Clay first (a 3-lap trial on the Dirt Classic)',
  },
  {
    id: 'dune-cup', name: 'Dune Run Desert Cup', vehicle: 'buggy', venue: 'dunes', venueName: 'Dune Run', format: 'race', laps: 4,
    blurb: 'Four fast laps of loose sand against the quickest drivers in the county.',
    skill: 0.75, prizes: [320, 180, 100], unlock: (d) => d.trackBests.clay.trial != null, lockHint: 'Open Dune Run first (a 3-lap trial on Hilltop Clay)',
  },
  {
    id: 'grindstone-race', name: 'Grindstone Monster Race', vehicle: 'monster', venue: 'bowl', venueName: 'Grindstone Bowl', format: 'race', laps: 3,
    blurb: 'Big tyres, tight lanes, plenty of contact. Three laps of the bowl.',
    skill: 0.35, prizes: [160, 100, 60], unlock: (d) => d.monster.owned, lockHint: 'Buy the Mudhammer monster truck',
  },
  {
    id: 'fair-freestyle', name: 'County Fair Freestyle', vehicle: 'monster', venue: 'fair', venueName: 'Hayfield County Fair', format: 'score',
    blurb: 'Ninety seconds to wow the grandstand. Beat the posted freestyle scores.',
    skill: 0.5, prizes: [180, 110, 60], rivalMarks: [1400, 1000, 650], unlock: (d) => d.monster.owned && d.monster.runs > 0, lockHint: 'Do a monster truck run to open the County Fair',
  },
  {
    id: 'gulch-open', name: 'Granite Gulch Open', vehicle: 'crawler', venue: 'comp', venueName: 'Granite Gulch comp course', format: 'points',
    blurb: 'A proper comp: clean gates, no reversing, no touching. Lowest points wins.',
    skill: 0.5, prizes: [150, 90, 50], rivalMarks: [10, 22, 38], unlock: (d) => d.crawler.owned, lockHint: 'Buy the Cragweld rock crawler',
  },
  {
    id: 'pile-king', name: 'Rock Pile King of the Hill', vehicle: 'crawler', venue: 'pile', venueName: 'The Rock Pile', format: 'time',
    blurb: 'Fastest to the summit takes the crown.',
    skill: 0.4, prizes: [100, 60, 35], rivalMarks: [55, 75, 100], unlock: (d) => d.crawler.owned, lockHint: 'Buy the Cragweld rock crawler',
  },
  {
    id: 'kanjo-night', name: 'Kanjo Drift Night', vehicle: 'drift', venue: 'hall', venueName: 'Kanjo Hall', format: 'score',
    blurb: 'Judged run: two laps from the line. Long, deep drifts and tagging the clipping points and zones score.',
    skill: 0.4, prizes: [150, 90, 50], rivalMarks: [1500, 1000, 600], unlock: (d) => d.drift.owned, lockHint: 'Buy the RD-1 drift car',
  },
  {
    id: 'bayside-midnight', name: 'Bayside Midnight Drift', vehicle: 'drift', venue: 'lot', venueName: 'Bayside Car Park', format: 'score',
    blurb: 'Midnight in the car park. The judges want big angle past the wheel stops.',
    skill: 0.65, prizes: [220, 130, 70], rivalMarks: [2000, 1400, 900], unlock: (d) => d.drift.owned && d.drift.sessions > 0, lockHint: 'Do a drift session to open Bayside',
  },
  {
    id: 'finale', name: 'Brackenbank Championship Final', vehicle: 'buggy', venue: 'dunes', venueName: 'Dune Run', format: 'race', laps: 5,
    blurb: 'The season decider: five laps of Dune Run against the pro field.',
    skill: 0.9, prizes: [500, 300, 150], unlock: (d) => wins(d) >= 3, lockHint: 'Win any three events',
  },
];

export const eventById = (id: string) => EVENTS.find((e) => e.id === id);

export interface EventRecord { best: number | null; wins: number; runs: number; earned: number }
export const eventRecord = (d: SaveData, id: string): EventRecord => (d.events[id] ??= { best: null, wins: 0, runs: 0, earned: 0 });

export const ordinal = (n: number) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;

/** Record a finishing position and pay the prize. Returns the credits won. */
export function settleEvent(d: SaveData, ev: EventDef, position: number): number {
  const r = eventRecord(d, ev.id);
  r.runs++;
  if (r.best == null || position < r.best) r.best = position;
  if (position === 1) r.wins++;
  const prize = position <= 3 ? ev.prizes[position - 1] : 0;
  r.earned += prize;
  d.credits += prize;
  return prize;
}

/** Where a judged result places against the rivals' posted marks (1 = win). */
export function judgedPosition(ev: EventDef, mark: number | null): number {
  if (mark == null || !ev.rivalMarks) return 4;
  const better = ev.format === 'score' ? (a: number, b: number) => a > b : (a: number, b: number) => a < b;
  let pos = 1;
  for (const m of ev.rivalMarks) if (!better(mark, m)) pos++;
  return pos;
}
