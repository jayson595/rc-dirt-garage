// Service, repair, tuning and the mapping from part condition -> handling.
// The garage workbench and the pit table both call into this with the same vehicle state.
import {
  BATTERY_DRAIN, BUGGY_CLASSES, ECONOMY, UPGRADE_SLOTS, UPGRADES, UpgradeFx, UpgradeSlot, setupFx, upgradeById, PART_DEFS, PartId, SHOCK_SETTINGS, ShockSetting, TIRE_COMPOUNDS, TireCompound, WEAR, WearPart,
} from '../data/specs';
import type { SimEvent } from '../sim/VehicleSimulation';
import { BatteryState, SaveData, VehicleState, activeVehicle, installedBattery, logDamage } from './state';

export type ServiceContext = 'garage' | 'pit';

export interface Handling {
  gripMul: number;
  powerMul: number;
  topSpeedMul: number;
  steerResp: number;
  spring: number;
  damping: number;
  rebound: number;
  steerBias: number;
  drainMul: number;
  shockHealth: number; // 0..1
  absorb: number;      // landing impact multiplier
  slideMul: number;    // power-on looseness of the rear
  tracMul: number;     // usable drive traction
  compressionMul: number; // suspension travel before bottoming out
  barrierMul: number;  // barrier damage multiplier
  wearMul: number;     // tyre wear multiplier
}

/** All the multipliers from fitted hop-ups and the setup sheet, combined. */
export function vehicleFx(v: VehicleState): Required<UpgradeFx> {
  const fx: Required<UpgradeFx> = { power: 1, top: 1, grip: 1, steer: 1, slide: 1, absorb: 1, damping: 1, drain: 1, barrier: 1, trac: 1, wear: 1, compression: 1 };
  const parts = [...UPGRADE_SLOTS.map((s) => upgradeById(v.fitted?.[s] ?? '')?.fx ?? {}), v.setup ? setupFx(v.setup) : {}];
  for (const f of parts) for (const k of Object.keys(f) as (keyof UpgradeFx)[]) fx[k] *= f[k]!;
  return fx;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const c01 = (v: number) => Math.min(1, Math.max(0, v));

/** Battery power factor: full above the low cutoff, fades below it, limp-home when empty. */
export function batteryPower(b: BatteryState | null): number {
  if (!b || b.charge <= 0) return BATTERY_DRAIN.emptyPower;
  if (b.charge >= BATTERY_DRAIN.lowCutoff) return 1;
  return lerp(0.55, 1, b.charge / BATTERY_DRAIN.lowCutoff);
}

/** Bounded penalties: worn parts hurt, but never make the car undriveable. */
export function computeHandling(s: SaveData): Handling {
  const v = activeVehicle(s);
  const cls = BUGGY_CLASSES[v.id];
  const c = v.condition;
  const shock = SHOCK_SETTINGS[v.shockSetting];
  const tire = TIRE_COMPOUNDS[v.tireCompound];
  const shockHealth = c.shocks / 100;
  const bat = installedBattery(s);
  const fx = vehicleFx(v);
  return {
    slideMul: fx.slide,
    tracMul: fx.trac,
    compressionMul: fx.compression,
    barrierMul: fx.barrier,
    wearMul: fx.wear,
    gripMul: fx.grip * tire.grip * shock.gripMul * lerp(0.74, 1, c01(c.tires / 100)) * lerp(0.88, 1, shockHealth),
    powerMul: fx.power * lerp(0.82, 1, c.motor / 100) * batteryPower(bat),
    topSpeedMul: fx.top * lerp(0.9, 1, c.motor / 100) * lerp(0.94, 1, c.chassis / 100) * (bat && bat.charge > 0 ? 1 : 0.4),
    steerResp: fx.steer * shock.steerResp * lerp(0.75, 1, c.servo / 100),
    // Worn shocks lose damping, so the car bounces and settles slowly.
    spring: shock.spring * cls.springMul,
    damping: fx.damping * shock.damping * cls.dampMul * lerp(0.35, 1, shockHealth),
    rebound: shock.rebound + (1 - shockHealth) * 0.3,
    // A bent chassis pulls slightly to one side. Deterministic, never random.
    steerBias: (1 - c.chassis / 100) * 0.05,
    drainMul: fx.drain * (bat ? 5000 / bat.capacity : 1),
    shockHealth,
    absorb: fx.absorb * shock.absorb * cls.absorbMul * lerp(1.15, 1, shockHealth),
  };
}

export interface PartAction {
  id: string;
  label: string;
  cost: number;
  enabled: boolean;
  note?: string;
  primary?: boolean;
}

export interface PartView {
  id: PartId;
  name: string;
  blurb: string;
  condition: number | null;
  status: string;
  effect: string;
  actions: PartAction[];
}

export function packLetter(name: string) { return name.match(/\((.)\)/)?.[1] ?? name; }

export function repairCost(part: WearPart, condition: number): number {
  const missing = 100 - condition;
  const per = part === 'chassis' ? ECONOMY.chassisPerPoint : part === 'shocks' ? ECONOMY.shocksPerPoint : ECONOMY.motorPerPoint;
  return Math.max(ECONOMY.minRepair, Math.round(missing * per));
}

function pct(n: number) { return `${Math.round(n)}%`; }
function signedPct(mul: number) {
  const d = Math.round((mul - 1) * 100);
  return d === 0 ? '±0%' : `${d > 0 ? '+' : '−'}${Math.abs(d)}%`;
}

export class ServiceSystem {
  constructor(private getSave: () => SaveData, private persist: () => void) {}

  get s() { return this.getSave(); }
  /** Sandbox free play: everything at the bench and parts cabinet costs nothing. */
  price(n: number) { return this.s.sandbox.free ? 0 : n; }
  get v() { return activeVehicle(this.s); }

  /** True when a part can only be reached with the shell removed. */
  needsShellOff(id: PartId) {
    return id !== 'shell' && id !== 'tires' && id !== 'battery' ? this.v.shellOn : false;
  }

  view(id: PartId, ctx: ServiceContext): PartView {
    const def = PART_DEFS[id];
    const v = this.v;
    const s = this.s;
    const actions: PartAction[] = [];
    let condition: number | null = null;
    let status = '';
    let effect = '';

    const lastCause = (p: WearPart) => v.damageLog.find((e) => e.part === p)?.cause;
    const blockedByShell = this.needsShellOff(id);

    switch (id) {
      case 'shell':
        status = v.shellOn ? 'Fitted' : 'Removed — chassis exposed';
        effect = 'Cosmetic. Must be off to service internal parts.';
        actions.push({ id: 'shell-toggle', label: v.shellOn ? 'Remove shell' : 'Refit shell', cost: 0, enabled: true, primary: true });
        break;

      case 'battery': {
        const bat = installedBattery(s);
        condition = bat ? bat.charge : 0;
        status = bat ? `${bat.name} · ${pct(bat.charge)} charge` : 'No battery installed';
        const pw = batteryPower(bat);
        effect = pw >= 1 ? 'Full power.' : bat && bat.charge > 0 ? `Low charge: power ${signedPct(pw)}.` : 'Empty: limp-home power only.';
        // One physical pack can only be in one place: in the car, on the bench tray, or on a charger.
        for (const b of s.batteries) {
          if (b.id === v.batteryId) continue;
          const where = ctx === 'pit' ? 'spare' : (s.garage.batteryPlace[b.id] === 'bench' ? 'on bench tray' : 'on charger');
          actions.push({
            id: `bat-install:${b.id}`, label: `${bat ? 'Swap to' : 'Install'} pack ${packLetter(b.name)} (${pct(b.charge)})`, cost: 0, enabled: true,
            primary: b.charge > (bat?.charge ?? -1), note: `Currently ${where}.`,
          });
        }
        if (bat) actions.push({ id: 'bat-remove', label: ctx === 'garage' ? 'Remove pack to bench tray' : 'Remove pack', cost: 0, enabled: true });
        if (ctx === 'garage') {
          for (const b of s.batteries) {
            if (b.id !== v.batteryId && s.garage.batteryPlace[b.id] === 'bench') actions.push({ id: `bat-tocharger:${b.id}`, label: `Put pack ${packLetter(b.name)} on the charger`, cost: 0, enabled: true });
          }
          if (bat && bat.charge < 100) actions.push({ id: 'noop', label: 'Charging happens at the charging bench', cost: 0, enabled: false, note: 'Remove the pack, then charge it there.' });
        } else {
          for (const b of s.batteries) {
            if (b.id !== v.batteryId && b.charge < 100) actions.push({ id: `bat-charge:${b.id}`, label: `Charge spare ${packLetter(b.name)} on field charger`, cost: 0, enabled: true });
          }
        }
        break;
      }

      case 'tires': {
        condition = v.condition.tires;
        const comp = TIRE_COMPOUNDS[v.tireCompound];
        status = `${comp.name} · ${pct(condition)} tread`;
        const h = computeHandling(s);
        effect = `Grip ${signedPct(h.gripMul)} vs. new medium tires. ${lastCause('tires') ? `Last wear: ${lastCause('tires')}.` : ''}`;
        for (const key of Object.keys(TIRE_COMPOUNDS) as TireCompound[]) {
          const t = TIRE_COMPOUNDS[key];
          const same = key === v.tireCompound;
          const owned = s.spares.tires[key] ?? 0;
          if (owned > 0) {
            actions.push({ id: `tires-spare:${key}`, label: `Fit owned spare: ${t.name} (×${owned})`, cost: 0, enabled: true, primary: same && condition < 60, note: `${t.note} From your parts cabinet.` });
            continue;
          }
          actions.push({
            id: `tires:${key}`,
            label: same ? `Fresh set: ${t.name}` : `Fit ${t.name}`,
            cost: this.price(t.price),
            enabled: s.credits >= this.price(t.price),
            note: `${t.note} Grip ${signedPct(t.grip)}.`,
            primary: same && condition < 60,
          });
        }
        break;
      }

      case 'shocks': {
        condition = v.condition.shocks;
        const set = SHOCK_SETTINGS[v.shockSetting];
        status = `${set.label} setting · ${pct(condition)} health`;
        effect = condition < 100
          ? `Worn shocks bounce more and cost grip (${signedPct(lerp(0.88, 1, condition / 100))}). ${lastCause('shocks') ? `Cause: ${lastCause('shocks')}.` : ''}`
          : set.note;
        this.pushRepair(actions, 'shocks', condition, 'Rebuild shocks', blockedByShell);
        for (const key of Object.keys(SHOCK_SETTINGS) as ShockSetting[]) {
          if (key === v.shockSetting) continue;
          actions.push({ id: `shock-set:${key}`, label: `Set ${SHOCK_SETTINGS[key].label}`, cost: 0, enabled: true, note: SHOCK_SETTINGS[key].note });
        }
        break;
      }

      case 'chassis': {
        condition = v.condition.chassis;
        status = `${pct(condition)} straight`;
        effect = condition < 100
          ? `Bent parts: top speed ${signedPct(0.94 + 0.06 * condition / 100)}, slight steering pull. ${lastCause('chassis') ? `Cause: ${lastCause('chassis')}.` : ''}`
          : 'Straight and true.';
        this.pushRepair(actions, 'chassis', condition, ctx === 'pit' ? 'Quick repair' : 'Repair chassis', blockedByShell);
        break;
      }

      case 'motor': {
        condition = v.condition.motor;
        status = `${pct(condition)} health`;
        effect = condition < 100 ? `Power ${signedPct(0.82 + 0.18 * condition / 100)}.` : 'Full power.';
        if (ctx === 'garage') this.pushRepair(actions, 'motor', condition, 'Service motor (bearings, clean)', blockedByShell);
        else actions.push({ id: 'noop', label: 'Motor service: garage only', cost: 0, enabled: false });
        break;
      }

      default: {
        const wp = id as WearPart;
        condition = v.condition[wp];
        status = `${pct(condition)} health`;
        effect = def.blurb;
      }
    }

    // hop-ups for this part (garage only): stock part first, then what you can buy or swap back to
    if ((UPGRADE_SLOTS as string[]).includes(id)) {
      const slot = id as UpgradeSlot, fitted = upgradeById(v.fitted[slot]);
      status = `${fitted?.name ?? 'Stock'} · ${status}`;
      if (fitted && fitted.price > 0) effect = `${fitted.note} ${effect}`;
      for (const u of UPGRADES[slot]) {
        if (u.id === v.fitted[slot]) continue;
        const owned = v.owned.includes(u.id);
        if (ctx !== 'garage') { actions.push({ id: 'noop', label: `${u.name}: fit at the garage workbench`, cost: 0, enabled: false }); continue; }
        const cost = owned ? 0 : this.price(u.price);
        actions.push({
          id: `upgrade:${u.id}`, label: owned ? `Swap to ${u.name}${u.price ? ' (owned)' : ''}` : `Fit ${u.name}`, cost,
          enabled: !blockedByShell && s.credits >= cost, note: blockedByShell ? 'Remove the shell first.' : u.note,
        });
      }
    }
    if (id === 'gears') {
      const g = v.setup.pinion;
      status = `Pinion ${g > 0 ? '+' : ''}${g}T vs. stock · ${pct(v.condition.gears)} health`;
      effect = 'Change the pinion on the setup sheet: bigger = more top speed and battery use, smaller = punchier.';
      actions.length = 0;
      actions.push({ id: 'noop', label: 'Gearing is on the setup sheet', cost: 0, enabled: false });
    }

    return { id, name: def.name, blurb: def.blurb, condition, status, effect, actions };
  }

  private pushRepair(actions: PartAction[], part: WearPart, condition: number, label: string, blockedByShell: boolean) {
    if (condition >= 99.5) {
      actions.push({ id: 'noop', label: 'No repair needed', cost: 0, enabled: false });
      return;
    }
    const cost = this.price(repairCost(part, condition));
    const afford = this.s.credits >= cost;
    actions.push({
      id: `repair:${part}`, label, cost, enabled: afford && !blockedByShell, primary: true,
      note: blockedByShell ? 'Remove the shell first.' : `Restores to 100%.`,
    });
    if (!afford && condition < ECONOMY.patchTo) {
      actions.push({
        id: `patch:${part}`, label: `Kit-box patch (free, to ${ECONOMY.patchTo}%)`, cost: 0, enabled: !blockedByShell,
        note: 'Short on credits? A rough fix to keep you driving.',
      });
    }
  }

  /** Returns a short message for a toast. */
  perform(actionId: string): string {
    const s = this.s;
    const v = this.v;
    const [kind, arg] = actionId.split(':');
    let msg = '';
    switch (kind) {
      case 'shell-toggle':
        v.shellOn = !v.shellOn;
        msg = v.shellOn ? 'Shell refitted' : 'Shell removed';
        break;
      case 'bat-install': {
        const b = s.batteries.find((x) => x.id === arg);
        if (!b || v.batteryId === arg) return '';
        if (v.batteryId) s.garage.batteryPlace[v.batteryId] = 'bench'; // old pack comes out onto the tray
        v.batteryId = arg;
        delete s.garage.batteryPlace[arg];
        msg = `Installed pack ${packLetter(b.name)}`;
        break;
      }
      case 'bat-remove': {
        if (!v.batteryId) return '';
        const b = s.batteries.find((x) => x.id === v.batteryId);
        s.garage.batteryPlace[v.batteryId] = 'bench';
        v.batteryId = null;
        msg = `Pack ${packLetter(b?.name ?? '')} removed to the bench tray`;
        break;
      }
      case 'bat-tocharger': {
        if (arg === v.batteryId) return '';
        s.garage.batteryPlace[arg] = 'charger';
        msg = 'Pack placed on the charger';
        break;
      }
      case 'bat-remove-charge': {
        // explicit: take the installed pack out of the buggy and charge it
        if (v.batteryId !== arg) return '';
        v.batteryId = null;
        s.garage.batteryPlace[arg] = 'charger';
        const b = s.batteries.find((x) => x.id === arg)!;
        b.charge = 100;
        msg = `Pack ${packLetter(b.name)} removed and charged`;
        break;
      }
      case 'bat-charge': {
        const b = s.batteries.find((x) => x.id === arg);
        if (!b) return '';
        if (b.id === v.batteryId) return 'Remove the pack from the car before charging';
        b.charge = 100;
        if (s.garage.batteryPlace[b.id]) s.garage.batteryPlace[b.id] = 'charger';
        msg = `Pack ${packLetter(b.name)} charged to 100%`;
        break;
      }
      case 'tires-spare': {
        const comp = arg as TireCompound;
        if (!TIRE_COMPOUNDS[comp] || (s.spares.tires[comp] ?? 0) < 1) return 'No spare set of that tire';
        s.spares.tires[comp] -= 1;
        v.tireCompound = comp;
        v.condition.tires = 100;
        msg = `Fitted spare ${TIRE_COMPOUNDS[comp].name}`;
        break;
      }
      case 'shop-tires': {
        const comp = arg as TireCompound;
        const t = TIRE_COMPOUNDS[comp];
        if (!t) return '';
        if (s.credits < this.price(t.price)) return 'Not enough credits';
        s.credits -= this.price(t.price);
        s.spares.tires[comp] = (s.spares.tires[comp] ?? 0) + 1;
        msg = `Bought a set of ${t.name} (−${this.price(t.price)} cr)`;
        break;
      }
      case 'tires': {
        const comp = arg as TireCompound;
        const t = TIRE_COMPOUNDS[comp];
        if (!t || s.credits < this.price(t.price)) return 'Not enough credits';
        s.credits -= this.price(t.price);
        v.tireCompound = comp;
        v.condition.tires = 100;
        msg = `Fitted ${t.name} (−${this.price(t.price)} cr)`;
        break;
      }
      case 'upgrade': {
        const u = upgradeById(arg);
        if (!u) return '';
        if (this.needsShellOff(u.slot as PartId)) return 'Remove the shell first';
        if (!v.owned.includes(u.id)) {
          const cost = this.price(u.price);
          if (s.credits < cost) return 'Not enough credits';
          s.credits -= cost; v.owned.push(u.id);
          msg = `Fitted ${u.name} (−${cost} cr)`;
        } else msg = `Swapped to ${u.name}`;
        v.fitted[u.slot] = u.id;
        break;
      }
      case 'shock-set':
        v.shockSetting = arg as ShockSetting;
        msg = `Shocks set to ${SHOCK_SETTINGS[v.shockSetting].label}`;
        break;
      case 'repair': {
        const part = arg as WearPart;
        if (this.needsShellOff(part as PartId)) return 'Remove the shell first';
        const cost = this.price(repairCost(part, v.condition[part]));
        if (s.credits < cost) return 'Not enough credits';
        s.credits -= cost;
        v.condition[part] = 100;
        msg = `${PART_DEFS[part as PartId].name} repaired (−${cost} cr)`;
        break;
      }
      case 'patch': {
        const part = arg as WearPart;
        if (this.needsShellOff(part as PartId)) return 'Remove the shell first';
        v.condition[part] = Math.max(v.condition[part], ECONOMY.patchTo);
        msg = `${PART_DEFS[part as PartId].name} patched to ${ECONOMY.patchTo}%`;
        break;
      }
      default:
        return '';
    }
    this.persist();
    return msg;
  }

  /** Battery drain + gradual wear from a chunk of driving. Returns true if the battery just hit empty. */
  applyDriving(stats: { distance: number; slipDistance: number; throttleEnergy: number }, dt: number, h: Handling): boolean {
    const v = this.v;
    const bat = installedBattery(this.s);
    let emptied = false;
    if (bat) {
      const before = bat.charge;
      bat.charge = Math.max(0, bat.charge - (BATTERY_DRAIN.idle * dt + BATTERY_DRAIN.full * stats.throttleEnergy) * h.drainMul);
      emptied = before > 0 && bat.charge <= 0;
    }
    const comp = TIRE_COMPOUNDS[v.tireCompound];
    const tireWear = (stats.distance * WEAR.tiresPerMeter + stats.slipDistance * WEAR.tiresSlipPerMeter) * comp.wear * h.wearMul;
    if (tireWear > 0) {
      v.condition.tires = Math.max(0, v.condition.tires - tireWear);
      this.tireWearAcc += tireWear;
      if (this.tireWearAcc > 2) {
        v.damageLog.unshift({ part: 'tires', amount: Math.round(this.tireWearAcc * 10) / 10, cause: stats.slipDistance > stats.distance * 0.15 ? 'sliding and wheelspin' : 'normal tread wear', at: Date.now() });
        v.damageLog.length = Math.min(v.damageLog.length, 12);
        this.tireWearAcc = 0;
      }
    }
    v.condition.motor = Math.max(0, v.condition.motor - stats.throttleEnergy * WEAR.motorPerSecond);
    v.odometer += stats.distance;
    return emptied;
  }
  private tireWearAcc = 0;

  /** Apply a physics event; returns a toast message if it caused damage. */
  applyEvent(e: SimEvent): string | null {
    if (e.type === 'landing' && e.damage > 0.4) {
      logDamage(this.v, 'shocks', e.damage, `hard landing (${e.impact.toFixed(1)} m/s)`);
      return `Hard landing · shocks −${Math.round(e.damage)}%`;
    }
    if (e.type === 'barrier' && e.damage * vehicleFx(this.v).barrier > 0.4) {
      const dmg = e.damage * vehicleFx(this.v).barrier;
      logDamage(this.v, 'chassis', dmg, `barrier hit (${e.impact.toFixed(1)} m/s)`);
      return `Barrier hit · chassis −${Math.round(dmg)}%`;
    }
    return null;
  }

  /** Short summary used on pit/garage headers. */
  summary() {
    const v = this.v;
    const bat = installedBattery(this.s);
    return {
      battery: bat ? bat.charge : 0,
      tires: v.condition.tires,
      shocks: v.condition.shocks,
      chassis: v.condition.chassis,
      motor: v.condition.motor,
    };
  }
}
