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
Status: Complete with amendment (truncation rule added 2026-05-06; see below)

Notes:
- Paystubs never cross calendar-month boundaries (decided per project
  context — every pay period is fully contained within a single calendar
  month). Each stub's earnings are attributed in full to the calendar month
  containing its `beginDate` / `endDate`. Multiple stubs in the same month
  sum together. No proration logic needed.
- Stage 3 will consume this; keep the function pure (input: stubs array;
  output: stream).
- **Trailing-incomplete-month truncation (amendment).** The output stream
  drops any trailing month that isn't anchored by a stub whose `endDate`
  falls on the last day of its calendar month — mirroring `generateWindows`'
  `lastAnchorEnd` logic at `lib/pension.js:608-616`. Rationale: surfaced
  during Stage 4.4 smoke test — the most recent calendar month often has
  only the first stub of its pay period at extraction time, so its
  `regular` value is roughly half the typical month. Used as the
  projector's "current rate" base, that half-month value drove
  saturated-future projections below past 12-month averages and
  suppressed every raise curve. With truncation, `stream[last]` is
  guaranteed to be a complete month and `base` is a stable "current rate"
  estimate. If no stub anchors a month-end, the function returns `[]`
  (caller falls back to manual-AFC behavior).
- Additional test: trailing mid-month stub triggers truncation; the
  resulting stream ends at the last fully-covered calendar month.

---

## Stage 3: Implement the windowing AFC projector

Goal: New pure function in `lib/pension.js`:

```
projectAfcAtRetirement({
  stream,        // [{month: Date, regular: Number, total: Number}], sorted ascending,
                 //   calendar-contiguous (Stage 2 truncates trailing incomplete months)
  retDate,       // Date — candidate retirement date
  raises,        // [{date: Date, rate: Number}] — usually the module RAISES export
  N,             // Number — averaging-window length in years (PLAN_CONFIGS[*].N)
  mode,          // 'regular' | 'total' | 'totalInclVacation' | 'totalExclVacation'
  lastDayOfSvc,  // Date | null — caps future projection (separation)
}) → Number | null
```

Returns the projected monthly AFC at `retDate`, or `null` if fewer than N
twelve-month windows are available, or if `stream` is empty.

The past/future boundary is derived from the stream itself: future
projection starts at the calendar month immediately after `stream[last].month`.
Caller does not pass a `currentMonth` — the truncated stream's last month
IS the boundary.

Algorithm:

1. **Regular base.** `base = stream[last].regular` if non-zero, else walk
   backward to the first non-zero entry. If `stream` is empty or all-zero,
   return `null`.
2. **Projection horizon.** Let `cap = min(retDate, lastDayOfSvc ?? retDate)`,
   collapsed to the 1st of its calendar month. Generate one future entry per
   month from `addMonths(stream[last].month, 1)` through `cap` inclusive.
   Each future entry's `regular = base × Π_{r ∈ raises, r.date ≤ month}(1 + r.rate)`;
   `total = regular` (future NR is always 0 per the project decision).
   If `cap < stream[last].month + 1`, future is empty.
3. **Concatenate.** `all = stream.filter(s => s.month <= cap).concat(future)`.
   The filter handles the case where `lastDayOfSvc` is in the past, capping
   the past portion. Because stream is calendar-contiguous and future
   begins immediately after stream's last month, `all` is calendar-contiguous
   by construction — array index `i` and `i+12` are exactly 12 calendar
   months apart, which is what the DP requires.
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
Tests (`tests/pension.test.js`) — wording assumes the boundary between past
and future is `stream[last].month + 1`, NOT a separately-passed `currentMonth`:
1. Flat stream `regular = total = 5000`, no raises, `mode = 'regular'`,
   any `retDate` with ≥ N×12 history → `5000` exactly.
2. Flat stream `5000`, single raise `(D, 0.05)` where `D` is at least
   `N × 12` months before `stream[last].month`, `retDate ≥ D + N × 12 months`
   (so all top windows are post-raise) → `5000 × 1.05 = 5250` exactly.
3. Past `regular = 5000`, `total = 6000` for ≥ N×12 months; raise of 5%
   at `stream[last].month + 1`; `retDate = stream[last].month + 2 months`;
   `mode = 'total'` → `6000` exactly (top N windows are all historical,
   scored at total).
4. Same stream, `retDate = stream[last].month + 1 + N × 12 months`;
   `mode = 'total'` → `6000` exactly (still — projected future at 5250 <
   past total 6000; top-N stays in the past). The dominance persists at
   any retDate until compounded raises drive future regular above 6000.
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
Status: Complete with amendment (7 cases passing in `tests/pension.test.js`;
amended 2026-05-06 to remove `currentMonth` parameter and derive the
past/future boundary from `stream[last].month + 1`. Rationale: surfaced
during Stage 4.4 smoke test — with `currentMonth = next month from today`
and an incomplete trailing month in the stream, future projection started
at the wrong point and a stale incomplete month corrupted `base`. New
design: stream is calendar-contiguous and ends at the last complete month
(per Stage 2 truncation); future continues from there with no gap.)

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

Goal: Replace `applyRaises(afcMonthly, …)` at `lib/pension.js:482` with
`projectAfcAtRetirement({ stream, retDate, … })` when a paystub stream is
available. When no stream is available (manual AFC entry), force
`pensionWithRaises`, `pensionRaisesCurrentSL`, and `pensionRaisesProjectedSL`
to `null` for every row. The `raisesActive` gate continues to suppress
raise curves when no scheduled raise lies in the projection horizon.

### Stage 4.1: Plumbing — extend `calculateSeries` signature

- Add one optional parameter: `paystubStream` (default `null`) — the array
  from `buildPaystubStream`, or `null`/`[]` for manual-AFC scenarios.
- Pull `mode` from `config.mode` (already on PLAN_CONFIGS), and `raises`
  from the module's `RAISES` constant.
- In `index.html:runCalculate`, compute
  `paystubStream = lastStubs.length ? buildPaystubStream(lastStubs) : null;`
  and pass it through. (Don't reuse `_debug.lastPaystubStream` — that's a
  debug surface, not a data path.)
- No math change yet; verify the existing `applyRaises` call still produces
  identical output for both paths. |
Success: existing tests still pass; manual smoke shows no chart change.

Note: an earlier iteration of this substage threaded a `currentMonth`
parameter alongside `paystubStream`. That parameter was removed during
the Stage 4.4 smoke-test amendment — the projector now derives the
past/future boundary from `stream[last].month + 1` (Stage 3 amendment).

### Stage 4.2: Math swap

- Inside `calculateSeries`, replace L482's `applyRaises` call with:
  ```js
  const raisedAfc = paystubStream && paystubStream.length
    ? projectAfcAtRetirement({
        stream: paystubStream, retDate,
        raises: RAISES, N: config.N, mode: config.mode, lastDayOfSvc,
      })
    : null;
  const raisesActive = raisedAfc != null && raisedAfc > afcMonthly;
  const pensionWithRaises = (offElig === 'ineligible' || !raisesActive) ? null
    : blendedBenefit(svcAtM, ncSvcMonths, raisedAfc, arf, plan, config);
  ```
- The SL-bearing branches use the same `raisedAfc`; when it's `null`, both
  `pensionRaisesCurrentSL` and `pensionRaisesProjectedSL` stay `null`.
- Edge case: if the projector returns `null` (insufficient windows), treat
  it the same as no stream — raise curves are inactive for that retDate.
- Update `noRaisesApply` lock in `index.html:1406` to be a no-op for the
  manual-AFC path (since `pensionWithRaises` is now structurally null
  there); behavior unchanged for paystub path. |
Success: Stage 4.3 tests pass; browser smoke passes.

### Stage 4.3: Tests in `tests/pension.test.js`

Test `calculateSeries` directly (it's pure, exported from `lib/pension.js`):

1. **Manual-AFC manual path:** `paystubStream = null`, hybrid-post2012 plan,
   reasonable inputs → every row's `pensionWithRaises`,
   `pensionRaisesCurrentSL`, `pensionRaisesProjectedSL` is `null`.
2. **Saturated regular-only paystub path:** `paystubStream` is a 60-month
   flat regular≡total stream at $5000, hybrid-post2012 (mode='regular',
   N=5), `lastDayOfSvc = null`, `currentMonth = today's next month`. For
   any row whose `retDate ≥ last_RAISE + 5 yr`, the row's projector AFC
   matches the legacy `applyRaises(5000, retDate, 5, null)` to within
   1¢ → `pensionWithRaises` matches what the old code would produce.
3. **NR-present noncontributory paystub path:** stream has 60 past months
   with `regular = 5000, total = 6000`, noncontributory plan (mode='total',
   N=3). For a near-term `retDate` the projector's AFC is `6000` while
   `applyRaises(5000, retDate, 3, null)` would give a smaller value —
   verify the divergence direction (projector ≥ legacy) and magnitude
   matches expectations.
4. **No-raises-in-horizon:** `paystubStream` present but
   `lastDayOfSvc < first scheduled RAISE` → `raisedAfc` (when computed)
   equals `afcMonthly`, so `raisesActive = false` and `pensionWithRaises`
   stays `null`. Validates the gate still works. |
Success: all four tests pass via `node --test`.

### Stage 4.4: Browser smoke test

User runs the calculator with:
1. Paystub directory loaded, hybrid plan → `_debug.lastSeries` rows have
   non-null `pensionWithRaises` for retDates past saturation. Chart
   unchanged (raise curves still suppressed by `showRaises = false`).
2. Manual AFC only → `_debug.lastSeries` rows all have null
   `pensionWithRaises`. Chart unchanged.
3. Paystub + `lastDayOfSvc` before the first scheduled raise →
   "Projected raises do not apply" checkbox auto-locks (existing
   `noRaisesApply` logic). |
Success: no console errors; both scenarios render identically to
pre-Stage-4 chart.

### Stage 4.5: Real-data robustness — truncate incomplete trailing months

Discovered during the first attempt at Stage 4.4 smoke. With actual
paystubs (89-month stream), Scenario 1 saw zero rows with non-null
`pensionWithRaises`. Root cause: the most recent calendar month had only
the first half of its pay period (one stub instead of the usual two), so
the stream's last `regular` value was ~half the typical month. Used as
the projector's `base`, that depressed value made saturated future
projections (`base × 1.1226`) lose to past 12-month averages, so the
raise gate (`raisedAfc > afcMonthly`) never fired.

Fix:
1. **`buildPaystubStream`** truncates trailing months that aren't anchored
   by a stub whose `endDate` is the last day of its calendar month
   (mirroring `generateWindows`'s `lastAnchorEnd` logic at
   `lib/pension.js:608-616`). Returns `[]` if no month-end stub exists.
2. **`projectAfcAtRetirement`** drops the `currentMonth` parameter and
   derives the past/future boundary from `addMonths(stream[last].month, 1)`.
   Future projection now picks up exactly where the (truncated) stream
   leaves off — no calendar gap, no need to zero-fill, and the array-index
   DP correctly enforces 12 consecutive calendar months because `all` is
   contiguous by construction.
3. **`calculateSeries`** drops `currentMonth` from its signature and
   from the `projectAfcAtRetirement` call.
4. **`runCalculate`** drops the corresponding argument.
5. **Existing tests** updated:
   - `buildPaystubStream` tests: stub `endDate`s switched from mid-month
     (e.g. day 28) to actual month-ends (31, 30, 29-for-Feb-leap).
   - `projectAfcAtRetirement` tests: `currentMonth` argument removed;
     stream is constructed to end at the desired past/future boundary.
   - `calculateSeries` tests: `currentMonth` argument removed.
6. **New tests:**
   - `buildPaystubStream` drops a trailing mid-month stub; resulting
     stream ends at the prior fully-covered month.
   - `buildPaystubStream` returns `[]` if no month-end stub exists.
   - `projectAfcAtRetirement` reproduces Scenario 1's expected behavior:
     90-month flat stream + module RAISES, hybrid-post2012 saturation
     retDate → projector returns `base × Π(1 + r_i)` and exceeds the
     past-only top-N average. |
Success: full test suite green; Stage 4.4 smoke passes.

Status: Complete (4.1–4.3 + 4.5 + 4.4 all green; 22 tests passing; smoke
verified Scenarios 1, 2, 3. Notable late discovery: `raisesActive` gate
needed widening to `... && anyRaiseInHorizon` because a fresh-base future
month can lift the projector's top-N above `solveDP`'s past-only result
even when no raise is in scope. Fix landed in `lib/pension.js:496-501`.)

---

## Stage 5: Un-suppress raise curves for the paystub path

Goal: Reveal the projected-raises UI (table + checkbox + four purple chart
curves + estimation-table columns) **only when a paystub stream is driving
the calculator**, since manual-AFC entries have no per-month structure to
project from. The `showRaises` flag is currently hardcoded `false` in two
sites (`index.html:1416`, `:1879`); the contractual fieldset is hidden via
`hidden` attribute (`:451`); and a `<!-- Temporarily suppressed -->` comment
(`:448-450`) explains the freeze. All three need to come down or become
data-driven.

Pre-existing issues uncovered while auditing for this stage:
- The hardcoded `<tbody>` at `:459-463` lists four raises, including a
  stale `2025-07-01 @ 3.50%` that doesn't exist in the module's `RAISES`
  constant (which has only the 2026/2027/2028 entries). Once the fieldset
  un-hides, this divergence becomes user-visible.
- `applyRaisesNALock` already handles the `lastDayOfSvc < first raise`
  case correctly; no logic change needed there.

### Stage 5.1: Wire `showRaises` from the data path

- In `runCalculate` (`index.html:1410-1418`), derive
  `showRaises = paystubStream != null && !raisesNA`.
- Pass `showRaises` to both `drawChart` and `drawSeriesTable`. Drop the
  redundant `raisesNA` parameter from `drawChart` — `showRaises` already
  encodes the user-checkbox gate.
- Remove the hardcoded `const showRaises = false;` at both `:1416` (the
  caller site) and `:1879` (inside `drawChart`).
- The chart's per-curve `raisesActive`-gate at row level
  (`pensionWithRaises != null`, etc.) already short-circuits when raises
  don't apply, so changing only the top-level `showRaises` is sufficient. |
Success: existing tests still pass; manual smoke shows the fieldset still
hidden via the `hidden` HTML attribute (since 5.2 hasn't fired yet) but
chart and table now react to a derived flag.

### Stage 5.2: Toggle the contractual fieldset visibility

- Remove the `hidden` attribute and the "Temporarily suppressed" comment
  block at `index.html:447-451`.
- Add a small helper `setContractualVisible(visible)` that toggles
  `document.getElementById('group-contractual-input').hidden`.
- Call it from `runCalculate` with `paystubStream != null`, and from
  `runClear` (`:1416-1438`) and the paystub cancel/error paths with
  `false` so the fieldset re-hides when paystubs are cleared. |
Success: manual smoke — fieldset hidden until paystubs load, visible
after, hidden again after `runClear`.

### Stage 5.3: Generate the raises table from `RAISES`

- Replace the hardcoded `<tbody>` at `:457-464` with an empty `<tbody
  id="raises-table-body">`.
- At inline-script init time (after `lib/pension.js` loads, so `RAISES` is
  defined), populate the tbody by iterating `RAISES`:
  `<tr><td>${fmtDate(r.date)}</td><td>${(r.rate * 100).toFixed(2)}%</td></tr>`.
- This eliminates the stale `2025-07-01` row and makes the displayed
  table self-updating if `RAISES` is later edited. |
Success: rendered table matches `RAISES` exactly; only the three current
entries are listed; rate-format matches the prior visual (e.g. "3.79%").

### Stage 5.4: Browser smoke

Three scenarios; all expectations are visual + console:

1. **Manual AFC only.**
   `file:///…/index.html?plan=hybrid&memDate=2014-08-01&dob=1960-01-01&svcYears=15&svcAsOf=2024-01-01&afc=5000`
   - Click Generate.
   - Expect: `#group-contractual-input` hidden (no raises table or checkbox
     visible); chart has no purple curves; estimation-table headers do NOT
     include `+ raises`; `_debug.lastSeries.every(r => r.pensionWithRaises === null)`
     is `true`.

2. **Paystub-driven hybrid.**
   `file:///…/index.html?plan=hybrid&memDate=2014-08-01&dob=1960-01-01&svcYears=15&svcAsOf=2024-01-01`
   - Load paystub directory; click Generate.
   - Expect: `#group-contractual-input` visible; raises table shows
     2026-07-01 @ 3.79%, 2027-07-01 @ 4.00%, 2028-07-01 @ 4.00% (NO
     2025-07-01 row); purple curves appear on the chart; estimation-table
     headers include `+ raises` (and `+ raises + …SL` if SL fields filled);
     toggling "Projected raises do not apply" hides curves AND columns;
     toggling back restores.

3. **Paystub + `lastDayOfSvc` before first RAISE.**
   `file:///…/index.html?plan=hybrid&memDate=2014-08-01&dob=1960-01-01&svcYears=15&svcAsOf=2024-01-01&lastDay=2026-06-30`
   - Load paystubs; click Generate.
   - Expect: fieldset visible; checkbox auto-locked
     (`document.getElementById('raises-na').checked === true` AND `.disabled === true`);
     label suffix "due to the Last day of service above"; no purple
     curves on chart; estimation-table has no `+ raises` columns. |
Success: all three scenarios behave as expected; no console errors.

Status: 5.1 / 5.2 / 5.3 / 5.4 — Not Started

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
