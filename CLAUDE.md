# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A single-file (`index.html`) browser-based pension calculator for ERS (Employees' Retirement System) members. No build system, no server — open directly from `file://`. All logic, styles, and markup live in `index.html`.

## Running the App

Open `index.html` in a browser via `file://`. Use URL parameters for development convenience:

```
file:///path/to/index.html?plan=hybrid-post2012&dob=1975-06-15&svcYears=15&svcMonths=3&svcAsOf=2024-01-01&afc=4500&slHours=240&slRate=14&raiseRate=2.5
```

Supported params: `plan`, `dob`, `svcYears`, `svcMonths`, `svcAsOf`, `lastDay`, `afc`, `slHours`, `slRate`, `raiseRate`

## Architecture

**Single-file HTML** with:
- D3.js v7 loaded from CDN
- Vanilla JS modules (no bundler)
- No external dependencies beyond D3 and pdf.js (pdf.js added in Stage 2)

**Two form groups** gate the Calculate button:
- Group 1: plan variant + DOB + (last day of service OR service-as-of date); optional: service years/months, sick leave hours/rate, annual raise %
- Group 2: paystub directory picker OR manual AFC — Calculate only enables when both groups are satisfied; the DP solver writes into the manual AFC field when paystubs are loaded

`canCalculate()` requires: plan + dob + (lastDay OR svcAsOf) + positive AFC value.

## Implementation Status

All major features are complete:
- Scaffold + form + URL params
- Directory picker + PDF extraction (pdf.js, DP window solver)
- Plan variant → AFC wiring + UX flow (clear, reload link, plan-change confirmation)
- Date utilities (`monthsBetween`, `fractionalAge`, `serviceAtMonth`, `addMonths`, `sickLeaveToMonths`)
- Pension series table for all plans
- D3 axes, pension curve, ineligible/vesting shading
- Sick leave lines (current and projected)
- Annual raise rate applied to AFC
- COLA projection on hover
- Hover tooltip with crosshair

Deferred items: mixed-service (multi-plan) members, survivor benefit options (see `TODO.md`).

## Key Logic

**Pension formula:**
```js
pension = multiplier × (serviceAtM / 12) × afcMonthly × factor
factor  = Math.max(0, 1.0 - 0.06 * yearsEarly)
yearsEarly = Math.max(0, normalRetirementAge - Math.floor(ageAtM))  // whole years
```

The whole-year floor produces a **staircase curve** — penalty steps down 6% on each birthday, flat between birthdays.

**Plan configs:**
```js
const PLAN_CONFIGS = {
  'hybrid-post2012':       { multiplier: 0.0175, N: 5, mode: 'regular', vestingMonths: 120, colaRate: 0.015 },
  'hybrid-pre2012':        { multiplier: 0.0200, N: 3, mode: 'total',   vestingMonths:  60, colaRate: 0.025 },
  'contributory-post2012': { multiplier: 0.0175, N: 5, mode: 'regular', vestingMonths: 120, colaRate: 0.015 },
  'contributory-pre2012':  { multiplier: 0.0200, N: 3, mode: 'total',   vestingMonths:  60, colaRate: 0.025 },
  'noncontributory':       { multiplier: 0.0125, N: 3, mode: 'total',   vestingMonths: 120, colaRate: 0.025 },
};
```

**AFC monthly** = `dpTotal / N / 12` (DP solver picks best N non-overlapping 12-month windows).

**Service accrual** — `asOfDate` is either `lastDayOfSvc` (separated) or `svcAsOf` (active):
```js
function serviceAtMonth(enteredMonths, asOfDate, retDate, lastDayOfSvc) {
  const accrualEnd = lastDayOfSvc
    ? new Date(Math.min(lastDayOfSvc.getTime(), retDate.getTime()))
    : retDate;
  return enteredMonths + Math.max(0, monthsBetween(asOfDate, accrualEnd));
}
```

**Annual raise rate** grows the AFC forward in time:
```js
const yearsAhead   = Math.max(0, monthsBetween(asOfDate, retDate)) / 12;
const effectiveAfc = raiseRate > 0
  ? afcMonthly * Math.pow(1 + raiseRate, yearsAhead)
  : afcMonthly;
```

**Sick leave** converts unused hours to credited service months:
```js
// Requires ≥ 60 days (480 hrs); 60 days → 3 months, each further 20 days → 1 month,
// remainder ≥ 10 days → 1 extra month.
function sickLeaveToMonths(hours) {
  const days = hours / 8;
  if (days < 60) return 0;
  const whole = Math.floor(days / 20);
  return whole + (days % 20 >= 10 ? 1 : 0);
}
```

Each series row carries `pensionCurrentSL` (with sick leave as entered) and `pensionProjectedSL` (sick leave accrued at `slRate` hrs/month through retirement or last day). Both use the same formula with extra credited months added to `svcAtM`.

## Plan Eligibility Rules

| Plan | Normal retirement | Early retirement | Early penalty |
|------|------------------|-----------------|---------------|
| hybrid-post2012 | Age 65/10 yos OR Age 60/30 yos | Age 55/20 yos | 6%/yr below normal age |
| hybrid-pre2012 | Age 62/5 yos OR Age 55/30 yos | Age 55/20 yos | 6%/yr below normal age |
| contributory-post2012 | Age 60/10 yos | Age 55/25 yos | 6%/yr below normal age |
| contributory-pre2012 | Age 55/5 yos | Any age/25 yos | 6%/yr below age 55 |
| noncontributory | Age 62/10 yos OR Age 55/30 yos | Age 55/20–29 yos | 6%/yr below age 62 |

For dual-threshold plans (hybrid-post2012, hybrid-pre2012, noncontributory), whichever normal threshold is met first ends the penalty.

## Chart Specification

- **X axis** (horizontal): Retirement date, time scale; major ticks Jan 1/year (grid line), minor every 2 months (odd months)
- **Y axis** (vertical): Monthly pension $, linear scale, $0 → max rounded to nearest $1,000; major ticks every $1,000, minor every $100
- **X range**: next month → (earliest normal retirement date + 10 years)
- **Y minimum**: floor of minimum eligible pension, rounded to nearest $1,000 (not always $0)
- **Lines** (all use `line.defined` — gaps where pension is null):
  - Blue solid: base pension
  - Green solid: base + current sick leave months
  - Light-green dashed: base + projected sick leave (no usage through retirement)
- **Shaded regions** (left of eligible date):
  - Dark grey (`#e8e8e8`): not yet vested
  - Light grey (`#f5f5f5`): vested, not yet eligible to collect
- **Hover tooltip**: vertical + horizontal crosshair; dots on all active curves; label snaps to the curve closest to cursor Y; COLA projection curve (dashed orange) extends 20 years from the hovered point. Label format: `"May 2031 — $2,847/mo"` (or `"$2,847/mo (+ cur. SL)"` / `"(+ proj. SL)"` when SL curves are active).

## Reference Documents

PDF specs in `info/` cover the legal definitions of multipliers, eligibility thresholds, and AFC rules for each plan variant.
