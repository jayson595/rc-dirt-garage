// Shared parts interface used by both the garage workbench and the pit table.
// The workbench uses the compact (collapsible) form: a parts list, then the selected part's name,
// status and primary action, with details expandable so the buggy stays in view.
import { PART_DEFS, PART_ORDER, PartId } from '../data/specs';
import { PartAction, ServiceContext, ServiceSystem } from '../core/ServiceSystem';
import { bar, h, toast } from './dom';

export interface PartsSheetOptions {
  collapsible?: boolean;
  /** Called after a service action succeeds, before re-render (for placement animations). */
  onAction?: (actionId: string, msg: string) => void;
}

export class PartsSheet {
  selected: PartId | null = 'shell';
  expanded = false;
  el: HTMLElement;
  private busy = false;

  constructor(
    private service: ServiceSystem,
    private ctx: ServiceContext,
    private onSelect: (p: PartId | null) => void,
    private onChanged: () => void,
    private opts: PartsSheetOptions = {},
  ) {
    this.el = h('div', { class: 'parts' });
    this.render();
  }

  select(p: PartId | null) {
    this.selected = p;
    this.onSelect(p);
    this.render();
  }

  private run(a: PartAction) {
    // one action at a time: repeated taps can't double-charge or double-move
    if (this.busy || !a.enabled) return;
    this.busy = true;
    const msg = this.service.perform(a.id);
    const failed = !msg || msg.startsWith('Not') || msg.startsWith('Remove') || msg.startsWith('No ');
    if (msg) toast(msg, failed ? 'warn' : 'good');
    if (!failed) this.opts.onAction?.(a.id, msg);
    this.onChanged();
    this.render();
    window.setTimeout(() => { this.busy = false; }, 350);
  }

  private actionButton(a: PartAction, compact = false) {
    return h('button', {
      class: `btn ${a.primary ? 'primary' : ''} ${a.enabled ? '' : 'disabled'}`,
      disabled: !a.enabled,
      'aria-disabled': !a.enabled,
      onclick: () => this.run(a),
    },
    h('span', {}, a.label),
    a.cost > 0 ? h('span', { class: 'cost' }, `${a.cost} cr`) : null,
    !compact && a.note ? h('span', { class: 'note' }, a.note) : null);
  }

  render() {
    const chips = h('div', { class: 'chips', role: 'tablist', 'aria-label': 'Parts' },
      PART_ORDER.map((id) => {
        const v = this.service.view(id, this.ctx);
        const tone = v.condition == null ? '' : v.condition > 60 ? 'ok' : v.condition > 30 ? 'mid' : 'low';
        return h('button', {
          class: `chip ${id === this.selected ? 'on' : ''}`, role: 'tab', 'aria-selected': id === this.selected,
          onclick: () => this.select(id),
        }, h('span', { class: `dot ${tone}` }), PART_DEFS[id].name);
      }),
    );
    if (!this.selected) {
      this.el.replaceChildren(chips, h('div', { class: 'part-card empty' },
        h('div', { class: 'muted' }, 'Tap a part on the buggy, or pick one from the list above.')));
      return;
    }
    const v = this.service.view(this.selected, this.ctx);
    const collapsed = this.opts.collapsible && !this.expanded;
    const enabled = v.actions.filter((a) => a.enabled);
    const primary = v.actions.find((a) => a.primary && a.enabled) ?? enabled[0] ?? v.actions[0];
    const shown = collapsed ? (primary ? [primary] : []) : v.actions;
    const detail = h('div', { class: `part-card ${collapsed ? 'collapsed' : ''}` },
      h('div', { class: 'row between' },
        h('strong', { class: 'part-name' }, v.name),
        h('div', { class: 'row' },
          PART_DEFS[v.id].inspectOnly ? h('span', { class: 'tag' }, 'Inspect only') : null,
          this.opts.collapsible ? h('button', {
            class: 'link-btn', 'aria-expanded': !collapsed,
            onclick: () => { this.expanded = !this.expanded; this.render(); },
          }, collapsed ? `Details${v.actions.length > 1 ? ` · ${v.actions.length} actions` : ''}` : 'Less') : null,
        ),
      ),
      h('div', { class: 'muted small' }, v.status),
      v.condition != null ? bar(v.condition) : null,
      collapsed ? null : h('div', { class: 'effect' }, v.effect),
      h('div', { class: 'actions' }, shown.map((a) => this.actionButton(a, collapsed))),
    );
    this.el.replaceChildren(chips, detail);
    // all part chips wrap onto the panel now, so bring the chosen part's card into view instead
    requestAnimationFrame(() => detail.scrollIntoView({ block: 'nearest' }));
  }
}
