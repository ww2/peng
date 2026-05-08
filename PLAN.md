# Vacation section reorganization

Move all vacation UI (inputs, button, chart, tooltip) into its own section
below the pension chart so the two systems chart and gate independently.

## Confirmed design

- **Inputs the vacation section reads from the pension form** (shared, not
  duplicated): `lastDayEl`, `stillActiveEl`. All other vacation behavior
  is independent of pension fields — no plan/dob/AFC dependency.
- **Vacation chart x-axis**: plain linear time scale, no compression, no
  vested/eligible region shading.
  - Active (no LDOS): `today → today+2y`.
  - Future LDOS ≤ today+2y: `today → today+2y` (LDOS marker falls inside).
  - Future LDOS > today+2y: `today → LDOS` (stops exactly at LDOS).
  - Already separated (LDOS < today): no curves; replace with text:
    ```
    Already separated on Jun 15 2024.
    Vacation payout: $32,400 (720 hours × $45.00/hr).
    ```
- **Curve style**: `d3.curveStepAfter` — flat horizontal segment per
  calendar month, vertical step at month boundaries.
- **LDOS marker** (when LDOS is in horizon): dashed vertical gray line at
  the LDOS x-position with a small "Last day of service" label.
- **Auto-fire gate** (independent from pension): `vacAsOf` set AND
  `vacHourlyRate > 0` AND `vacHours` has a value (≥ 0; `0` is legitimate)
  AND (`stillActive` OR `lastDay` set).
- **Raises override**: pension and vacation each get their own
  "Projected raises do not apply" checkbox; the two are kept
  bidirectionally in sync (toggling one toggles the other).
  The vacation override visibility is independent of the pension
  contractual fieldset.
- **Pension chart cleanup**: remove vacation fields entirely from
  `calculateSeries` rows and from the pension estimation table — vacation
  becomes a separate series builder.
- **Page layout** (top → bottom):
  1. Pension fieldsets (required / optional with **only** sick leave
     left / contractual / earnings) — unchanged
  2. Pension Generate-graph + Clear buttons — unchanged
  3. Pension chart (`#chart-svg`) + estimation table — unchanged
  4. Pension legend — unchanged (the legend is inside `#chart-svg`)
  5. **NEW** Vacation inputs fieldset (`vacHours`, `vacAsOf`, `vacRate`,
     `vacHourlyRate`, vacation-side raises-override checkbox)
  6. **NEW** Generate-vacation-graph button
  7. Vacation chart (`#vac-chart-svg` — relocated)

---

## Stage 1: Extract vacation series into a dedicated builder
Goal: Add `buildVacationSeries({ vacHours, vacAsOf, vacRate, vacHourlyRate, lastDayOfSvc, raisesNA })` to `lib/pension.js`. Drop `vacationCurrentPayout`/`vacationMaxPayout` from `calculateSeries` rows and from `drawSeriesTable`'s `hasVac` column set. Pension stays a pure-pension calculation.
| Success: `calculateSeries` no longer touches vacation. The new builder returns rows `{ retDate, currentPayout, maxPayout }` honoring the time-horizon rules (today → max(LDOS, today+2y), capped exactly at future LDOS, monthly granularity). Already-separated case returns `{ separatedOn, finalHours, finalRate, finalPayout }` instead of rows. `vacationPayoutAt` stays unchanged and still backs the new builder.
| Tests: Update `tests/pension.test.js` — drop the calc-series vacation row assertions; add `buildVacationSeries` cases: still-active full horizon, future-LDOS-near (< 2y), future-LDOS-far (> 2y, stops at LDOS), already-separated short-circuit, raises-applied vs `raisesNA: true`. Existing `vacationPayoutAt` tests untouched.
| Status: Complete

## Stage 2: Restructure HTML — move vacation inputs into their own section
Goal: HTML/CSS only. Remove the vacation row from `#group-optional-input` (sick leave row stays). Add a new `#group-vacation-input` fieldset placed below the pension chart's container (`#chart-svg`) and the existing series-details. Add `#vac-graph-btn` button row below the new fieldset. Relocate `#vac-chart-svg` to sit below the button. Add a second `#vac-raises-na` checkbox inside the vacation fieldset (or a small adjacent row) with a stable label matching the pension one.
| Success: Page renders with pension content unchanged on top; vacation inputs, vacation Generate button, and vacation chart all live in a contiguous section below. The smoke test (`tests/index-html.test.js`) still passes — script blocks parse cleanly. No JS behavior changes yet — old draw paths still draw, but they're now wired to elements in the new locations.
| Tests: `node --test tests/*.test.js` (smoke test green). Manual visual check of element ordering.
| Status: Complete

## Stage 3: Wire the vacation gate, button, and auto-fire
Goal: Implement `canCalculateVacation()` and `runVacationCalculate()`. Inputs that drive vacation auto-fire: `vacHoursEl`, `vacAsOfEl`, `vacRateEl`, `vacHourlyRateEl`, `lastDayEl`, `stillActiveEl`, plus either raises-na checkbox. Vacation button disabled when gate is false. Drop vacation gating from pension's `canCalculate()` (so pension auto-fires even when vacation is partially filled). Bidirectional sync between `#raises-na` and `#vac-raises-na`. Update `runClear()` to clear vacation fields and the new checkbox, and to hide/clear the vacation chart.
| Success: Pension and vacation chart independently. URL params with all-pension fields fire pension only; URL params with all-vacation fields fire vacation only; URL with both fires both. `vacHours=0` in URL produces a (flat) vacation chart. Both raises checkboxes track each other. Existing pension auto-fire behavior unchanged.
| Tests: Smoke test passes. Manual: four URL-param scenarios (pension-only / vacation-only / both / neither). Manual: toggle each raises checkbox, observe the other follows. Manual: hit Clear, confirm vacation fields and chart reset.
| Status: Complete (rolled into Stage 4 since the wiring needed the rewritten chart to be testable)

## Stage 4: Rewrite `drawVacationChart` for the standalone layout
Goal: Replace the shared-x-scale/compressed/eligibility-zoned chart with a plain linear time scale per the confirmed design. Use `d3.curveStepAfter`. Compute time horizon from `lastDayOfSvc`/`stillActive`. Draw the LDOS dashed marker + label when in horizon. When `lastDayOfSvc < today`, suppress curves and render the two-line text instead. Keep the existing tooltip mechanic (centered top label, two crosshair dots) but adapt it to the staircase curves; tooltip is suppressed in the already-separated state. Drop region shading and break indicators — they're meaningless on a linear time axis.
| Success: Chart renders cleanly as a monthly staircase from today. LDOS marker is visible and correctly placed when applicable. Already-separated mode shows the two-line text and no curves. Tooltip works on the staircase. Visual stacking with the pension chart no longer relies on x-scale alignment.
| Tests: Smoke test passes. Manual visual checks across all four LDOS states (no LDOS / future ≤ 2y / future > 2y / already separated). Confirm staircase rendering at month granularity.
| Status: Complete

## Stage 4.5: Fix the year-end carry-over model

Domain correction: the 720-hr `VACATION_CAP_HOURS` constant is the **carry-over** limit (Dec 31 → Jan 1 forfeiture), **not** a hard ceiling. Mid-year, balance can grow above 720; at each Jan 1 transition within the projection window, the balance snaps back to `min(720, current)`. The theoretical peak is `720 + accrualHrsPerMo × 12` (= 888 at the standard 14/mo) on Dec 31 of any year past the cap.

User-confirmed answers to the three open questions:
1. **Bottom curve ("current")** — apply the year-end snap. If `vacHoursAsOf > 720` and retDate crosses a Jan 1, the snapshot drops to 720 at that boundary.
2. **Already-separated `finalHours`** — apply the year-end snap if LDOS is in a year after `vacAsOfDate` (i.e., a Jan 1 fell between `vacAsOfDate` and LDOS).
3. **Y-axis** — let the chart auto-scale; the existing `yMax = ceil(max / 1000) * 1000` already does the right thing once the curves rise above 720 × rate.

Curve label change: top curve "vacation payout (max, no spending)" → "vacation payout (accrued, no spending)". The `colorVacationMax` color name stays (renaming the constant is out of scope; the label change is purely the legend text).

Goal: Replace the constant-720 cap inside `vacationPayoutAt` with a year-end-snap model that walks calendar months and applies the snap at each Jan 1 transition in `(vacAsOfDate, effDate]`. Apply identically to both the `currentPayout` (no accrual added; only year-end snaps applied to the running balance — the snapshot holds steady within a year then drops at the Jan 1 boundary if currently above 720) and the `maxPayout` (accrual added each month plus year-end snaps). `buildVacationSeries`'s already-separated short-circuit picks up the new `finalHours` automatically since it calls `vacationPayoutAt`.

| Files to touch:
| - `lib/pension.js`: rewrite the cap math in `vacationPayoutAt`. Add a small helper that walks months and applies snaps. The `monthsAccrued` calculation goes away — it gets replaced by an explicit walk.
| - `index.html`: change the `legendItems` label string in `drawVacationChart` ("(max, no spending)" → "(accrued, no spending)") and the matching tooltip label segment ("(max)" → "(accrued)"). Two-line separated message format unchanged (it just reads `finalHours` and `finalPayout`).
| - `tests/pension.test.js`: rewrite the `vacationPayoutAt` tests that asserted the hard-720 cap. Add new cases:
|   1. Balance starts at 720 on Jan 1, accrues for 12 months → maxHours = 888 on Dec 31 of same year.
|   2. Balance starts at 720, retDate is Jan 1 of next year → maxHours snaps back to 720.
|   3. `vacHoursAsOf` = 800 (mid-year), retDate before next Jan 1 → currentHours = 800 (no snap yet).
|   4. `vacHoursAsOf` = 800, retDate after next Jan 1 → currentHours = 720 (snap applied).
|   5. Multi-year sawtooth: walk 30 months from Jan 1 with vacHoursAsOf=720, accrual=14 — verify the year-end snap fires at each Jan 1 in between.
|   6. `buildVacationSeries` already-separated test: confirm `finalHours` reflects the snap when LDOS is in a year after vacAsOfDate.

| Success: `vacationPayoutAt` produces sawtooth-correct values. Both vacation curves on the chart show the in-year ramp and the Jan 1 drop. Y-axis auto-scales to fit the new (taller) max. Top legend reads "vacation payout (accrued, no spending)". All tests green.
| Status: Not Started

## Stage 5: Cleanup + CLAUDE.md update
Goal: Remove now-dead code (vacation reads inside `runCalculate`, vacation columns from `drawSeriesTable`, the `hasVac` parameter, any `colorVacation*` references in pension-chart code). Audit URL pre-fill: vacation params should pre-populate the new fields and trigger vacation auto-fire only. Update `CLAUDE.md` "Where Things Live", "Form Structure", and "Vacation chart" sections to describe the new layout, the new builder function, the dual raises-checkbox sync, and the year-end-snap model. Remove obsolete details (e.g., "vacation columns appended when `hasVac` is true", "720-hr cap applies everywhere").
| Success: No dead vacation code in the pension path. `CLAUDE.md` accurately describes the new structure including the corrected carry-over model.
| Tests: `node --test tests/*.test.js` green.
| Status: Not Started
