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

## Stage 1: Embed the official ARF tables and age-rounding function

**Goal:** Get the raw data and the key age calculation into `index.html` with no UI changes.

**What to add** (inside a `<script>` block, above the existing JS):

1. A `OFFICIAL_TABLES` constant containing:
   - `tier1.tableH` — hybrid tier1 (pre-2012) ARF by [year 55–62][month 0–11]
   - `tier2.tableH` — hybrid tier2 (post-2012) ARF by [year 55–64][month 0–11]
   - `tier1.tableNonCon` — noncontributory ARF by [year 55–61][month 0–11]
   - `tier1.tableCon1` — contributory tier1 ARF by [year 28–54][month 0–11]
   - `tier2.tableCon1` — contributory tier2 ARF by [year 28–59][month 0–11]
   (Copy these verbatim from `ers/_js/scripts/ers.data.js` and `ers.dataNew.js`.)

2. A function `officialArfAge(dob, retDate)` → `{year, month}` using the official rounding:
   ```
   dayDiff  = retDate.day - dob.day
   monthDiff = retDate.month - dob.month
   yearDiff  = retDate.year - dob.year
   if dayDiff < 0:  monthDiff -= 1; dayDiff += 30
   if monthDiff < 0: monthDiff += 12; yearDiff -= 1
   if dayDiff >= 15: monthDiff += 1
   if monthDiff >= 12: yearDiff += 1   // no reset of monthDiff — year increments, month stays for lookup
   return {year: yearDiff, month: monthDiff % 12}
   ```

**Success criteria:** `officialArfAge` is available in the browser console.

**Manual validation:**
Open `index.html` in a browser, open the console, and run:
```js
// Example: DOB 1975-06-15, retirement 2033-01-01
officialArfAge(new Date('1975-06-15'), new Date('2033-01-01'))
// Expected: {year: 57, month: 6}  (57 years, 6 months + 17 days → rounds up to month 7)
// Cross-check: 2033-01 minus 1975-06 = 57y 7m minus 15d → dayDiff=1-15=-14<0 → monthDiff-=1→6, dayDiff+=30=16 → 16>=15 → monthDiff+1=7 → {year:57, month:7}
```
Try a few DOB/retirement combos and verify the year/month make sense.

---

## Stage 2: Add official eligibility and ARF lookup

**Goal:** Compute whether the official calculator would call a given retirement date Regular,
Early, or Ineligible, and what ARF it would apply.

**What to add:**

1. `officialEligibility(plan, ageYear, serviceYears, tier)` — port `getEligibility` from
   `ers.utils.js` verbatim, mapping `index.html` plan names to official plan types:
   - `hybrid-post2012`       → HYBRID / tier2
   - `hybrid-pre2012`        → HYBRID / tier1
   - `contributory-post2012` → CONTRIBUTORY / tier2
   - `contributory-pre2012`  → CONTRIBUTORY / tier1
   - `noncontributory`       → NON_CONTRIBUTORY / tier1

2. `officialARF(eligibility, plan, arfYear, arfMonth, tier)` — port `getARF` / table lookup:
   - REGULAR → return 1
   - INELIGIBLE → return 0
   - EARLY → `OFFICIAL_TABLES[tier][tableKey][arfYear]?.[arfMonth] ?? 1`
     where `tableKey` is `tableH` / `tableNonCon` / `tableCon1` per plan

**Success criteria:** Both functions callable from the console with no errors.

**Manual validation:**
```js
// hybrid-post2012, DOB 1975-06-15, retirement 2033-01-01
// Service at that date: say 25 years
const arfAge = officialArfAge(new Date('1975-06-15'), new Date('2033-01-01'))
// arfAge.year = 57
const elig = officialEligibility('hybrid-post2012', 57, 25, 'tier2')
// Expected: 'Early Retirement' (age 57 >= 55, service >= 20)
const arf = officialARF(elig, 'hybrid-post2012', arfAge.year, arfAge.month, 'tier2')
// Expected: OFFICIAL_TABLES.tier2.tableH[57][arfAge.month]  ≈ 0.625–0.646
```
Manually verify the returned ARF by looking up the same age/month in the tier2 `tableH` data you
embedded. Then enter the same values into the live ERS calculator and confirm the "Maximum Allowance"
matches `afc × serviceYears × 0.0175 × arf`.

---

## Stage 3: Add `officialPensionAtMonth(retDate)` and build the official series

**Goal:** Produce a series of `{date, pension}` pairs using the official formula, parallel to
the existing blue series. No chart changes yet — validate the numbers first.

**What to add:**

A function `officialPensionAtMonth(retDate)` that:
1. Computes `svcAtM` using the existing `serviceAtMonth()` (same service inputs)
2. Converts to `svcYears = svcAtM / 12` (fractional, not rounded — the official formula uses
   `afc × (hybridYear + hybridMonth/12) × multiplier × ARF` where it passes integer years and
   integer months; replicate that by doing `Math.floor(svcAtM/12)` for years and `svcAtM % 12`
   for months, matching how the form inputs would be filled)
3. Computes `ageYear` using `officialArfAge(dob, retDate).year` (for eligibility check — the
   official uses `getEligableAgeYear` for eligibility, which has *no* day-rounding, just
   `dayDiff < 0 → monthDiff -= 1, monthDiff < 0 → yearDiff -= 1`; add this as
   `officialEligAge(dob, retDate)` separately)
4. Calls `officialEligibility`, then `officialARF`
5. Returns `null` if INELIGIBLE; otherwise:
   `Math.floor(afc × (svcYears + svcMonths/12) × multiplier × arf)`
   where `multiplier` comes from the existing `PLAN_CONFIGS`

Then build `officialSeries` the same way `pensionSeries` is built (iterating over the same
month range), and `console.log` a few spot values.

**Success criteria:** `officialSeries` exists in the console with reasonable values.

**Manual validation (most important step):**
Pick 3–5 retirement dates spanning the early-retirement range and normal range. For each:
1. Read `officialSeries.find(d => d.date matches)` from the console
2. Enter the same DOB, AFC, service, and retirement date into the live ERS calculator
3. Compare the "Maximum Allowance" shown there to your `officialSeries` value
They should match exactly (or within $1 due to `Math.floor`).

If they don't match, this stage is where you debug before touching the chart.

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
