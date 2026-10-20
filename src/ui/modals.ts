import type { Session } from '../controller/session';
import type { VoiceController } from '../controller/voice';
import { legalActions } from '../engine/legal';
import { handInProgress } from '../engine/seats';
import type { Hand, TableState } from '../engine/types';
import { openAddPlayer, openLog, openSeatMenu, openSettings, openSettle } from './dialogs';
import { fmt, h, icon, openDialog, openSheet, toast, type Sheet } from './dom';
import { seatPositions } from './layout';

const potTitle = (i: number) => (i === 0 ? 'Main pot' : `Side pot ${i}`);

// ---------------------------------------------------------------- bet / raise sheet

export function openRaiseSheet(s: TableState, onSubmit: (to: number) => void): void {
  const l = legalActions(s);
  const hand = s.hand;
  if (!l || !hand) return;
  const lo = Math.min(l.minTo, l.maxTo);
  const hi = l.maxTo;
  const owed = Math.max(0, hand.streetBet - l.mine);
  const word = l.isBet ? 'Bet' : 'Raise';
  const step = Math.max(1, s.settings.bigBlind);
  let amount = lo;
  let typing = false;

  openSheet((close) => {
    const clamp = (n: number) => Math.max(lo, Math.min(hi, Math.round(Number.isFinite(n) ? n : lo)));
    const frac = (f: number) => clamp(hand.streetBet + Math.round(f * (l.pot + owed)));

    const shown = h('div', { class: 'amt-shown', 'aria-live': 'polite' });
    const typed = h('input', { class: 'amt-typed', type: 'number', inputMode: 'numeric', min: String(lo), max: String(hi), 'aria-label': 'Amount' });
    typed.hidden = true;
    const slider = h('input', { class: 'amt-slider', type: 'range', min: String(lo), max: String(hi), step: '1', 'aria-label': 'Amount slider', disabled: lo === hi });
    const submit = h('button', { class: 'btn red wide', type: 'button' });
    const buttons = new Map<string, HTMLButtonElement>();

    const set = (n: number) => {
      amount = clamp(n);
      shown.textContent = fmt(amount);
      typed.value = String(amount);
      slider.value = String(amount);
      const pct = hi === lo ? 100 : ((amount - lo) / (hi - lo)) * 100;
      slider.style.setProperty('--fill', `${pct}%`);
      submit.textContent = amount >= hi ? `All-in ${fmt(hi)}` : word;
      buttons.get('minus')!.disabled = amount <= lo;
      buttons.get('plus')!.disabled = amount >= hi;
      buttons.get('min')!.disabled = amount === lo;
      buttons.get('max')!.disabled = amount === hi;
    };
    const mk = (key: string, label: string | Node, get: () => number) => {
      const b = h('button', { class: 'btn blue', type: 'button', onClick: () => set(get()) }, label);
      buttons.set(key, b);
      return b;
    };

    const kbd = h('button', { class: 'icon-btn kbd', type: 'button', 'aria-label': 'Type an amount', onClick: () => {
      typing = !typing;
      typed.hidden = !typing;
      shown.hidden = typing;
      if (typing) { typed.focus(); typed.select(); }
    } }, icon('keyboard'));
    typed.addEventListener('input', () => { amount = clamp(Number(typed.value)); slider.value = String(amount); slider.style.setProperty('--fill', `${hi === lo ? 100 : ((amount - lo) / (hi - lo)) * 100}%`); });
    typed.addEventListener('change', () => set(Number(typed.value)));
    slider.addEventListener('input', () => set(Number(slider.value)));
    submit.addEventListener('click', () => { close(); onSubmit(amount); });

    const grid = h('div', { class: 'raise-grid' },
      mk('minus', '−', () => amount - step), mk('plus', '+', () => amount + step),
      mk('min', 'Min', () => lo), mk('max', 'Max', () => hi),
      mk('third', '1/3', () => frac(1 / 3)), mk('half', '1/2', () => frac(1 / 2)),
      mk('three', '3/4', () => frac(3 / 4)), mk('pot', 'Pot', () => frac(1)));
    const nodes = [
      h('button', { class: 'icon-btn sheet-x', type: 'button', 'aria-label': 'Close', onClick: close }, icon('close')),
      h('div', { class: 'amt-box' }, kbd, shown, typed),
      slider, grid, submit,
    ];
    queueMicrotask(() => set(amount));
    return nodes;
  }, { className: 'raise' });
}

// ---------------------------------------------------------------- showdown

export function createShowdown(session: Session) {
  let sheet: Sheet | null = null;
  let handNo = -1;
  const picks = new Map<number, Set<string>>();

  function sync(s: TableState): void {
    const hand = s.hand;
    const active = !!hand && hand.street === 'showdown' && hand.pots.some((p) => !p.paid);
    if (!active) {
      sheet?.close();
      sheet = null;
      return;
    }
    if (hand.number !== handNo) {
      handNo = hand.number;
      picks.clear();
    }
    if (!sheet) sheet = openSheet(() => [], { className: 'showdown', dismissible: false, onClose: () => { sheet = null; } });
    render(s, hand);
  }

  function render(s: TableState, hand: Hand): void {
    const body = sheet!.body;
    const unpaid = hand.pots.map((p, i) => ({ p, i })).filter((x) => !x.p.paid);
    const ready = unpaid.every((x) => (picks.get(x.i)?.size ?? 0) > 0);
    const next = h('button', { class: 'btn green wide', type: 'button', disabled: !ready, onClick: () => {
      const awards = unpaid.map((x) => ({ kind: 'award' as const, pot: x.i, winners: [...(picks.get(x.i) ?? [])] }));
      const err = session.dispatchAll([...awards, { kind: 'startHand' }]);
      if (!err) return;
      if (err.startsWith('Need at least 2 players')) {
        const e2 = session.dispatchAll(awards);
        toast(e2 ?? err);
      } else toast(err);
    } }, 'Next hand');

    body.replaceChildren(
      h('div', { class: 'sd-head' },
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Undo last action', disabled: !session.canUndo, onClick: () => session.undo() }, icon('undo')),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Pot details', onClick: () => openPotInfo(s, hand) }, icon('info'))),
      h('h2', { class: 'sd-title' }, 'Showdown'),
      h('p', { class: 'sd-sub' }, 'Select pot winner(s)'),
      h('div', { class: 'sd-pots' }, ...hand.pots.map((pot, i) => {
        if (pot.paid) {
          return h('div', { class: 'sd-pot done' }, h('h3', null, `${potTitle(i)}: ${fmt(pot.amount)}`),
            h('p', null, `→ ${(pot.winners ?? []).map((id) => s.players[id]?.name).join(' & ')}`));
        }
        const chosen = picks.get(i) ?? new Set<string>();
        picks.set(i, chosen);
        return h('div', { class: 'sd-pot' }, h('h3', null, `${potTitle(i)}: ${fmt(pot.amount)}`),
          h('div', { class: 'choices' }, ...pot.eligible.map((id) => {
            const on = chosen.has(id);
            return h('button', { class: `choice${on ? ' on' : ''}`, type: 'button', 'aria-pressed': String(on), onClick: () => {
              if (on) chosen.delete(id); else chosen.add(id);
              render(s, hand);
            } }, on ? icon('check', 'icon tick') : null, s.players[id]?.name ?? id);
          })));
      })),
      next,
    );
  }

  return { sync };
}

function openPotInfo(s: TableState, hand: Hand): void {
  openDialog('Pots', () => {
    const rows = hand.pots.map((p, i) => h('p', null, h('b', null, `${potTitle(i)} ${fmt(p.amount)}`), `: ${p.eligible.map((id) => s.players[id]?.name).join(', ')} can win this pot.`));
    const refunds = Object.entries(hand.refunds).map(([id, n]) => h('p', null, `${s.players[id]?.name} got ${fmt(n)} back because nobody matched that part of the bet.`));
    return [
      ...rows,
      ...refunds,
      h('p', { class: 'hint' }, 'A side pot appears when someone is all-in for less than the others. Only players who put chips into a pot can win it. Pick several names to split a pot.'),
    ];
  });
}

// ---------------------------------------------------------------- dealer picker

export function openDealer(s: TableState, onPick: (seat: number) => void): void {
  const players = Object.values(s.players).filter((p) => p.stack > 0 && !p.sittingOut).sort((a, b) => a.seat - b.seat);
  openSheet((close) => {
    const pos = seatPositions(players.length);
    const pick = (seat: number) => { close(); onPick(seat); };
    return [
      h('h2', { class: 'sd-title' }, 'Dealer'),
      h('p', { class: 'sd-sub' }, 'Select initial dealer.'),
      h('div', { class: 'dealer-map' },
        h('div', { class: 'mini-table' }),
        ...players.map((p, i) => {
          const [x, y] = pos[i] ?? [50, 50];
          return h('button', { class: 'btn blue', type: 'button', style: { left: `${x}%`, top: `${y}%` }, onClick: () => pick(p.seat) }, p.name);
        })),
      h('button', { class: 'btn blue wide', type: 'button', onClick: () => pick(players[Math.floor(Math.random() * players.length)]!.seat) }, 'Randomize ', icon('dice')),
    ];
  }, { className: 'dealer' });
}

// ---------------------------------------------------------------- menu

export function openMenu(session: Session, voice: VoiceController): void {
  openDialog('Menu', (close) => {
    const s = session.state;
    const snap = voice.snapshot();
    const item = (label: string, fn: () => void, cls = 'blue', disabled = false) =>
      h('button', { class: `btn ${cls} wide`, type: 'button', disabled, onClick: () => { close(); fn(); } }, label);
    const firstFree = s.seats.findIndex((x) => x === null);
    return [
      h('div', { class: 'menu-list' },
        item('Resume', () => {}, 'green'),
        item('Undo last action', () => session.undo(), 'blue', !session.canUndo),
        item('Add player', () => openAddPlayer(session, firstFree), 'blue', handInProgress(s) || firstFree < 0),
        item('Players and seats', () => openPlayers(session), 'blue', Object.keys(s.players).length === 0),
        item('Hand log', () => openLog(session)),
        item('Settle up', () => openSettle(session)),
        item(snap.enabled ? 'Mute microphone' : 'Turn microphone on', () => voice.toggle(), 'blue', !snap.supported),
        item('Settings', () => openSettings(session, voice))),
    ];
  });
}

function openPlayers(session: Session): void {
  openDialog('Players', (close) => {
    const s = session.state;
    const list = Object.values(s.players).sort((a, b) => a.seat - b.seat);
    return [h('div', { class: 'menu-list' }, ...list.map((p) =>
      h('button', { class: 'btn blue wide row-btn', type: 'button', onClick: () => { close(); openSeatMenu(session, p.id); } },
        h('span', null, `${p.seat + 1}. ${p.name}`), h('span', { class: 'row-amt' }, fmt(p.stack)))))];
  });
}
