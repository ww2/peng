# RESUME.md

State for resuming the "fix projector double-counting past raises" work
on a different machine / session. Pair this with `PLAN.md` for full
context.

## Where we are

Stages 1.1 – 1.5 and 2.1 are complete and verified. Stages 2.2 and 2.3
are not yet started.

```
Status: 1.1 ✓ / 1.2 ✓ / 1.3 ✓ / 1.4 ✓ / 1.5 ✓ / 2.1 ✓ / 2.2 / 2.3 — In Progress
```

Tests: `node --test tests/pension.test.js` — **23/23 passing**.

## What changed (committable diff)

### `lib/pension.js`

- `RAISES` (`:35`) — added `{ date: '2025-07-01', rate: 0.035 }` as the
  first entry. This is the real-world raise the user has already
  received.
- `applyRaises` (`:328`) — added optional `streamEnd` parameter that,
  when provided, skips raises whose date ≤ `streamEnd`. Mirrors the
  projector's past-raise filter so test fixtures using both stay
  consistent. Defaults to `null` (no filter, backward compatible).
- `projectAfcAtRetirement` (`:351`) — extracted `streamEnd` from
  `stream[stream.length - 1].month`, then added `date > streamEnd`
  guard inside the future-month raise loop. Past raises (already
  baked into `base`) no longer compound forward. **This is the core
  bug fix.**
- `calculateSeries` (`:436`) — extracted module-scope `streamEnd` once
  before the 600-iteration loop; updated `anyRaiseInHorizon` to also
  require `r.date > streamEnd` when a stream is present. Defensive
  cleanup; behavior was already correct via the projector's filter,
  but the gate was semantically off.

### `index.html`

- `renderRaisesTable(boundary)` (`:609`) — extracted from the inline
  `raisesTableBodyEl.innerHTML = RAISES.map(...)` block. Filters out
  raises whose date ≤ `boundary`; default boundary is today's
  first-of-month. Module init now calls `renderRaisesTable()` (no arg).
  Stage 2.2 will wire `applyLoadedStubs` and `runClear` to re-call
  with `streamEnd` / no-arg respectively.

### `tests/pension.test.js`

- `projectAfcAtRetirement` test #2 (`:142`) — moved raise date from
  2018-01-01 to 2026-01-01 so it's genuinely future relative to the
  Dec 2025 stream end. Asserted AFC unchanged (5250).
- `projectAfcAtRetirement` test #6 (`:201`) — shifted stream from
  2016–2025 to 2014–2023 so all RAISES (including the new 2025-07-01
  entry) remain future relative to streamEnd. Equivalence with
  `applyRaises` is preserved.
- `projectAfcAtRetirement` test #9 (new) — regression test for the
  bug: 6 months at $5000 + 18 months at $5250 stream, raise dated
  2024-07-01 baked into the stream values. Asserts AFC === 5250
  (pre-fix returned 5512.50).
- `calculateSeries` test #2 (`:307`) — passes `streamEnd` through to
  `applyRaises` so equivalence holds with the new past-raise entry in
  `RAISES`.
- `calculateSeries` test #4 (`:359`) — clarified the inline comment
  ("first FUTURE raise") since the first entry of `RAISES` is now in
  the past.

## What's left

### Stage 2.2 — re-render `renderRaisesTable` when paystub state changes

Two call sites need wiring (per `PLAN.md` Stage 2.2):

1. **`applyLoadedStubs`** (`index.html:734`): after `lastStubs` /
   `lastWindows` are set, call
   `renderRaisesTable(stream[stream.length - 1].month)` if the stream
   is non-empty (`buildPaystubStream(stubs)` is the same data; can
   reuse `lastPaystubStream` from `_debug` or compute it). Cleanest
   place: right after the `window._debug.lastPaystubStream = ...`
   assignment.
2. **`runClear`** (`index.html:1517+`): call `renderRaisesTable()`
   (no arg → today's boundary) alongside the other UI resets. Add it
   to the "Picker UI" or a new "Raises table" section.

The picker change handler doesn't need a separate hook — it calls
`applyLoadedStubs(stubs)` on success, which will trigger the re-render
once Stage 2.2 wires it in.

### Stage 2.3 — browser smoke

See `PLAN.md` Stage 2.3 for the rewritten checklist (no longer needs
temporary RAISES edits since the 2025-07-01 entry is in production
now). Three steps:

1. Fresh open, no paystubs → only future rows visible in
   `#raises-table-body`.
2. Load paystubs spanning 2025-07-01 → fieldset becomes visible, table
   still hides the 2025-07-01 row (now via stream-end boundary) and
   shows the three future rows.
3. Clear all fields → next load re-renders with today's boundary.

### Cleanup after 2.3 lands

- Update CLAUDE.md if any line refs in `lib/pension.js` shifted
  meaningfully (the projector and applyRaises edits added a few
  lines). Spot-check the bullets for `applyRaises (:328)`,
  `projectAfcAtRetirement (:351)`, `calculateSeries (:432)`, and the
  paystub-pipeline bullet.
- Delete `PLAN.md` and `RESUME.md`.

## Quick verifications

```bash
# Run tests
node --test tests/pension.test.js

# Re-confirm the bug fix with the synthetic repro
node -e "
const { projectAfcAtRetirement } = require('./lib/pension.js');
const stream = [];
for (let i = 0; i < 6;  i++) stream.push({ month: new Date(2024, i,     1), regular: 5000, total: 5000 });
for (let i = 0; i < 18; i++) stream.push({ month: new Date(2024, 6 + i, 1), regular: 5250, total: 5250 });
const raises = [{ date: new Date(2024, 6, 1), rate: 0.05 }];
const afc = projectAfcAtRetirement({
  stream, retDate: new Date(2027, 11, 1),
  raises, N: 1, mode: 'regular', lastDayOfSvc: null,
});
console.log('AFC:', afc, '(expected 5250)');
"
```

## Decisions worth remembering

- **`streamEnd` boundary semantics**: a raise on the same month as
  `stream[last].month` counts as "past" (already in base). The check
  is `raise.date > streamEnd`, strict inequality. RAISES dates are
  first-of-month; stream months are also first-of-month, so no
  ambiguity.
- **`applyRaises` stays in the codebase** as a reference for the
  saturated-case equivalence test — not in the live calculation path.
  We added the `streamEnd` filter to it specifically so the
  equivalence test still works after the projector fix; do not remove
  the function or its filter.
- **`anyRaiseInHorizon` fix is defensive**: with the projector
  filtering past raises, `raisedAfc === afcMonthly` when no future
  raises apply, which already drives `raisesActive = false`. Tightening
  the gate produces no observable behavior change but keeps the flag
  semantically honest. Tests still pass either way.
- **`renderRaisesTable` default boundary** is today's first-of-month
  for the no-arg case. The contractual fieldset is hidden until paystubs
  load, so the user technically never sees the today-based filter; but
  it's the right default for any future caller (and keeps the function
  callable in isolation).
- **Real-data validation (Stage 1.5)** confirmed empirical 1.0350 raise
  ratio and projector match-with-vs-without past raises on the user's
  actual 88-month stream (2018-12 through 2026-03). Local-only,
  artifacts already deleted.
