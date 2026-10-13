// Tiny DOM helpers + toasts + confirm modal (no window.confirm: it's unreliable in embedded pages).

type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, any> = {},
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

export const $ = (id: string) => document.getElementById(id)!;

let toastTimer = 0;
export function toast(msg: string, kind: 'info' | 'warn' | 'good' = 'info', ms = 1800) {
  if (!msg) return;
  const t = $('toast');
  t.textContent = msg;
  t.className = `show ${kind}`;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { t.className = ''; }, ms);
}

export function confirmModal(title: string, body: string, okLabel: string, danger = false): Promise<boolean> {
  return new Promise((resolve) => {
    const root = $('modal');
    const close = (v: boolean) => { root.replaceChildren(); root.classList.remove('open'); resolve(v); };
    root.replaceChildren(
      h('div', { class: 'modal-card scroll-ok', role: 'dialog', 'aria-modal': 'true' },
        h('h2', {}, title),
        h('p', {}, body),
        h('div', { class: 'row end' },
          h('button', { class: 'btn ghost', onclick: () => close(false) }, 'Cancel'),
          h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, onclick: () => close(true) }, okLabel),
        ),
      ),
    );
    root.classList.add('open');
  });
}

export function fmtTime(t: number | null | undefined) {
  if (t == null || !Number.isFinite(t)) return '--:--.--';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

export function bar(value: number, cls = '') {
  const v = Math.max(0, Math.min(100, value));
  const tone = v > 60 ? 'ok' : v > 30 ? 'mid' : 'low';
  return h('div', { class: `bar ${tone} ${cls}` }, h('i', { style: { width: `${v}%` } }));
}
