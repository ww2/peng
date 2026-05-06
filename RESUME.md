# Resume state — raises projection refactor (post Stage 4)

**Branch:** `preraise`. The full plan, stage criteria, and substage
breakdowns live in `PLAN.md`. **Read it first.**

## Where we are

| Stage | Title | Status |
|------|-------|--------|
| 1 | Delete the `nonreg-afc` field | Complete |
| 1.5 | Extract pure logic to `lib/pension.js` | Complete |
| 2 | Build per-month earnings stream from paystubs | Complete (with trailing-incomplete-month truncation; see Stage 4.5) |
| 3 | Implement windowing AFC projector | Complete (amended in Stage 4.5 to drop `currentMonth` and derive boundary from stream) |
| 4 | Wire projector into `calculateSeries` | Complete (4.1–4.5; smoke-tested all 3 scenarios) |
| 5 | Un-suppress raise curves for paystub path | **Not Started** — substages 5.1–5.4 spec'd in PLAN.md |
| 6 | Update DESIGN.md and CLAUDE.md | Not Started |

## Test suite

`node --test tests/pension.test.js` from repo root → 22 cases passing
across `buildPaystubStream`, `projectAfcAtRetirement`, and
`calculateSeries: paystubStream wiring` suites. The suite file:
`tests/pension.test.js`.

## Notable decisions made during Stage 4

1. **Top-N non-overlapping windows** (matches official ERS rule and existing
   `solveDP`), not the linear-blend heuristic of `applyRaises`. Closed-form
   match between projector and `applyRaises` only holds at saturation
   (`retDate ≥ last raise + N×12 months`).
2. **`buildPaystubStream` truncates trailing months** that aren't anchored
   by a stub whose `endDate` is the last day of its calendar month. Mirrors
   `generateWindows`'s `lastAnchorEnd` logic. Without this, a half-month
   most-recent stub gives a depressed `base` that suppresses raise curves.
3. **Past/future boundary is `stream[last].month + 1`**, not "next month
   from today". This keeps `all` calendar-contiguous in the projector so
   the array-index DP correctly enforces 12 consecutive calendar months.
4. **Future NR is always 0.** Regular pay grows by raises; total-mode
   plans see future months at base × multipliers (no overtime/diff).
5. **`raisesActive` gate widened** at `lib/pension.js:496-501` to require
   `anyRaiseInHorizon` — without that, a fresh `base` higher than the past
   5-year average could cause the gate to fire even when no raise actually
   lands inside the projection cap. Caught during Scenario 3 smoke.

## Pre-existing issues to be cleaned up in Stage 5

1. **Stale raises table at `index.html:459-463`** — hardcodes a
   `2025-07-01 @ 3.50%` row that doesn't exist in the module's `RAISES`.
   Stage 5.3 generates the table from data instead.
2. **Layered suppression at `:447-451`** — three mechanisms (HTML
   `hidden`, `<!-- Temporarily suppressed -->` comment, `showRaises = false`
   in two JS sites). Stage 5.1 + 5.2 strip all three.

## Stage 5 starting point

When ready to implement, begin with **Stage 5.1** (`PLAN.md` for spec):
derive `showRaises = paystubStream != null && !raisesNA` in
`runCalculate` (`index.html:1410-1418`); pass it through to `drawChart`
and `drawSeriesTable`; remove the `const showRaises = false;` lines at
`:1416` and `:1879`. No new Node tests — Stage 5 is purely UI wiring.

After 5.1, browser-smoke that the chart still renders identically (the
fieldset is still HTML-`hidden` so no purple curves yet — that comes in
5.2). Then 5.2, 5.3, 5.4 in order.

## Files of interest

- `PLAN.md` — full plan with stage and substage criteria
- `lib/pension.js` — pure logic (737+ lines, 33 exports including
  `projectAfcAtRetirement`)
- `index.html` — UI; key sites for Stage 5: `:447-451` (fieldset),
  `:457-464` (raises table), `:1410-1418` (showRaises wiring),
  `:1877-1879` (drawChart entry), `:1327-1339` (drawSeriesTable)
- `tests/pension.test.js` — 22 cases; run with `node --test`
- `info/DESIGN.md` lines 162–186 — the canonical statement of the raises
  suppression. Stage 6 will update this.
- `notes.md` — sample URL for browser smoke testing (untracked, do not
  commit)

## To resume on another machine

1. Push current branch — there are uncommitted changes in the working tree
   right now. Commit them and push before switching.
2. On the new machine: clone, `git checkout preraise`, pull.
3. `node --test tests/pension.test.js` → expect 22 passing.
4. Read this file, then `PLAN.md`. Stage 5 is fully spec'd.
5. Optional sanity smoke before starting: open `index.html` with a
   paystub-driven URL and confirm `_debug.lastSeries.filter(r =>
   r.pensionWithRaises != null).length > 0` for hybrid plans.
6. Implement Stage 5.1.
