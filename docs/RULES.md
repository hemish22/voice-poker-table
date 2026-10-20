# Rules spec — No-Limit Hold'em, chips only

Executable spec for the engine. Every rule has an ID; each worked example becomes a test (`engine/*.test.ts`).
App tracks chips only; cards are real, humans declare winners.

## Source status (honest)

| Tag | Meaning |
|---|---|
| **TDA13** | Verified by reading text of TDA Rules 2013 v1.1 (Aug 11 2013) booklet, rule numbers as in that edition. Newer edition (2024 v1.0) site was unreachable this session (connection refused); rule numbering differs, wording of betting rules believed stable. **Re-check against 2024 before release.** |
| **PYM** | Matches semantics documented in pymaverick betting-rules doc (independent engine). |
| **PTE** | Matches @pokertools/engine README example. |
| **CONV** | Universal convention (all major rulebooks), NOT yet read from a primary text this session. Must be cross-checked in Phase 0 gate against Robert's Rules of Poker or PokerKit tests. |
| **APP** | App-specific design choice, not a poker rule. |

## 1. Blinds and button

| ID | Rule | Source |
|---|---|---|
| B1 | Multi-way (3+): SB = first live seat left of button; BB = next live seat left of SB. | CONV, PYM |
| B2 | Heads-up (2): button posts SB, acts first preflop, acts last on every later street. Other player is BB, acts first postflop. | TDA13 R33, PYM |
| B3 | Button must be set so nobody is BB twice in a row when play goes heads-up. | TDA13 R33 |
| B4 | Blind posting short stack: posts what they have, is all-in. | CONV |
| B5 | Button advance policy: **OPEN DECISION D1** (dead button vs moving button). TDA13 R31 says dead button (tournament). | TDA13 R31 |

## 2. Action order

| ID | Rule | Source |
|---|---|---|
| A1 | Preflop first to act: first live seat left of BB (UTG). Heads-up: button/SB. | CONV, PYM |
| A2 | Postflop first to act: first live, non-folded, non-all-in seat left of button. Heads-up: BB. | CONV, PYM |
| A3 | Skip folded and all-in players. | CONV |
| A4 | Players must act in turn; only the player to act can act (app enforces; this is why voice needs no speaker ID). | TDA13 R37A, APP |

## 3. Legal actions (for the player to act)

Definitions: `streetBet` = highest total contributed on this street by anyone; `mine` = this player's contribution this street; `toCall = min(streetBet − mine, stack)`; `lastIncrement` = size of largest bet/raise this street (initial value = BB preflop, 0 postflop until first bet).

| ID | Rule | Source |
|---|---|---|
| L1 | **Fold**: always legal. (Folding when `toCall = 0` is legal but app warns/confirm: "you can check".) | TDA13 R50 |
| L2 | **Check**: only if `streetBet == mine`. | CONV |
| L3 | **Call**: only if `streetBet > mine`; pays `toCall`. If `toCall ≥ stack` → all-in for less (stack). | CONV |
| L4 | **Bet** (opening bet on a street, `streetBet == 0`): amount ≥ BB, ≤ stack. Smaller only if all-in. | CONV, PYM |
| L5 | **Raise** (to total `T`): `T ≥ streetBet + lastIncrement`, `T − mine ≤ stack`. Raise-to semantics. Preflop BB counts as the opening bet (`streetBet = BB`, `lastIncrement = BB`). | TDA13 R41A, PYM |
| L6 | **All-in**: always legal; amount = whole stack. If it exceeds min raise it is a full raise; if it exceeds `streetBet` by less than `lastIncrement` it is a **short all-in** (see R). If ≤ `streetBet` it is a call for less. | TDA13 R41B |
| L7 | A raise below min raise that is not all-in is **rejected** (app does not apply TDA's "50% rule" auto-rounding; user simply gets "min raise is N"). | APP (TDA13 R41A allows 50% rounding at TD discretion) |
| L8 | No cap on number of raises in NL. | TDA13 R45 |
| L9 | Player with 0 chips behind (all-in) takes no more actions. | CONV |

## 4. Raise sizing and reopening

| ID | Rule | Source |
|---|---|---|
| R1 | Min raise increment = largest previous bet or raise increment on the current street. | TDA13 R41A, PYM |
| R2 | A **full raise** (increment ≥ `lastIncrement`) sets new `lastIncrement` and **reopens** action: everyone who already acted may raise again. | TDA13 R41B, PYM |
| R3 | A **short all-in** (raises the bet by less than a full raise) does NOT change `lastIncrement` and does NOT reopen betting to players who already acted and are not facing at least a full raise. They may only fold or call the extra amount. Players who have not yet acted this round still may raise. | TDA13 R41B, PYM |
| R4 | After a short all-in, the min raise-to for anyone allowed to raise = new `streetBet` + existing `lastIncrement`. | TDA13 R41A |
| R5 | Multiple short all-ins that cumulatively add ≥ one full increment **do not** by themselves reopen unless the last raise-of-record faced by a player constitutes ≥ a full raise relative to that player's last action. Implementation: per player, track `facedRaiseSinceLastAction = streetBet_now − streetBet_at_my_last_action`; I may raise only if that ≥ `lastIncrement`, or I have not acted yet. | TDA13 R41B ("not facing at least a full raise"); verify with TDA 2024 illustration addendum |

## 5. Round and street completion

| ID | Rule | Source |
|---|---|---|
| S1 | Betting round ends when every non-folded, non-all-in player has acted since the last full raise and has `mine == streetBet`. | CONV, PYM |
| S2 | **BB option**: preflop, if no one raised, BB still gets to act (check or raise) before round ends. | CONV |
| S3 | Only one non-folded player left → hand ends immediately, they win all pots; no showdown. | CONV |
| S4 | If after betting closes ≤ 1 player has chips behind (all others all-in / folded), no more betting rounds; remaining streets are dealt without action → showdown. | CONV |
| S5 | Streets: preflop → flop → turn → river → showdown. App advances street when round closes; humans deal real cards. | CONV |

## 6. Pots

| ID | Rule | Source |
|---|---|---|
| P1 | Pots are built in layers from per-player total contributions: sort distinct all-in levels; layer = (level − previous level) × (number of contributors with at least that level). | CONV, PTE |
| P2 | Folded players' chips stay in the layers they reached ("dead money") but folded players are not eligible to win any pot. | CONV |
| P3 | **Uncalled bet** returned: the part of the highest contribution that no one matched goes back to that player before pots are formed. | PTE |
| P4 | Each side pot is awarded separately; winner can differ per pot. | TDA13 R20 |
| P5 | Split pot: divide evenly in smallest chip unit; odd chip(s) go to first winner seat left of the button (clockwise). Smallest unit = table setting (default 1). | TDA13 R19 |
| P6 | Winner declaration: humans pick winner(s) per pot among eligible players. | APP |

## 7. Table / seat / buy-in rules (home-game policy, not TDA)

| ID | Rule | Source |
|---|---|---|
| T1 | Seats, names, buy-ins, rebuys, sit-outs, removals only change **between hands**. Name edit allowed any time. | APP |
| T2 | Buy-in within table min/max. Rebuy/top-up allowed only between hands. TDA13 R26 (tournament rebuy) not applicable. | APP |
| T3 | Player joining mid-session plays from next hand; first hand policy: waits for BB (no missed-blind debt in v1). | APP, **OPEN D2** |
| T4 | Player with 0 chips after a hand is marked busted; may rebuy or is removed. | APP |
| T5 | Need ≥ 2 players with chips to deal. | CONV |
| T6 | Host stack/pot corrections allowed between hands, always logged. | APP |

## 8. Voice-specific rules

| ID | Rule | Source |
|---|---|---|
| V1 | Spoken declaration is only a **proposal**. Nothing changes until user says **confirm** or taps Confirm. **cancel** discards. (Deliberate departure from TDA13 R37A where verbal declarations in turn are binding.) | APP |
| V2 | Bare "raise N" is ambiguous (TDA13 R49: ambiguous amounts → lesser value). App interprets as **raise to N** and always shows both: "RAISE TO N (adds M)". "raise by N" explicit. **OPEN D3.** | TDA13 R49, APP |
| V3 | "bet the pot" is not valid NL declaration per TDA13 R47, but app knows the pot exactly, so "pot" shortcut is offered as convenience; confirm box shows resulting number. Pot-size raise = call + (pot after call). | TDA13 R47, APP |
| V4 | Unclear/illegal command → no confirm box; show reason ("can't check, 20 to call"). | APP |
| V5 | Confirm box auto-cancels after timeout (default 8 s). While open, only confirm/cancel recognised. | APP |

## 9. Worked examples (become tests)

All use blinds 5/10 unless stated. `X→n` = raise to n.

**E1 Heads-up order (B2, A1, A2).** A=button/SB, B=BB. Preflop: A acts first. Flop/turn/river: B acts first.

**E2 3-handed order (B1, A1).** Seats A(btn), B(SB), C(BB). Preflop first act: A. Postflop first act: B.

**E3 Min raise chain (R1, L5).** Preflop 4 players, UTG raises to 30 (increment 20). Next min raise-to = 50. Then raise to 50 → next min = 70.

**E4 Opening bet min (L4).** Flop, no bet: bet 5 rejected (min 10); bet 10 ok; raise-to min = 20.

**E5 Short all-in does not reopen (R3, TDA13 R41B).** Flop, `lastIncrement` 0. A bets 100. B (stack 150) all-in to 150 (increment 50 < 100): short. C (not yet acted) may fold/call 150/raise to ≥ 250. If C only calls 150: action returns to A, who is facing 50 more, not a full raise → A may only fold or call 50 (raise rejected, "betting not reopened").

**E6 Full raise reopens (R2).** Same as E5 but B has 300: B all-in to 300 (increment 200 ≥ 100) → full raise; A may re-raise; min raise-to = 500.

**E7 Short all-in then full raise reopens (R5).** E5, then C raises to 250 (increment 100 ≥ lastIncrement 100 → full raise relative to 150). A faces 150 more than they put → may raise.

**E8 Side pots (P1, P3; PTE).** Stacks A=100, B=300, C=500, all-in preflop. Main = 300 (A,B,C eligible), side = 400 (B,C), uncalled 200 returned to C.

**E9 Dead money (P2).** A all-in 40; B calls 40; SB(5) and BB(10) folded. Main pot = 40+40+5+10 = 95, eligible A,B.

**E10 Uncalled heads-up (P3).** A bets 100, B (stack 60) calls all-in. Pot = 120; A gets 40 back.

**E11 BB option (S2).** 3 players limp to BB. BB may check (street ends) or raise (action reopens for limpers).

**E12 Run-out (S4).** Preflop A and B all-in, C folds. No betting on flop/turn/river; humans then pick winner.

**E13 Fold wins (S3).** Everyone folds to BB: BB takes the pot (SB's 5 + own 10 = 15), no showdown, no BB option needed.

**E14 Odd chip (P5).** Pot 101 split between B and D, button on A, seat order A,B,C,D. B is first left of button → B gets 51, D gets 50.

**E15 Per-pot winners (P4).** E8 pots: A wins main (300), C wins side (400) + 200 refund = 600. Chip total conserved = 900.

**E16 Voice raise ambiguity (V2).** "raise fifty" with streetBet 20, mine 0 → proposal RAISE TO 50 (adds 50). "raise by fifty" → RAISE TO 70.

**E17 Illegal check (L2/V4).** Facing a bet of 20, "check" → rejected with "20 to call".

**E18 Chip conservation (property test).** After any sequence of legal actions and awards: sum(stacks) + sum(pots) + sum(live street bets) = constant.

## 10. Decisions (RESOLVED — user chose "go with recommendations")

- **D1** Moving button (a). **D2** Joiner waits for BB. **D3** Bare "raise N" = raise to N, confirm box shows both. **D4** No ante/straddle/run-twice/rake in v1. **D5** Integer chips, unit 1.

Original options kept below for reference.

- **D1 Button policy**: (a) *moving button*: button always lands on a live player; simple, a player can occasionally skip or double a blind; (b) *dead button* (TDA13 R31): button position fixed by seat rotation, SB may be unposted, nobody skips BB. Recommendation: **(a) moving button** for a home table — fewer surprises. Confirm.
- **D2 Join mid-session**: wait for BB (recommended) vs post immediately.
- **D3 Bare "raise N"**: raise-to N (recommended, shown clearly in confirm box) vs force user to say "raise to".
- **D4 Ante / straddle / run-it-twice / rake / bomb pots**: out of v1 (recommended) — confirm.
- **D5 Chip unit**: integer chips, smallest unit 1 (recommended) vs allow decimals/cents.

## 11. Phase 0 gate checklist

- [x] User signs off D1-D5 (all recommendations).
- [x] Engine implements E1-E18 (`src/engine/engine.test.ts`, 23 tests incl. 300-game chip-conservation fuzz).
- [x] Differential test vs independent `@pokertools/engine` v2.1.0 (`src/engine/crosscheck.test.ts`): 3643 random, partly illegal actions across 400 tables of 2-6 players. 0 divergences on accept/reject, who acts next, and every stack. Covers raise minimums, short all-in reopening, blind posting, heads-up order, uncalled returns, run-outs.
- [ ] NOT yet done: re-read TDA **2024** text (site unreachable; verified against 2013 v1.1 booklet only). Re-check R19/20/31/33/37/41 equivalents before release.
- [ ] NOT yet done: side-pot *amounts* at showdown compared to reference on random hands (only E8 / README example matched). Reference auto-resolves showdown with random cards, so needs a harness that reads `state.pots` before resolution.
- [ ] NOT covered by any reference: seat/buy-in/waiting-for-BB policy (APP rules T1-T6), voice rules V1-V5.
