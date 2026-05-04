# PREPLAN — Raise-eligible AFC split

A pre-existing flaw in `applyRaises`: it grows the *entire* AFC by `(1 + r × blend)` per raise, including any portion of AFC that doesn't actually scale with ATB raises (lump-sum vacation, retros, fixed-dollar differentials). This work splits AFC into a raise-eligible portion and a frozen portion, so raises grow only the eligible slice. Must land before PLAN.md's anchor work, because the anchor's delta-blend math is conceptually layered on top of "what fraction of the AFC actually grows."

Scope here is the lowest-cost lever: a single optional override field. The paystub scanner is **not** updated to auto-classify earnings categories — that's deliberate (out of scope, see bottom). Users who want a more conservative projection enter the eligible amount manually; everyone else gets blank ⇒ defaults to total ⇒ today's behavior unchanged.

## Math (reference)

Split the entered AFC into a frozen portion and an eligible portion:

```
frozen   = total − eligible          -- non-raising slice (lump sums, retros, etc.)
eligible = user-provided, defaults to total
```

For each raise `{date: D, rate: r}` and cap `C = min(lastDayOfSvc, retDate)`:

```
b(C)        = min(1, max(0, monthsBetween(D, C)) / (N * 12))
eligible   *= (1 + r * b(C))         -- grow only the eligible slice
afc_at_C    = frozen + eligible      -- frozen stays flat
```

`eligible = total` (default) ⇒ `frozen = 0` ⇒ collapses to today's `total × ∏(1 + r * b(C))`. So the new parameter is purely additive: behavior is byte-identical when the eligible field is left blank.

## Stage 1: `applyRaises` grows only the eligible portion
Goal: Extend `applyRaises(afcMonthly, retDate, N, cutoff)` to `applyRaises(afcMonthly, eligibleMonthly, retDate, N, cutoff)`. Math implements the formula above. `eligibleMonthly == null || eligibleMonthly >= afcMonthly` ⇒ treat as `eligibleMonthly = afcMonthly` (frozen = 0). | Success: With `eligibleMonthly = afcMonthly` (or null), output is byte-identical to the current implementation across the planning horizon. With `eligibleMonthly < afcMonthly`, the frozen portion stays flat and only the eligible portion compounds. | Tests (browser console via `window._debug`): (a) eligible=null vs. eligible=total — identical AFC for every retDate; (b) eligible=0 — AFC stays flat at total regardless of raises (frozen = total); (c) eligible=total/2 — incremental AFC growth is exactly half of the all-eligible case. | Status: Not Started

## Stage 2: Add "Raise-eligible monthly AFC" form input
Goal: New `<input type="text" inputmode="decimal" id="afc-eligible">` placed adjacent to `#manual-afc` inside `#group-earnings-input-manual`, with a small "Raise-eligible $" label. Blank by default. Shares disabled state with `#manual-afc`. Inline note: "Leave blank if your AFC is fully raise-eligible." | Success: Field renders next to the manual AFC; `clearForm` blanks it; disabling earnings fieldset disables it; numeric validation matches `manual-afc`. | Tests: visual; toggle earnings fieldset; clear form; enter non-numeric and confirm it's rejected the same way as manual-afc. | Status: Not Started

## Stage 3: Thread `afcEligible` into `calculateSeries`
Goal: Read `afcEligibleEl.value` at Calculate time, parse to float (or null if blank), pass through `calculateSeries({ ..., afcEligible })` to the `applyRaises` call site (`index.html:1324`). | Success: Changing the field re-runs the projection; the "+raises" curve flattens proportionally as the eligible portion shrinks. | Tests: enter eligible = total (no change), eligible = total/2 (raise contribution halved), eligible = 0 (no raise contribution); verify the "+raises" curve matches predictions. | Status: Not Started

## Stage 4: URL param + reload-link round-trip
Goal: Add `afcEligible` to `SUPPORTED_PARAMS` (`index.html:2232`) and to the URL-pre-fill / reload-link plumbing (`index.html:2189`, `:2276`). Bad value triggers the existing red-outline + error-banner path. | Success: `?afcEligible=3500` pre-fills the field; reload link includes the current value (omits the param when blank). | Tests: round-trip URL load; `afcEligible=invalid` triggers banner without breaking other fields; blank field produces a URL without the param. | Status: Not Started

## Out of scope / explicit non-goals
- **Paystub scanner classification.** The scanner does not auto-populate `afcEligible` by summing only "raise-eligible" earnings categories. That would require deciding which categories count (a non-trivial spec — OT and percentage differentials arguably *do* scale with base pay) and is deferred. Users who want category-level accuracy enter the value manually.
- **Default behavior change.** Blank field ⇒ identical to current behavior. No silent correctness shift; users opt in by filling the field.
- **Documentation.** The eligible-split design rationale is captured in PLAN.md's Stage 7 (DESIGN.md update), not duplicated here.
