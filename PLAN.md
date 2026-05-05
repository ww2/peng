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
Status: In Progress

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
Status: Not Started

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

Goal: New pure function
`projectAfcAtRetirement({ stream, retDate, currentMonth, raises, N, mode, lastDayOfSvc })`
that returns the AFC the member would have at `retDate` given the historical
`stream`, applying scheduled `raises` to the regular-pay portion only for
months between `currentMonth` and the earlier of `retDate` and `lastDayOfSvc`.

Algorithm:
1. Concatenate `stream` (past) with a projected future array from
   `currentMonth` through `min(retDate, lastDayOfSvc)`. Each future month's
   `regular` = (current monthly regular base, derived as the most recent
   non-zero `stream[*].regular`) × Π(1 + rate) for raises whose date is
   ≤ that future month. Future `total` = future `regular` (no NR
   projection).
2. Score each calendar month under the requested `mode`:
   - `mode === 'regular'`: use the month's `regular` value.
   - `mode === 'total'` / `'totalInclVacation'`: use `total`.
   - `mode === 'totalExclVacation'`: needs a third stream column (vacation
     payout per month). Defer or zero-fill until pre-1971 dual-method is
     wired in — flag as TODO.
3. Form 12-month rolling sums (or averages); pick the top N annual
   averages by value (must be among the months at-or-before `retDate`).
   Their mean × (config-specific divisor handling) = projected monthly AFC.
4. Return that AFC.
|
Success:
- Pure function with no DOM dependencies.
- For a stream where every month's `regular` equals every month's `total`
  (no non-regular pay), the projector's output for a `retDate` past the
  last raise matches `applyRaises(scalarAfc, retDate, N, lastDayOfSvc)`
  to within 1¢. (This is the closed-form exactness check.)
- For a stream where past months have `total > regular` (NR present) and
  the future has only regular, the projector's value at a `retDate` only
  a few months out is closer to the historical `total`-based AFC, not
  the raised-regular value — and it rises continuously toward the
  raised-regular AFC as `retDate` extends past the N-year window. |
Tests:
1. Synthetic flat stream, no raises → projector returns the flat
   monthly value.
2. Synthetic flat stream, single raise at month 0 → projector at month
   `12 × N + 1` returns flat × (1 + rate).
3. Synthetic flat stream, single raise at month 0 → projector at month
   `12 × (N/2)` returns approximately flat × (1 + rate × 0.5)
   (within 1¢; the rolling window discretises the linear blend).
4. Synthetic stream where past regular = $5000, past NR = $1000/month,
   raise of 5%, retDate one month out → projector returns approximately
   $6000 (the historical total dominates — raises haven't had time to
   replace the NR-inclusive past).
5. Same stream, retDate `12 × N` months out → projector returns
   approximately $5250 (raised regular alone; the NR-inclusive past
   has aged out of the window). |
Status: Not Started

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
