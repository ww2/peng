# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A single-file (`index.html`) browser-based pension calculator for ERS (Employees' Retirement System) members. No build system, no server — open directly from `file://`. All logic, styles, and markup live in `index.html`. External deps (D3 v7 and pdf.js) are vendored locally in `lib/` (versioned filenames, e.g., `d3-7.9.0.min.js`).

## Running the App

Open `index.html` in a browser via `file://`. URL parameters for development convenience:

```
file:///path/to/index.html?plan=hybrid-post2012&dob=1975-06-15&svcYears=15&svcMonths=3&svcAsOf=2024-01-01&afc=4500&slHours=240&slAsOf=2024-01-01
```

Supported params (`index.html:1911-1933`): `plan`, `dob`, `svcYears`, `svcMonths`, `svcAsOf`, `lastDay`, `afc`, `slHours`, `slAsOf`, `slRate`. Pre-split URLs containing only `lastDay` are accepted as a shim — that date is also used for `svcAsOf`.

## Form Structure

Four fieldsets in `index.html:270-417`:

1. **Required information** — plan, DOB, credited service (years/months), service-as-of date, last day of service (or "Still active" checkbox)
2. **Optional adjustments** — sick leave hours / as-of date / accrual rate (default 14 hrs/mo)
3. **Contractual adjustments** — read-only `RAISES` table (`index.html:506-510`) with a "Projected raises do not apply" override checkbox
4. **Earnings data** — manual monthly AFC OR paystub directory picker (DP solver writes the computed AFC into the manual field)

`canCalculate()` (`index.html:1602`) gates the Generate-graph button on: plan + dob + svcAsOf + (Still active OR lastDay) + positive AFC + (no SL hours OR slAsOf set).

## Where Things Live

- **Plan configs** — `PLAN_CONFIGS` at `index.html:497-503` (multiplier, AFC averaging window `N`, AFC mode, vesting months, COLA rate)
- **ARF tables** — `PRIMARY_ARF_TABLES` at `index.html:516-620`, copied verbatim from the official ERS calculator's `ers.data.js` (tier1) and `ers.dataNew.js` (tier2)
- **Eligibility / ARF lookup** — `primaryEligAge` (`:639`), `primaryArfAge` (`:625`, days≥15 rounds up), `primaryEligibility` (`:651`, returns `'regular' | 'early' | 'ineligible'`), `primaryARF` (`:682`)
- **Pension series** — `calculateSeries` at `index.html:1143`. Per-month rows from next month → 10 years past first normal retirement (50-yr ceiling). Each row carries `primaryPension`, `pensionCurrentSL`, `pensionProjectedSL`, `pensionWithRaises`, `pensionRaisesCurrentSL`, `pensionRaisesProjectedSL`. Already-separated members and future committed `lastDayOfSvc` snap eligible rows to a single value (`:1238-1277`).
- **Date utilities** — `parseDate` (`:1055`), `addMonths` (`:1060`), `addDays` (`:1069`), `monthsBetween` (`:1084`), `fractionalAge` (`:1091`), `serviceAtMonth` (`:1100`)
- **Sick leave → months** — `sickLeaveToMonths` at `index.html:1116`. Spec: ≥60 days (480 hrs) required; 60d→3mo, each further 20d→1mo, remainder ≥10d→1mo
- **Raises** — `applyRaises` at `index.html:1129` blends each scheduled raise linearly across the plan's N-year averaging window, capped at `lastDayOfSvc` if set
- **Paystub pipeline** — `filterStubs` (`:1289`), `generateWindows` (`:1319`), `scoreStub` (`:1349`), `solveDP` (`:1356`), `computeAndFillAfc` (`:1430`)
- **Chart** — `drawChart` at `index.html:1941`. Curves drawn back-to-front via `makeCurve` at `:2177-2202`
- **Debug handle** — `window._debug` (`:693`) exposes the ARF helpers; `window._debug.lastSeries` is set after each Calculate

The pension formula itself is one line at `index.html:1200-1201`:
```js
afcMonthly * (svcYrs + svcMos / 12) * config.multiplier * arf
```

## Plan Eligibility Rules

| Plan | Normal retirement | Early retirement | Early penalty |
|------|------------------|-----------------|---------------|
| hybrid-post2012 | Age 65/10 yos OR Age 60/30 yos | Age 55/20 yos | 5%/yr below normal age |
| hybrid-pre2012 | Age 62/5 yos OR Age 55/30 yos | Age 55/20 yos | 5%/yr below normal age |
| contributory-post2012 | Age 60/10 yos | Age 55/25 yos | 5%/yr below normal age |
| contributory-pre2012 | Age 55/5 yos | Any age/25 yos | 5%/yr below age 55 |
| noncontributory | Age 62/10 yos OR Age 55/30 yos | Age 55/20–29 yos | 6%/yr below age 62 |

For dual-threshold plans, whichever normal threshold is met first ends the penalty (encoded in `primaryEligibility`'s switch, returning `'regular'` so `primaryARF` returns 1). The penalty values themselves come from the ARF tables, not a per-plan rate constant. Authoritative spec: `info/Retirement-Information-{Hybrid,Contrib,Noncontributory}-eff.-6.2022.md`.

## Chart

`drawChart` at `index.html:1941`. Notable:

- **Zone compression** (`COMPRESS_PX` at `:1957`, `compressedSegs` at `:1977-1993`) — the not-yet-vested and vested-but-ineligible date ranges are squashed to fixed pixel widths and separated from the eligible zone by zigzag break marks (`:2212-2223`); axis labels switch from years to a single boundary marker per compressed segment
- **Curves** (`makeCurve` at `:2177`, drawn back-to-front so primary sits on top): primary blue (`primaryPension`), lighter-blue solid + dashed sick-leave variants, purple raises and raises+SL variants. Dashed for "projected" sick leave. All use `line.defined` so gaps appear where the value is null (ineligible months)
- **Region shading** (`:2035-2085`): not-yet-vested (`#e8e8e8`), vested-but-ineligible (`#f5f5f5`), early-retirement-penalty zone between first eligible and first normal retirement (`#f0f0f0`)
- **Legend** (`:2225-2306`) — flowed left-to-right below the X-axis label, wraps and column-aligns; only shows entries for active curves
- **Hover tooltip + COLA** (`:2330+`): dot on each visible curve at the hovered month; label snaps to the curve nearest the cursor; a dashed-green COLA projection extends 20 years from the hovered point using the plan's `colaRate`. Suffix: `(+ cur. SL)`, `(+ proj. SL)`, `(+ raises)`, etc.
- **Estimation table** (`drawSeriesTable` at `:1627`) — first 48 rows; collapses tail rows once values stabilize

## Reference Documents

- `info/Retirement-Information-{Hybrid,Contrib,Noncontributory}-eff.-6.2022.md`, `info/ContribGeneral201205.md`, `info/ContribHybrid201205.md`, `info/Noncontributory200912.md`, `info/act-163-relating-to-employees-retirement-system.md` — **authoritative** plan specs (multipliers, eligibility thresholds, AFC rules). Treat as source of truth when the calculator's behavior is in question.
- `info/DESIGN.md` — design decisions and rationale (staircase curve, penalty reference age, AFC field UX)
- `info/originals/` — archived PDF originals; ignore — the `.md` files are the converted, cross-checked versions
- `PLAN.md` — ephemeral; current forward-looking work plan, may be deleted when its stages land
