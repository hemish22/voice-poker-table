import type { Intent } from '../controller/session';
import { legalActions } from '../engine/legal';
import type { TableState } from '../engine/types';

export interface Description {
  /** On-screen text, e.g. "Asha: RAISE TO 250". */
  text: string;
  /** Spoken sentence. */
  speech: string;
  /** Extra line for ambiguity, e.g. "adds 250". */
  detail?: string;
}

const name = (s: TableState, id: string) => s.players[id]?.name ?? 'Someone';
const potLabel = (i: number) => (i === 0 ? 'main pot' : `side pot ${i}`);

export function describeIntent(intent: Intent, s: TableState): Description {
  switch (intent.kind) {
    case 'undo':
      return { text: 'Undo the last change', speech: 'Undo the last change' };
    case 'startHand':
      return { text: `Deal hand ${s.handNumber + 1}`, speech: `Deal hand ${s.handNumber + 1}` };
    case 'award': {
      const pot = s.hand?.pots[intent.pot];
      const names = intent.winners.map((id) => name(s, id));
      const who = names.join(' and ');
      const verb = names.length > 1 ? 'Split' : 'Award';
      return {
        text: `${verb} ${potLabel(intent.pot)} (${pot?.amount ?? 0}) ${names.length > 1 ? 'between' : 'to'} ${who}`,
        speech: `${who} ${names.length > 1 ? 'split' : 'wins'} the ${potLabel(intent.pot)}`,
      };
    }
    case 'act': {
      const l = legalActions(s);
      const who = l ? name(s, l.playerId) : 'Player';
      const a = intent.action;
      switch (a.type) {
        case 'fold': return { text: `${who}: FOLD`, speech: `${who} folds` };
        case 'check': return { text: `${who}: CHECK`, speech: `${who} checks` };
        case 'call': return { text: `${who}: CALL ${l?.toCall ?? ''}`.trim(), speech: `${who} calls ${l?.toCall ?? ''}`.trim() };
        case 'allIn': return { text: `${who}: ALL-IN ${l?.maxTo ?? ''}`.trim(), speech: `${who} is all in for ${l?.maxTo ?? ''}`.trim() };
        case 'raise': {
          const adds = l ? a.to - l.mine : a.to;
          return l?.isBet
            ? { text: `${who}: BET ${a.to}`, speech: `${who} bets ${a.to}` }
            : { text: `${who}: RAISE TO ${a.to}`, detail: `adds ${adds} more`, speech: `${who} raises to ${a.to}` };
        }
      }
    }
  }
}
