# Raises projection: month-level windowing, paystub-only

Replace the closed-form `applyRaises` shortcut with a principled month-level
windowing projector, gate raise projection behind paystub presence, and
delete the dead `nonreg-afc` field.

Background and rationale: see DESIGN.md "Projected Raises — Currently
Suppressed" — the suppression is exactly because the closed-form blend is
silently wrong on plans whose AFC includes overtime/bonuses (Noncontributory;
pre-2012 gross-pay tiers). With paystub data we have per-stub per-category
earnings (`scoreStub` already supports `'regular'` vs `'total'` modes at
`index.html:1524`), so we can synthesize a real past+future monthly stream
and re-pick the highest-N annual averages for each candidate retirement
month. Manual AFC entry can't supply that decomposition honestly, so it
loses raise projection entirely.

Out of scope:
- Renaming `manual-afc` → `reg-afc` (per `next.md`). Once `nonreg-afc` is
  gone there's only one AFC input again, so the rename loses its motivation.
  Defer; revisit only if a follow-up reintroduces a second field.

---

## Stage 1: Delete the `nonreg-afc` field

Goal: Remove all DOM, JS, CSS, and event-handler references to the dead
`nonreg-afc` field; it has no functional effect today and the new plan does
not need it. |
Success: `grep -i nonreg index.html` returns no matches; existing manual-AFC
and paystub flows behave identically to before; URL pre-fill still works
(no `nonreg-afc` param exists, so no migration needed). |
Tests:
1. Open `index.html` with a paystub-driven scenario — chart still renders.
2. Open `index.html?plan=noncontributory&dob=1966-05-01&memDate=2002-04-17&svcYears=24&svcMonths=9&svcAsOf=2026-01-31&afc=10078.67&slHours=2124&slAsOf=2026-03-31` (from `notes.md`) — Generate-graph still works.
3. Switch plan dropdown between hybrid / contributory / noncontributory and confirm no JS errors (no orphan `nonregAfcEl.value` reads).
4. `runClear()` resets cleanly. |
Status: Complete (28 lines removed from index.html; `next.md` deleted)

---

## Stage 1.5: Extract pure logic to `lib/pension.js`

Goal: Move all pure functions, data tables, and constants from the inline
`<script type="module">` in `index.html` into a new vendored sibling
`lib/pension.js`, loaded via a classic `<script src="lib/pension.js">` tag
just like `d3-7.9.0.min.js` and `pdfjs-3.11.174.min.js` (`index.html:555-556`).
The motivation is testability: Stages 2/3/4 each ship pure functions whose
correctness should be verified by Node-based unit tests, and an inline
script in HTML can't be `require`'d without an awk/extract dance. Classic
script semantics (top-level `function`/`const` declarations become globals)
mean the existing `type="module"` block can keep referencing them by name
with no other change. A small UMD-style footer
(`if (typeof module !== 'undefined') module.exports = {...}`) makes the
same file directly `require`-able in Node. |
Success:
- New file `lib/pension.js` exists; existing `<script type="module">` block
  in `index.html` no longer contains the moved declarations.
- `node -e "require('./lib/pension.js')"` succeeds with no errors.
- `<script src="lib/pension.js"></script>` line appears in `index.html`
  before the inline module script, alongside the d3/pdfjs script tags.
- The app behaves identically — open the noncontributory URL from
  `notes.md`, hit Generate, confirm the chart matches the pre-refactor
  output (visually). |
Tests:
1. `node -e "const P = require('./lib/pension.js'); console.log(Object.keys(P).length)"`
   prints a positive integer.
2. Browser smoke test: open `index.html` with the `notes.md` URL — chart
   renders, AFC fills, no console errors.
3. The synthetic Stage 2 unit tests can be rewritten as
   `const { buildPaystubStream } = require('./lib/pension.js')` instead
   of the awk-extract pattern. |
Status: Complete

What moves (pure):
- Constants: `IGNORED`, `LUMP_SUM_VACATION`, `PRE_1971_DATE`, `RAISES`,
  `PRIMARY_ARF_TABLES`, `PLAN_CONFIGS`.
- Date utils: `parseDate`, `addMonths`, `addDays`, `fmtDate`,
  `monthsBetween`, `fractionalAge`, `parseIsoDate`, `serviceAtMonth`.
- Plan logic: `derivePlanKey`, `primaryArfAge`, `primaryEligAge`,
  `primaryEligibility`, `primaryARF`.
- Math helpers: `sickLeaveToMonths`, `applyRaises`, `blendedBenefit`,
  `calculateSeries`.
- Paystub pipeline: `filterStubs`, `generateWindows`, `scoreStub`,
  `buildPaystubStream`, `solveDP`, `detectGaps`.
- Pre-1971 helper: `isPre1971DualMethod` — refactored to take `memDate`
  as a parameter instead of reading `memDateEl.value` directly.

What stays in `index.html` (DOM-bound):
- All `getElementById` references and event handlers.
- `canCalculate`, `validateMemDate`, `runCalculate`, `maybeCalculate`,
  `runClear`.
- `computeAndFillAfc`, `computeDualMethodAfc` (write to `manualAfcEl`).
- `renderWindowsSection`, `updateRegularEarningsDisplay`.
- `drawChart`, `drawSeriesTable` (D3 + DOM).
- All form-syncing functions (`syncLastDayState`, `syncSvcSplitVisibility`).
- URL-parameter pre-fill, `buildReloadUrl`, `updateReloadLink`.
- PDF picker / paystub-extraction flow.
- `_debug` handle setup.
- `commitAfc`, `applyRaisesNALock`.

After this stage, Stage 2 verification resumes — but the Node test simply
`require`s `lib/pension.js` instead of regex-extracting from HTML.

---

## Stage 2: Build a per-month regular-pay + total-pay stream from paystubs

Goal: Produce a per-calendar-month historical earnings array
`stream = [{ month: Date, regular: Number, total: Number }]` derived from the
`stubs` already produced by `filterStubs` (`index.html:1464`). Each entry is
that calendar month's earnings under the two scoring modes already supported
by `scoreStub`. This is internal data; no UI change. |
Success:
- `window._debug.lastPaystubStream` exposes the array after a successful
  `computeAndFillAfc` run.
- For a paystub set covering N calendar months, the array has exactly N
  entries, sorted ascending by month, with no gaps (zero-fill missing
  months between the earliest and latest stubs).
- `regular` ≤ `total` for every month.
- For `mode === 'regular'` plans the existing AFC value matches the highest
  N-year average computed from `stream[*].regular` (sanity check). |
Tests:
1. Use the noncontributory URL from `notes.md` after wiring up paystubs (or whatever paystub fixture is available); inspect `_debug.lastPaystubStream`.
2. Confirm a synthetic stub set spanning Jan–Jun produces 6 entries, no gaps.
3. Confirm a stub set with a 1-month gap fills the gap with `{regular:0, total:0}`. |
Status: Complete (5 cases passing in `tests/pension.test.js`; run with `node --test`)

Notes:
- Paystubs never cross calendar-month boundaries (decided per project
  context — every pay period is fully contained within a single calendar
  month). Each stub's earnings are attributed in full to the calendar month
  containing its `beginDate` / `endDate`. Multiple stubs in the same month
  sum together. No proration logic needed.
- Stage 3 will consume this; keep the function pure (input: stubs array;
  output: stream).

---

## Stage 3: Implement the windowing AFC projector

Goal: New pure function in `lib/pension.js`:

```
projectAfcAtRetirement({
  stream,        // [{month: Date, regular: Number, total: Number}], sorted ascending, gaps zero-filled
  retDate,       // Date — candidate retirement date
  currentMonth,  // Date (1st of month) — boundary between past and future
  raises,        // [{date: Date, rate: Number}] — usually the module RAISES export
  N,             // Number — averaging-window length in years (PLAN_CONFIGS[*].N)
  mode,          // 'regular' | 'total' | 'totalInclVacation' | 'totalExclVacation'
  lastDayOfSvc,  // Date | null — caps future projection (separation)
}) → Number | null
```

Returns the projected monthly AFC at `retDate`, or `null` if fewer than N
twelve-month windows are available.

Algorithm:

1. **Regular base.** Walk `stream` from the latest entry backward and take
   the first non-zero `regular`. If none (stream empty or all zero), base = 0.
2. **Projection horizon.** Let `cap = min(retDate, lastDayOfSvc ?? retDate)`,
   collapsed to the 1st of its calendar month. Generate one future entry per
   month from `currentMonth` (1st) through `cap` inclusive. Each future
   entry's `regular = base × Π_{r ∈ raises, r.date ≤ month}(1 + r.rate)`;
   `total = regular` (future NR is always 0 per the project decision).
3. **Concatenate.** `all = past ++ future`, where `past` keeps only stream
   entries with `month < currentMonth`. Stream entries at or after
   `currentMonth` (if any) are dropped — the projection is authoritative
   for those months.
4. **Score.** Per-month score `s(m)`:
   - `'regular'` → `m.regular`
   - `'total'` or `'totalInclVacation'` → `m.total`
   - `'totalExclVacation'` → `m.total` for now (TODO: subtract per-month
     vacation column once `buildPaystubStream` adds one; pre-1971 dual-method
     is the only consumer)
5. **Rolling 12-month sums.** For every starting index `i` in `all` with
   `i + 12 ≤ all.length`, form `S_i = Σ_{j=0..11} s(all[i+j])`. Discard any
   window whose last month exceeds `retDate`'s calendar month (in practice
   none, since `cap ≤ retDate` already bounds `all`).
6. **Top-N non-overlapping selection (DP).** Pick the `N` highest-summing
   windows subject to no two windows sharing any month — matching the
   official ERS rule ("highest twelve consecutive months throughout your
   career, the next highest, …"; see
   `info/Retirement-Information-Noncontributory-eff.-6.2022.md:113`) and
   the existing `solveDP` semantics for paystub-driven AFC. Standard DP:
   `dp[k][i]` = best sum of `k` windows whose last window ends at or
   before month-index `i`; recurrence
   `dp[k][i] = max(dp[k][i-1], dp[k-1][i-12] + S_{i-11})`. Return `null`
   if `dp[N][last]` is undefined (insufficient windows).
7. **Average.** AFC = `dp[N][last] / (N × 12)`.

|
Success:
- Pure function, no DOM. Lives in `lib/pension.js`, exported alongside
  `applyRaises`.
- **Closed-form exactness (saturated):** For a stream where `regular ≡
  total` at every month, every raise dated at least `N × 12` months
  before `retDate`, and ≥ `N × 12` months of constant pre-raise history,
  the projector output equals `applyRaises(base, retDate, N, lastDayOfSvc)
  = base × Π(1 + r_i)` to within 1¢. (All top-N windows are entirely
  post-all-raises and have identical sum.) See Notes for why partial
  blends do NOT match closed-form.
- **NR-dominated past:** For past `regular = 5000`, `total = 6000`,
  single 5% raise at `currentMonth`, `mode = 'total'`: regardless of how
  far out `retDate` extends, AFC stays at `6000` (the past total) until
  the cumulative raise multiplier on `regular` exceeds `total / regular =
  1.20`. This is the documented divergence from `applyRaises` that
  motivates the refactor (DESIGN.md:168–176). |
Tests (`tests/pension.test.js`):
1. Flat stream `regular = total = 5000`, no raises, `mode = 'regular'`,
   any `retDate` with ≥ N×12 history → `5000` exactly.
2. Flat stream `5000`, single raise `(D, 0.05)` where `D` is at least
   `N × 12` months before `currentMonth`, `retDate ≥ D + N × 12 months`
   (so all top windows are post-raise) → `5000 × 1.05 = 5250` exactly.
3. Past `regular = 5000`, `total = 6000` for ≥ N×12 months; raise of 5%
   at `currentMonth`; `retDate = currentMonth + 1 month`; `mode = 'total'`
   → `6000` exactly (top N windows are all historical, scored at total).
4. Same stream, `retDate = currentMonth + N × 12 months`; `mode = 'total'`
   → `6000` exactly (still — projected future at 5250 < past total 6000;
   top-N stays in the past). The dominance persists at any retDate until
   compounded raises drive future regular above 6000.
5. Same stream, but with raises totalling > 20% (e.g. four 5% raises
   compounded at 1-yr intervals → ~21.6%); `retDate` chosen so
   `retDate ≥ last_raise + N × 12 months` AND there are ≥ N×12 future
   months at the maximally-raised value `5000 × 1.05^4 ≈ 6077`; mode =
   `'total'` → AFC equals `5000 × 1.05^4` exactly (future now beats past).
6. Equivalence with `applyRaises` over the module's real `RAISES` array:
   flat regular≡total stream of length ≥ N×12, `retDate ≥ last raise +
   N × 12 months` → projector output equals `applyRaises(base, retDate,
   N, null) = base × Π(1 + r_i)` to within 1¢.
7. Edge case: insufficient windows — total `all.length < 12 × N` plus
   non-overlap forcing — returns `null`. |
Status: Complete (7 cases passing in `tests/pension.test.js`; module export
added; closed-form match with `applyRaises` verified on saturated
module-RAISES scenario; NR-dominated past correctly persists at $6000
across all retDate horizons until cumulative raises exceed the markup)

Notes:
- **Why partial blends do not match closed-form.** `applyRaises` is a
  linear-blend heuristic that approximates the average over the N-year
  window ending at `retDate`. The official ERS rule is top-N
  *non-overlapping* highest-paid 12-month periods (anywhere in the
  career), which `solveDP` and this projector implement. With a single
  raise mid-window, the rolling-window approximation `X · (1 + r · k/(N×12))`
  used by `applyRaises` differs from the actual non-overlapping-DP
  selection by a discretization remainder and a boundary off-by-one in
  `monthsBetween`. The two converge only when blends saturate to 1
  (raise ≥ N years before `retDate`), at which point every top-N window
  has identical post-all-raises score and both formulas reduce to
  `base × Π(1 + r_i)`.
- **Why multi-raise needs full saturation for closed-form match.**
  `applyRaises` compounds blends: `Π(1 + r_i · b_i)`. Even ignoring the
  partial-blend issue above, the compounded form differs from the
  averaged-cohorts form unless every `b_i = 1`. For our union contract
  (raises ~1 yr apart) and `N = 5`, `retDate ≥ last_raise + 5 yr` is the
  saturation threshold for an exact match.
- **Monotonicity & pruning (informational; do not implement in Stage 3).**
  The optimal top-N is monotone non-decreasing in `retDate`: any window
  feasible at `retDate = t` is still feasible at `t' > t`, and new
  candidate windows added between `t` and `t'` lie strictly in the
  future. Therefore the threshold (Nth-highest selected sum) at `t` is a
  lower bound on the threshold at any `t' > t`, and any past or future
  window with sum strictly below the running threshold can never enter
  the optimal solution at any future `retDate`. This enables an
  incremental DP across the 600 retDate rows in `calculateSeries` —
  carry forward the dp[][] state and the discard set rather than
  re-running solveDP from scratch each call. Defer to Stage 4 (or later);
  Stage 3 should implement the simple per-retDate DP and verify
  correctness first.

---

## Stage 4: Wire the projector into `calculateSeries`

Goal: Inside `calculateSeries` (`index.html:1321`), when a paystub stream is
available, replace the `applyRaises(afcMonthly, …)` call at L1379 with
`projectAfcAtRetirement({ stream, retDate, … })`. When no stream is
available (manual AFC entry), set `pensionWithRaises`,
`pensionRaisesCurrentSL`, and `pensionRaisesProjectedSL` to `null` for
every row. |
Success:
- Existing curves on a no-paystub manual-AFC scenario are unchanged.
- Paystub-driven scenarios now produce non-null `pensionWithRaises` rows
  whose values are computed via the windowing projector (verifiable via
  `window._debug.lastSeries`).
- The `raisesActive` gate (`index.html:1380`) still suppresses the curve
  when no scheduled raise lies between today and `lastDayOfSvc`. |
Tests:
1. Paystub-driven hybrid post-2012 (regular-only AFC plan): the new
   projector's output matches the old `applyRaises` output to within 1¢.
2. Paystub-driven noncontributory: the new projector's output diverges
   from what `applyRaises` would have given (sanity-check the divergence
   direction matches the DESIGN.md diagnosis).
3. Manual AFC entry on any plan: no `pensionWithRaises` values appear in
   `_debug.lastSeries`. |
Status: Not Started

---

## Stage 5: Un-suppress raise curves for the paystub path

Goal: Replace the hardcoded `showRaises = false` (at `index.html:2018` and
`:2498`) with a derived flag: raise curves render iff a paystub stream is
present AND the user hasn't checked "Projected raises do not apply" AND no
committed `lastDayOfSvc` cutoff has eliminated all raises. Hide the
`#group-contractual-input` fieldset when no paystub stream is present (since
its only job is to gate raises). |
Success:
- Manual-entry users see no raises UI at all (no fieldset, no checkbox, no
  curves, no table columns, no legend entries).
- Paystub users see the contractual fieldset and raise curves; the
  "Projected raises do not apply" checkbox correctly suppresses curves
  while leaving the manual-AFC path unaffected.
- Hover tooltip's COLA suffix logic (`index.html:2701+`) handles the new
  "raises only present in some scenarios" reality without errors. |
Tests:
1. Manual-AFC scenario: no raise UI visible, no console errors.
2. Paystub-AFC scenario (hybrid post-2012): four purple raise curves
   appear; toggling raisesNA hides them.
3. Paystub-AFC scenario with `lastDayOfSvc` set before any future raise:
   raise curves remain hidden (existing `raisesActive` gate still works).
4. Hover tooltip on every curve in a paystub scenario shows the right
   suffix. |
Status: Not Started

---

## Stage 6: Update DESIGN.md and CLAUDE.md

Goal: Document the new flow. Replace the "Projected Raises — Currently
Suppressed" section in `DESIGN.md` with a description of the
paystub-gated month-level windowing. Update CLAUDE.md's "Where Things
Live" entry for `applyRaises` (gone or repurposed) and add an entry for
the new `projectAfcAtRetirement` and the per-month stream builder. |
Success: A reader new to the project can understand from the markdown
alone why raises depend on paystubs, what the windowing projector does,
and where to find each piece. |
Tests: N/A (docs). |
Status: Not Started

---

## Decided assumptions

- **Future non-regular pay is always 0.** Overtime in this employer's
  context is rare enough that the simplification is acceptable; raises
  apply only to regular pay, and projected future months contain no NR
  component. (No "expected future monthly NR" input is being added.)
- **Paystubs never cross calendar-month boundaries.** Every pay period is
  fully contained within one calendar month, so per-stub earnings can be
  attributed in full to the month containing its dates without proration.

## Open questions

1. **Pre-1971 dual-method**: Stage 3's `totalExclVacation` mode needs a
   per-month vacation column in the stream. Currently zero-filled — fine
   for non-pre-1971 members, surfaces as a known limitation otherwise.
