# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A single-file (`index.html`) browser-based pension calculator for ERS (Employees' Retirement System) members. No build system, no server — open directly from `file://`. All logic, styles, and markup live in `index.html`. External deps (D3 v7 and pdf.js) are vendored locally in `lib/` (versioned filenames, e.g., `d3-7.9.0.min.js`).

## Running the App

Open `index.html` in a browser via `file://`. URL parameters for development convenience:

```
file:///path/to/index.html?plan=hybrid&memDate=2014-08-01&dob=1975-06-15&svcYears=15&svcMonths=3&svcAsOf=2024-01-01&afc=4500&slHours=240&slAsOf=2024-01-01
```

Supported params (URL pre-fill block at `index.html:2185+`): `plan`, `dob`, `memDate`, `svcYears`, `svcMonths`, `ncSvcYears`, `ncSvcMonths`, `svcAsOf`, `lastDay`, `afc`, `slHours`, `slAsOf`, `slRate`. `plan` takes one of three values (`hybrid`, `contributory`, `noncontributory`); the tier qualifier is derived from `memDate` (see "Plan key derivation" below). `ncSvcYears`/`ncSvcMonths` are only meaningful for hybrid plans (NC mixed-service split); they are dropped from the URL on non-hybrid plans. Pre-split URLs containing only `lastDay` are accepted as a shim — that date is also used for `svcAsOf`. Bad / unknown params are surfaced in a top-of-page error banner; the corresponding form fields are outlined red until corrected.

## Form Structure

Four fieldsets in `index.html:290-451`:

1. **Required information** — plan (3-option dropdown: hybrid / contributory / noncontributory), DOB, ERS membership date (`memDate`), credited service (an as-of date anchored at the leftmost slot of `svc-pair-row` regardless of plan, plus one or more years/months pairs to its right). For hybrid plans, three pairs sit in that row: `Hybrid`, `Noncontributory`, and a read-only `Total` computed as `Hybrid + NC` with months carry. For non-hybrid plans, only the `Total` pair is visible and is itself user-editable. Last day of service (or "Still active" checkbox) follows.
2. **Optional adjustments** — sick leave hours / as-of date / accrual rate (default 14 hrs/mo)
3. **Contractual adjustments** — read-only `RAISES` table (`index.html:561`) with a "Projected raises do not apply" override checkbox
4. **Earnings data** — manual monthly AFC OR paystub directory picker (DP solver writes the computed AFC into the manual field)

`canCalculate()` (`index.html:1788`) gates the Generate-graph button on: plan + dob + memDate (range-valid) + svcAsOf + (Still active OR lastDay) + positive AFC + (no SL hours OR slAsOf set). `validateMemDate()` (`:1771`) hard-blocks future-dated memDate and soft-flags memDate before DOB or before DOB+18.

## Plan key derivation

The dropdown carries plan **type**; tier (post-2012 vs pre-2012) is inferred from `memDate` against the `2012-07-01` boundary. `derivePlanKey(plan, memDate)` (`index.html:552`) returns the `PLAN_CONFIGS` key:

- `hybrid` + memDate ≥ 2012-07-01 → `hybrid-post2012`
- `hybrid` + memDate < 2012-07-01 → `hybrid-pre2012`
- `contributory` + memDate ≥ 2012-07-01 → `contributory-post2012`
- `contributory` + memDate < 2012-07-01 → `contributory-pre2012`
- `noncontributory` (any memDate) → `noncontributory`

Eligibility, ARF lookup, AFC mode/N, and COLA all read from the derived key. Crossing the 2012-07-01 boundary by editing `memDate` triggers the same AFC-recompute confirm dialog as switching the plan dropdown.

## Where Things Live

- **Plan configs** — `PLAN_CONFIGS` at `index.html:537` (multiplier, AFC averaging window `N`, AFC mode, vesting months, COLA rate). Keys are the five internal plan-tier strings; UI translates via `derivePlanKey()`.
- **ARF tables** — `PRIMARY_ARF_TABLES` at `index.html:571`, copied verbatim from the official ERS calculator's `ers.data.js` (tier1) and `ers.dataNew.js` (tier2)
- **Eligibility / ARF lookup** — `primaryArfAge` (`:680`, days≥15 rounds up), `primaryEligAge` (`:694`), `primaryEligibility` (`:706`, returns `'regular' | 'early' | 'ineligible'`), `primaryARF` (`:737`)
- **Pension series** — `calculateSeries` at `index.html:1225` accepts `ncSvcMonths` (defaults 0). Per-month rows from next month → 10 years past first normal retirement (50-yr ceiling). Each row carries `primaryPension`, `pensionCurrentSL`, `pensionProjectedSL`, `pensionWithRaises`, `pensionRaisesCurrentSL`, `pensionRaisesProjectedSL`. Already-separated members and future committed `lastDayOfSvc` snap eligible rows to a single value.
- **Pension formula helper** — `blendedBenefit(svcMonths, ncMonths, afc, arf, plan, config)` at `index.html:1290`. Splits hybrid service into NC-portion (1.25%) and hybrid-portion (config.multiplier); non-hybrid plans use the uniform formula. Caller invariant: `ncMonths ≤ svcMonths` (the form's read-only Total = Hybrid + NC guarantees this). All six pension expressions in `calculateSeries` (primary, ±raises, ±SL variants) call this helper. SL months credit to the hybrid portion.
- **Date utilities** — `parseDate` (`:1122`), `addMonths` (`:1127`), `addDays` (`:1136`), `monthsBetween` (`:1151`), `fractionalAge` (`:1158`), `serviceAtMonth` (`:1167`)
- **Sick leave → months** — `sickLeaveToMonths` at `index.html:1183`. Spec: ≥60 days (480 hrs) required; 60d→3mo, each further 20d→1mo, remainder ≥10d→1mo
- **Raises** — `applyRaises` at `index.html:1196` blends each scheduled raise linearly across the plan's N-year averaging window, capped at `lastDayOfSvc` if set
- **Paystub pipeline** — `filterStubs` (`:1368`), `generateWindows` (`:1398`), `scoreStub` (`:1428`), `solveDP` (`:1441`), `computeAndFillAfc` (`:1527`)
- **Pre-1971 AFC dual-method** — `LUMP_SUM_VACATION` constant (`:943`), `isPre1971DualMethod(planKey)` (`:1519`) gates the trigger, `computeDualMethodAfc(config)` (`:1545`) runs Method A (top-3 excl. lump-sum vacation) and Method B (top-5 incl. lump-sum vacation) and writes the higher monthly AFC. Renders winner/runner-up + no-vacation warning in the windows section.
- **Chart** — `drawChart` at `index.html:2307`. Curves drawn back-to-front via `makeCurve`.
- **Debug handle** — `window._debug` (`:748`) exposes the ARF helpers; `window._debug.lastSeries` is set after each Calculate (`:1886`)

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

`drawChart` at `index.html:2307`. Notable:

- **Zone compression** (`COMPRESS_PX` at `:2323`, `compressedSegs` at `:2344`) — the not-yet-vested and vested-but-ineligible date ranges are squashed to fixed pixel widths and separated from the eligible zone by zigzag break marks; axis labels switch from years to a single boundary marker per compressed segment
- **Curves** (`makeCurve` at `:2543`, drawn back-to-front so primary sits on top): primary blue (`primaryPension`), lighter-blue solid + dashed sick-leave variants, purple raises and raises+SL variants. Dashed for "projected" sick leave. All use `line.defined` so gaps appear where the value is null (ineligible months)
- **Region shading**: not-yet-vested (`#e8e8e8`), vested-but-ineligible (`#f5f5f5`), early-retirement-penalty zone between first eligible and first normal retirement (`#f0f0f0`)
- **Legend** — flowed left-to-right below the X-axis label, wraps and column-aligns; only shows entries for active curves
- **Hover tooltip + COLA** (`:2701+`): dot on each visible curve at the hovered month; label snaps to the curve nearest the cursor; a dashed-green COLA projection extends 20 years from the hovered point using the plan's `colaRate`. Suffix: `(+ cur. SL)`, `(+ proj. SL)`, `(+ raises)`, etc.
- **Estimation table** (`drawSeriesTable` at `:1816`) — first 48 rows; collapses tail rows once values stabilize

## Reference Documents

- `info/Retirement-Information-{Hybrid,Contrib,Noncontributory}-eff.-6.2022.md`, `info/ContribGeneral201205.md`, `info/ContribHybrid201205.md`, `info/Noncontributory200912.md`, `info/act-163-relating-to-employees-retirement-system.md` — **authoritative** plan specs (multipliers, eligibility thresholds, AFC rules). Treat as source of truth when the calculator's behavior is in question.
- `info/DESIGN.md` — design decisions and rationale (staircase curve, penalty reference age, AFC field UX)
- `info/originals/` — archived PDF originals; ignore — the `.md` files are the converted, cross-checked versions
- `PLAN.md` / `PREPLAN.md` — ephemeral; forward-looking work plans, deleted when their stages land
