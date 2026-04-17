# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A single-file (`index.html`) browser-based pension calculator for ERS (Employees' Retirement System) members. No build system, no server — open directly from `file://`. All logic, styles, and markup live in `index.html`.

## Running the App

Open `index.html` in a browser via `file://`. Use URL parameters for development convenience:

```
file:///path/to/index.html?plan=hybrid-post2012&dob=1975-06-15&svcYears=15&svcMonths=3&afc=4500
```

Supported params: `plan`, `dob`, `svcYears`, `svcMonths`, `lastDay`, `afc`

## Architecture

**Single-file HTML** with:
- D3.js v7 loaded from CDN
- Vanilla JS modules (no bundler)
- No external dependencies beyond D3 and pdf.js (pdf.js added in Stage 2)

**Two form groups** gate the Calculate button:
- Group 1: plan variant + DOB (+ optional service fields)
- Group 2: paystub directory picker OR manual AFC — Calculate only enables when both groups are satisfied; manual AFC takes precedence when both are filled

## Implementation Stages

`PLAN.md` is the authoritative spec. Current status:
- **Stage 1** (scaffold + form + URL params): complete
- **Stages 2–12**: not yet started

Stages in order: directory picker + PDF extraction (port from `afc.html`) → plan dropdown + AFC computation → manual AFC override → date utilities → pension series table (noncontributory, then all plans) → D3 axes → pension curve → ineligible shading → full form wiring → hover tooltip.

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
  'hybrid-post2012':       { multiplier: 0.0175, N: 5, mode: 'regular' },
  'hybrid-pre2012':        { multiplier: 0.0200, N: 3, mode: 'total'   },
  'contributory-post2012': { multiplier: 0.0175, N: 5, mode: 'regular' },
  'contributory-pre2012':  { multiplier: 0.0200, N: 3, mode: 'total'   },
  'noncontributory':       { multiplier: 0.0125, N: 3, mode: 'total'   },
};
```

**AFC monthly** = `dpTotal / N / 12` (DP solver picks best N non-overlapping 12-month windows).

**Service accrual** (default: active employee — service grows until retirement date):
```js
const accrualEnd = lastDayOfSvc
  ? new Date(Math.min(lastDayOfSvc.getTime(), retDate.getTime()))
  : retDate;
const serviceAtM = currentSvcMonths + Math.max(0, monthsBetween(today, accrualEnd));
```

## Existing Code to Port (Stage 2)

`afc.html` contains the complete, working PDF extraction pipeline to import as-is:
- `reconstructRows`, `parseHeader`, `findEarningsBlock`, `parseEarnings`, `extractPaystub`
- `ALIASES`, `KNOWN`, `IGNORED` (earning-type taxonomy)
- `filterStubs`, `generateWindows`, `solveDP`, `scoreStub`
- Date utilities: `fmtDate`, `parseDate`, `addMonths`, `addDays`

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

- **X axis** (horizontal): Monthly pension $, linear scale, $0 → max rounded to nearest $1,000; major ticks every $1,000, minor every $100
- **Y axis** (vertical): Retirement date, time scale, earlier at bottom; major ticks Jan 1/year, minor every 2 months
- **Line**: `d3.line()` with `line.defined(d => d.pension !== null)` — gaps for ineligible months
- **Y range**: next month → (earliest normal retirement date + 10 years)
- Shaded rect for ineligible region, labeled "Not yet eligible"
- Hover tooltip: crosshair + "May 2031 — $2,847/mo"

## Reference Documents

PDF specs in `info/` cover the legal definitions of multipliers, eligibility thresholds, and AFC rules for each plan variant.
