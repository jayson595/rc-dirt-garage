// Odd job: sort the club's mixed screw tray. 30 seconds, one part at a time drops into the tray,
// tap the matching bin. Streaks multiply points; wrong bins cost a second. A quick, cheesy earner.
import { h } from './dom';

export const SORT = { seconds: 30, maxPay: 50, payPerPoint: 0.5, wrongPenalty: 1 };

type Kind = 'screw' | 'nut' | 'washer' | 'stud';
const KINDS: Kind[] = ['screw', 'nut', 'washer', 'stud'];
const LABEL: Record<Kind, string> = { screw: 'Screws', nut: 'Nuts', washer: 'Washers', stud: 'Ball studs' };
const TINTS = [['#d9dde2', '#8b939c'], ['#d9dde2', '#8b939c'], ['#3c3f44', '#16181b'], ['#4a8be0', '#1d4f9a'], ['#e0b04a', '#8a6420']];

/** Side/plan drawings of the parts, as inline SVG (light top, dark bottom gradient = metal). */
function partSvg(kind: Kind, tint: string[], id: string, size = 96) {
  const g = `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${tint[0]}"/><stop offset="1" stop-color="${tint[1]}"/></linearGradient></defs>`;
  const f = `fill="url(#${id})" stroke="#111" stroke-width="2" stroke-linejoin="round"`;
  let body = '';
  if (kind === 'screw') {
    body = `<rect x="14" y="36" width="20" height="24" rx="4" ${f}/><rect x="34" y="41" width="50" height="14" rx="2" ${f}/>`
      + Array.from({ length: 9 }, (_, i) => `<line x1="${38 + i * 5}" y1="41" x2="${41 + i * 5}" y2="55" stroke="#111" stroke-width="1.4" opacity=".55"/>`).join('')
      + `<rect x="18" y="44" width="4" height="8" fill="#111" opacity=".6"/>`;
  } else if (kind === 'nut') {
    const pts = Array.from({ length: 6 }, (_, i) => { const a = Math.PI / 6 + (i * Math.PI) / 3; return `${48 + 32 * Math.cos(a)},${48 + 32 * Math.sin(a)}`; }).join(' ');
    body = `<polygon points="${pts}" ${f}/><circle cx="48" cy="48" r="17" fill="#2a64c9" stroke="#111" stroke-width="2"/><circle cx="48" cy="48" r="11" fill="#14161a"/>`;
  } else if (kind === 'washer') {
    body = `<circle cx="48" cy="48" r="32" ${f}/><circle cx="48" cy="48" r="13" fill="#14161a" stroke="#111" stroke-width="2"/><path d="M26 38 A24 24 0 0 1 44 24" stroke="#fff" stroke-width="3" fill="none" opacity=".5"/>`;
  } else {
    body = `<circle cx="28" cy="48" r="17" ${f}/><rect x="44" y="43" width="10" height="10" ${f}/><rect x="54" y="42" width="30" height="12" rx="2" ${f}/>`
      + Array.from({ length: 5 }, (_, i) => `<line x1="${58 + i * 5}" y1="42" x2="${61 + i * 5}" y2="54" stroke="#111" stroke-width="1.4" opacity=".55"/>`).join('')
      + `<circle cx="22" cy="42" r="5" fill="#fff" opacity=".55"/>`;
  }
  return `<svg viewBox="0 0 96 96" width="${size}" height="${size}" aria-hidden="true">${g}${body}</svg>`;
}

export interface SortResult { points: number; correct: number; wrong: number; bestStreak: number; pay: number }

/** Runs the game inside `host`. Calls `done` with the result when the player collects pay or quits (null). */
export function runScrewSort(host: HTMLElement, best: number, done: (r: SortResult | null) => void) {
  let left = SORT.seconds, points = 0, correct = 0, wrong = 0, streak = 0, bestStreak = 0;
  let current: Kind = 'screw', running = false, finished = false, raf = 0, last = 0, uid = 0;
  const pay = () => Math.min(SORT.maxPay, Math.floor(points * SORT.payPerPoint));

  const timeEl = h('b', {}, `${SORT.seconds}`);
  const ptsEl = h('b', {}, '0');
  const streakEl = h('div', { class: 'sort-streak' }, '');
  const fill = h('i', {});
  const tray = h('div', { class: 'sort-tray' });
  const hint = h('div', { class: 'sort-hint' }, 'Tap the bin that matches the part in the tray');
  const bins = KINDS.map((k) => {
    const b = h('button', { class: 'sort-bin', 'data-kind': k, 'aria-label': LABEL[k], onpointerdown: (e: Event) => { e.preventDefault(); pick(k, b); } },
      h('span', { class: 'sort-bin-ico', html: partSvg(k, TINTS[0], `bi-${k}`, 52) }), h('span', {}, LABEL[k]));
    return b;
  });
  const card = h('div', { class: 'modal-card sort-card' },
    h('div', { class: 'row between' }, h('div', {}, h('div', { class: 'eyebrow' }, 'Odd job · club parts tray'), h('h2', {}, 'Sort the screw tray')),
      h('button', { class: 'icon-btn', 'aria-label': 'Quit', onclick: () => stop(null) }, '✕')),
    h('div', { class: 'sort-hud' },
      h('div', {}, h('small', {}, 'TIME'), timeEl), h('div', {}, h('small', {}, 'POINTS'), ptsEl),
      h('div', { class: 'grow' }, h('small', {}, `PAY (max ${SORT.maxPay} cr)`), h('div', { class: 'bar mini ok' }, fill))),
    h('div', { class: 'sort-stage' }, tray, streakEl),
    hint,
    h('div', { class: 'sort-bins' }, bins),
  );
  const root = h('div', { class: 'sheet-overlay sort-overlay' }, card);
  host.replaceChildren(root);

  function next() {
    let k: Kind;
    do k = KINDS[Math.floor(Math.random() * 4)]; while (k === current && Math.random() < 0.5);
    current = k;
    // later in the round, anodised and black parts turn up to keep you honest
    const tint = correct > 8 ? TINTS[Math.floor(Math.random() * TINTS.length)] : TINTS[0];
    const el = h('div', { class: 'sort-part', html: partSvg(k, tint, `p${uid++}`) });
    el.style.setProperty('--rot', `${Math.round((Math.random() - 0.5) * 70)}deg`);
    tray.replaceChildren(el);
  }

  function pick(k: Kind, btn: HTMLElement) {
    if (finished) return;
    if (!running) { running = true; last = performance.now(); raf = requestAnimationFrame(tick); hint.textContent = ''; }
    const ok = k === current;
    btn.classList.remove('ok', 'bad'); void btn.offsetWidth; btn.classList.add(ok ? 'ok' : 'bad');
    if (ok) {
      streak++; correct++; bestStreak = Math.max(bestStreak, streak);
      const mult = streak >= 15 ? 3 : streak >= 6 ? 2 : 1;
      points += mult;
      streakEl.textContent = mult > 1 ? `×${mult} streak!` : '';
      streakEl.classList.toggle('show', mult > 1);
      next();
    } else {
      wrong++; streak = 0; left = Math.max(0, left - SORT.wrongPenalty);
      streakEl.textContent = `−${SORT.wrongPenalty} s`; streakEl.classList.add('show', 'bad');
      setTimeout(() => streakEl.classList.remove('bad'), 400);
      tray.firstElementChild?.classList.add('shake');
      setTimeout(() => tray.firstElementChild?.classList.remove('shake'), 300);
    }
    hud();
  }

  function hud() {
    timeEl.textContent = `${Math.ceil(left)}`;
    ptsEl.textContent = `${points}`;
    fill.style.width = `${(pay() / SORT.maxPay) * 100}%`;
  }

  function tick(now: number) {
    left -= (now - last) / 1000; last = now;
    if (left <= 0) { left = 0; hud(); end(); return; }
    hud();
    raf = requestAnimationFrame(tick);
  }

  function end() {
    finished = true; cancelAnimationFrame(raf);
    const r: SortResult = { points, correct, wrong, bestStreak, pay: pay() };
    const pb = points > best;
    card.replaceChildren(
      h('div', { class: 'eyebrow' }, 'Screw tray sorted'),
      h('div', { class: 'big-time' }, `${points} points`),
      h('div', { class: 'muted small' }, `${correct} sorted · ${wrong} wrong bin${wrong === 1 ? '' : 's'} · best streak ${bestStreak}${pb ? ' · new best!' : ''}`),
      h('div', { class: 'earned' }, `+${r.pay} credits`),
      h('div', { class: 'muted small' }, r.pay >= SORT.maxPay ? `The club treasurer pays out the full ${SORT.maxPay}.` : `${Math.round(SORT.maxPay / SORT.payPerPoint)} points earns the full ${SORT.maxPay} cr. Streaks double and triple your points.`),
      h('div', { class: 'row end' }, h('button', { class: 'btn primary', onclick: () => stop(r) }, 'Collect pay')));
  }

  function stop(r: SortResult | null) {
    finished = true; cancelAnimationFrame(raf);
    host.replaceChildren();
    done(r);
  }

  next(); hud();
  return { stop: () => stop(null) };
}
