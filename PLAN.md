# Plan: Add Official ERS Calculator Line to Chart

## Background

The official calculator's JS runs entirely client-side. The pension math for hybrid/contributory plans
uses a **5%/year** early-retirement penalty (with month-level granularity), while noncontributory uses
**6%/year**. `index.html` has been updated to use the correct rates per plan via `earlyPenalty` in
`PLAN_CONFIGS`. The remaining discrepancy is that `index.html` applies the penalty in whole-year steps
(staircase), whereas the official calculator uses a lookup table with month-level granularity (smooth).

The official ARF (Age Reduction Factor) is a lookup table keyed by `[year][month]` at retirement,
where year/month are computed with a specific rounding rule (days ≥ 15 rounds up to next month).
The tables themselves are small enough to embed directly.

---

## Stage 1: Embed the official ARF tables and age-rounding function ✓

**Completed.** Added to `index.html` immediately after `PLAN_CONFIGS`:

- `OFFICIAL_ARF_TABLES` constant with `tier1`/`tier2` sub-objects each containing the relevant
  table(s): `tableH` (hybrid), `tableNonCon` (noncontributory, tier1 only), `tableCon1`
  (contributory). Copied verbatim from `ers/_js/scripts/ers.data.js` and `ers.dataNew.js`.
- `officialArfAge(dob, retDate)` → `{year, month}` using the official rounding (days ≥ 15
  rounds up to the next month; month overflow carries into year).
- `window._debug = { officialArfAge, OFFICIAL_ARF_TABLES }` to expose both for console testing
  (required because the script uses `type="module"`, which has its own scope).

**Validated in Firefox console:**
```js
_debug.officialArfAge(new Date('1975-06-15'), new Date('2033-01-01'))
// → { year: 57, month: 7 }
// Trace: dayDiff=1-15=-14 → monthDiff-=1, dayDiff+=30=16 → monthDiff=-6+12=6,
//        yearDiff=58-1=57 → dayDiff 16>=15 → monthDiff=7 → { year:57, month:7 }

_debug.OFFICIAL_ARF_TABLES.tier2.tableH[57][6]  // → 0.62506
_debug.OFFICIAL_ARF_TABLES.tier2.tableH[65]     // → undefined (normal retirement; ARF=1)
```

---

## Stage 2: Add official eligibility and ARF lookup

**Goal:** Compute whether the official calculator would call a given retirement date Regular,
Early, or Ineligible, and what ARF it would apply.

**What was added:**

- `officialEligAge(dob, retDate)` → `{year, month, day}` — eligibility age with no day-rounding
  (the official calculator uses a separate age calculation for eligibility vs. ARF lookup).
- `officialEligibility(plan, eligAge, svcYears)` — returns `'regular'`, `'early'`, or
  `'ineligible'`. Takes the `eligAge` object directly. Tier is derived from the plan name.
- `officialARF(eligibility, plan, arfYear, arfMonth)` — returns the ARF from the lookup tables.
  Tier and table key are derived from the plan name. Returns 1 for regular, 0 for ineligible.
- `window._debug` updated to expose all four functions.

**Manual validation — run these in the Firefox console after reloading:**
```js
const { officialArfAge, officialEligAge, officialEligibility, officialARF, OFFICIAL_ARF_TABLES } = _debug;

// 1. Early retirement case: DOB 1975-06-15, retire 2033-01-01, 25 years service
const arfAge  = officialArfAge(new Date('1975-06-15'), new Date('2033-01-01')); arfAge
// → { year: 57, month: 7 }
const eligAge = officialEligAge(new Date('1975-06-15'), new Date('2033-01-01')); eligAge
// → { year: 57, month: 6, day: 17 }  (no day-rounding, so month stays at 6)
const elig = officialEligibility('hybrid-post2012', eligAge, 25); elig
// → 'early'  (age 57 >= 55, service 25 >= 20)
const arf = officialARF(elig, 'hybrid-post2012', arfAge.year, arfAge.month); arf
// → 0.629226  (OFFICIAL_ARF_TABLES.tier2.tableH[57][7])

// 2. Normal retirement case: DOB 1975-06-15, retire 2040-07-01, 32 years service
const eligAge2 = officialEligAge(new Date('1975-06-15'), new Date('2040-07-01')); eligAge2
// → { year: 65, month: 0, day: 16 }
const elig2 = officialEligibility('hybrid-post2012', eligAge2, 32); elig2
// → 'regular'  (age 65 >= 65, service 32 >= 10)
officialARF(elig2, 'hybrid-post2012', 0, 0)
// → 1

// 3. Ineligible case: DOB 1975-06-15, retire 2030-01-01, 18 years service
const eligAge3 = officialEligAge(new Date('1975-06-15'), new Date('2030-01-01')); eligAge3
// → { year: 54, month: 6, day: 17 }
const elig3 = officialEligibility('hybrid-post2012', eligAge3, 18); elig3
// → 'ineligible'  (age 54 < 55)
officialARF(elig3, 'hybrid-post2012', 0, 0)
// → 0
```

Cross-check case 1 against the live ERS calculator
(https://ers.ehawaii.gov/resources/calculator/):

| Field | Value |
|-------|-------|
| Your Date of Birth | 06/15/1975 |
| Primary Beneficiary's Date of Birth | 01/01/1975 (placeholder; doesn't affect Maximum Allowance) |
| Monthly AFC | 5000 |
| Retirement Month/Year | January / 2033 |
| Membership Date | August / 1 / 2012 (puts member in Tier 2 = hybrid-post2012) |
| Plan checkbox | Hybrid Service only |
| Hybrid Years / Months | 25 / 0 |

Expected **Maximum Allowance: $1,376.00**

Derivation: `floor(round(5000 × 25 × 0.0175 × 0.629226, 2))` = `floor(1376.43)` = `$1,376.00`

And, to get the same result in the browser console (post reload):
```
const { officialArfAge, officialEligAge, officialEligibility, officialARF } = _debug;
const dob = new Date(1975, 5, 15);   // June 15 1975, local time                                                                          
const ret = new Date(2033, 0, 1);    // Jan 1 2033, local time
const arfAge  = officialArfAge(dob, ret);
const eligAge = officialEligAge(dob, ret);
const elig    = officialEligibility('hybrid-post2012', eligAge, 25);
const arf     = officialARF(elig, 'hybrid-post2012', arfAge.year, arfAge.month);
Math.floor(Math.round(5000 * 25 * 0.0175 * arf * 100) / 100)
```
outputs "1376"

---

## Stage 3: Add `officialPension` to the series ✓

**Completed.** `officialPension` is computed inside the `calculateSeries` loop for each row:

```js
const svcYrs  = Math.floor(svcAtM / 12);
const svcMos  = svcAtM % 12;
const eligAge = officialEligAge(dob, retDate);
const arfAge  = officialArfAge(dob, retDate);
const offElig = officialEligibility(plan, eligAge, svcYrs);
const arf     = officialARF(offElig, plan, arfAge.year, arfAge.month);
const officialPension = offElig === 'ineligible' ? null
  : Math.floor(Math.round(afcMonthly * (svcYrs + svcMos / 12) * config.multiplier * arf * 100) / 100);
```

`officialPension` is included in each `rows.push(...)` object. After `runCalculate`, the full
series is exposed as `window._debug.lastSeries`.

**Manual validation:**

Use DOB 06/15/1975, AFC $5,000, plan `hybrid-post2012`, 25 yrs service as of 2024-01-01.
After clicking Calculate, run in the Firefox console:

```js
// 1. Pick a row and read its service months — then cross-check against live calculator
const row = _debug.lastSeries.find(d => d.retDate.getFullYear() === 2033 && d.retDate.getMonth() === 0);
[row.svcAtM, row.officialPension]
// → [408, 1871]
// Service at Jan 2033 = 25 yrs + 108 months (Jan 2024 → Jan 2033) = 408 months = 34 yrs.
// Live ERS: DOB 06/15/1975, AFC $5,000, retirement Jan/2033, Hybrid 34/0 → $1,871 ✓

// 2. Find the first early-eligible row and cross-check it
const early = _debug.lastSeries.find(d => d.status === 'early');
[early.retDate.toISOString().slice(0,7), Math.floor(early.svcAtM/12), early.svcAtM%12, early.officialPension]
// Enter those service yrs/mos into live calculator for that retirement month

// 3. Find a normal retirement row; officialPension should be close to pension (both ARF=1)
const normal = _debug.lastSeries.find(d => d.status === 'normal');
[normal.retDate.toISOString().slice(0,7), normal.pension, normal.officialPension]
// Both values should be within a few dollars (smooth vs staircase disappears at normal age)

// 4. Confirm ineligible rows have officialPension === null
_debug.lastSeries.filter(d => d.status === 'ineligible').every(d => d.officialPension === null)
// → true
```

Key insight: `officialPension` at each row uses the accrued service at that retirement date,
**not** the entered service. Always read `row.svcAtM` first, then enter that amount in the
live calculator to compare.

---

## Stage 4: Draw the red line on the chart

**Goal:** Add the official series as a red line to the existing D3 chart.

**What to add:**

1. In the series-building section, compute `officialSeries` alongside the existing series.

2. In the D3 drawing section, add a fourth line path using the same `line` generator
   (with `.defined(d => d.officialPension !== null)`), bound to `officialSeries`, styled:
   ```js
   stroke: '#cc0000', strokeWidth: 1.5, strokeDasharray: none
   ```

3. Extend the hover tooltip to include the official value: when the cursor is near the red line,
   show a dot and label it `"$X,XXX/mo (official)"`.

4. Add a legend entry for the red line (label: "Official ERS").

5. The Y-axis max should already accommodate the official line since official values are higher
   than current values, but verify and adjust `yMax` computation if needed.

**Success criteria:** Red line appears on the chart, tracking slightly above the blue line in the
early-retirement zone, converging at normal retirement age.

**Manual validation:**
- Hover over the red line at a few dates and confirm the tooltip value matches what the live
  ERS calculator returns for that date.
- Confirm the red and blue lines converge at or near the normal retirement date (where ARF = 1
  for both).

---

## Notes

- `ers.data.js` / `ers.dataNew.js` are only needed for the table data extracted in Stage 1.
  Do not `<script src>` them — embed only the needed tables as a JS literal.
- The official calculator also uses a `lookupAge` (rounds retirement age to nearest year) for
  survivor-benefit option tables. We don't need that — we only need the Maximum Allowance line.
- Sick leave and annual raise rate: the official calculator doesn't model either; the red line
  should be the no-sick-leave, no-raise baseline (i.e., use current AFC and no sick leave credit).
- If the plan is `noncontributory`, use `tableNonCon`; for `contributory-*`, use `tableCon1`.
  The `hybrid-*` plans are the most common case and use `tableH`.
