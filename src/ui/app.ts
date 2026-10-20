import type { Session } from '../controller/session';
import type { VoiceController } from '../controller/voice';
import { legalActions, potSize } from '../engine/legal';
import { positionLabels } from '../engine/positions';
import type { Hand, HandPlayer, LastAction, Player, TableState } from '../engine/types';
import { createCaption } from './caption';
import { openAddPlayer, openSeatMenu } from './dialogs';
import { fmt, h, icon, toast } from './dom';
import { seatPositions, towardCentre } from './layout';
import { createShowdown, openDealer, openMenu, openRaiseSheet } from './modals';
import type { VoiceUI } from './voiceui';

const STREET_TITLE: Record<string, string> = {
  preflop: 'Preflop', flop: 'Flop', turn: 'Turn', river: 'River', showdown: 'Showdown', complete: 'Hand over',
};
const ACTION_LABEL: Record<LastAction, string> = {
  fold: 'Fold', check: 'Check', call: 'Call', bet: 'Bet', raise: 'Raise', allIn: 'All-in',
};

export function mountApp(root: HTMLElement, session: Session, voice: VoiceController, voiceUi: VoiceUI): void {
  const caption = createCaption();
  document.body.append(caption.el);
  const showdown = createShowdown(session);
  let seenLog = session.state.log.length;
  let seenStreet = session.state.hand?.street;
  let seenBoard = session.state.hand?.board ?? 0;
  let seenHand = session.state.hand?.number ?? 0;

  const send = (intent: Parameters<Session['dispatch']>[0]): void => {
    const err = session.dispatch(intent);
    if (err) toast(err);
  };

  function render(): void {
    const s = session.state;
    root.replaceChildren(topBar(s), voiceUi.bar, h('div', { class: 'stage' }, tableView(s)), bottomBar(s));
    showdown.sync(s);
    announce(s);
  }

  /** Bottom strip: the newest thing that happened, plus a nudge when cards should come out. */
  function announce(s: TableState): void {
    const hand = s.hand;
    if (s.log.length > seenLog) {
      let text = s.log[s.log.length - 1]!.text;
      if (hand && hand.number === seenHand && hand.street !== seenStreet) {
        if (hand.street === 'flop' || hand.street === 'turn' || hand.street === 'river') text += ` · Deal the ${hand.street}`;
        else if (hand.street === 'showdown' && hand.runout) text += ' · Deal the rest of the board';
      }
      caption.show(text);
    }
    seenLog = s.log.length;
    seenStreet = hand?.street;
    seenHand = hand?.number ?? 0;
    seenBoard = hand?.board ?? 0;
  }

  // ---------------------------------------------------------------- top bar

  function topBar(s: TableState): HTMLElement {
    const hand = s.hand;
    const title = hand ? STREET_TITLE[hand.street] ?? '' : s.handNumber === 0 ? 'New game' : 'Hand over';
    return h('header', { class: 'topbar' },
      h('button', { class: 'btn blue menu-btn', type: 'button', onClick: () => openMenu(session, voice) }, 'Menu ', icon('menu')),
      h('h1', { class: 'street' }, title),
      h('div', { class: 'top-right' },
        voiceUi.mic,
        h('div', { class: 'blinds' }, h('small', null, 'Blinds'), h('b', null, `${fmt(s.settings.bigBlind)}/${fmt(s.settings.smallBlind)}`))));
  }

  // ---------------------------------------------------------------- table

  function tableView(s: TableState): HTMLElement {
    const hand = s.hand;
    const seated = Object.values(s.players).sort((a, b) => a.seat - b.seat);
    const pos = seatPositions(seated.length);
    const labels = hand ? positionLabels(hand.players.length) : [];
    const labelOf = new Map<string, string>(hand ? hand.players.map((p, i) => [p.id, labels[i] ?? ''] as [string, string]) : []);
    const inPlay = !!hand && hand.street !== 'complete';

    const wrap = h('div', { class: 'table-wrap' }, h('div', { class: 'table' }, boardView(s), potView(s)));
    seated.forEach((p, i) => {
      const at = pos[i] ?? [50, 50];
      wrap.append(seatEl(s, p, hand, at, labelOf.get(p.id)));
      const hp = hand?.players.find((x) => x.id === p.id);
      if (inPlay && hp && hp.streetBet > 0 && hand!.street !== 'showdown') {
        const [bx, by] = towardCentre(at, 0.42);
        wrap.append(h('div', { class: 'bet', style: { left: `${bx}%`, top: `${by}%` } }, h('i', { class: 'chip' }, icon('spade', 'icon')), fmt(hp.streetBet)));
      }
    });
    return wrap;
  }

  /** Five slots: red face-up cards are open on the table, dark ones are still in the deck. */
  function boardView(s: TableState): HTMLElement {
    const open = s.hand?.board ?? 0;
    const fresh = open > seenBoard && s.hand?.number === seenHand;
    const slots = Array.from({ length: 5 }, (_, i) => {
      const up = i < open;
      const cls = ['card', up ? 'up' : 'down', up && fresh && i >= seenBoard ? 'deal' : '', !up && i === open && s.hand?.street !== 'complete' && s.hand ? 'next' : ''].filter(Boolean).join(' ');
      return h('span', { class: cls, 'aria-label': up ? 'Community card, face up' : 'Community card, not dealt' }, up ? icon('diamond') : null);
    });
    return h('div', { class: 'board', role: 'group', 'aria-label': `Community cards: ${open} open` }, ...slots);
  }

  function potView(s: TableState): HTMLElement {
    const hand = s.hand;
    if (!hand) {
      const ready = Object.values(s.players).filter((p) => p.stack > 0 && !p.sittingOut).length;
      return h('div', { class: 'pot idle' }, ready < 2 ? 'Add players to begin' : s.handNumber === 0 ? 'Ready. Press Start game' : 'Press Next hand');
    }
    const live = hand.street !== 'showdown' && hand.street !== 'complete';
    const amount = live ? potSize(hand) : hand.pots.reduce((a, p) => a + p.amount, 0);
    return h('div', { class: 'pot' }, hand.street === 'complete' ? 'Pot paid' : fmt(amount));
  }

  function seatEl(s: TableState, p: Player, hand: Hand | null, at: [number, number], label: string | undefined): HTMLElement {
    const hp: HandPlayer | undefined = hand?.players.find((x) => x.id === p.id);
    const inPlay = !!hand && hand.street !== 'complete';
    const acting = hand?.toActId === p.id;
    const won = hand?.street === 'complete' && hand.pots.some((pot) => pot.winners?.includes(p.id));

    let status = '';
    let kind = 'none';
    if (inPlay && hp?.lastAction) { status = ACTION_LABEL[hp.lastAction]; kind = hp.lastAction; }
    else if (inPlay && hand!.street === 'preflop' && hand!.sbId === p.id) { status = 'SB'; kind = 'blind'; }
    else if (inPlay && hand!.street === 'preflop' && hand!.bbId === p.id) { status = 'BB'; kind = 'blind'; }
    else if (won) { status = 'Won'; kind = 'won'; }
    else if (p.sittingOut) { status = 'Sitting out'; kind = 'out'; }
    else if (p.stack === 0 && !inPlay) { status = 'Busted'; kind = 'out'; }
    else if (p.waitingForBB && s.handNumber > 0) { status = 'Next BB'; kind = 'out'; }
    else if (inPlay && !hp) { status = 'Waiting'; kind = 'out'; }
    const dealer = hand ? hand.players[0]?.id === p.id : s.buttonSeat === p.seat;
    const hasCards = inPlay && !!hp && !hp.folded;
    const cls = ['seat', acting && 'acting', won && 'won', (inPlay && !hp) || p.sittingOut ? 'away' : ''].filter(Boolean).join(' ');

    return h('button', {
      class: cls, type: 'button', style: { left: `${at[0]}%`, top: `${at[1]}%` }, 'aria-current': acting ? 'true' : undefined,
      'aria-label': `${p.name}, ${fmt(p.stack)} chips${label ? `, ${label}` : ''}${status ? `, ${status}` : ''}${acting ? ', to act' : ''}. Open seat menu`,
      onClick: () => openSeatMenu(session, p.id),
    },
      hasCards ? h('span', { class: 'hole', 'aria-hidden': 'true' }, h('i'), h('i')) : null,
      dealer ? h('span', { class: 'dealer', title: 'Dealer' }, 'D') : null,
      h('span', { class: 'name' }, p.name),
      h('span', { class: 'amt' }, fmt(p.stack)),
      h('span', { class: `status s-${kind}` }, status),
    );
  }

  // ---------------------------------------------------------------- bottom

  function bottomBar(s: TableState): HTMLElement {
    const hand = s.hand;
    if (hand?.toActId) return actionBar(s);
    if (hand?.street === 'showdown') return h('section', { class: 'actions idle' });
    return idleBar(s);
  }

  function actionBar(s: TableState): HTMLElement {
    const l = legalActions(s)!;
    const name = s.players[l.playerId]?.name ?? '';
    const first = l.canCheck
      ? h('button', { class: 'round green', type: 'button', onClick: () => send({ kind: 'act', action: { type: 'check' } }) }, h('span', null, 'Check'))
      : h('button', { class: 'round gold', type: 'button', onClick: () => send({ kind: 'act', action: { type: 'call' } }) },
          h('span', null, l.toCall >= l.stack ? 'All-in' : 'Call'), h('em', { class: 'tag' }, fmt(l.toCall)));
    const wagerWord = l.isBet ? 'Bet' : 'Raise';
    const wager = h('button', {
      class: `round red${l.canRaise ? '' : ' off'}`, type: 'button', 'aria-disabled': l.canRaise ? undefined : 'true',
      title: l.notReopened ? 'The short all-in did not reopen betting: call or fold' : undefined,
      onClick: () => {
        if (!l.canRaise) return toast(l.notReopened ? 'The short all-in did not reopen betting. Call or fold.' : 'No chips left to raise with.');
        openRaiseSheet(session.state, (to) => send({ kind: 'act', action: { type: 'raise', to } }));
      },
    }, h('span', null, wagerWord));
    const fold = h('button', {
      class: `round blue${l.canCheck ? ' dim' : ''}`, type: 'button', 'aria-label': `Fold, ${name}`,
      onClick: () => {
        if (l.canCheck && !confirm('You can check for free. Fold anyway?')) return;
        send({ kind: 'act', action: { type: 'fold' } });
      },
    }, h('span', null, 'Fold'));
    return h('section', { class: 'actions', 'aria-label': `${name} to act` }, first, wager, fold);
  }

  function idleBar(s: TableState): HTMLElement {
    const ready = Object.values(s.players).filter((p) => p.stack > 0 && !p.sittingOut);
    const busted = Object.values(s.players).filter((p) => p.stack === 0);
    const firstFree = s.seats.findIndex((x) => x === null);
    const first = s.handNumber === 0;
    const msg = ready.length < 2
      ? 'Add at least two players with chips.'
      : busted.length ? 'Tap a busted player to rebuy or cash out.' : '';
    const start = h('button', {
      class: 'btn green xl', type: 'button', disabled: ready.length < 2,
      onClick: () => {
        if (!first) return send({ kind: 'startHand' });
        openDealer(session.state, (seat) => {
          send({ kind: 'startHand', buttonSeat: seat });
          const dealer = Object.values(session.state.players).find((p) => p.seat === seat);
          if (dealer) caption.show(`${dealer.name} is the dealer.`);
        });
      },
    }, first ? 'Start game' : 'Next hand');
    return h('section', { class: 'actions idle' },
      h('div', { class: 'idle-row' },
        first && firstFree >= 0 ? h('button', { class: 'btn blue xl', type: 'button', onClick: () => openAddPlayer(session, firstFree) }, 'Add player') : null,
        start),
      msg ? h('p', { class: 'hint' }, msg) : null);
  }

  session.subscribe(render);
  render();
}
