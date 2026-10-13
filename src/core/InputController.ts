// Central driving input. Exactly one place owns steering/throttle intent for the simulation.
// Touch values come from the transmitter controls; keyboard is the desktop fallback.
// Ownership: while a touch control holds an axis, the keyboard cannot override that axis.
export class InputController {
  /** Final normalised intents read by the simulation. */
  steer = 0;
  throttle = 0;
  /** Which source last produced each axis (drives nothing, useful for debugging/tests). */
  steerSource: 'none' | 'touch' | 'keys' = 'none';
  throttleSource: 'none' | 'touch' | 'keys' = 'none';

  private keys = new Set<string>();
  private kbSteer = 0;
  /** null = axis not held by touch. */
  private touchSteer: number | null = null;
  private touchThrottle: number | null = null;
  /** Called by clear() so gesture owners can release pointers/captures. */
  private cancelHandlers = new Set<() => void>();

  onPause: (() => void) | null = null;
  onResetKey: (() => void) | null = null;
  enabled = false;

  constructor() {
    window.addEventListener('keydown', this.keydown);
    window.addEventListener('keyup', this.keyup);
  }

  setTouchSteer(v: number | null) { this.touchSteer = v; }
  setTouchThrottle(v: number | null) { this.touchThrottle = v; }

  onCancel(fn: () => void) { this.cancelHandlers.add(fn); return () => this.cancelHandlers.delete(fn); }

  /** Drop every held input: pause, blur, hidden tab, resize, screen change. */
  clear() {
    this.keys.clear();
    this.kbSteer = 0;
    for (const fn of this.cancelHandlers) fn();
    this.touchSteer = null;
    this.touchThrottle = null;
    this.steer = 0;
    this.throttle = 0;
  }

  private keydown = (e: KeyboardEvent) => {
    if (!this.enabled) return;
    const k = e.key.toLowerCase();
    if (k === 'escape' || k === 'p') { this.onPause?.(); e.preventDefault(); return; }
    if (k === 'r' && !e.repeat) { this.onResetKey?.(); return; }
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
    this.keys.add(k);
  };
  private keyup = (e: KeyboardEvent) => { this.keys.delete(e.key.toLowerCase()); };

  update(dt: number) {
    const left = this.keys.has('a') || this.keys.has('arrowleft');
    const right = this.keys.has('d') || this.keys.has('arrowright');
    const up = this.keys.has('w') || this.keys.has('arrowup');
    const down = this.keys.has('s') || this.keys.has('arrowdown') || this.keys.has(' ');
    const target = (right ? 1 : 0) - (left ? 1 : 0);
    // keyboard steering ramps like a thumb on a wheel, not a switch
    const rate = target === 0 ? 7 : 4.5;
    this.kbSteer += Math.max(-rate * dt, Math.min(rate * dt, target - this.kbSteer));
    const kbThrottle = (up ? 1 : 0) - (down ? 1 : 0);

    if (this.touchSteer !== null) { this.steer = this.touchSteer; this.steerSource = 'touch'; }
    else { this.steer = this.kbSteer; this.steerSource = this.kbSteer !== 0 ? 'keys' : 'none'; }
    if (this.touchThrottle !== null) { this.throttle = this.touchThrottle; this.throttleSource = 'touch'; }
    else { this.throttle = kbThrottle; this.throttleSource = kbThrottle !== 0 ? 'keys' : 'none'; }
  }
}
