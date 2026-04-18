# ERS Pension Graph — Implementation Plan

## Purpose

A single `index.html` file that:
1. Accepts a directory of PDF paystubs (via directory picker)
2. Extracts earnings data from each paystub using pdf.js
3. Automatically calculates the AFC (Average Final Compensation) appropriate
   to the user's plan type and membership date
4. Plots **retirement date (X) vs. monthly pension (Y)** for every eligible
   month from now through 10 years past the member's normal retirement date

Works standalone from `file://` with no server.

---

## Pension Calculation Formula

```
pension = multiplier × (serviceAtM / 12) × AFC × factor
factor  = max(0.0, 1.0 - 0.06 × yearsEarly)
yearsEarly = max(0, normalRetirementAge - ageAtM)   -- whole years (floor)
```

`ageAtM` is computed in **whole years** (floor of fractional age) for the penalty
calculation, matching the PDFs' "6% for each year under age 62" language. This
produces a staircase curve in the early retirement window: flat between birthdays,
stepping down 6% on each birthday.

`serviceAtM / 12` may still be fractional (months of credited service matter for
the pension amount; only the penalty uses whole years).

AFC is a **monthly** dollar amount derived automatically from paystubs.

---

## Plan Variant Dropdown

A single dropdown replaces separate "plan type" and "membership date" controls.
Five options fully specify the rule set and AFC parameters with no additional input:

| Value | Label | N windows | Earnings mode |
|---|---|---|---|
| `hybrid-post2012` | Hybrid (joined July 2012 or later) | 5 | regular (base pay only) |
| `hybrid-pre2012` | Hybrid (joined before July 2012) | 3 | total (all non-ignored) |
| `contributory-post2012` | Contributory (joined July 2012 or later) | 5 | regular (base pay only) |
| `contributory-pre2012` | Contributory (joined before July 2012) | 3 | total (all non-ignored) |
| `noncontributory` | Noncontributory | 3 | total (all non-ignored) |

```js
const PLAN_CONFIGS = {
  'hybrid-post2012':      { multiplier: 0.0175, N: 5, mode: 'regular', ... },
  'hybrid-pre2012':       { multiplier: 0.0200, N: 3, mode: 'total',   ... },
  'contributory-post2012':{ multiplier: 0.0175, N: 5, mode: 'regular', ... },
  'contributory-pre2012': { multiplier: 0.0200, N: 3, mode: 'total',   ... },
  'noncontributory':      { multiplier: 0.0125, N: 3, mode: 'total',   ... },
};
```

AFC monthly = DP total / N / 12 (DP total is sum of annual earnings across N windows).

---

## Plan Rules

### Hybrid Plan

| Rule | Membership post-2012 | Membership pre-2012 |
|---|---|---|
| Multiplier | 1.75% | 2.00% |
| AFC basis | avg 5-highest base-pay years (regular earnings) | avg 3-highest gross years (total earnings) |
| Normal retirement | Age 65 w/10 yos OR Age 60 w/30 yos | Age 62 w/5 yos OR Age 55 w/30 yos |
| Normal ret. age for penalty | 65 (or 60 once 30 yos met first) | 62 (or 55 once 30 yos met first) |
| Early retirement | Age 55 w/20 yos | Age 55 w/20 yos |
| Early penalty | 6%/yr below normal age | 6%/yr below normal age |
| Vesting | 10 yos | 5 yos |
| Post-retirement increase | 1.5%/yr | 2.5%/yr |

### Contributory Plan (General Employees)

| Rule | Membership post-2012 | Membership pre-2012 |
|---|---|---|
| Multiplier | 1.75% | 2.00% |
| AFC basis | avg 5-highest base-pay years (regular earnings) | avg 3-highest gross years (total earnings) |
| Normal retirement | Age 60 w/10 yos | Age 55 w/5 yos |
| Normal ret. age for penalty | 60 | 55 |
| Early retirement | Age 55 w/25 yos | Any age w/25 yos |
| Early penalty | 6%/yr below normal age | 6%/yr below age 55 |
| Vesting | 10 yos | 5 yos |
| Post-retirement increase | 1.5%/yr | 2.5%/yr |

### Noncontributory Plan

| Rule | Value |
|---|---|
| Multiplier | 1.25% |
| AFC basis | avg 3-highest gross years (total earnings) |
| Normal retirement | Age 62 w/10 yos OR Age 55 w/30 yos |
| Normal ret. age for penalty | 62 (or 55 once 30 yos met first) |
| Early retirement | Age 55 w/20–29 yos |
| Early penalty | 6%/yr below age 62 (explicitly stated in PDFs) |
| Post-retirement increase | 2.5%/yr |

---

## Service Accrual

Active employees are the primary audience. The default assumption is that
service keeps accruing month-by-month until the retirement date itself — this
makes the curve naturally steeper for later retirement dates, capturing both the
higher multiplier and the longer service.

An optional **"Last day of service"** date input covers the non-default cases
(already retired, planning a specific separation date, or modelling a break in
service). When left blank, service accrues through the retirement date.

```js
// asOfDate     = reference date for the entered service figure:
//                  lastDayOfSvc (when set) — service is static, accrual = 0
//                  svcAsOf field value (when lastDay is blank) — accrues forward
// lastDayOfSvc = optional Date from form input; null = still active
// retDate      = candidate retirement month (1st of that month)
// enteredSvcMonths = credited service as reported by ERS (as of asOfDate)

const accrualEnd = lastDayOfSvc
  ? new Date(Math.min(lastDayOfSvc.getTime(), retDate.getTime()))
  : retDate;
const serviceAtM = enteredSvcMonths + Math.max(0, monthsBetween(asOfDate, accrualEnd));
```

`monthsBetween` counts whole calendar months (same day-of-month logic as
`addMonths`). When `asOfDate === lastDayOfSvc`, `accrualEnd = lastDayOfSvc` and
`monthsBetween` = 0, giving static service.

---

## Eligibility Logic (per candidate month M)

1. `ageAtM` — DOB to M in fractional years (months precision)
2. `serviceAtM` — see Service Accrual above
3. Determine status:
   - **Normal**: meets either normal threshold → factor = 1.0
   - **Early**: meets early threshold but not normal → apply 6% penalty
   - **Ineligible**: neither met → pension = null (gap in chart)
4. Dual normal thresholds (65/10 or 60/30): whichever is met first ends
   the penalty; use the lower normal age for penalty once higher service
   count is reached
5. `yearsEarly = Math.max(0, normalRetAge - Math.floor(ageAtM))`
   `factor = Math.max(0, 1 - 0.06 * yearsEarly)`
6. `pension = multiplier * (serviceAtM / 12) * afcMonthly * factor`

---

## Inputs (HTML Form)

| Field | Control | Required | Notes |
|---|---|---|---|
| Plan variant | Select (5 options) | Yes | Must be selected before Earnings data group is enabled |
| Date of birth | Date input | Yes | Age at each candidate retirement month |
| Current credited service | Two number inputs (years + months) | Yes | Service as of today; projected forward automatically |
| Last day of service | Date input | **No** | Leave blank for active employees (ongoing accrual) |
| Monthly AFC ($) | Text input | Yes* | *Primary AFC field; scanning populates it automatically |
| Paystub directory | `<input type="file" webkitdirectory>` | No | Scanning populates Monthly AFC; user may edit afterwards |

**AFC field behaviour**: scanning runs the DP solver (N windows, mode from plan
config) and writes `total / N / 12` into the Monthly AFC field. The user can
edit that value freely before clicking Calculate. If the plan is changed after
the AFC field has a value, the user is prompted; on confirmation the field is
recomputed from the already-extracted stubs in memory (no re-scan needed); on
cancellation the plan dropdown reverts. If the AFC field is empty when the plan
changes, recomputation happens silently.

---

## Layout

```
┌─────────────────────────────────────────────────┐
│ ╔═ Your information ════════════════════════════╗│
│ ║  Plan variant [dropdown]  │  DOB [date]       ║│
│ ║  Service [years] [months] │  Last day [  ][✕] ║│
│ ╚═══════════════════════════════════════════════╝│
│                                                  │
│ ╔═ Earnings data (disabled until plan selected) ═╗│
│ ║  Monthly AFC ($): [_______]                   ║│
│ ║  ────────────── or ──────────────             ║│
│ ║  Paystub dir: [btn] …/name │ ▸ Show detail…  ║│
│ ║  [scan status]             │   [debug panel]  ║│
│ ╚═══════════════════════════════════════════════╝│
├─────────────────────────────────────────────────┤
│  [Calculate ▶]  Status line (errors / warnings)  │
├─────────────────────────────────────────────────┤
│                                                  │
│  D3 SVG chart                                    │
│                                                  │
└─────────────────────────────────────────────────┘
```

**Fieldset enable/disable sequence**:
1. "Your information" is always enabled
2. "Earnings data" is disabled (greyed, non-interactive) until plan variant is selected
3. Calculate button is disabled until the Monthly AFC field has a value > 0 AND DOB is entered

---

## Graph Specification

**Technology**: D3.js v7, rendered to SVG, inlined into `index.html`.

**Axes**:
- X (horizontal): Retirement Date, `d3.scaleTime()`, earlier on left
- Y (vertical): Monthly Pension ($), `d3.scaleLinear()`

**X axis**:
- Lower bound: 1st of next calendar month
- Upper bound: earliest normal retirement date + 10 years (or today + 10 years
  if already past normal eligibility)
- Orientation: earlier dates on **left**, later dates on **right** — curve slopes
  up-right naturally (retire later → higher pension)
- Major ticks: Jan 1 each year, labeled with 4-digit year
- Minor ticks: 1st of every other month, unlabeled

**Y axis**:
- Range: min pension floored to nearest $1,000 → max pension ceiled to nearest $1,000
- Major ticks every $1,000: labeled, full-height gridlines
- Minor ticks every $100: unlabeled, shorter marks

Both axes use `axis.tickValues()` with two separate `<g>` tick layers (one for
major, one for minor) to achieve independent label and length control.

**Plot**:
- `d3.line()` with `line.defined(d => d.pension !== null)` — gaps for ineligible months
- Shaded `<rect>` behind curve for ineligible range, labeled "Not yet eligible"
- Staircase steps in the early retirement window (penalty drops 6% on each birthday,
  flat between birthdays); smooth continuous slope outside the early window
- Step up to full pension visible on the birthday the member reaches normal retirement age
- Hover tooltip: crosshair lines + label "May 2031 — $2,847/mo"
- Title: "ERS Monthly Pension vs. Retirement Date"
- X label: "Retirement Date"
- Y label: "Monthly Pension — Maximum Allowance ($/month)"

---

## Implementation Stages

### Stage 1: Bare scaffold
**Goal**: `index.html` with full form structure in two fieldsets, D3 available,
Calculate button wired to enable/disable logic, URL parameter pre-fill, no
extraction or calculation yet

**URL parameters** (all optional, for development convenience):
| Param | Field | Example |
|---|---|---|
| `plan` | Plan variant | `hybrid-post2012` |
| `dob` | Date of birth | `1975-06-15` |
| `svcYears` | Service years | `15` |
| `svcMonths` | Service months | `3` |
| `lastDay` | Last day of service | `2028-01-01` |
| `afc` | Manual AFC ($/mo) | `4500` |

**Verify**:
- Open from `file://`; both fieldsets visible; no console errors
- `console.log(d3.version)` prints a version string
- Calculate button is disabled on load
- Filling plan + DOB alone does not enable it (Group 2 still empty)
- Typing any positive value in the manual AFC field enables it (given plan + DOB set)
- Clearing the manual AFC value disables it again
- ✕ button clears the last-day-of-service field
- Opening with `?plan=hybrid-post2012&dob=1975-06-15&afc=4500` pre-fills those
  fields and enables the Calculate button immediately
**Status**: Complete

---

### Stage 2: Directory picker + JSON extraction
**Goal**: Directory picker, `extractPaystub`, `filterStubs`, JSON display, per-file
`<details>` view, JSON download button
**Verify**: Pick a paystub directory; confirm extracted JSON contains correct stubs;
paper checks and stubs with missing dates are absent from the output
**Status**: Complete

---

### Stage 3: Plan variant → AFC wiring + UX flow
**Goal**: Complete the plan-first UX flow:
- Swap fieldset order: "Your information" above "Earnings data"
- Disable the "Earnings data" fieldset until a plan variant is selected
- `PLAN_CONFIGS` (already defined), `computeAndFillAfc()` (already implemented):
  after scanning, run DP solver with plan's N and mode, write result into
  `#manual-afc`; also fires when plan dropdown changes
- Plan change with non-empty AFC field: prompt user; if confirmed recompute AFC
  from `lastStubs`/`lastWindows` in memory; if cancelled revert the dropdown
- Plan change with empty AFC field: recompute silently (nothing to lose)
- Calculate button enabled when DOB is entered AND Monthly AFC field has a value > 0

**Already done**: `PLAN_CONFIGS`, `computeAndFillAfc()`, `lastStubs`/`lastWindows`
storage, plan dropdown listener, AFC written to `#manual-afc` after scan.

**Remaining**: fieldset order swap, earnings data disabled until plan selected,
plan-change prompt + revert-on-cancel.

**Verify**:
- On load, "Earnings data" fieldset is greyed and non-interactive
- Selecting a plan enables "Earnings data"
- Scanning populates Monthly AFC; `hybrid-post2012` → N=5 regular,
  `hybrid-pre2012` → N=3 total, `noncontributory` → N=3 total
- Changing plan with a value in AFC field shows a confirmation prompt;
  confirming rewrites the field using in-memory stubs; cancelling restores
  the previous plan in the dropdown
- Changing plan with empty AFC field rewrites silently
- Calculate button remains disabled until DOB is entered and AFC field has a value
**Status**: Complete

---

### Stage 4: Date and service utility functions
**Goal**: Implement and inline-test three pure functions:
- `monthsBetween(a, b)` — whole calendar months from Date a to Date b
- `fractionalAge(dob, date)` — age in fractional years
- `serviceAtMonth(enteredMonths, asOfDate, retDate, lastDayOfSvc)` — accrual
  from `asOfDate` to `min(lastDayOfSvc, retDate)` (or to `retDate` when
  `lastDayOfSvc` is null); `Math.max(0, ...)` prevents negative deltas

Render a small verification table directly on the page (no test framework) with
a handful of known-answer cases for each function
**Verify**: All rows in the table show expected values; no surprises at month
boundaries (e.g. same day next month = exactly 1 month)
**Status**: Complete

---

### Stage 4b: "As of" date field + service reference wiring
**Goal**: Add an "as of" date input for credited service; enforce that at least
one of "as of" or "last day of service" is provided before Calculate enables.

- Add `#svc-as-of` date input adjacent to the service years/months fields;
  visible when `#last-day` is blank, hidden when `#last-day` is filled
- Clearing `#last-day` (via ✕ or manual edit) reveals `#svc-as-of`; filling
  `#last-day` hides it — stale `asOf` value is ignored; `lastDay` itself serves
  as the implicit reference date when set
- Calculate button enable: `group1Ok` requires plan + DOB + (`lastDay` non-blank
  OR `asOf` non-blank)
- Resolved reference date passed into `serviceAtMonth`:
  - `lastDay` set → `asOfDate = lastDay` (service is static; accrual = 0)
  - `lastDay` blank → `asOfDate = asOf`

**Verify**:
- On load with no URL params: "as of" visible, Calculate disabled (neither date set)
- Filling `lastDay` hides "as of"; clearing it restores "as of"
- `lastDay` set, service entered, DOB + plan filled: Calculate enables; curve shows
  flat static service across all retirement dates
- `lastDay` blank, `asOf` set: Calculate enables; service accrues forward from
  `asOf` date on each candidate month
- Both blank: Calculate stays disabled despite plan + DOB + AFC being filled
**Status**: Complete

---

### Stage 5: Pension series for Noncontributory (table output)
**Goal**: Implement `calculateSeries(params)` for `noncontributory` only;
render output as a plain HTML table — one row per candidate month showing:
retirement date | service months | whole age | status (normal/early/ineligible) | pension
**Verify**:
- Rows before age 55 w/20 yos show `ineligible`, pension blank
- Rows at age 55 w/20–29 yos show `early`; pension decreases by 6% on each
  birthday and is flat between birthdays (confirming the staircase)
- Rows at age 62 w/10 yos (or age 55 w/30 yos) show `normal`; penalty gone
- Active-employee rows: service column increases month-by-month
**Status**: Complete

---

### Stage 6: D3 axes (no data)
**Goal**: Replace the chart placeholder with a real SVG; render X and Y axes
with correct tick structure but hardcoded ranges (X: today to today+15 years;
Y: $0–$5,000)
**Verify**: Both axes visible; X major ticks on Jan 1 each year labeled, minor
on 1st of every other month; Y major ticks every $1,000 labeled, minor every
$100 unlabeled; earlier dates on the left; no data yet
**Status**: Complete

---

### Stage 7: Pension curve (hardcoded ranges)
**Goal**: Feed `calculateSeries` output (noncontributory) into the chart as a
`d3.line()` over the hardcoded axes from Stage 6; use
`line.defined(d => d.pension !== null)` for gaps
**Verify**: Line visible over existing axes; staircase steps clearly visible in
early retirement window; line resumes after each step; line absent (gap) for
ineligible months; service-driven upward slope visible for active employees
**Status**: Complete

---

### Stage 8: Dynamic axis ranges
**Goal**: Replace hardcoded axis ranges with data-driven ones — X from first
candidate month to 10 years past earliest normal retirement date; Y from the
nearest $1,000 floor below the minimum pension to the nearest $1,000 ceiling
above the maximum pension
**Verify**: Axis ranges update when inputs change; Y min and max track the
pension range; X bounds are tight to the data; staircase and gaps still correct
**Status**: Complete

---

### Stage 9: Ineligible region shading
**Goal**: Add a shaded `<rect>` covering the Y range of ineligible months
behind the curve, with a "Not yet eligible" label
**Verify**: Shading covers exactly the ineligible date range and stops where
the curve begins; label readable; curve renders on top of shading
**Status**: Not Started

---

### Stage 10: Pension series + chart for all plan variants
**Goal**: Extend `calculateSeries` to cover all five plan variants; chart and
debug table both update when the plan dropdown changes and Calculate is clicked
**Verify**:
- `hybrid-post2012`: normal at 65/10 yos or 60/30 yos; early at 55/20 yos
- `hybrid-pre2012`: normal at 62/5 yos or 55/30 yos; same early threshold
- `contributory-post2012`: normal at 60/10 yos; early at 55/25 yos
- `contributory-pre2012`: normal at 55/5 yos; early at *any age* w/25 yos
  (confirm: rows below age 55 with 25+ yos show `early`, not `ineligible`)
- Dual-threshold plans: confirm `normal` fires on whichever condition is met first
- Chart curve and staircase shape correct for each plan variant
**Status**: Not Started

---

### Stage 11: Full form wiring + Calculate button
**Goal**: Wire all form inputs (plan variant, DOB, service years/months, last
day of service) to `calculateSeries`; Calculate button renders the chart; debug
series table from Stages 5 & 10 remains visible for cross-checking
**Verify**:
- Changing any input and clicking Calculate updates the chart
- Blank "last day of service" → active-employee accrual; filled date → service caps
**Status**: Not Started

---

### Stage 12: Remove debug table + status line
**Goal**: Remove the debug series table; add a status line showing validation
errors or "No eligible retirement dates found" when the series is empty
**Verify**:
- Debug table is gone; chart is the only output
- Missing required fields show a clear error instead of a broken chart
- "No eligible dates found" appears for implausible inputs (e.g., DOB = today)
**Status**: Not Started

---

### Stage 13: Hover tooltip
**Goal**: On mouse move over the chart, draw vertical + horizontal crosshair
lines snapped to the nearest data point and show a label ("May 2031 — $2,847/mo")
**Verify**: Tooltip appears on hover; snaps correctly to data points; disappears
when mouse leaves the chart area; label text is correctly formatted
**Status**: Not Started

---

## Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Plan input | Single 5-option dropdown | One control fully specifies rules + AFC params; no ambiguity for Noncontributory |
| Service accrual | Ongoing by default | Primary audience is active employees; later retirement = more service + higher pension |
| Last day of service | Optional date input, blank = active | Covers separation/modelling use cases without cluttering the common case |
| AFC source | Scanning populates Monthly AFC field | Replaces manual entry in the common case; user can edit the value before drawing |
| AFC field | Single editable text input | Scanning fills it; user may override; Calculate requires it to be non-empty |
| AFC parameters | Auto-selected from plan variant | User shouldn't need to know ERS rules; single source of truth |
| Plan-change prompt | Confirm before overwriting non-empty AFC | Prevents silent loss of a manually edited value; recomputes from in-memory stubs on confirm |
| AFC monthly | dpTotal / N / 12 | DP total is sum of annual earnings; pension formula needs monthly |
| Chart library | D3.js v7 (inlined) | Full axis control; SVG resolution-independent; `line.defined()` handles gaps |
| Multiple curves | Single curve | No use case expressed for overlays |
| Age penalty | 6%/yr below normal retirement age | Consistent across all plans per PDFs |
| Penalty granularity | Whole years (floor) | PDFs say "each year under age 62" — no monthly pro-ration; produces staircase curve |
| Retirement option | Maximum Allowance only | Survivor reductions require actuarial factors not in source docs |
| Plan scope | All three plans (5 variants) | Minimal added complexity; maximises usefulness |
| Mixed service | Not supported — **most likely to change** | Additive formula known; at least one intended user has mixed Hybrid+Noncontributory service; deferred to follow-on |
| X-axis orientation | Earlier dates on left | Curve slopes up-right naturally; matches conventional graph reading direction |
| CLI harness | Removed | Paystub directory can't be passed via URL; limited value |
| Delivery | Single HTML file | No server, no install; works offline from `file://` |
| Debug UI | Collapsed by default | Keep for troubleshooting; not in main flow |

---

## Open Questions

None currently blocking implementation.
