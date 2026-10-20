# Voice Poker Table

Voice-controlled chips-only poker table (pokerchips.com style). Real cards on the table; the app tracks stacks, blinds, bets, pots and turn order. Control by voice or buttons.

- Say the wake word, then a command: `table raise 50`, `table call`, `table fold`. The app shows a confirm card; answer `yes` or `no`.
- Offline speech (Vosk) or browser speech, auto-selected. Brave falls back to offline.
- No-Limit Hold'em rules in `docs/RULES.md` (side pots, short all-in, uncalled-bet refund, odd chip).
- State saved in IndexedDB + localStorage, so a refresh loses nothing.

## Run

```
npm install
npm run dev
npm test
```

Offline model lives at `public/models/vosk-model-small-en-us-0.15.tar.gz`.
