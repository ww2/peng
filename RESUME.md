# Resume — vacation section reorganization

Mid-flight checkpoint. The work plan lives in `PLAN.md`; this file captures
the conversation context the plan doesn't preserve so the work can pick up
on a different machine.

## Branch

`vacation` (off `main`). Recent landed commits: `9f01f24 updated NEXT goals`,
`04f81a5 handled timezone edge cases`, `66a322e checkpoint: RESUME and PLAN_HST`.
The current uncommitted work spans `index.html`, `lib/pension.js`,
`tests/pension.test.js`, plus `PLAN.md` (this file's sibling) and `RESUME.md`.

## Where we are

Stages 1–4 of `PLAN.md` are complete (Stage 3 was rolled into Stage 4 since
the wiring needed the rewritten chart to be testable). All 57 tests in
`tests/` pass. The vacation section is reorganized into its own block below
the pension chart with its own gate, button, auto-fire, and chart.

**Next up: Stage 4.5** — fix the year-end carry-over model in
`vacationPayoutAt` and rename the top curve from "max, no spending" to
"accrued, no spending". This was prompted by the user spotting that the
720-hr cap is a year-end carry-over limit, not a hard ceiling. PLAN.md's
Stage 4.5 has the full design with the user's confirmed answers (snap on
both curves; snap on already-separated `finalHours`; let chart auto-scale).
After 4.5, do Stage 5 cleanup + `CLAUDE.md` update.

## Saved feedback (process)

- **Pause after each stage** of `PLAN.md` and wait for user OK before
  starting the next.
- `PLAN.md` and `PREPLAN.md` are ephemeral — delete them when their stages
  land. (Don't delete `RESUME.md` — that's tracked separately.)

## Key design decisions (already in PLAN.md but worth re-stating)

- `lastDayEl` and `stillActiveEl` are **shared** between pension and
  vacation sections; vacation reads them, doesn't duplicate them.
- Vacation chart x-axis: linear time; `today → max(LDOS-month, today+24mo)`,
  stops exactly at LDOS when LDOS > today+24mo. Already-separated → no
  curves, two-line message.
- Curves use `d3.curveStepAfter` for monthly staircase.
- LDOS marker: dashed gray vertical line + "Last day of service" label
  (`CHART.colorMinor`).
- `vacHours = 0` is legitimate; gate uses `value !== ''` (not `> 0`).
- Two raises-NA checkboxes (`#raises-na`, `#vac-raises-na`) bidirectionally
  synced via `syncRaisesNaFrom` — programmatic `dispatchEvent('change')`
  with a recursion guard so each side's existing handlers fire.
- `applyRaisesNALock` mirrors the lock state to both checkboxes and calls
  `maybeCalculateVacation` after the lock change.

## Stage 4.5 implementation notes for whoever picks this up

The crux is in `lib/pension.js:vacationPayoutAt` (currently ~lines 457–479).
The existing math:

```js
const currentHours = Math.min(VACATION_CAP_HOURS, Math.max(0, vacHoursAsOf));
const monthsAccrued = Math.max(0, monthsBetween(vacAsOfDate, effDate));
const maxHours = Math.min(
  VACATION_CAP_HOURS,
  Math.max(0, vacHoursAsOf + accrualHrsPerMo * monthsAccrued)
);
```

…needs to be replaced by a per-month walk that applies the carry-over snap
at each Jan 1 in `(vacAsOfDate, effDate]`. Suggested shape:

```js
// Walk month-by-month from vacAsOfDate to effDate. For each step that
// crosses a Jan 1 boundary (next.year > cursor.year), snap balance to
// min(VACATION_CAP_HOURS, balance) BEFORE applying that month's accrual.
// "current" curve omits the accrual addition; "accrued" applies it.
function snapWalk({ startHours, startDate, endDate, accrual }) {
  let hours = startHours;
  let cursor = startDate;
  while (cursor < endDate) {
    const next = addMonths(cursor, 1);
    if (next.getFullYear() > cursor.getFullYear()) {
      hours = Math.min(VACATION_CAP_HOURS, hours);
    }
    hours += accrual;  // 0 for the current curve
    cursor = next;
    if (cursor > endDate) break;
  }
  return Math.max(0, hours);
}
```

Then `currentHours = snapWalk({...accrual: 0})` and `maxHours = snapWalk({...accrual: accrualHrsPerMo})`.

Edge case: when `vacAsOfDate == effDate` (retDate equals as-of), the loop
doesn't execute → returns `vacHoursAsOf` clamped to ≥ 0. Good — no snap
yet. Test #7 in current vacationPayoutAt suite ("retDate before asOf →
no negative accrual") should still pass; the `Math.max(0, ...)` covers it.

The label change in `index.html:drawVacationChart`:
- Search for `'vacation payout (max, no spending)'` and replace with
  `'vacation payout (accrued, no spending)'` (in `legendItems`).
- In the tooltip block, the segment with `(max)` becomes `(accrued)`.
- The internal CSS color constant `CHART.colorVacationMax` keeps its
  name — renaming it is out of scope for this stage.

Tests to add are listed in PLAN.md under Stage 4.5. Existing
`vacationPayoutAt` tests that assert the hard-720 cap will need to flip
expected values to reflect the new sawtooth.

## Stage 5 reminders

- Audit `CLAUDE.md` for stale phrases. Current `CLAUDE.md` has language
  like "The 720-hr cap applies everywhere (carry-over rule between calendar
  years), so both the as-of snapshot and the running accrual ramp are
  clamped to it." — that's now wrong post-4.5; rewrite to describe the
  Jan 1 snap.
- The "Vacation chart" subsection in `CLAUDE.md` currently describes the
  old shared-x-scale design with region shading. Replace with a description
  of the standalone chart (linear time scale, staircase curves, LDOS marker,
  separated-state text replacement).
- Document the `buildVacationSeries` function in "Where Things Live".
- Document the dual raises-NA checkbox sync (`syncRaisesNaFrom`).
- The `buildChartXScale` helper comment was already updated to note it's
  pension-chart-only.
- After Stage 5 lands and the user OKs, **delete `PLAN.md` and `RESUME.md`**
  per the saved project memory ("PLAN.md and PREPLAN.md are deleted when
  their stages land"). RESUME.md follows the same convention here.

## Verification commands

```sh
# All tests (currently 57 passing)
node --test tests/*.test.js

# Smoke test only (parses inline JS in index.html)
node --test tests/index-html.test.js

# Manual: open file:///path/to/index.html in a browser
# Manual URL test scenarios:
#   ?vacHours=400&vacAsOf=2025-01-01&vacHourlyRate=45         (vac only, active)
#   ?vacHours=0&vacAsOf=2025-01-01&vacHourlyRate=45           (vac=0 case)
#   ?vacHours=600&vacAsOf=2024-01-01&vacHourlyRate=45&lastDay=2024-06-15  (already separated)
#   ?vacHours=720&vacAsOf=2026-01-01&vacHourlyRate=45         (cap-hit case — useful for Stage 4.5 visual verification)
```
