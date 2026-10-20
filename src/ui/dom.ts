type Child = Node | string | number | null | false | undefined;
type Props = Record<string, unknown>;

/** Tiny hyperscript helper. `on*` props become listeners; text goes through textContent (no HTML injection). */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: Props | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k in el && k !== 'list') (el as unknown as Props)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) {
    if (c === null || c === false || c === undefined) continue;
    el.append(typeof c === 'number' ? String(c) : c);
  }
  return el;
}

export const fmt = (n: number) => n.toLocaleString('en-US');

let toastTimer: number | undefined;
export function toast(message: string, kind: 'error' | 'info' = 'error'): void {
  document.querySelector('.toast')?.remove();
  const el = h('div', { class: `toast ${kind}`, role: 'status' }, message);
  document.body.append(el);
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.remove(), 4200);
}

export interface Sheet {
  el: HTMLElement;
  body: HTMLElement;
  close(): void;
}

export interface SheetOptions {
  className?: string;
  /** Tap on the dark backdrop or press Escape to close. Default true. */
  dismissible?: boolean;
  onClose?: () => void;
}

/**
 * A modal sheet drawn in normal page layers (not the browser's top layer), so the
 * voice confirmation card can always appear above it.
 */
export function openSheet(build: (close: () => void) => (Node | null)[], opts: SheetOptions = {}): Sheet {
  const previous = document.activeElement as HTMLElement | null;
  const body = h('div', { class: `sheet ${opts.className ?? ''}`.trim(), role: 'dialog', 'aria-modal': 'true' });
  const backdrop = h('div', { class: 'sheet-backdrop' }, body);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    backdrop.remove();
    opts.onClose?.();
    previous?.focus?.();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && opts.dismissible !== false) close();
  };
  body.append(...build(close).filter((n): n is Node => n !== null));
  backdrop.addEventListener('pointerdown', (e) => {
    if (e.target === backdrop && opts.dismissible !== false) close();
  });
  document.addEventListener('keydown', onKey);
  document.body.append(backdrop);
  body.querySelector<HTMLElement>('input:not([type=hidden]), button:not(.sheet-x)')?.focus?.({ preventScroll: true });
  return { el: backdrop, body, close };
}

export function openDialog(title: string, build: (close: () => void) => (Node | null)[]): Sheet {
  return openSheet((close) => [
    h('header', { class: 'dlg-head' }, h('h2', null, title), h('button', { class: 'icon-btn sheet-x', 'aria-label': 'Close', onClick: close }, icon('close'))),
    h('div', { class: 'dlg-body' }, ...build(close).filter((n): n is Node => n !== null)),
  ], { className: 'dlg' });
}

const ICONS: Record<string, string> = {
  undo: '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="21" fill="none" stroke="currentColor" stroke-width="4"/><path d="M15 22h14a6 6 0 0 1 0 12h-6M15 22l6-6M15 22l6 6" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  info: '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="21" fill="none" stroke="currentColor" stroke-width="4"/><circle cx="24" cy="14" r="3" fill="currentColor"/><path d="M20 22h6v12m-6 0h12" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  keyboard: '<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="4" y="11" width="40" height="26" rx="4" fill="none" stroke="currentColor" stroke-width="3.5"/><path d="M11 19h2m5 0h2m5 0h2m5 0h2m5 0h2M11 25h2m5 0h2m5 0h2m5 0h2m5 0h2M15 31h18" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/></svg>',
  close: '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="21" fill="none" stroke="currentColor" stroke-width="4"/><path d="M16 16l16 16M32 16L16 32" stroke="currentColor" stroke-width="4.5" stroke-linecap="round"/></svg>',
  dice: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M10 14l14-8 14 8v16l-14 8-14-8z" fill="currentColor"/><circle cx="19" cy="17" r="2.6" fill="#2f5fd8"/><circle cx="29" cy="17" r="2.6" fill="#2f5fd8"/><circle cx="24" cy="24" r="2.6" fill="#2f5fd8"/><circle cx="19" cy="31" r="2.6" fill="#2f5fd8"/><circle cx="29" cy="31" r="2.6" fill="#2f5fd8"/></svg>',
  check: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M9 25l11 11L40 13" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  menu: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M8 14h32M8 24h32M8 34h32" stroke="currentColor" stroke-width="5" stroke-linecap="round"/></svg>',
  spade: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 6c8 9 15 13 15 21a8 8 0 0 1-13 6c.6 4 1.600 7 3.500 9h-11c1.900-2 2.900-5 3.500-9a8 8 0 0 1-13-6c0-8 7-12 15-21z" fill="currentColor"/></svg>',
  diamond: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 4l14 20-14 20L10 24z" fill="currentColor"/></svg>',
};

/** Inline SVG icon from the fixed set above (static markup only, never user text). */
export function icon(name: keyof typeof ICONS | string, className = 'icon'): HTMLElement {
  const span = document.createElement('span');
  span.className = className;
  span.innerHTML = ICONS[name] ?? '';
  return span;
}

export function field(label: string, input: HTMLElement, hint?: string): HTMLElement {
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), input, hint ? h('span', { class: 'hint' }, hint) : null);
}
