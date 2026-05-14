# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A single-file (`index.html`) browser-based pension calculator for ERS (Employees' Retirement System) members. No build system, no server — open directly from `file://`. All logic, styles, and markup live in `index.html`. External deps (D3 v7 and pdf.js) are vendored locally in `lib/` (versioned filenames, e.g., `d3-7.9.0.min.js`).

## Running the App

Open `index.html` in a browser via `file://`. URL params are accepted for development convenience:

```
file:///path/to/index.html?plan=hybrid&memDate=2014-08-01&dob=1975-06-15&svcYears=15&svcMonths=3&svcAsOf=2024-01-01&afc=4500&slHours=240&slAsOf=2024-01-01&vacHours=400&vacAsOf=2026-01-01&vacHourlyRate=45
```

Full param list and parsing rules live in the pre-fill block at `index.html:2110+`. Notable behaviors:
- Pension and vacation auto-fire independently — a URL with only pension fields fires only the pension chart, etc.
- `?cache` is a presence-only flag mirroring the "Cache paystubs across reloads" checkbox.
- Bad/unknown params route to `#url-error-banner` (pension-side) or `#vac-error-banner` (vacation-side, sits above `#group-vacation-input`).

## Tests

`node --test tests/*.test.js` from repo root. `tests/pension.test.js` covers `lib/pension.js`. `tests/index-html.test.js` is a smoke test that the inline `<script>` blocks in `index.html` parse — catches typos without spinning up a browser.

## Form Structure

Four pension fieldsets in `index.html:390-568`, plus a separate vacation fieldset at `index.html:589+` (sits below the pension chart so the two systems gate and chart independently):

1. **Required information** — plan dropdown (hybrid / contributory / noncontributory), DOB, ERS membership date (`memDate`), credited service. Hybrid plans show three years/months pairs: `Hybrid`, `Noncontributory`, and a read-only `Total = Hybrid + NC`. Non-hybrid plans show only `Total`, user-editable. Last day of service (or "Still active" checkbox) follows.
2. **Optional adjustments** — sick leave (hours / as-of / accrual rate, default 14 hrs/mo).
3. **Contractual adjustments** — read-only `RAISES` table + "Projected raises do not apply" override (`#raises-na`). Shown when raises affect *either* graph: pension (via paystub stream OR regular-mode synthetic stream from manual AFC) OR vacation (raises always compound through the vacation hourly rate).
4. **Earnings data** — manual monthly AFC OR paystub directory picker (DP solver writes the computed AFC into the manual field).
5. **Vacation** (`#group-vacation-input` at `index.html:589`) — vacation hours / as-of / accrual rate (default 14) / hourly rate, plus its own independent "Projected raises do not apply" checkbox (`#vac-raises-na`). Drives its own chart and Generate-vacation-graph button. Reads `lastDay` / `stillActive` from the pension form.

Pension (`canCalculate()`) and vacation (`canCalculateVacation()`) gate independently — vacation has no influence on the pension gate or vice versa.

## Plan key derivation

The dropdown carries plan **type**; tier (post-2012 vs pre-2012) is inferred from `memDate` against the `2012-07-01` boundary. `derivePlanKey(plan, memDate)` (`lib/pension.js:26`) returns the `PLAN_CONFIGS` key:

- `hybrid` + memDate ≥ 2012-07-01 → `hybrid-post2012`
- `hybrid` + memDate < 2012-07-01 → `hybrid-pre2012`
- `contributory` + memDate ≥ 2012-07-01 → `contributory-post2012`
- `contributory` + memDate < 2012-07-01 → `contributory-pre2012`
- `noncontributory` (any memDate) → `noncontributory`

Eligibility, ARF lookup, AFC mode/N, and COLA all read from the derived key. Crossing the 2012-07-01 boundary by editing `memDate` triggers the same AFC-recompute confirm dialog as switching the plan dropdown.

## Where Things Live

Pure logic lives in `lib/pension.js` (loaded as a classic `<script>` so its top-level declarations are also accessible from the browser console; also `require()`-able from Node, used by `tests/pension.test.js`). DOM-bound code stays in `index.html`. Function-level docs are inline in each file — this section captures cross-file interactions and invariants that wouldn't survive being inferred from code alone.

- **Plan policy** — `lib/pension.js:9-250` houses `PLAN_CONFIGS`, `PRIMARY_ARF_TABLES` (copied verbatim from the official ERS calculator's `ers.data.js` / `ers.dataNew.js`), and the `primary*` eligibility/ARF helpers.
- **Pension series** — `calculateSeries` at `lib/pension.js:622`. Pure pension; vacation has its own builder. For regular-mode plans with a manual AFC and no paystubs, an internal synthetic stream lets the raise projector apply through the same path as the paystub case. Total-mode plans get no synthetic extrapolation — their AFC mixes overtime/NR/differentials that don't scale with contract raises.
- **Pension formula** — `blendedBenefit` at `lib/pension.js:608`. Caller invariant: `ncMonths ≤ svcMonths`, guaranteed by the form's read-only Total = Hybrid + NC. SL months credit to the hybrid portion.
- **Vacation series** — `buildVacationSeries` at `lib/pension.js:531`. Standalone — no pension dependency. The 720-hr `VACATION_CAP_HOURS` is the *year-end carry-over forfeiture* (Dec 31 → Jan 1), not a hard ceiling: balance can grow above 720 mid-year, then snaps back at each Jan 1. Already-separated members short-circuit to a `{ separated: true, … }` summary.
- **Raises projection** — `projectAfcAtRetirement` (`lib/pension.js:373`) is the live path called by `calculateSeries`. Legacy `applyRaises` (`:347`) is a closed-form linear-blend approximation kept as a test fixture and reference — not wired into `calculateSeries` anymore. Full algorithm in `info/DESIGN.md` ("Projected Raises").
- **`RAISES` table** — `RAISES` constant at `lib/pension.js:35` is the single source of truth. The on-screen `#raises-table-body` re-renders on three triggers: init (boundary = today's first-of-month), paystub load (boundary = `stream[last].month`, so already-baked-in raises drop out), and `runClear` (back to today).
- **Paystub cache** — `localStorage` slot keyed `paystubCache`, gated by `?cache` URL flag and `#cache-toggle` checkbox. Invalidation: `runClear` and the picker change handler — `clearCache()` runs *before* scanning so a cancelled scan leaves the cache cleared until the next successful pick rewrites it. `runClear` is a hard reset: unticks the cache toggle, zeroes `cacheMode`, and strips URL params.
- **Pre-1971 AFC dual-method** — gated by `isPre1971DualMethod(planKey, memDate)` (`lib/pension.js:248`); `computeDualMethodAfc` at `index.html:1236` runs Method A (top-3 excl. lump-sum vacation) and Method B (top-5 incl.) and writes the higher monthly AFC.
- **Contractual-adjustments visibility** — `updateContractualVisibility()` at `index.html:1999`. Fieldset shows when raises affect *either* graph (pension uses raises OR vacation is graphable). The pension `#raises-na` checkbox auto-locks via `applyRaisesNALock` (`index.html:1922`); vacation has a parallel `applyVacRaisesNALock` (`:1957`). The two checkbox states are intentionally allowed to diverge — no cross-sync. Pension lock precedence: **NOPROJ** (no paystubs and no regular-mode AFC) wins over **LASTDAY** (raises would project but `lastDayOfSvc` cuts them all off). The NOPROJ suffix is mode-aware (paystub vs AFC hint).
- **Debug handle** — `window._debug` exposes the ARF helpers, `lastPaystubStream`, and `lastSeries` (set after each Calculate).

## Plan Eligibility Rules

Rows are keyed by the internal `PLAN_CONFIGS` key (output of `derivePlanKey`). The user-facing dropdown selects the plan **type** column; the tier comes from `memDate`.

| Internal key (dropdown + memDate→tier) | Normal retirement | Early retirement | Early penalty |
|------|------------------|-----------------|---------------|
| hybrid-post2012 (hybrid + memDate ≥ 2012-07-01) | Age 65/10 yos OR Age 60/30 yos | Age 55/20 yos | 5%/yr below normal age |
| hybrid-pre2012 (hybrid + memDate < 2012-07-01) | Age 62/5 yos OR Age 55/30 yos | Age 55/20 yos | 5%/yr below normal age |
| contributory-post2012 (contributory + memDate ≥ 2012-07-01) | Age 60/10 yos | Age 55/25 yos | 5%/yr below normal age |
| contributory-pre2012 (contributory + memDate < 2012-07-01) | Age 55/5 yos | Any age/25 yos | 5%/yr below age 55 |
| noncontributory (any memDate) | Age 62/10 yos OR Age 55/30 yos | Age 55/20–29 yos | 6%/yr below age 62 |

For dual-threshold plans, whichever normal threshold is met first ends the penalty (encoded in `primaryEligibility`'s switch, returning `'regular'` so `primaryARF` returns 1). Penalty values come from the ARF tables, not a per-plan rate constant. Authoritative spec: `info/Retirement-Information-{Hybrid,Contrib,Noncontributory}-eff.-6.2022.md`.

## Chart

`drawChart` at `index.html:2300`. Notable:

- **Zone compression** (`COMPRESS_PX`, `compressedSegs`) — the not-yet-vested and vested-but-ineligible date ranges are squashed to fixed pixel widths and separated from the eligible zone by zigzag break marks; axis labels switch from years to a single boundary marker per compressed segment.
- **Curves** (`makeCurve`, drawn back-to-front so primary sits on top): primary blue (`primaryPension`), lighter-blue solid + dashed sick-leave variants, purple raises and raises+SL variants. All use `line.defined` so gaps appear where the value is null (ineligible months). Raise curves overlay the primary at retDates where raises haven't lifted the AFC (the `pensionWithRaises = primaryPension` pin in `calculateSeries`); they only diverge upward where raises actually lift.
- **Region shading**: not-yet-vested (`#e8e8e8`), vested-but-ineligible (`#f5f5f5`), early-retirement-penalty zone between first eligible and first normal retirement (`#f0f0f0`).
- **Legend** — flowed left-to-right below the X-axis label, wraps and column-aligns; only shows entries for active curves.
- **Hover tooltip + COLA**: dot on each visible curve at the hovered month; label snaps to the curve nearest the cursor; a dashed-green COLA projection extends 20 years from the hovered point using the plan's `colaRate`.
- **Pension x-scale helper** — `buildChartXScale(series, iW)` at `index.html:2245`, called only by `drawChart`. The vacation chart uses its own plain `d3.scaleTime` and does not call this helper.
- **Vacation chart** (`drawVacationChart` at `index.html:2801`) — separate `<svg id="vac-chart-svg">` below the pension chart, plus a `<div id="vac-separated-message">` for already-separated members. Plain linear time x-axis — no compression, no eligibility shading. Year-major ticks at each Jan 1, quarterly minor grid lines for ≤ 6-year spans, monthly tick marks at every month-1. LDOS marker when `lastDayOfSvc` is in horizon. Own y-axis in `$` lump sum, own legend, own hover tooltip (no COLA — vacation is a one-time payout). Tooltip date format includes the day so Dec 1 / Dec 31 peak rows are distinguishable.
- **Estimation table** (`drawSeriesTable` at `:1619`) — first 48 rows; collapses tail rows once values stabilize. Pension-only — vacation has no companion table.

## Reference Documents

- `info/Retirement-Information-{Hybrid,Contrib,Noncontributory}-eff.-6.2022.md`, `info/ContribGeneral201205.md`, `info/ContribHybrid201205.md`, `info/Noncontributory200912.md`, `info/act-163-relating-to-employees-retirement-system.md` — **authoritative** plan specs (multipliers, eligibility thresholds, AFC rules). Treat as source of truth when the calculator's behavior is in question.
- `info/DESIGN.md` — design decisions and rationale (staircase curve, penalty reference age, AFC field UX, projected-raises algorithm).
- `info/originals/` — archived PDF originals; ignore — the `.md` files are the converted, cross-checked versions.
- `PLAN.md` / `PREPLAN.md` — ephemeral; forward-looking work plans, deleted when their stages land.
