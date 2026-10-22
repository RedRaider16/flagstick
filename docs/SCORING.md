# Scoring rules — Phase 1

This document is the specification for `src/scoring/`. Every rule here is covered by
tests in `tests/scoring/`. If a rule changes, change this file, the code and the tests
together.

## Shared definitions

| Term | Meaning |
|---|---|
| **Entry** | The thing that appears on the leaderboard. In individual stroke play an entry is one player. In a two-person scramble an entry is one team. |
| **Hole score** | A whole number of strokes from **1 to 20** for one entry on one hole. Anything else is rejected before it is saved. |
| **Missing score** | A hole with no saved score. It is never treated as 0, as par, or as any other value. It simply does not count yet. |
| **Holes played** | The number of holes that have a saved score for the entry. |
| **Gross** | The sum of the entry's saved hole scores. It is the 18-hole total only once all 18 holes are scored. |
| **To par** | Gross minus the par of **the same holes that have scores**. A player who is 1 over through 5 holes shows `+1`, not `+1` plus the par of 13 unplayed holes. |
| **Complete** | All 18 holes have a saved score. |

Par and stroke index come from the tee assigned to the round. Phase 1 uses gross
scores only, so stroke index is stored and validated but does not affect results.

## Format 1 — Individual stroke play (gross)

- Each player is one entry and records one score per hole.
- Ranking uses **to par**, lowest first.
- Entries with no scores yet are listed below ranked entries without a position.

## Format 2 — Two-person scramble (gross)

- Each team of exactly two players is one entry. Teams with fewer or more than two
  players cannot be scored until fixed (the app blocks starting the round).
- Both players hit, the team picks the best shot, and both play from there. The team
  records **one score per hole**. Individual player scores are not recorded in this
  format and never appear on the scramble leaderboard.
- Ranking is identical to individual stroke play, applied to team scores.
- Players can be on only one team per event.

## Withdrawals (WD) and disqualifications (DQ)

- An administrator marks an entry WD or DQ (with an optional note).
- WD/DQ entries are listed after every other entry, have **no position**, and are shown
  as `WD` or `DQ`. Their saved scores are kept (nothing is deleted) and remain visible
  on the scorecard, but they are not ranked and cannot win.
- Reinstating an entry (setting it back to active) restores it to the ranking.
- Scores for a WD/DQ entry cannot be entered or changed by scorekeepers.

## Positions and ties

- Positions use standard competition ranking: two entries tied for 2nd are both `T2`
  and the next entry is `4`.
- During play, entries with the same to-par score are tied regardless of how many
  holes each has played. Display order inside a tie is: more holes played first, then
  name. That order is cosmetic; both still show the same position.

## Tie-breaking policy (chosen per event — there is no hidden default)

The administrator picks one of these when creating the event. It is shown on the
leaderboard.

### `share` — ties stand (default when the admin doesn't change it)
Tied entries share the position. Nothing else is applied. Use this when you will
decide ties another way (play-off, split prize money).

### `card_back` — matching scorecards
Based on the USGA Rules of Golf Committee Procedures, Section 5A(6). Applied **only
when every entry in the tied group has a complete 18-hole score** — otherwise the
whole group stays tied. For a single round, compare in this order and stop at the
first difference (lower wins):

1. Holes 10–18
2. Holes 13–18
3. Holes 16–18
4. Hole 18
5. Holes 4–9
6. Holes 7–9
7. Hole 9

The Committee Procedures recommend that "last nine", "last six" and so on mean holes
10–18, 13–18 and so on **even when players start on different tees**; this app follows
that recommendation for tee-time and shotgun starts alike. If entries are still tied
after step 7 they remain tied and the leaderboard says so — the app never flips a coin.

The leaderboard notes which comparison separated the entries (for example
"won on holes 10–18").

## Shotgun starts and "thru"

- Each group has a starting hole. Holes are played in rotation from that hole: a group
  starting on 7 plays 7…18, then 1…6.
- **Thru** shows how many holes the entry has scored. `F` means complete. An asterisk
  (`*`) marks entries that started on a hole other than 1.
- If a hole is skipped in the rotation (for example holes 7, 8, 10 are scored but 9 is
  not), the leaderboard flags the entry with "missing 9" so a scorekeeper can fix it.
  The missing hole still counts as missing, not as zero.

## Provisional vs final

- Results are **provisional** until the administrator finalizes the round. The
  leaderboard says "Provisional" in every view, including exports and print.
- Finalizing requires that every active entry is complete. Entries that are not
  complete must be finished, or marked WD/DQ, first. The app lists what is blocking.
- After finalizing, results are labelled **Final** and nobody can change scores. An
  administrator can reopen the round; the reopen is recorded with the admin's identity,
  time and reason.

## Corrections

- Every insert, change and deletion of a hole score is written to the score history
  with who made it, when, the old and new value, and a reason (required for
  administrator corrections after the round is locked).
- Deleting a score returns the hole to "missing"; it does not become 0.

## What Phase 1 deliberately does not do

- No net scoring, handicap allowances or course handicaps. Handicap Index values are
  not used anywhere in Phase 1 results. When net scoring is added, Handicap Index,
  Course Handicap and Playing Handicap will be stored and calculated separately and
  checked against current World Handicap System rules first.
- No claims of official handicap-system compliance or GHIN integration.
