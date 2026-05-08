# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A single-file (`index.html`) browser-based pension calculator for ERS (Employees' Retirement System) members. No build system, no server — open directly from `file://`. All logic, styles, and markup live in `index.html`. External deps (D3 v7 and pdf.js) are vendored locally in `lib/` (versioned filenames, e.g., `d3-7.9.0.min.js`).

## Running the App

Open `index.html` in a browser via `file://`. URL parameters for development convenience:

```
file:///path/to/index.html?plan=hybrid&memDate=2014-08-01&dob=1975-06-15&svcYears=15&svcMonths=3&svcAsOf=2024-01-01&afc=4500&slHours=240&slAsOf=2024-01-01&vacHours=400&vacAsOf=2026-01-01&vacHourlyRate=45
```

Supported params (URL pre-fill block at `index.html:2110+`): `plan`, `dob`, `memDate`, `svcYears`, `svcMonths`, `ncSvcYears`, `ncSvcMonths`, `svcAsOf`, `lastDay`, `afc`, `slHours`, `slAsOf`, `slRate`, `vacHours`, `vacAsOf`, `vacRate`, `vacHourlyRate`, `cache`. `plan` takes one of three values (`hybrid`, `contributory`, `noncontributory`); the tier qualifier is derived from `memDate` (see "Plan key derivation" below). `ncSvcYears`/`ncSvcMonths` are only meaningful for hybrid plans (NC mixed-service split); they are dropped from the URL on non-hybrid plans. Pre-split URLs containing only `lastDay` are accepted as a shim — that date is also used for `svcAsOf`. Pension and vacation auto-fire independently: a URL with only the pension fields fires the pension chart, only the vacation fields fires the vacation chart, both fires both. Vacation auto-fires when `vacHours` (≥ 0; `0` is legitimate) + `vacAsOf` + `vacHourlyRate` are present and the shared `lastDay`/`stillActive` state is resolved (`vacRate` defaults to 14 hrs/mo and isn't part of the gate). `cache` is a presence-only boolean flag (`?cache` with no value) that mirrors the on-screen "Cache paystubs across reloads" checkbox — see "Paystub cache" in "Where Things Live". Bad / unknown params are surfaced in a top-of-page error banner; the corresponding form fields are outlined red until corrected.

## Tests

`node --test tests/*.test.js` from repo root. Two files: `tests/pension.test.js` covers `lib/pension.js` (date utils, paystub pipeline, projector, `snapWalkVacationHours`, `vacationPayoutAt`, `buildVacationSeries`, `calculateSeries` wiring). `tests/index-html.test.js` is a smoke test that the inline `<script>` blocks in `index.html` parse cleanly — catches typos without spinning up a browser.

## Form Structure

Four pension fieldsets in `index.html:388-516`, plus a separate vacation fieldset at `index.html:590+` (sits below the pension chart so the two systems gate and chart independently):

1. **Required information** — plan (3-option dropdown: hybrid / contributory / noncontributory), DOB, ERS membership date (`memDate`), credited service (an as-of date anchored at the leftmost slot of `svc-pair-row` regardless of plan, plus one or more years/months pairs to its right). For hybrid plans, three pairs sit in that row: `Hybrid`, `Noncontributory`, and a read-only `Total` computed as `Hybrid + NC` with months carry. For non-hybrid plans, only the `Total` pair is visible and is itself user-editable. Last day of service (or "Still active" checkbox) follows.
2. **Optional adjustments** — sick leave only (hours / as-of / accrual rate, default 14 hrs/mo). Vacation lives in its own fieldset below the pension chart — see "Vacation chart" below.
3. **Contractual adjustments** — read-only `RAISES` table (`index.html:484`, populated at module-script init from the `RAISES` constant) with a "Projected raises do not apply" override checkbox. The whole fieldset is shown when an effective stream is driving the calculation — either a paystub stream or the synthetic stream that regular-mode plans build from a manual AFC.
4. **Earnings data** — manual monthly AFC OR paystub directory picker (DP solver writes the computed AFC into the manual field)
5. **Vacation** (`#group-vacation-input`, below the pension chart) — vacation hours / as-of / accrual rate (default 14) / hourly rate, plus a vacation-side "Projected raises do not apply" checkbox kept bidirectionally in sync with the pension-side one (see `syncRaisesNaFrom` (`index.html:1536`)). Drives its own chart and own Generate-vacation-graph button. Reads `lastDay` / `stillActive` from the pension form rather than duplicating them.

`canCalculate()` (`index.html:1479`) gates the pension Generate-graph button on: plan + dob + memDate (range-valid) + svcAsOf + (Still active OR lastDay) + positive AFC + (no SL hours OR slAsOf set). Vacation has no influence on this gate. `canCalculateVacation()` (`:1500`) gates the vacation button independently on: `vacHours` ≥ 0 + `vacAsOf` + `vacHourlyRate` > 0 + (Still active OR lastDay). `validateMemDate()` (`:1462`) hard-blocks future-dated memDate and soft-flags memDate before DOB or before DOB+18.

## Plan key derivation

The dropdown carries plan **type**; tier (post-2012 vs pre-2012) is inferred from `memDate` against the `2012-07-01` boundary. `derivePlanKey(plan, memDate)` (`lib/pension.js:26`) returns the `PLAN_CONFIGS` key:

- `hybrid` + memDate ≥ 2012-07-01 → `hybrid-post2012`
- `hybrid` + memDate < 2012-07-01 → `hybrid-pre2012`
- `contributory` + memDate ≥ 2012-07-01 → `contributory-post2012`
- `contributory` + memDate < 2012-07-01 → `contributory-pre2012`
- `noncontributory` (any memDate) → `noncontributory`

Eligibility, ARF lookup, AFC mode/N, and COLA all read from the derived key. Crossing the 2012-07-01 boundary by editing `memDate` triggers the same AFC-recompute confirm dialog as switching the plan dropdown.

## Where Things Live

Pure logic lives in `lib/pension.js` (loaded as a classic `<script>` so its top-level declarations are also accessible from the browser console; also `require()`-able from Node, used by `tests/pension.test.js`). DOM-bound code stays in `index.html`. Line numbers below are split accordingly.

- **Plan configs** — `PLAN_CONFIGS` at `lib/pension.js:9` (multiplier, AFC averaging window `N`, AFC mode, vesting months, COLA rate). Keys are the five internal plan-tier strings; UI translates via `derivePlanKey` (`:26`).
- **ARF tables** — `PRIMARY_ARF_TABLES` at `lib/pension.js:62`, copied verbatim from the official ERS calculator's `ers.data.js` (tier1) and `ers.dataNew.js` (tier2)
- **Eligibility / ARF lookup** — `primaryArfAge` (`lib/pension.js:177`, days≥15 rounds up), `primaryEligAge` (`:191`), `primaryEligibility` (`:203`, returns `'regular' | 'early' | 'ineligible'`), `primaryARF` (`:234`)
- **Pension series** — `calculateSeries` at `lib/pension.js:622` accepts `ncSvcMonths` (defaults 0) and an optional `paystubStream` (defaults `null`). Pure pension — no vacation parameters; vacation has its own builder (see "Vacation series" below). Per-month rows from next month → 10 years past first normal retirement (50-yr ceiling). Each row carries `primaryPension`, `pensionCurrentSL`, `pensionProjectedSL`, `pensionWithRaises`, `pensionRaisesCurrentSL`, `pensionRaisesProjectedSL`. Already-separated members and future committed `lastDayOfSvc` snap eligible rows to a single value. Internally `calculateSeries` derives an `effectiveStream`: when no `paystubStream` is given but the plan is `mode === 'regular'` and `afcMonthly > 0`, it builds a synthetic flat stream via `buildSyntheticStream` (`lib/pension.js:948`) anchored at today (or `lastDayOfSvc`'s month if already separated) so the raise projector applies to manual-AFC entries on regular-mode plans. Total-mode plans get no synthetic extrapolation — their AFC mixes overtime/NR/differentials that don't scale with contract raises.
- **Pension formula helper** — `blendedBenefit(svcMonths, ncMonths, afc, arf, plan, config)` at `lib/pension.js:608`. Splits hybrid service into NC-portion (1.25%) and hybrid-portion (config.multiplier); non-hybrid plans use the uniform formula. Caller invariant: `ncMonths ≤ svcMonths` (the form's read-only Total = Hybrid + NC guarantees this). All six pension expressions in `calculateSeries` (primary, ±raises, ±SL variants) call this helper. SL months credit to the hybrid portion.
- **Date utilities** — `parseDate` (`lib/pension.js:272`), `addMonths` (`:277`), `addDays` (`:286`), `monthsBetween` (`:301`), `fractionalAge` (`:308`), `serviceAtMonth` (`:317`)
- **Sick leave → months** — `sickLeaveToMonths` at `lib/pension.js:333`. Spec: ≥60 days (480 hrs) required; 60d→3mo, each further 20d→1mo, remainder ≥10d→1mo
- **Vacation hours snap-walk** — `snapWalkVacationHours({ startHours, startDate, endDate, accrualHrsPerMo, excludeFinalSnap })` at `lib/pension.js:456`. The 720-hr `VACATION_CAP_HOURS` (`:54`) is the year-end carry-over forfeiture (Dec 31 → Jan 1), **not** a hard ceiling: balance can grow above 720 mid-year, then snaps back to ≤ 720 at each Jan 1 boundary in `(startDate, endDate]`. The walk anchors on Jan 1 boundaries (not month-by-month), so mid-month start/end dates are handled correctly. `accrualHrsPerMo = 0` yields the "current" curve (snapshot held flat, snapped at Jan 1 if currently > 720); non-zero yields the "accrued" sawtooth. `excludeFinalSnap: true` suppresses the snap when `endDate` is exactly Jan 1 — used to expose the pre-snap year-end peak on the chart's Dec 31 rows.
- **Vacation payout** — `vacationPayoutAt(retDate, { vacHoursAsOf, vacAsOfDate, accrualHrsPerMo, hourlyRateAtAsOf, raises, cutoff, excludeFinalSnap })` at `lib/pension.js:491`. Returns `{ currentPayout, maxPayout, projectedHourlyRate }`. Hours come from two `snapWalkVacationHours` calls (accrual=0 for current, accrual=`accrualHrsPerMo` for max). Hourly rate compounds every raise strictly after `vacAsOfDate` and on/before `effDate = cutoff ? min(cutoff, retDate) : retDate`. Past-raise filter is the as-of date (raises ≤ vacAsOf are already baked into the entered hourly rate). `cutoff` mirrors `applyRaises`: when `lastDayOfSvc` is set, it caps both raise compounding and the accrual walk at separation. `excludeFinalSnap` plumbs through to the snap-walk for the chart's Dec 31 peak rows.
- **Vacation series** — `buildVacationSeries({ vacHours, vacAsOf, vacRate, vacHourlyRate, lastDayOfSvc, raisesNA })` at `lib/pension.js:531`. Standalone — no pension dependency. Returns `{ separated: false, rows: [{ retDate, currentPayout, maxPayout }, …], lastDayOfSvc }` for active members and future LDOS, or `{ separated: true, separatedOn, finalHours, finalRate, finalPayout }` short-circuit when `lastDayOfSvc < today`. Active-row horizon: today's first-of-month → `max(LDOS-month, today + 24mo)`, capped at the LDOS month when LDOS is > 24mo out. After the monthly loop, one Dec 31 row is appended per calendar year-end inside the active range (skipping years past LDOS) — computed via `vacationPayoutAt(jan1NextYear, { excludeFinalSnap: true })` and stored with `retDate = Dec 31 of y` — to make the year-end peak hover-discoverable in the chart's tooltip. Rows are sorted by `retDate` after insertion. `raisesNA: true` mirrors the pension-side override and suppresses raise compounding on the hourly rate.
- **Raises projection (paystub-driven)** — `projectAfcAtRetirement` at `lib/pension.js:373` is the live path called by `calculateSeries` when a paystub stream is present. Picks top-N **non-overlapping** rolling 12-month windows from past+future via DP (the official ERS rule, matching `solveDP`). Past/future boundary derived from `stream[last].month + 1`; future months projected at `base × Π raises ≤ that month` with `total = regular` (future NR ≡ 0). Past raises (date ≤ stream-end) are filtered out — already baked into `base`. See `info/DESIGN.md` "Projected Raises" for the full algorithm. The legacy `applyRaises` (`lib/pension.js:347`) is the linear-blend approximation kept as a closed-form reference (saturated cases match the projector to within 1¢) and as a test fixture; not wired into `calculateSeries` anymore. It accepts an optional `streamEnd` parameter that mirrors the projector's past-raise filter so equivalence-test fixtures stay consistent.
- **Raises gate** — inside `calculateSeries`, `raisesActive = raisedAfc != null && raisedAfc > afcMonthly && anyRaiseInHorizon`. When an `effectiveStream` is present (paystub OR synthetic) but `raisesActive` is false, `pensionWithRaises` and the SL-raise variants pin to their non-raise counterparts (rather than null) so the chart curves overlay the primary curve from the X origin instead of producing a left-edge gap. Total-mode manual-AFC scenarios (no effective stream at all) get null on every row.
- **`RAISES` table** — `RAISES` constant at `lib/pension.js:35`. Single source of truth for the projected-raises schedule. The on-screen `#raises-table-body` is populated by `renderRaisesTable(boundary)` (`index.html:690`); raises whose date ≤ `boundary` are filtered out (already-applied raises). Default boundary is today's first-of-month; `applyLoadedStubs` re-renders with `stream[last].month` once paystubs load, and `runClear` re-renders with the today default.
- **Paystub pipeline** — `filterStubs` (`lib/pension.js:819`), `generateWindows` (`:849`), `scoreStub` (`:879`), `buildPaystubStream` (`:905`, truncates trailing months not anchored by a stub whose `endDate` is the last day of its month — returns `[]` if no anchor exists), `buildSyntheticStream` (`:948`, the manual-AFC analogue used by regular-mode extrapolation — see "Pension series"), `solveDP` (`:958`), `detectGaps` (`:997`). The non-pure end of the pipeline (`computeAndFillAfc`) lives at `index.html:1217`.
- **Paystub cache** — `localStorage` slot keyed `paystubCache` (`PAYSTUB_CACHE_KEY` at `index.html:745`), gated by the `?cache` URL flag and `#cache-toggle` checkbox; `cacheMode` (`:746`) is mutable so the checkbox change handler (`:790`) can flip it and sync the URL via `history.replaceState`. `persistCache` / `clearCache` / `loadCache` (`:752-787`) handle write / clear / restore — `loadCache` re-derives `beginDate`/`endDate` via `parseDate(payBeginDate)` to avoid timezone shifts that ISO-string round-tripping would introduce. `applyLoadedStubs(stubs, { fromCache, cachedAt })` (`:828`) is the shared post-load path between fresh picks and cache restore; it sets `lastStubs`/`lastWindows`/`lastPaystubStream`, runs `computeAndFillAfc`, fires `maybeCalculate`, and writes the cache (when `!fromCache`). Cache restore on init lives in the URL pre-fill block (`:2220+`). Invalidation triggers: `runClear` and the picker change handler (top — `clearCache()` runs *before* scanning so a cancelled scan leaves the cache cleared until the next successful pick rewrites it). `runClear` is a hard reset: in addition to `clearCache()`, it unticks the cache toggle (back to its unchecked default), zeroes `cacheMode`, and strips URL params via `history.replaceState(null, '', buildReloadUrl())`.
- **Pre-1971 AFC dual-method** — `LUMP_SUM_VACATION` constant (`lib/pension.js:48`), `isPre1971DualMethod(planKey, memDate)` (`:248`) gates the trigger, `computeDualMethodAfc(config)` at `index.html:1236` runs Method A (top-3 excl. lump-sum vacation) and Method B (top-5 incl. lump-sum vacation) and writes the higher monthly AFC. Renders winner/runner-up + no-vacation warning in the windows section.
- **Contractual-adjustments fieldset** — `#group-contractual-input` (`index.html:484`) is hidden by default (HTML `hidden` attribute) and toggled at runtime by `setContractualVisible` (`index.html:1933`); shown when `raisesProjected` is true, where `raisesProjected = paystubStream !== null || extrapolating` and `extrapolating = !paystubStream && planConfig?.mode === 'regular' && manualAfc > 0`. `runCalculate` derives `showRaises = raisesProjected && !raisesNA` and threads it to `drawChart` and `drawSeriesTable`. The "Projected raises do not apply" auto-lock (`applyRaisesNALock`, `:1903`) fires when `lastDayOfSvc` cuts off all raises in the projection horizon — for paystub OR synthetic-extrapolation streams.
- **Chart** — `drawChart` at `index.html:2300`. Curves drawn back-to-front via `makeCurve`.
- **Vacation chart** — `drawVacationChart` at `index.html:2801` (separate `<svg id="vac-chart-svg">` below the pension chart, plus a `<div id="vac-separated-message">` text-replacement node). Consumes the `buildVacationSeries` result: when `result.separated` is true, the SVG stays hidden (no `.has-data` class) and the message div renders a two-line summary (`Already separated on …` / `Vacation payout: $X (N hours × $R/hr)`); otherwise the SVG gets `.has-data` and the rows are drawn as a `d3.curveStepAfter` staircase on a **plain linear time x-axis** — no compression, no eligibility shading. Year-major ticks at each Jan 1 (with year labels), quarterly minor grid lines (dashed) for ≤ 6-year spans, monthly tick marks (3 px below the axis) at every month-1. LDOS marker (dashed gray vertical line + "Last day of service" label) when `lastDayOfSvc` is in horizon. Own y-axis in `$` lump sum (auto-scaled — `yMax = max(1000, ceil(vacMax/1000) × 1000)`), own legend below the x-axis label, own hover tooltip (no COLA — one-time payout).
- **Pension x-scale helper** — `buildChartXScale(series, iW)` at `index.html:2245`, called only by `drawChart`. Returns `{ COMPRESS_PX, xMin, xMax, compressedSegs, eligPxStart, eligPxWidth, eligFromDate, xScale }` (with `xScale.invert` for tooltip use). The vacation chart uses its own plain `d3.scaleTime` and does not call this helper.
- **Dual raises-NA sync** — Two "Projected raises do not apply" checkboxes — one in the pension contractual fieldset (`#raises-na`) and one in the vacation fieldset (`#vac-raises-na`) — kept bidirectionally in sync by `syncRaisesNaFrom(source)` (`index.html:1536`). The handler dispatches a `change` event on the other side (with a recursion guard) so each side's existing change listeners (visibility toggle, recalculate, `updateReloadLink`, etc.) fire as if the user had clicked them. `applyRaisesNALock` (`:1903`) mirrors the lock state to both checkboxes.
- **Debug handle** — `window._debug` exposes the ARF helpers and `lastPaystubStream`; `window._debug.lastSeries` is set after each Calculate.

The pension formula lives in `blendedBenefit`:
```js
const benefit = isHybrid
  ? afc * ((hybridYrs * config.multiplier) + (ncYrs * 0.0125)) * arf
  : afc * totalYrs * config.multiplier * arf;
return Math.floor(Math.round(benefit * 100) / 100);
```
For non-hybrid plans `ncMonths` is ignored. The form guarantees `ncMonths ≤ svcMonths` (the Total pair is read-only and computed as `Hybrid + NC`), so the helper trusts that invariant and does no runtime clamping.

## Plan Eligibility Rules

Rows are keyed by the internal `PLAN_CONFIGS` key (output of `derivePlanKey`). The user-facing dropdown selects the plan **type** column; the tier comes from `memDate`.

| Internal key (dropdown + memDate→tier) | Normal retirement | Early retirement | Early penalty |
|------|------------------|-----------------|---------------|
| hybrid-post2012 (hybrid + memDate ≥ 2012-07-01) | Age 65/10 yos OR Age 60/30 yos | Age 55/20 yos | 5%/yr below normal age |
| hybrid-pre2012 (hybrid + memDate < 2012-07-01) | Age 62/5 yos OR Age 55/30 yos | Age 55/20 yos | 5%/yr below normal age |
| contributory-post2012 (contributory + memDate ≥ 2012-07-01) | Age 60/10 yos | Age 55/25 yos | 5%/yr below normal age |
| contributory-pre2012 (contributory + memDate < 2012-07-01) | Age 55/5 yos | Any age/25 yos | 5%/yr below age 55 |
| noncontributory (any memDate) | Age 62/10 yos OR Age 55/30 yos | Age 55/20–29 yos | 6%/yr below age 62 |

For dual-threshold plans, whichever normal threshold is met first ends the penalty (encoded in `primaryEligibility`'s switch, returning `'regular'` so `primaryARF` returns 1). The penalty values themselves come from the ARF tables, not a per-plan rate constant. Authoritative spec: `info/Retirement-Information-{Hybrid,Contrib,Noncontributory}-eff.-6.2022.md`.

## Chart

`drawChart` at `index.html:2300`. Notable:

- **Zone compression** (`COMPRESS_PX` at `:2045`, `compressedSegs` at `:2066`) — the not-yet-vested and vested-but-ineligible date ranges are squashed to fixed pixel widths and separated from the eligible zone by zigzag break marks; axis labels switch from years to a single boundary marker per compressed segment
- **Curves** (`makeCurve` at `:2265`, drawn back-to-front so primary sits on top): primary blue (`primaryPension`), lighter-blue solid + dashed sick-leave variants, purple raises and raises+SL variants. Dashed for "projected" sick leave. All use `line.defined` so gaps appear where the value is null (ineligible months). Raise curves overlay the primary at retDates where raises haven't lifted the AFC (the `pensionWithRaises = primaryPension` pin in `calculateSeries`); they only diverge upward where raises actually lift.
- **Region shading**: not-yet-vested (`#e8e8e8`), vested-but-ineligible (`#f5f5f5`), early-retirement-penalty zone between first eligible and first normal retirement (`#f0f0f0`)
- **Legend** — flowed left-to-right below the X-axis label, wraps and column-aligns; only shows entries for active curves
- **Hover tooltip + COLA** (`:2474+`): dot on each visible curve at the hovered month; label snaps to the curve nearest the cursor; a dashed-green COLA projection extends 20 years from the hovered point using the plan's `colaRate`. Suffix: `(+ cur. SL)`, `(+ proj. SL)`, `(+ raises)`, etc.
- **Vacation chart tooltip**: separate from the pension chart's. Two crosshair dots (accrued + current) plus a centered top label of the form `2026 Dec 31 — $43,560 (accrued), $36,000 (current)` colored per curve — date format includes the day so Dec 1 / Dec 31 peak rows are distinguishable. No COLA — vacation is a one-time payout.
- **Estimation table** (`drawSeriesTable` at `:1619`) — first 48 rows; collapses tail rows once values stabilize. Pension-only — vacation has no companion table.

## Reference Documents

- `info/Retirement-Information-{Hybrid,Contrib,Noncontributory}-eff.-6.2022.md`, `info/ContribGeneral201205.md`, `info/ContribHybrid201205.md`, `info/Noncontributory200912.md`, `info/act-163-relating-to-employees-retirement-system.md` — **authoritative** plan specs (multipliers, eligibility thresholds, AFC rules). Treat as source of truth when the calculator's behavior is in question.
- `info/DESIGN.md` — design decisions and rationale (staircase curve, penalty reference age, AFC field UX)
- `info/originals/` — archived PDF originals; ignore — the `.md` files are the converted, cross-checked versions
- `PLAN.md` / `PREPLAN.md` — ephemeral; forward-looking work plans, deleted when their stages land
