import type { Session } from '../controller/session';
import type { VoiceController } from '../controller/voice';
import type { EngineMode } from '../voice/autoEngine';
import { MAX_CHIPS, addPlayer, adjustStack, movePlayer, rebuy, removePlayer, renamePlayer, setSittingOut, updateSettings } from '../engine/seats';
import { handInProgress } from '../engine/seats';
import { field, fmt, h, openDialog, toast } from './dom';

const numInput = (value: number, min?: number, max?: number, step = 1) =>
  h('input', { type: 'number', inputMode: 'numeric', value: String(value), min: min === undefined ? undefined : String(min), max: max === undefined ? undefined : String(max), step: String(step) });

/** Run an admin op; show the engine's reason when it refuses. */
function run(session: Session, fn: Parameters<Session['admin']>[0], close?: () => void): void {
  const err = session.admin(fn);
  if (err) toast(err);
  else close?.();
}

export function openAddPlayer(session: Session, seat: number): void {
  const { settings } = session.state;
  const defaultBuyIn = Math.min(settings.maxBuyIn, Math.max(settings.minBuyIn, settings.bigBlind * 100));
  openDialog(`Seat ${seat + 1}: add player`, (close) => {
    const name = h('input', { type: 'text', autocomplete: 'off', placeholder: 'Name', maxLength: 20 });
    const buyIn = numInput(defaultBuyIn, settings.minBuyIn, settings.maxBuyIn);
    const chips = h('div', { class: 'chip-row' },
      ...[settings.minBuyIn, defaultBuyIn, settings.maxBuyIn]
        .filter((v, i, a) => a.indexOf(v) === i)
        .map((v) => h('button', { type: 'button', class: 'pill', onClick: () => (buyIn.value = String(v)) }, fmt(v))),
    );
    const submit = () => run(session, (s) => addPlayer(s, name.value, seat, Number(buyIn.value)), close);
    const form = h('form', { class: 'stack', onSubmit: (e: Event) => { e.preventDefault(); submit(); } },
      field('Name', name),
      field('Buy-in', buyIn, `Between ${fmt(settings.minBuyIn)} and ${fmt(settings.maxBuyIn)}`),
      chips,
      session.state.handNumber > 0 ? h('p', { class: 'hint' }, 'Joins the game when they reach the big blind.') : null,
      h('button', { class: 'btn primary', type: 'submit' }, 'Sit down'),
    );
    queueMicrotask(() => name.focus());
    return [form];
  });
}

export function openSeatMenu(session: Session, playerId: string): void {
  const p0 = session.state.players[playerId];
  if (!p0) return;
  openDialog(p0.name, (close) => {
    const s = session.state;
    const locked = handInProgress(s);
    const nodes: (Node | null)[] = [];

    const name = h('input', { type: 'text', value: p0.name, maxLength: 20 });
    nodes.push(
      h('form', { class: 'row', onSubmit: (e: Event) => { e.preventDefault(); run(session, (st) => renamePlayer(st, playerId, name.value), close); } },
        field('Name', name), h('button', { class: 'btn', type: 'submit' }, 'Rename')),
    );

    if (locked) {
      nodes.push(h('p', { class: 'hint' }, 'Seats and chips can change between hands. Finish this hand first.'));
      return nodes;
    }

    const top = numInput(0, 1);
    const room = Math.max(0, s.settings.maxBuyIn - p0.stack);
    nodes.push(
      h('form', { class: 'row', onSubmit: (e: Event) => { e.preventDefault(); run(session, (st) => rebuy(st, playerId, Number(top.value)), close); } },
        field(p0.stack === 0 ? 'Rebuy' : 'Add chips', top, `Stack ${fmt(p0.stack)}. Room for ${fmt(room)} more.`),
        h('button', { class: 'btn', type: 'submit' }, p0.stack === 0 ? 'Rebuy' : 'Add')),
    );

    const seatSel = h('select', null, ...s.seats.map((occ, i) =>
      h('option', { value: String(i), selected: i === p0.seat }, `Seat ${i + 1}${occ && occ !== playerId ? ` (swap with ${s.players[occ]?.name})` : occ ? ' (here)' : ''}`)));
    nodes.push(
      h('div', { class: 'row' }, field('Move to', seatSel),
        h('button', { class: 'btn', type: 'button', onClick: () => run(session, (st) => movePlayer(st, playerId, Number(seatSel.value)), close) }, 'Move')),
    );

    const fix = numInput(p0.stack, 0);
    const why = h('input', { type: 'text', placeholder: 'Reason (optional)' });
    nodes.push(
      h('details', null, h('summary', null, 'Fix a mistake'),
        h('div', { class: 'stack pad' }, field('Set stack to', fix), field('Reason', why),
          h('button', { class: 'btn', type: 'button', onClick: () => run(session, (st) => adjustStack(st, playerId, Number(fix.value), why.value), close) }, 'Apply correction'))),
    );

    nodes.push(
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn', type: 'button', onClick: () => run(session, (st) => setSittingOut(st, playerId, !p0.sittingOut), close) }, p0.sittingOut ? 'Sit back in' : 'Sit out'),
        h('button', { class: 'btn danger', type: 'button', onClick: () => {
          if (confirm(`Cash out ${p0.name} with ${fmt(p0.stack)} and remove from the table?`)) run(session, (st) => removePlayer(st, playerId), close);
        } }, 'Cash out and leave')),
    );
    return nodes;
  });
}

const LANGS: [string, string][] = [['en-US', 'English (US)'], ['en-IN', 'English (India)'], ['en-GB', 'English (UK)'], ['en-AU', 'English (Australia)'], ['en-CA', 'English (Canada)']];

export function openSettings(session: Session, voice: VoiceController): void {
  openDialog('Table settings', (close) => {
    const s = session.state.settings;
    const locked = handInProgress(session.state);
    const f = {
      smallBlind: numInput(s.smallBlind, 1), bigBlind: numInput(s.bigBlind, 1),
      minBuyIn: numInput(s.minBuyIn, 1, MAX_CHIPS), maxBuyIn: numInput(s.maxBuyIn, 1, MAX_CHIPS),
      maxSeats: numInput(s.maxSeats, 2, 10),
    };
    for (const el of Object.values(f)) el.disabled = locked;
    const save = () => run(session, (st) => updateSettings(st, {
      smallBlind: Number(f.smallBlind.value), bigBlind: Number(f.bigBlind.value),
      minBuyIn: Number(f.minBuyIn.value), maxBuyIn: Number(f.maxBuyIn.value), maxSeats: Number(f.maxSeats.value),
    }), close);

    const file = h('input', { type: 'file', accept: 'application/json', class: 'hidden' });
    file.addEventListener('change', async () => {
      const text = await file.files?.[0]?.text();
      if (!text) return;
      const err = session.importJson(text);
      if (err) toast(err);
      else { toast('Table loaded', 'info'); close(); }
    });

    const v = voice.snapshot();
    const lang = h('select', { 'aria-label': 'Speech language', onChange: () => voice.setLang(lang.value) },
      ...LANGS.map(([code, label]) => h('option', { value: code, selected: code === v.lang }, label)));
    const speak = h('input', { type: 'checkbox', checked: v.speakBack, onChange: () => voice.setSpeakBack(speak.checked) });
    const engineSel = h('select', { 'aria-label': 'Speech engine', onChange: () => voice.setEngineMode(engineSel.value as EngineMode) },
      h('option', { value: 'auto', selected: v.engineMode === 'auto' }, 'Automatic'),
      h('option', { value: 'online', selected: v.engineMode === 'online' }, 'Browser (needs internet)'),
      h('option', { value: 'offline', selected: v.engineMode === 'offline' }, 'Offline (works in Brave)'));
    const wake = h('input', { type: 'checkbox', checked: v.wakeWord, onChange: () => voice.setWakeWord(wake.checked) });

    return [
      locked ? h('p', { class: 'hint' }, 'Blinds, buy-ins and seats change between hands.') : null,
      h('form', { class: 'grid2', onSubmit: (e: Event) => { e.preventDefault(); save(); } },
        field('Small blind', f.smallBlind), field('Big blind', f.bigBlind),
        field('Min buy-in', f.minBuyIn), field('Max buy-in', f.maxBuyIn),
        field('Seats', f.maxSeats),
        h('button', { class: 'btn primary span2', type: 'submit', disabled: locked }, 'Save settings')),
      h('div', { class: 'stack' },
        h('h3', { class: 'sub' }, 'Voice'),
        field('Speech engine', engineSel, 'Automatic uses the browser, and switches to offline if the browser cannot reach its speech service.'),
        field('Speech language', lang, 'Pick the accent that matches how you speak.'),
        h('label', { class: 'check' }, wake, h('span', null, 'Only listen after I say "table"')),
        h('label', { class: 'check' }, speak, h('span', null, 'Read commands back out loud')),
        voice.supported ? null : h('p', { class: 'hint' }, 'This browser has no speech recognition. Use Chrome, Edge or Safari.')),
      h('p', { class: 'hint' }, 'Saved automatically in this browser (IndexedDB), so a refresh keeps the table. Export a copy to back it up.'),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn', type: 'button', onClick: () => {
          const url = URL.createObjectURL(new Blob([session.exportJson()], { type: 'application/json' }));
          const a = h('a', { href: url, download: 'poker-table.json' });
          a.click();
          URL.revokeObjectURL(url);
        } }, 'Export table'),
        h('button', { class: 'btn', type: 'button', onClick: () => file.click() }, 'Import table'),
        h('button', { class: 'btn danger', type: 'button', onClick: () => {
          if (confirm('Clear the whole table, all players and history?')) { session.reset(); close(); }
        } }, 'New table'),
        file),
    ];
  });
}

export function openLog(session: Session): void {
  openDialog('Hand log', () => {
    const entries = [...session.state.log].reverse();
    if (entries.length === 0) return [h('p', { class: 'hint' }, 'Nothing has happened yet.')];
    return [h('ol', { class: 'log' }, ...entries.map((e) =>
      h('li', null, h('time', null, new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })), h('span', null, e.text))))];
  });
}

export function openSettle(session: Session): void {
  openDialog('Settle up', () => {
    const s = session.state;
    const rows = [
      ...Object.values(s.players).map((p) => ({ name: p.name, bought: p.buyIns.reduce((a, b) => a + b, 0), out: p.stack, seated: true })),
      ...(s.cashOuts ?? []).map((c) => ({ name: c.name, bought: c.buyIns.reduce((a, b) => a + b, 0), out: c.cashOut, seated: false })),
    ];
    if (rows.length === 0) return [h('p', { class: 'hint' }, 'Nobody has sat down yet.')];
    const note = handInProgress(s) ? h('p', { class: 'hint' }, 'A hand is in progress. Stacks exclude chips in the pot.') : null;
    return [
      note,
      h('table', { class: 'settle' },
        h('thead', null, h('tr', null, h('th', null, 'Player'), h('th', null, 'Bought'), h('th', null, 'Has'), h('th', null, 'Net'))),
        h('tbody', null, ...rows.map((r) => {
          const net = r.out - r.bought;
          return h('tr', null,
            h('td', null, r.name, r.seated ? null : h('small', null, ' (left)')),
            h('td', null, fmt(r.bought)), h('td', null, fmt(r.out)),
            h('td', { class: net > 0 ? 'up' : net < 0 ? 'down' : '' }, `${net > 0 ? '+' : ''}${fmt(net)}`));
        }))),
    ];
  });
}
