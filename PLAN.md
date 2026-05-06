# PLAN.md

## Stage 1: Fix projector double-counting past raises

`projectAfcAtRetirement` (`lib/pension.js:351`) multiplies `base` (the
last paystub's regular pay) by every raise whose date ≤ each future
month — including raises that occurred *during* the paystub coverage
period. Real paystubs from after a raise already reflect that raise in
their values, so `base` already has it baked in; multiplying it in
again silently inflates future-month projections.

Confirmed via repro: stream of 6×$5000 + 18×$5250 with a single 5%
raise dated mid-stream returns 5512.50 instead of the correct 5250.

The fix is a one-clause addition to the future-projection loop:
`raise.date > streamEnd` in addition to `raise.date <= m`. Past raises
(date ≤ stream-end) are skipped — they're already in `base`. Future
raises (date > stream-end) are applied as today.

### Stage 1.1: Add stream-end filter to `projectAfcAtRetirement`

- Compute `const streamEnd = stream[stream.length - 1].month;` once
  before the future-month loop (already on line 363 as `futureStart`'s
  source — pull it into its own const for clarity).
- Inside the future-month loop (`lib/pension.js:368-370`), replace
  `if (date <= m)` with `if (date > streamEnd && date <= m)` so past
  raises are filtered out.
- No other call-site changes needed; `RAISES` continues to flow in
  intact and the filter is local to the projector. |

Success: re-running the repro fixture (stream with a 5% raise at month
6, baked into months 7–24) returns 5250, not 5512.50.

### Stage 1.2: Update existing test #2 to keep it meaningful

- `tests/pension.test.js:142` ("flat stream + saturated single raise")
  currently uses a 120-month flat-$5000 stream with a raise dated
  2018-01-01 — i.e., the stream "forgets" to apply its own past raise
  and relies on the buggy double-count to produce 5250. After Stage 1.1
  this test would return 5000 and fail.
- Fix: change the raise date from `new Date(2018, 0, 1)` to
  `new Date(2026, 0, 1)` so the raise is genuinely future relative to
  the stream's Dec 2025 end. Expected AFC stays 5250 — the test still
  validates saturation. Add a one-line comment noting the constraint
  (raise must be after stream end). |

Success: test #2 still passes and now exercises the realistic case.

### Stage 1.3: Add regression test for the bug

- New `await t.test('N. past raise during coverage → no double-count', ...)`
  inside the existing `projectAfcAtRetirement` suite.
- Setup mirrors the repro: stream of 6 months at 5000 (Jan–Jun 2024) +
  18 months at 5250 (Jul 2024 – Dec 2025); raises =
  `[{ date: new Date(2024, 6, 1), rate: 0.05 }]`; N=1, mode='regular',
  retDate = 2027-12-01.
- Assert AFC === 5250 exactly. |

Success: pre-fix, the test fails with 5512.50; post-fix, passes.

### Stage 1.4: (optional) tighten `anyRaiseInHorizon` gate

- `index.html` (in `calculateSeries` consumer's neighborhood — actually
  `lib/pension.js:503`): `anyRaiseInHorizon = RAISES.some(r => r.date <= raiseCap)`
  also doesn't filter past raises. Currently no observable impact —
  when all raises are past, `raisedAfc === afcMonthly` after the
  Stage 1.1 fix, so `raisesActive = false` regardless of this flag —
  but the flag is semantically wrong (claims "yes a raise applies"
  when none will).
- Fix: add `&& r.date > paystubStream[paystubStream.length - 1].month`
  to the `.some` predicate when `paystubStream` is non-empty. |

Success: defensive cleanup; tests still pass; no UI change. Skip if
scope-tight.

### Stage 1.5: Real-data validation (local-only, not committed)

End-to-end sanity check using actual paystubs that span the 2025-07-01
3.5% raise. The PDF parser is browser-bound, so this leans on the
existing "Download JSON" debug button to bridge into Node.

- In the browser, load the paystub directory (with the bug fix applied
  — Stages 1.1–1.3 already in). Click **Download JSON** to export the
  parsed `paystubs.json`.
- Move the JSON to a path outside the repo (or under a gitignored
  subdir). The file contains real earnings data — keep it local.
- Throwaway Node script (~30 lines, also kept local):

      const { filterStubs, buildPaystubStream, projectAfcAtRetirement }
        = require('/path/to/peng/lib/pension.js');
      const data = require('/path/to/local/paystubs.json');
      const { stubs } = filterStubs(data.paystubs);
      const stream = buildPaystubStream(stubs);
      const retDate = new Date(2030, 0, 1);  // safely future, plenty of windows
      const N = 5, mode = 'totalInclVacation';  // match the user's plan config
      const raisesWithPast = [
        { date: new Date(2025, 6, 1), rate: 0.035 },
        // …current RAISES schedule…
      ];
      const raisesFutureOnly = raisesWithPast.filter(r => r.date > stream[stream.length - 1].month);
      const a = projectAfcAtRetirement({ stream, retDate, raises: raisesWithPast,   N, mode, lastDayOfSvc: null });
      const b = projectAfcAtRetirement({ stream, retDate, raises: raisesFutureOnly, N, mode, lastDayOfSvc: null });
      console.log({ a, b, equal: Math.abs(a - b) < 0.01 });

- Also useful as a parser-integrity check: empirically compute the
  pre-raise vs post-raise regular-pay ratio from `stream`. It should
  land within rounding of 1.035. |

Success: post-fix, `a === b` (within 1¢), confirming the past raise is
correctly filtered out of the projector. Empirical pay-step ratio ≈
1.035. After verification, delete the JSON and the script.

## Stage 2: UI filter for the displayed RAISES table

The contractual-adjustments fieldset's RAISES table currently lists
every raise in the schedule. Once Stage 1 lands, raises whose date is
in the past (relative to paystub end) won't actually affect the
projection — so showing them as "Projected raises" is misleading.

### Stage 2.1: Extract the raises-table render into a function

- Replace the inline `raisesTableBodyEl.innerHTML = RAISES.map(...)`
  block at `index.html:609` with a function:

      function renderRaisesTable(boundary) {
        const cutoff = boundary ?? new Date(new Date().getFullYear(),
                                            new Date().getMonth(), 1);
        raisesTableBodyEl.innerHTML = RAISES.filter(r => r.date > cutoff)
          .map(r => { … original formatting … }).join('');
      }

  Call it once at module init with no arg (uses today's first-of-month). |

Success: at page load, the table looks identical to today (since all
current RAISES are still future).

### Stage 2.2: Re-render when paystub state changes

- `applyLoadedStubs` (after `lastStubs`/`lastWindows` are set):
  `renderRaisesTable(stream[stream.length - 1].month)` if
  `lastPaystubStream` is non-empty.
- `runClear`: `renderRaisesTable()` (back to today's boundary).
- Picker change handler (the cancel branch / start of scan): rendering
  doesn't have to update mid-scan since the contractual fieldset is
  hidden until paystubStream is non-null. Leaving as-is is fine. |

Success: when a stream is loaded whose last month is, say, 2026-08-01,
a hypothetical raise dated 2026-07-01 would disappear from the on-screen
table; raises dated 2026-09-01+ would still show.

### Stage 2.3: Browser smoke

The RAISES schedule already includes a real past entry (2025-07-01,
3.5%) added during Stage 2.1, so smoke can use it directly without
temporary edits.

1. Open the app fresh (no paystubs) → contractual-adjustments fieldset
   is hidden (because no paystub stream). Confirm via DevTools that
   `#raises-table-body` contains only the three future rows
   (2026-07-01, 2027-07-01, 2028-07-01) — the 2025-07-01 row is filtered
   out at init by the today-based boundary.
2. Load paystubs that span 2025-07-01 (the user's actual paystubs do).
   Confirm: (a) the contractual-adjustments fieldset becomes visible,
   (b) the displayed table still hides the 2025-07-01 row (now
   filtered by stream-end boundary), and (c) it shows the three future
   rows. Stage 2.2 wires the re-render so the boundary swaps from
   "today" to "stream end" — verify it actually fires.
3. Click "Clear all fields" → fieldset hides; the next load (or page
   reload) re-renders with the today boundary again. |

Status: 1.1 ✓ / 1.2 ✓ / 1.3 ✓ / 1.4 ✓ / 1.5 ✓ / 2.1 ✓ / 2.2 / 2.3 — In Progress

---

## Bonus changes that landed alongside Stage 2.1

- `RAISES` in `lib/pension.js` now includes the real 2025-07-01 / 3.5%
  raise (the one used to validate the projector fix in Stage 1.5). With
  the projector and `anyRaiseInHorizon` filters in place, this entry is
  inert for users whose paystubs span it (already in `base`) and active
  for users whose paystubs don't (treated as a future raise).
- `applyRaises` (`lib/pension.js:328`) gained an optional `streamEnd`
  parameter that mirrors the projector's past-raise filter. Backward
  compatible (defaults to `null` = no filtering, legacy behavior).
- `tests/pension.test.js` updated:
  - `projectAfcAtRetirement` test #6: stream shifted from 2016–2025 to
    2014–2023 so all RAISES remain future relative to streamEnd.
  - `calculateSeries` test #2: passes `streamEnd` to `applyRaises` so
    the equivalence assertion holds with past raises in `RAISES`.
  - `calculateSeries` test #4: comment clarified ("first FUTURE raise"
    since the first RAISES entry is now past).

---

## Notes

- The bug was dormant in production until Stage 2.1's RAISES update
  added the 2025-07-01 entry. With the Stage 1 fixes in place, the
  schedule is now safe to extend with past entries.
- PLAN.md is ephemeral — delete after Stage 2.3 lands.
