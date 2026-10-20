import type { VoiceController } from '../controller/voice';
import { h } from './dom';

export interface VoiceUI {
  mic: HTMLButtonElement;
  bar: HTMLElement;
}

/**
 * Voice widgets live outside the main render so live transcripts never rebuild the table
 * (which would steal focus from the amount field).
 */
export function mountVoiceUI(voice: VoiceController): VoiceUI {
  const mic = h('button', { class: 'mic', id: 'mic-btn', type: 'button', onClick: () => voice.toggle() });
  const hint = h('span', { class: 'vhint' });
  const tag = h('span', { class: 'engine-tag' });
  const heard = h('span', { class: 'heard' });
  const msg = h('span', { class: 'vmsg' });
  const bar = h('div', { class: 'voice-bar', role: 'status', 'aria-live': 'polite' },
    h('span', { class: 'rec-dot', 'aria-hidden': 'true' }),
    tag, hint,
    heard, msg);
  bar.classList.add('off');

  const card = h('div', { class: 'confirm-card', role: 'alertdialog', 'aria-label': 'Confirm the voice command?' });
  card.hidden = true;
  document.body.append(card);
  let shownFor = 0;

  function update(): void {
    const s = voice.snapshot();
    mic.textContent = !s.supported ? 'Mic n/a' : s.enabled ? (s.loading ? 'Loading voice…' : s.reconnecting ? 'Reconnecting…' : s.listening ? 'Listening' : 'Starting…') : 'Mic off';
    mic.classList.toggle('on', s.enabled);
    mic.disabled = !s.supported;
    mic.title = s.supported ? (s.enabled ? 'Mute the microphone' : 'Turn the microphone on') : 'Voice control needs Chrome, Edge or Safari';
    mic.setAttribute('aria-pressed', String(s.enabled));

    bar.classList.toggle('off', !s.enabled);
    bar.classList.toggle('live', s.listening);
    hint.textContent = s.armed
      ? 'Go ahead, I\u2019m listening…'
      : s.wakeWord
        ? 'Say \u201ctable\u201d then a command: \u201ctable, call\u201d, \u201ctable, raise to 50\u201d'
        : 'Say a command: \u201ccall\u201d, \u201craise to 50\u201d, \u201cfold\u201d';
    bar.classList.toggle('armed', s.armed);
    tag.textContent = s.listening && s.engineLabel ? s.engineLabel : '';
    heard.textContent = s.heard ? `“${s.heard}”` : '';
    msg.textContent = s.message;
    msg.className = `vmsg ${s.messageKind}`;

    if (!s.pending) {
      card.hidden = true;
      shownFor = 0;
      return;
    }
    card.hidden = false;
    if (shownFor === s.pending.expiresAt) return; // already built; keep the countdown running
    shownFor = s.pending.expiresAt;
    const d = s.pending.description;
    card.replaceChildren(
      h('p', { class: 'cc-q' }, 'Confirm?'),
      h('p', { class: 'cc-text' }, d.text),
      h('p', { class: 'cc-detail' }, d.detail ?? ''),
      h('p', { class: 'cc-say' }, 'Say ', h('b', null, 'yes'), ' or ', h('b', null, 'no')),
      h('div', { class: 'cc-btns' },
        h('button', { class: 'btn blue xl', type: 'button', onClick: () => voice.cancel() }, 'No'),
        h('button', { class: 'btn green xl', type: 'button', onClick: () => voice.confirm() }, 'Yes')),
      h('div', { class: 'cc-timer', style: { animationDuration: `${s.pending.ms}ms` } }),
    );
  }

  voice.subscribe(update);
  update();
  return { mic, bar };
}
