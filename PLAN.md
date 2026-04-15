# ERS Pension Graph — Implementation Plan

## Purpose

A browser-based application that plots **monthly pension at retirement (X) vs. retirement date (Y)**
for a Hawaii ERS member. The user enters inputs via an HTML form; the app calculates
the Maximum Allowance pension for every eligible retirement month and plots the curve.

Delivered as:
- A single `index.html` file (HTML + inlined JS + inlined CSS) that works standalone
  in any browser, including from `file://` with no server
- An optional Groovy CLI harness (`graphret`) that accepts input params, constructs a
  `file://` URL with query parameters, and opens `index.html` in the default browser
  with the graph pre-calculated

---

## Source Documents

- `Retirement-Information-Hybrid-eff.-6.2022.pdf`
- `Retirement-Information-Noncontributory-eff.-6.2022.pdf`
- `Retirement-Information-Contrib-eff.-6.2022.pdf`
- `ContribHybrid201205.pdf`
- `ContribGeneral201205.pdf`
- `Noncontributory200912.pdf`
- `act-163-relating-to-employees-retirement-system.pdf`

---

## Pension Calculation Formula

```
Monthly Pension (Maximum Allowance) = Multiplier × Years_of_Credited_Service × AFC_monthly
```

Early retirement penalty (fractional years, smooth curve):
```
years_early = normal_retirement_age - exact_age_at_retirement_month
factor      = max(0.0, 1.0 - 0.06 × years_early)
pension     = multiplier × (service_months / 12) × AFC × factor
```

`exact_age_at_retirement_month` is computed in fractional years (months of precision),
giving a smooth continuous curve through the early-retirement window rather than a
staircase. This is intentional — the graph is a planning tool, not an official estimate.

AFC is entered by the user as a monthly dollar amount and treated as fixed.

---

## Plan Rules

### Hybrid Plan

| Rule | Membership after Jun 30 2012 | Membership before Jul 1 2012 |
|---|---|---|
| Multiplier | 1.75% | 2.00% |
| AFC basis | avg 5-highest base-pay years | avg 3-highest gross years |
| Normal retirement | Age 65 w/10 yos **or** Age 60 w/30 yos | Age 62 w/5 yos **or** Age 55 w/30 yos |
| Early retirement | Age 55 w/20 yos | Age 55 w/20 yos |
| Normal retirement age (for penalty) | 65 (or 60 if 30 yos met first) | 62 (or 55 if 30 yos met first) |
| Early retirement penalty | 6% per year below normal retirement age | 6% per year below normal retirement age |
| Vesting | 10 yos | 5 yos |
| Post-retirement increase | 1.5%/yr | 2.5%/yr |

### Contributory Plan (General Employees)

| Rule | Membership after Jun 30 2012 | Membership before Jul 1 2012 |
|---|---|---|
| Multiplier | 1.75% | 2.00% |
| AFC basis | avg 5-highest base-pay years | avg 3-highest gross years |
| Normal retirement | Age 60 w/10 yos | Age 55 w/5 yos |
| Early retirement | Age 55 w/25 yos | Any age w/25 yos |
| Normal retirement age (for penalty) | 60 | 55 |
| Early retirement penalty | 6% per year below normal retirement age | 6% per year below normal retirement age |
| Vesting | 10 yos | 5 yos |
| Post-retirement increase | 1.5%/yr | 2.5%/yr |

### Noncontributory Plan

| Rule | Value |
|---|---|
| Multiplier | 1.25% |
| AFC basis | avg 3-highest years |
| Normal retirement | Age 62 w/10 yos **or** Age 55 w/30 yos |
| Early retirement | Age 55 w/20–29 yos |
| Normal retirement age (for penalty) | 62 (or 55 if 30 yos met first) |
| Early retirement penalty | 6% per year below age 62 (explicitly stated in PDFs) |
| Post-retirement increase | 2.5%/yr |

---

## Eligibility Logic (per candidate retirement month M)

1. `ageAtM` — exact fractional age derived from DOB and M (months precision)
2. `serviceAtM` — current credited service (months) + months elapsed from today to M
3. Determine status:
   - **Normal**: meets either normal age+service threshold → no penalty
   - **Early**: meets early age+service threshold but not yet normal → apply penalty
   - **Ineligible**: neither met → no point plotted
4. For plans with two normal thresholds (e.g., 65/10 or 60/30): the first threshold
   met determines when the penalty ends; use the lower normal retirement age for
   penalty calculation once the higher service count is reached
5. `factor = Math.max(0, 1 - 0.06 * (normalRetirementAge - ageAtM))` (only when early)
6. `pension = multiplier * (serviceAtM / 12) * afc * factor`

---

## Inputs

### HTML Form (manual use)

| Field | Control | Notes |
|---|---|---|
| Plan type | Dropdown | Hybrid / Contributory / Noncontributory |
| Membership date | Date input | Determines pre/post-2012 rule set |
| Date of birth | Date input | Used to compute age at each future date |
| Current credited service | Two number inputs (years + months) | Projected forward from today |
| AFC (monthly $) | Number input | Treated as fixed |

### URL Query Parameters (CLI / pre-fill)

| Param | Example |
|---|---|
| `plan` | `hybrid`, `contributory`, `noncontributory` |
| `membershipDate` | `2015-03-01` |
| `dob` | `1975-06-15` |
| `serviceYears` | `11` |
| `serviceMonths` | `4` |
| `afc` | `4500` |

If all params are present and valid on load, the form is pre-filled and the chart
rendered immediately without user interaction.

---

## Layout

```
┌─────────────────────────────────────┐
│  [Form: 5 inputs]  [Calculate]      │
├─────────────────────────────────────┤
│  Status line (errors / warnings)    │
├─────────────────────────────────────┤
│                                     │
│  D3 SVG chart                       │
│                                     │
└─────────────────────────────────────┘
```

The status line shows:
- Input validation errors (missing/invalid fields)
- "No eligible retirement dates found in this range" if data series is empty
- Clear (hidden) when chart renders successfully

---

## Graph Specification

**Technology**: D3.js v7, rendered to SVG, inlined into `index.html` (~260KB minified).
SVG output is resolution-independent.

**Axes**:
- X axis (horizontal): Monthly Pension ($), `d3.scaleLinear()`
- Y axis (vertical): Retirement Date, `d3.scaleTime()`
- Y orientation: earlier dates at **bottom**, later dates at **top** — curve slopes
  naturally up-right (retire later → higher pension)

**X axis — Monthly Pension ($)**
- Range: $0 → max computed pension rounded up to nearest $1,000
- Major ticks every $1,000: labeled, full-height tick line
- Minor ticks every $100: unlabeled, shorter tick line
- Implemented via `axis.tickValues()` with two separate `<g>` tick layers

**Y axis — Retirement Date**
- Lower bound: first day of next calendar month (runtime)
- Upper bound: member's earliest normal retirement date + 10 years;
  if already past normal retirement eligibility: today + 10 years
- Major ticks on January 1 of each year: labeled with 4-digit year, full-height tick line
- Minor ticks on 1st of every other month: unlabeled, shorter tick line
- Implemented the same way as X axis tick layers

**Plot**
- `d3.line()` with `line.defined(d => d.pension !== null)` — gaps for ineligible months
- Shaded `<rect>` behind the curve covering the ineligible date range, labeled
  "Not yet eligible"
- Slope kink naturally visible where penalty factor reaches 1.0 at normal retirement
- Hover tooltip: vertical/horizontal crosshair lines + label showing date and pension
  (e.g., "May 2031 — $2,847/mo")
- Title: "ERS Monthly Pension vs. Retirement Date"
- X label: "Monthly Pension — Maximum Allowance ($/month)"
- Y label: "Retirement Date"

---

## CLI Harness

Language: Groovy script (`graphret`)

Responsibilities:
1. Parse named CLI arguments (`--plan`, `--dob`, `--membershipDate`, `--serviceYears`,
   `--serviceMonths`, `--afc`)
2. Validate all required params are present; print usage and exit on error
3. Resolve absolute path to `index.html` (relative to script location)
4. Construct `file:///absolute/path/index.html?plan=hybrid&dob=...`
5. Call `java.awt.Desktop.desktop.browse(uri)` — cross-platform, no OS detection needed

~35 lines. No dependencies beyond the JDK.

---

## Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Chart library | D3.js v7 (inlined) | Full axis control; native major/minor tick support; SVG is resolution-independent; `line.defined()` handles gaps cleanly |
| Age penalty rate | 6% per year below normal retirement age | No explicit rate in PDFs for Hybrid/Contributory; consistent with Noncontributory's stated rate |
| Penalty calculation | Fractional years (months precision) | Smooth curve; graph is a planning tool, not an official estimate |
| Retirement option | Maximum Allowance only | Survivor option reductions require actuarial factors not in source docs |
| Plan scope | All three plans | Minimal added complexity; maximises usefulness |
| Mixed Hybrid+Noncontributory service | **Not supported — most likely to change** | At least one intended user has mixed service; additive formula is known, deferred to follow-on |
| AFC | User-entered fixed value | Salary trajectory modelling requires too many assumptions |
| Delivery | Single HTML file (~270KB) | No server, no install, works offline and from `file://`; shareable as file or static host |
| CLI harness | Groovy + `Desktop.browse()` | Language preference; cross-platform without OS detection |
| Y-axis orientation | Earlier dates at bottom | Curve slopes up-right naturally; matches conventional graph reading direction |

---

## Implementation Stages

### Stage 1: HTML scaffold
**Goal**: `index.html` with form, status line, empty SVG chart area, and D3 inlined
**Success**: Page loads from `file://`; form visible; D3 available; no console errors
**Status**: Not Started

### Stage 2: Calculation engine
**Goal**: Self-contained JS function `calculateSeries(params)` returning array of
`{date, pension}` — `pension` is `null` for ineligible months
**Success**: Correct values for all cases:
- Hybrid post-2012: normal retirement, early retirement with penalty, ineligible
- Hybrid pre-2012: same
- Contributory post-2012: same
- Contributory pre-2012: "any age w/25 yos" early retirement
- Noncontributory: normal, early with 6% penalty, ineligible
- Dual normal threshold: penalty ends correctly when either condition is first met
**Status**: Not Started

### Stage 3: Form wiring + URL params
**Goal**: Calculate button calls `calculateSeries()` with form values; URL params
pre-fill form and auto-trigger on load if all present and valid
**Success**: Manual form entry and CLI-supplied URL params both produce identical results
**Status**: Not Started

### Stage 4: Chart rendering
**Goal**: D3 SVG chart matching the graph specification
**Success**:
- Correct axis ranges and orientation
- Major and minor ticks on both axes at specified intervals
- Curve with gaps at ineligible months
- Shaded ineligible region with label
- Hover tooltip with crosshairs
- Status line shows error message when series is empty
**Status**: Not Started

### Stage 5: CLI harness
**Goal**: Groovy script `graphret` parses args, constructs URL, opens browser
**Success**: `./graphret --plan hybrid --dob 1975-06-15 --membershipDate 2015-03-01
--serviceYears 11 --serviceMonths 4 --afc 4500` opens browser with chart rendered
**Status**: Not Started
