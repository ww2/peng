# Resume state — raises projection refactor

**Branch:** `preraise`. Plan lives at `PLAN.md`. The full plan, motivations, and
stage-by-stage success criteria are in that file — read it first.

## Where we are

| Stage | Title | Status |
|------|-------|--------|
| 1 | Delete the `nonreg-afc` field | **Complete** (committed in working tree) |
| 1.5 | Extract pure logic to `lib/pension.js` | **In progress, mid-refactor** |
| 2 | Build per-month earnings stream from paystubs | Function written; verification paused on Stage 1.5 |
| 3 | Implement windowing AFC projector | Not started |
| 4 | Wire projector into `calculateSeries` | Not started |
| 5 | Un-suppress raise curves for paystub path | Not started |
| 6 | Update DESIGN.md and CLAUDE.md | Not started |

Stage 1.5 was added mid-stream after Stage 1 landed and before Stage 2
verification. The motivation: pure functions belong in a Node-loadable file
so Stages 2/3/4 can be unit-tested without an awk-extract dance against
HTML.

## What `lib/pension.js` contains

Pure, browser-loaded as a classic script (same as `lib/d3-*.min.js`,
`lib/pdfjs-*.min.js`); also `require()`-able from Node thanks to a
`module.exports` footer at the bottom. **32 exports**, verified via:

```
node -e "const P = require('./lib/pension.js'); console.log(Object.keys(P).length)"
# → 32
```

Exports:

- **Constants** — `IGNORED`, `LUMP_SUM_VACATION`, `PRE_1971_DATE`, `RAISES`,
  `TIER_BOUNDARY`, `PLAN_CONFIGS`, `PRIMARY_ARF_TABLES`
- **Plan logic** — `derivePlanKey`, `primaryArfAge`, `primaryEligAge`,
  `primaryEligibility`, `primaryARF`, `isPre1971DualMethod` *(refactored to
  take `memDate` as a parameter)*
- **Date utilities** — `toYmd`, `parseDate`, `addMonths`, `addDays`, `fmtDate`,
  `monthsBetween`, `fractionalAge`, `parseIsoDate`, `serviceAtMonth`,
  `sickLeaveToMonths`
- **Math** — `applyRaises`, `blendedBenefit`, `calculateSeries`
- **Paystub pipeline** — `filterStubs`, `generateWindows`, `scoreStub`,
  `buildPaystubStream` *(new, from Stage 2)*, `solveDP`, `detectGaps`

## What `index.html` still owns (DOM-bound)

DOM element refs, all event handlers, `canCalculate`, `validateMemDate`,
`runCalculate`, `maybeCalculate`, `runClear`, `computeAndFillAfc`,
`computeDualMethodAfc`, `renderWindowsSection`, `updateRegularEarningsDisplay`,
`drawChart`, `drawSeriesTable`, all `sync*Visibility` functions,
URL pre-fill, `buildReloadUrl`, `updateReloadLink`, the PDF picker /
paystub-extraction flow, `_debug` handle setup, `commitAfc`,
`applyRaisesNALock`. Plus PDF-parser-only constants/data: `KNOWN`,
`ALIASES`, `REVERSED_ALIASES`, `GAP_THRESHOLD`. Plus `fmtMoney` (string
formatter only used by display code).

## What was changed in `index.html` for Stage 1.5

1. Added `<script src="lib/pension.js"></script>` between the existing
   pdfjs and inline-module script tags.
2. Removed `PLAN_CONFIGS`, `TIER_BOUNDARY`, `derivePlanKey`, `RAISES` —
   replaced with a one-line comment pointing at `lib/pension.js`.
3. Removed the entire `PRIMARY_ARF_TABLES` block plus `primaryArfAge`,
   `primaryEligAge`, `primaryEligibility`, `primaryARF` — replaced with a
   one-line comment.
4. Removed `LUMP_SUM_VACATION` and `IGNORED` constants. `KNOWN` (PDF
   parser only) was kept and now references `LUMP_SUM_VACATION` as a
   global from `lib/pension.js`.
5. Removed all date utilities, `applyRaises`, `blendedBenefit`,
   `calculateSeries` — replaced with a one-line comment.
6. Removed `filterStubs`, `generateWindows`, `scoreStub`,
   `buildPaystubStream`, `solveDP`, `detectGaps` — covered by the same
   comment.
7. Removed `PRE_1971_DATE` and `isPre1971DualMethod` from the AFC pipeline
   section. The two callers were updated to pass parsed `memDate`:
   - `computeAndFillAfc` (parses memDate locally then calls
     `isPre1971DualMethod(planKey, memDate)`)
   - `updateManualAfcNote` (same pattern)

## What I had NOT yet verified when interrupted

The user paused me right before this verification command:

```
awk '/<script type="module">/{f=1;next} /<\/script>/{f=0} f' \
    /Users/ww2/Eclectospace/peng/index.html > /tmp/peng-script.js \
  && node --check /tmp/peng-script.js && echo "module-script OK"
```

So **Stage 1.5 has not been confirmed working**. Before declaring it
done, on resume:

1. Run the syntax check above on the inline module script.
2. Run `node -e "const P = require('./lib/pension.js')"` again from a
   clean shell — confirm it still loads (no missing/dangling references).
3. Open `index.html` in a browser using the URL from `notes.md` (or any
   paystub-driven scenario). Confirm:
   - No console errors.
   - Generate-graph button works.
   - Chart renders identically to pre-refactor.
   - The plan-dropdown and memDate-edit flows still work (no orphan
     `PRIMARY_ARF_TABLES`/`PLAN_CONFIGS`/etc. references).
4. Spot-check the residual `// ── Plan configs ──` comment block at the
   top of the inline module script and confirm the wording is accurate.
5. There's a stale reference inside the `updateManualAfcNote` comment
   ("PLAN.md Stage 8") from a prior plan iteration — harmless but worth
   noting; consider scrubbing during the Stage 6 doc pass.

## Stage 2 status (paused)

The function `buildPaystubStream(stubs)` is fully present in
`lib/pension.js`. The wiring in `index.html` is in place too:

- `_debug.lastPaystubStream = []` initial publish at the `_debug` setup site.
- `_debug.lastPaystubStream = buildPaystubStream(stubs)` after the success path
  in the paystub pipeline (right after `lastStubs = stubs`).
- `_debug.lastPaystubStream = []` on the cancel and `runClear` paths.

The synthetic Stage 2 unit tests (in the in-flight `/tmp/stage2-test.js`
that the user rejected — it duplicated the function rather than `require`-ing
it) should be **rewritten as a Node-based test that requires `lib/pension.js`
directly**, e.g.:

```js
const { buildPaystubStream } = require('./lib/pension.js');
// then run the same five test cases:
//   1. empty input → []
//   2. Jan–Jun 6 months × 2 stubs each → 6 entries, regular=$4000, total=$4000
//   3. 1-month gap (Jan + Mar stubs) → 3 entries with Feb zero-filled
//   4. overtime/diff stub → regular ≤ total invariant
//   5. cross-year span (Nov 2023 → Feb 2024) → 4 entries, gaps zero-filled
```

Once that passes, Stage 2 is complete.

## Next stage (3) preview

`projectAfcAtRetirement({ stream, retDate, currentMonth, raises, N, mode, lastDayOfSvc })`
in `lib/pension.js`. Algorithm in PLAN.md Stage 3. Closed-form sanity check
required (output must equal `applyRaises` to within 1¢ when stream regular ≡
total, no NR component).

## Decided assumptions (from earlier in the conversation)

- Future non-regular pay is always 0. No "expected future NR" input is added.
- Paystubs never cross calendar-month boundaries — every pay period is in
  a single calendar month. Per-stub earnings attribute in full, no proration.

## Open question carried forward

- Pre-1971 dual-method's `totalExclVacation` mode needs a per-month
  vacation column in the stream. Currently the stream has only `{regular,
  total}` — vacation handling is deferred and zero-filled until pre-1971
  members are revisited.

## Files of interest

- `PLAN.md` — full plan with all stage criteria
- `lib/pension.js` — the new pure-logic file (688 lines, 32 exports)
- `index.html` — currently 2420 lines (down from ~3070 pre-refactor)
- `info/DESIGN.md` lines 168–176 — the canonical statement of why raises
  were suppressed; will need updating in Stage 6
- `notes.md` — sample URL for browser smoke testing (untracked, do not
  commit)

## To resume on another machine

1. `git status` — confirm working tree matches the snapshot above
   (`AM PLAN.md`, `MM index.html`, `?? lib/pension.js`, `?? notes.md`).
2. Read `PLAN.md` end-to-end to reload context.
3. Read this file (`RESUME.md`).
4. Run the four verification steps under "What I had NOT yet verified
   when interrupted" above.
5. If verification passes, mark Stage 1.5 Status as Complete in `PLAN.md`,
   delete `RESUME.md`, then proceed to Stage 2 verification.
