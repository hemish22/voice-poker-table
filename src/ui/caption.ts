import { h } from './dom';

export type CaptionKind = 'info' | 'error';

/** The announcement strip along the bottom ("lodu is the dealer."). */
export function createCaption(): { el: HTMLElement; show(text: string, kind?: CaptionKind, ms?: number): void } {
  const el = h('div', { class: 'caption', role: 'status', 'aria-live': 'polite' });
  el.hidden = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    el,
    show(text, kind = 'info', ms = 3600) {
      clearTimeout(timer);
      el.textContent = text;
      el.className = `caption ${kind}`;
      el.hidden = false;
      timer = setTimeout(() => { el.hidden = true; }, ms);
    },
  };
}
