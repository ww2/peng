# PLAN — AFC anchor date for raise blending

Add an explicit AFC anchor (`afcAsOf`) so `applyRaises` can credit pre-anchor raises only by the *delta* between the historical and projected blend factors. This corrects under/over-counting when the user's AFC reflects pay from a moment that is itself partway through a raise's averaging window.

**Depends on PREPLAN.md.** PREPLAN splits AFC into a raise-eligible portion and a frozen portion; this plan's anchor logic operates on the eligible portion only. The math shown below is for the eligible slice — `eligible *= (1 + r * delta)` per raise — with the frozen slice (`total − eligible`) added back in unchanged. If PREPLAN hasn't landed yet, the formulas still work with `eligible := afcMonthly`.

## Math (reference)

AFC is, by definition, the average of monthly basic pay over the last N years of service. A raise at date `D` only affects months on or after `D`, so its impact on AFC at retirement `C` is the fraction of the N-year averaging window that falls after `D` — a linear ramp from 0% (at `C = D`) to 100% (at `C = D + N years`), not a stairstep. (A simpler "AFC ×= (1+r) per raise" model was considered but rejected: it overstates AFC for retirements within N years of a raise, where most of the averaging window is still at the pre-raise rate.)

For each raise `{date: D, rate: r}` and candidate retirement month with cap `C = min(lastDayOfSvc, retDate)`:

```
b(t)     = min(1, max(0, monthsBetween(D, t)) / (N * 12))   -- blend at reference t
delta    = max(0, b(C) - b(A))                              -- A = afcAsOf anchor
eligible *= (1 + r * delta)                                 -- only the eligible slice grows
afc_at_C  = (total - eligible_initial) + eligible
```

Anchor unset (`A = null`) ⇒ `b(A) = 0` ⇒ collapses to PREPLAN's behavior. PREPLAN behavior with `eligible = total` ⇒ collapses to today's behavior. So Stages 1–6 below are purely additive on top of PREPLAN.

## Stage 1: Anchor-aware `applyRaises` (no UI)
Goal: Extend `applyRaises(afcMonthly, eligibleMonthly, retDate, N, cutoff)` (post-PREPLAN signature) to `applyRaises(afcMonthly, eligibleMonthly, retDate, N, cutoff, anchor = null)`. Math implements the delta-blend on the eligible slice. When `anchor === null`, output is byte-identical to the post-PREPLAN implementation. | Success: Behavior matches the formula above for every regime (anchor before earliest raise / at raise.date / mid-window / past raise.date+N). | Tests (browser console via `window._debug`): (a) anchor=null vs. removed parameter — identical AFC; (b) anchor before all RAISES dates — identical to null; (c) anchor exactly at a raise's date — that raise's delta = b(C); (d) anchor at raise.date + N years — that raise's delta = 0; (e) anchor mid-window — delta strictly between 0 and b(C). | Status: Not Started

## Stage 2: Add `afc-as-of` form input
Goal: New `<input type="date" id="afc-as-of">` placed next to `#manual-afc`, with a small "as of" label. Defaults to today's ISO date on page load. Lives in the manual-AFC sub-block so it shares the earnings-fieldset disabled state. | Success: Picker renders adjacent to the manual AFC field; default value = today; disabled when `#group-earnings-input` is disabled; `clearForm` resets it to today. | Tests: visual check; toggling the earnings fieldset disables/enables the picker; clearing the form resets to today. | Status: Not Started

## Stage 3: Thread `afcAsOf` into `calculateSeries`
Goal: Read `afcAsOfEl.value` at Calculate time, parse via `parseIsoDate`, and pass through `calculateSeries({ ..., afcAsOf })` to the existing `applyRaises` call site (`index.html:1324`). Empty/invalid input ⇒ pass `null` (current behavior). | Success: Changing the picker re-runs the projection and the "+raises" curve shifts as expected. | Tests: with the current (Stage 1-only) RAISES array, set anchor = 2025-12-01 vs. 2027-12-01 and confirm 2026-07-01 raise's contribution differs as predicted by the formula. | Status: Not Started

## Stage 4: Add `2025-07-01 / 3.5%` to RAISES array
Goal: Insert `{ date: new Date('2025-07-01'), rate: 0.035 }` at the front of `RAISES` (`index.html:603`). Already present in the displayed table — this brings the data array in sync. | Success: With anchor ≥ 2025-07-01 + N years, the new raise contributes 0 (no double-counting). With anchor before 2025-07-01, it blends in. | Tests: anchor = today (2026-05-02) under N=3 ⇒ b(A) = monthsBetween(2025-07-01, 2026-05-02) / 36 = 10/36 ≈ 0.278; for a far-future retirement b(C) = 1, delta ≈ 0.722 — verify pension-with-raises picks up the residual ~2.5% that the historical AFC didn't capture. | Status: Not Started

## Stage 5: Paystub scanner overwrites `afcAsOf`
Goal: After `computeAndFillAfc` succeeds (`index.html:1568`), set `afcAsOfEl.value` to the maximum `payEndDate` across `lastStubs` (not just selected windows — all extracted stubs). Same behavior in the dual-method branch. | Success: A scan of paystubs ending 2024-06-15 … 2025-09-30 sets the picker to 2025-09-30; a re-scan with newer stubs overwrites again; clearing scan results does not reset the picker (treat as sticky once user-edited or scan-populated). | Tests: scan a known PDF batch, observe picker; clear earnings, reload form, confirm picker resets to today. | Status: Not Started

## Stage 6: URL param + reload-link round-trip
Goal: Add `afcAsOf` to `SUPPORTED_PARAMS` (`index.html:2232`) and to the URL-pre-fill / reload-link plumbing (`index.html:2189`, `:2276`). Bad date triggers the existing red-outline + error-banner path. | Success: `?afcAsOf=2024-06-01` pre-fills picker; reload link includes current `afcAsOf` value. | Tests: round-trip URL load; `afcAsOf=invalid` triggers banner without breaking other fields. | Status: Not Started

## Stage 7: Document design choices in `info/DESIGN.md`
Goal: Add rows to the Key Decisions table capturing the design choices from this plan **and PREPLAN.md**. Specifically: (a) **AFC raise model** — Model B (N-year averaging blend) chosen over Model A (stairstep ×=(1+r)); rationale that AFC is by definition the N-year average, so a raise can only fully affect AFC after N years have elapsed. (b) **Raise-eligible AFC split (PREPLAN)** — separate optional field for the raise-eligible portion of AFC; raises grow only that slice while the frozen portion (lump sums, retros, fixed-dollar items) stays flat; blank ⇒ defaults to total ⇒ today's behavior. Scanner does not auto-classify (out of scope; OT and percentage differentials arguably do scale, so a default classifier would be opinionated). (c) **AFC anchor (`afcAsOf`)** — separate field from `svcAsOf`; defaults to today; paystub scanner overwrites with max `payEndDate`; sticky once set; `applyRaises` uses delta-blend (`b(C) − b(A)`) to avoid double-counting raises already absorbed into the entered AFC. (d) **Raise schedule scope** — only the FY26–FY29 ATB schedule shared by BUs 01/02/04/07/08/10 is modeled; BUs 03 and 09 omitted because they require step-movement modeling (pay-grid data) that's out of scope. (e) **2025-07-01 row** — included in `RAISES` despite being in the past, because anchors before that date legitimately need it blended in. | Success: DESIGN.md gains five new table rows (or equivalent prose entries) reflecting the above; entries are concise and follow the existing table's tone. | Tests: re-read DESIGN.md cold and confirm a future contributor would understand both *what* was chosen and *why* the rejected alternative was rejected. | Status: Not Started

## Out of scope / explicit non-goals
- Any change to `svcAsOf` semantics — `afcAsOf` is independent.
- Altering AFC averaging or DP solver logic.
- Modeling step movement, lump sums, or non-BU-08 raise schedules.
