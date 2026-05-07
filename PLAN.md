# PLAN.md

## Stage 1: Extrapolate manual AFC for regular-only plans

For plans with `mode === 'regular'` (`hybrid-post2012`, `contributory-post2012`),
AFC is just the top-N average of monthly *regular* pay; contract raises propagate
through it predictably. Today the raise-projection path only fires when paystubs
are loaded — manually-entered AFC produces a flat `primaryPension` curve and no
`pensionWithRaises`. We can extend the raise projection to manual-AFC users on
regular-only plans by feeding `projectAfcAtRetirement` a **synthetic flat stream**
pinned at the entered AFC value.

`mode === 'total'` plans (`hybrid-pre2012`, `contributory-pre2012`,
`noncontributory`) stay out of scope: total earnings include overtime, NR/SDI,
holiday/differential pay, and lump-sum vacation that don't scale linearly with
the contract raise. Their manual-AFC path stays as-is.

### Why synthetic stream + projector reuse, vs. a step-function shortcut?

A literal `AFC × Π raises ≤ retDate` formula is simpler but produces a step
function on the chart and overstates the AFC by up to ~half the raise rate for
retDates within 12 months of a raise (in reality the top-N rolling 12-month
windows would straddle the raise boundary and average across it). The synthetic
stream approach reuses `projectAfcAtRetirement`'s rolling-window math, gives a
smooth ramp through each raise, and keeps the chart curves consistent across
manual-AFC and paystub-driven modes. Code cost: one helper + replacing
`paystubStream` with `effectiveStream` at four sites in `calculateSeries`.

### Stage 1.1: Add `buildSyntheticStream(afcMonthly, anchorDate, monthsBack)`

- New pure function in `lib/pension.js`, sibling to `buildPaystubStream`.
- Returns array of `{ month, regular, total }` of length `monthsBack`,
  ascending by month, with the last entry's `month` equal to `anchorDate`'s
  first-of-month.
- Each entry: `regular = total = afcMonthly`. `total` is set defensively
  even though regular-mode plans only score on `regular`; keeps the function
  mode-agnostic for any future caller.
- Default `monthsBack`: 60 (covers N=5 with safety margin; N=3 plans are
  total-mode and won't call this).
- Append CommonJS export. |

Success: `buildSyntheticStream(5000, new Date('2026-05-01'), 60)` returns a
60-element array, months from 2021-06-01 through 2026-05-01, all
`{ regular: 5000, total: 5000 }`. Unit test asserts shape + values.

### Stage 1.2: Wire synthetic stream into `calculateSeries`

In `lib/pension.js:440+`:

- After the existing `streamEnd` computation, add an `effectiveStream`
  derivation:

      const useSynthetic = !paystubStream && config.mode === 'regular' && afcMonthly > 0;
      const anchorDate   = lastDayOfSvc
        ? new Date(lastDayOfSvc.getFullYear(), lastDayOfSvc.getMonth(), 1)
        : new Date(today.getFullYear(), today.getMonth(), 1);
      const effectiveStream = paystubStream || (useSynthetic ? buildSyntheticStream(afcMonthly, anchorDate, 60) : null);
      const effectiveStreamEnd = effectiveStream && effectiveStream.length
        ? effectiveStream[effectiveStream.length - 1].month
        : null;

- Replace `paystubStream` with `effectiveStream` at the four downstream
  sites:
  - `raisedAfc` calculation (`:504-509`) — pass `effectiveStream` to
    `projectAfcAtRetirement`.
  - `streamEnd` reference inside `anyRaiseInHorizon` (`:520`) — use
    `effectiveStreamEnd`.
  - `hasPaystub` flag (`:522`) — rename to `hasEffectiveStream`,
    derive from `effectiveStream`.
  - `pensionWithRaises` null-check (`:529`) — use `!hasEffectiveStream`.
  - SL-raises pinning block (`:548`) — use `hasEffectiveStream`.

- The committed-COB snap (`:602-607`) and already-separated snap
  (`:570-579`) need no changes — they already operate on the right keys
  for both paths.

- Top-of-function `streamEnd` const (`:450-452`) is still derived from
  `paystubStream` only since it's used for documentation/clarity in
  comments; rename it to `paystubStreamEnd` if that's clearer, but
  functionally `effectiveStreamEnd` is the one that matters for the
  raise gate. |

Success: regular-only plan + manual AFC=5000, no paystubs, retDate past
2028-07-01: `pensionWithRaises ≈ primaryPension × (1.035 × 1.0379 × 1.04 × 1.04)`
(within rounding of mid-year window straddle). Same plan + retDate before
2026-07-01: `pensionWithRaises === primaryPension` (pinned, no future raises
land in the horizon yet).

### Stage 1.3: Show contractual-adjustments fieldset when extrapolation is active

In `index.html`:

- `runCalculate` (`:1538`) currently calls `setContractualVisible(paystubStream !== null)`.
  Change to:

      const planKey = derivePlanKey(planEl.value, memDateEl.value);
      const config  = PLAN_CONFIGS[planKey];
      const afc     = parseFloat(manualAfcEl.value);
      const extrapolating = !paystubStream && config?.mode === 'regular' && afc > 0;
      setContractualVisible(paystubStream !== null || extrapolating);

- `showRaises` (`:1537`) — extend similarly:
  `const showRaises = (paystubStream !== null || extrapolating) && !raisesNA;`

- `applyRaisesNALock` gate (`:1531`): the auto-lock currently fires only
  when `paystubStream !== null && lastDayOfSvc !== null && ...`. For the
  extrapolating path with a future-dated `lastDayOfSvc` that cuts off
  all raises, the lock should also fire. Extend the gate to
  `(paystubStream !== null || extrapolating) && lastDayOfSvc !== null && ...`.

- `renderRaisesTable()` with no-arg (today's first-of-month boundary) is
  correct for the manual-AFC case — no real stream end exists, and the
  synthetic anchor is today anyway. No change needed. |

Success: manual AFC + hybrid-post2012 → fieldset visible, raises table
shows the future entries, chart shows a purple raises curve. Toggle
"Projected raises do not apply" → raises curve collapses onto primary.
Switch plan to noncontributory → fieldset hides.

### Stage 1.4: Tests

In `tests/pension.test.js`:

- New `buildSyntheticStream` suite (~3 tests): default behavior, custom
  monthsBack, mid-month anchorDate snaps to first-of-month.

- New `calculateSeries` test: regular-only plan (`hybrid-post2012`),
  `paystubStream: null`, `afcMonthly: 5000`, retDate well past 2028-07-01.
  Assert `pensionWithRaises > primaryPension` and the ratio matches the
  cumulative raise product within rounding tolerance (~$1).

- New `calculateSeries` test: total-mode plan (`noncontributory`),
  `paystubStream: null`, `afcMonthly: 5000`. Assert `pensionWithRaises === null`
  on every row (no extrapolation for total-mode).

- Update existing `calculateSeries` test #1 ("manual AFC path → all
  raise-related fields are null"): re-target to a `total`-mode plan,
  since the regular-only path now applies raises. The test's purpose
  (no raises without paystubs) is preserved for total-mode.

- New `calculateSeries` test: regular-only plan, manual AFC + future-dated
  `lastDayOfSvc` that's before all RAISES. Assert `pensionWithRaises ===
  primaryPension` on every row (no raises in horizon, gate pins). |

Success: 23 prior tests + ~5 new tests pass.

### Stage 1.5: Browser smoke

1. URL `?plan=hybrid&dob=1980-01-01&memDate=2014-08-01&svcAsOf=2024-01-01&svcYears=10&afc=5000` (post-2012 hybrid → regular mode). Click Generate.
   - **Expected:** contractual-adjustments fieldset visible; raises table
     shows the 3 future RAISES entries; chart has purple raises curve
     diverging from primary at 2026-07-01 onward. Tooltip on a 2030+
     retDate shows raises-AFC ≈ 5000 × 1.035 × 1.0379 × 1.04 × 1.04.
   - Toggle "Projected raises do not apply" → raises curve collapses;
     chart shows only the primary curve.
2. Same URL but `plan=noncontributory` (total mode).
   - **Expected:** contractual fieldset stays hidden; chart shows only
     the primary curve (flat).
3. From state (1), load real paystubs.
   - **Expected:** fieldset stays visible; raises table re-renders with
     stream-end boundary; chart raises curve switches to the paystub-
     driven projection (which may differ slightly from the synthetic
     extrapolation if the paystub-derived AFC differs from 5000).
4. From state (3), click "Clear all fields".
   - **Expected:** fieldset hides; chart clears; reloading the page goes
     back to a fresh manual-AFC state.
5. Edge: regular-only plan + manual AFC + future-dated last-day-of-service
   that's before 2026-07-01.
   - **Expected:** "Projected raises do not apply" auto-locks on; raises
     curve pins to primary. |

Success: all 5 scenarios match expectations.

### Cleanup after 1.5 lands

- CLAUDE.md updates:
  - "Pension series" / `calculateSeries` bullet: note the synthetic-stream
    extrapolation branch for regular-only plans with manual AFC.
  - "Raises gate" bullet: gate now fires for `effectiveStream` (paystub
    OR synthetic) instead of `paystubStream`.
  - "Contractual-adjustments fieldset" bullet: visibility now also fires
    for regular-only plans with positive manual AFC.
  - "Where Things Live" Pension series: add `buildSyntheticStream` line
    ref next to `buildPaystubStream`.
- Spot-check line refs for any drift introduced by the wiring changes.
- Delete `PLAN.md`.

---

## Notes on what's NOT covered

- **Salary growth beyond contract raises** (merit/longevity/step increases)
  is not modeled. The user's actual pay trajectory may exceed the contract
  raise schedule due to step increases. Out of scope — calculator's raise
  model is "contract raises only", same as the paystub-driven path.
- **Stale manual AFC**: the synthetic-stream anchor at today implicitly
  assumes the manual AFC reflects current pay. If the user enters an AFC
  from years ago, the projection inherits that lag. No flag in the form
  to detect this; we rely on the user entering a sensible current value.
- **Raise-applies-to-base assumption**: contract raises apply to base pay,
  which the calculator treats as ≈ regular pay. For step-pay employees
  (most state workers) this is exact; for hourly variable-shift workers
  it can drift. Out of scope.
- **Total-mode plans**: as discussed, NOT extended here. Manual-AFC for
  `hybrid-pre2012` / `contributory-pre2012` / `noncontributory` continues
  to produce no raises curve. To add raise support there, the user would
  need to disclose what fraction of their AFC is "regular base" — the UI
  complexity we're explicitly avoiding.
