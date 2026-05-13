## Stage 1: Rename pension clear button + update cache-clear hint
Goal: Cosmetic-only rename. `#clear-btn` label becomes `Clear pension fields`; the cache-clear hint at `index.html:553-555` updates from `Use the "Clear all fields" button to clear cached paystub data` to `Use the "Clear pension fields" button to clear cached paystub data`. No behavior changes.
Success: Page loads, button reads `Clear pension fields`, hint text updated, smoke test passes.
Tests: `node --test tests/index-html.test.js`. Manual: open `index.html`, eyeball the button + hint.
Status: Complete

## Stage 2: Add `Clear vacation fields` button (markup + wiring stub)
Goal: New `#vac-clear-btn` button inside `#vac-action-row` next to `#vac-graph-btn` (matches the pension action-row pattern). JS picks up an element reference and binds a no-op click handler stub. CSS picks up the new button via the existing `#graph-btn, #clear-btn, #picker-btn, #cancel-btn, #vac-graph-btn` selector — extend that selector to include `#vac-clear-btn`.
Success: Button renders, is clickable, no JS errors. Smoke test passes.
Tests: smoke test; manual click → no-op confirmed.
Status: Complete

## Stage 3: Implement `runClearVacation()` (vacation-only scope)
Goal: New handler clears only vacation-section state — `vacHoursEl`, `vacAsOfEl`, `vacHourlyRateEl` blanked; `vacRateEl` reset to `'14'`; `vacGraphBtn.disabled = true`; `vacStatusLine.textContent = ''`; `drawVacationChart(null)` (also clears `#vac-separated-message`); `updateReloadLink()` + `history.replaceState(null, '', buildReloadUrl())` (the existing builder will naturally drop vacation params now that the inputs are blank). Wire to `vacClearBtn.addEventListener('click', runClearVacation)`. Pension fields (including the shared `lastDay` / `stillActive`), pension chart, paystub cache, and the pension-side raises-NA checkbox are all left untouched.
Success: With both sections populated, clicking `Clear vacation fields` blanks vacation inputs + chart only; pension fields and pension chart unchanged; URL drops `vacHours`/`vacAsOf`/`vacRate`/`vacHourlyRate` and retains pension params.
Tests: smoke test; manual end-to-end with a URL that includes both pension + vacation params.
Status: Complete

### Stage 3a (added mid-flight): Empty vacation chart renders axes for symmetry
Goal: User asked for the empty vacation chart to behave like the empty pension chart — draw axes/title/legend even when fields are blank. Default empty-frame x-axis spans today−2yr → today+2yr (4 years, anchored to today's month-1st); y-axis $0–$50k with $10k increments.
Implemented: Dropped `display: none` + `.has-data` toggle from `#vac-chart-svg` CSS. Refactored `drawVacationChart` so a null/empty result still draws the frame; curves, LDOS marker, and tooltip are gated on `hasRows`. Separated branch now hides the SVG inline (`node.style.display = 'none'`) and surfaces `#vac-separated-message`. Added `drawVacationChart()` at script tail so the empty frame renders on initial page load.
Status: Complete

## Stage 4: Re-scope `runClear` to pension-only
Goal: Remove vacation-input resets from the field-zero loop (`vacHoursEl`, `vacAsOfEl`, `vacHourlyRateEl`); drop `vacRateEl.value = '14'`, `vacGraphBtn.disabled = true`, `vacStatusLine.textContent = ''`. Drop `vacRaisesNaEl.checked = false` — the bidirectional sync still propagates `raisesNaEl = false` until Stages 5–6 replace that checkbox. Keep the explicit `drawVacationChart(null)` call so pension-clear visually blanks both graphs per spec. The shared `stillActiveEl.checked = true` + `lastDayEl.value = ''` resets remain — these are pension-section controls. URL-builder needs no change; pension params naturally drop and vacation params survive.
Success: With both sections populated, clicking `Clear pension fields` blanks pension inputs + cache + paystub state + pension chart; vacation form fields remain intact; URL drops pension params and retains vacation params.
Tests: smoke test passes. Manual end-to-end NOT yet performed in browser — flag for resume.
Status: Complete (pending manual browser verification)

### Mid-flight rename
"Generate graph" relabeled to "Generate pension graph" (`index.html:577`) for symmetry with "Generate vacation graph". CLAUDE.md updated to match.

## Stage 4.5: Add vacation-scoped error banner
Goal: New `<div id="vac-error-banner" class="url-error-banner" hidden>` (matching the existing pension banner's markup) inserted immediately above `#group-vacation-input` (`index.html:590+`), reusing the existing `.url-error-banner` CSS. Title reads `Issues:` for consistency with the pension banner. Parameterize `addError(msg, els)` in the URL pre-fill block (`index.html:2108`) to accept an optional `target` argument `{ banner, list }`, defaulting to the existing top-of-page pension banner; the helper still toggles `target.banner.hidden = false` when entries land. Route vacation-related URL-param errors (`vacHours`, `vacAsOf`, `vacRate`, `vacHourlyRate` — lines `:2146` and `:2175-2177`) to the new vacation banner. Unknown-param errors and all pension-side errors continue to route to the top banner.
Success: Loading a URL with bad vacation params surfaces those errors in the vacation banner directly above the vacation fieldset; pension-param errors still appear at the top; both banners clear independently when offending fields are edited.
Tests: smoke test; manual: load `?vacHours=-5&memDate=invalid` → memDate error in top banner, vacHours error in vacation banner; edit each field → corresponding banner entry clears.
Status: Complete (pending manual browser verification)

## Stage 4.6: Drop pension-clear's vacation-chart blanking
Goal: Replace `drawVacationChart(null)` at `index.html:1792` with `maybeCalculateVacation()` so vacation auto-recomputes against the cleared pension state (the still-active default leaves vacation graphable as long as the user's vacation inputs are intact). No banner content needed — under current gating, pension-clear never actually puts vacation in a non-graphable state.
Success: With pension and vacation both populated, clicking `Clear pension fields` blanks the pension chart but leaves the vacation chart drawn (recomputed against the reset still-active/raises-NA state); vacation form inputs remain intact.
Tests: smoke test; manual end-to-end with a URL that includes both pension + vacation params; click `Clear pension fields` → vacation chart persists, pension chart blanks.
Status: Complete (pending manual browser verification)

## Stages 5 + 6 (combined): Replace `#vac-raises-na` checkbox with passive notice + simplify sync to one-way
Combined because Stage 5 markup removal leaves Stage 6 JS references dangling — no clean intermediate landing.
Goal: Swap the vacation-fieldset checkbox+label for `<div id="vac-raises-na-notice" class="form-row" hidden>` styled small/muted, text `Projected raises do not apply (set in pension section)`. Drop `vacRaisesNaEl` from the script. Replace `syncRaisesNaFrom` and its recursion guard with `updateVacRaisesNotice()` that toggles the notice's `hidden` from `raisesNaEl.checked`. Wire a single `raisesNaEl` `change` listener that calls `updateVacRaisesNotice()` + `maybeCalculateVacation()`. `runVacationCalculate` now reads `raisesNaEl.checked` directly (single source of truth). `applyRaisesNALock` drops the four `vacRaisesNaEl` mutation lines and calls `updateVacRaisesNotice()` when state changes. `runClear` calls `updateVacRaisesNotice()` after `raisesNaEl.checked = false` (programmatic mutation doesn't fire `change`).
Success: No `vacRaisesNaEl` symbol remains. Pension checkbox drives vacation graph re-render and the new notice in lockstep. The `applyRaisesNALock` auto-lock path still works (lock applies, notice appears). Pension-clear resets notice to hidden alongside the checkbox.
Tests: smoke test; manual: tick `#raises-na` → vacation chart recomputes + notice appears; set a `lastDay` that cuts off all raises → auto-lock fires + notice appears; clear pension → notice disappears.
Status: Complete (pending manual browser verification)

## Stage 7: Doc + comment cleanup
Goal: Update CLAUDE.md `Where Things Live` entries that reference the dual checkbox sync (`Dual raises-NA sync`, `Vacation` fieldset description, `syncRaisesNaFrom` line ref) to match the new one-way model. Update any inline comments in `index.html` that mention `vacRaisesNaEl` or the bidirectional sync (including the comment in `runClear` referring to "Stage 5/6" once those stages have landed). Final smoke + unit test pass.
Success: Docs match implementation; no stale references to the removed checkbox.
Tests: `node --test tests/*.test.js`; manual end-to-end one more time covering: both clears in isolation, raises-NA toggle, paystub auto-lock.
Status: Complete (pending final manual end-to-end verification)

## Stage 8: Show contractual fieldset when vacation is graphable, with explanatory note
The contractual fieldset currently hides for total-mode plans without paystubs, even though the RAISES table affects vacation projection. Stage 5+6 made this gap user-visible by removing the always-visible vacation-side checkbox. Expand visibility to also fire when vacation can graph; surface an explanatory note when only vacation is consuming the table.

### Stage 8a: Add `updateContractualVisibility()` helper + raises note markup
Goal: Refactor the contractual-fieldset visibility decision into a single function `updateContractualVisibility()` that reads both pension and vacation state. Add a `<p id="raises-note" class="raises-note" hidden>` inside `#group-contractual-input` (placement: just under the fieldset's `<legend>` and above the existing controls, so the explanation sits at the top). Add a `.raises-note` CSS rule (small italic muted grey, matching the existing form's secondary-text vocabulary). Note text: `These raises are projected through the vacation hourly rate. They aren't applied to your pension AFC with the current inputs — load paystubs above to project them through pension as well.`
Helper logic:
- `pensionUsesRaises` = `paystubStream !== null || (planConfig?.mode === 'regular' && manualAfc > 0)` (mirrors `raisesProjected` from `runCalculate`; recomputed locally so the helper can be called from any path).
- `vacationActive` = `canCalculateVacation()`.
- Set `contractualGroupEl.hidden = !(pensionUsesRaises || vacationActive)`.
- Set `raisesNoteEl.hidden = !(vacationActive && !pensionUsesRaises)`.
The helper supersedes `setContractualVisible(visible)` — drop `setContractualVisible` once all callsites migrate.
Wiring (all in this sub-stage):
- `runCalculate`: replace `setContractualVisible(raisesProjected)` (`index.html:1716`) with `updateContractualVisibility()`. The locally-computed `raisesProjected` constant stays — `noRaisesApply` and `showRaises` still use it.
- `maybeCalculateVacation`: add an `updateContractualVisibility()` call at the top (or end) so vacation-gating changes shift fieldset visibility even when pension can't recalc.
- `raisesNaEl` change listener: already calls `maybeCalculateVacation()`, which will now cascade — no extra wiring needed there.
- `runClear`: replace `setContractualVisible(false)` (`:1764`) with `updateContractualVisibility()` (after the rest of the clear is done) so a pension-clear that leaves vacation intact still shows the fieldset with the note.
- `runClearVacation`: add an `updateContractualVisibility()` call after the clear so the fieldset hides when vacation was the only thing keeping it visible.
- URL pre-fill block: after pension + vacation pre-fill completes, `maybeCalculate` and `maybeCalculateVacation` already fire — both paths now cover the contractual visibility update.
Success: Helper is the single source of truth for both fieldset visibility and note visibility. No `setContractualVisible` references remain.
Tests: smoke test + unit tests; manual: load `?plan=noncontributory&dob=…&memDate=…&svcYears=…&svcAsOf=…&afc=…&vacHours=…&vacAsOf=…&vacHourlyRate=…` → fieldset visible, note visible. Clear vacation → fieldset hides. Clear pension only → fieldset stays visible with note.
Status: Complete (pending manual browser verification)

### Stage 8b: CLAUDE.md cleanup
Goal: Update the `Contractual-adjustments fieldset` entry in CLAUDE.md (the one that describes `setContractualVisible` and `raisesProjected`) to reflect the new visibility model — fieldset shows when pension uses raises OR vacation is graphable; note appears in the vacation-only case.
Success: Docs match implementation.
Tests: `node --test tests/*.test.js`.
Status: Not Started

## Stage 9: Revert vacation-side notice → checkbox (no sync between sides)
Reverses Stage 5+6's "single source of truth" decision per user direction after coworker discussion. The two checkboxes become independent (user-accepted divergence). No auto-lock logic yet — that lands in Stages 10 and 11.

### Stage 9a: Revert vacation markup + JS handle
Goal: Replace `<div id="vac-raises-na-notice" hidden>…</div>` (`index.html:615-617`) with the original markup: a `.form-row` containing a `<label>` wrapping `<input type="checkbox" id="vac-raises-na">` + `<span id="vac-raises-na-text">Projected raises do not apply</span>`. Same styling as the pension-side raises-na row. In the JS handle block, drop `vacRaisesNaNoticeEl` and add `vacRaisesNaEl` + `vacRaisesNaTextEl`.
Success: Vacation fieldset now shows a real checkbox again. Notice div gone.
Tests: smoke test passes; manual: vacation fieldset shows checkbox (defaulted to unchecked, enabled).
Status: Not Started

### Stage 9b: Rewire vacation logic to read its own checkbox; drop one-way sync
Goal: `runVacationCalculate` (`index.html:1528`) reads `vacRaisesNaEl.checked` (not `raisesNaEl.checked`). Delete `updateVacRaisesNotice` and its three callsites (the `raisesNaEl` change listener at `:1553`, the call in `runClear` at `:1770`, the call in `applyRaisesNALock` at `:1934`). The `raisesNaEl` change listener simplifies to just `maybeCalculate` (pension recalc — already wired separately at `:1625`) — so the listener at `:1553` can be removed entirely, since `maybeCalculate` and `updateReloadLink` already fire on pension-side change elsewhere. Add `vacRaisesNaEl.addEventListener('change', maybeCalculateVacation)`. In `runClearVacation`, add `vacRaisesNaEl.checked = false` so vacation-clear resets the checkbox.
Success: Pension and vacation checkboxes operate independently; toggling one doesn't affect the other. No `vacRaisesNaNotice` symbol remains. Pension/vacation graphs recompute correctly when their respective checkboxes toggle.
Tests: smoke test passes; unit tests pass; manual: tick pension checkbox → only pension chart recomputes; tick vacation checkbox → only vacation chart recomputes; clear vacation → vac checkbox resets to unchecked.
Status: Not Started

## Stage 10: Add pension-side "no projection" auto-lock
Pension checkbox should be checked + disabled when the pension info doesn't support projecting raises at all (no paystub stream AND not regular-mode-with-manual-AFC). Composes with the existing lastDay-cutoff auto-lock in a single redesigned `applyRaisesNALock`.

### Stage 10a: Refactor `applyRaisesNALock` to take a reason; decouple from table visibility
Goal: Change `applyRaisesNALock(forced)` (`index.html:1933`) to `applyRaisesNALock({ pensionUsesRaises, noRaisesApply })`. Internally derive a `suffix` constant:
- `!pensionUsesRaises` → `RAISES_NA_NOPROJ_SUFFIX` (new constant, value `" — pension AFC isn't projecting raises with the current inputs"`)
- else if `noRaisesApply` → existing `RAISES_NA_LASTDAY_SUFFIX`
- else → `null` (release)

Lock state transitions: dataset.prior captured only on transition from unlocked → locked; transitions between locked-noproj and locked-lastday just swap the suffix without touching prior. Release restores prior. Update the single existing callsite in `runCalculate` (`:1731`) to pass `{ pensionUsesRaises: raisesProjected, noRaisesApply }`. Remove the trailing `maybeCalculateVacation()` call inside the lock function — with separate checkboxes, vacation no longer needs to cascade off pension lock changes.

**Also drop the two `raisesTableRowEl.hidden = …` mutations** (one in the lock-applied branch, one in the release branch). Per user direction, the RAISES table stays visible whenever the fieldset is visible, regardless of pension lock state — it's still informative even when raises don't apply to the pension chart (vacation may still consume them, and the LASTDAY pension lock can fire without the vacation lock firing for the same horizon).
Success: When `runCalculate` fires, the pension checkbox locks/unlocks per the same rules as before, with the new NOPROJ suffix appearing when `paystubStream === null && !(regular-mode plan + manual AFC)`. Existing LASTDAY-suffix behavior unchanged. RAISES table visibility is no longer toggled by the auto-lock — it stays visible whenever the fieldset is.
Tests: smoke test passes; manual: load `?plan=noncontributory&dob=…&memDate=…&svcYears=…&svcAsOf=…&afc=4500` → pension checkbox checked + disabled with NOPROJ suffix, **table visible**; load paystubs → suffix clears (lock releases or transitions to LASTDAY), table still visible.
Status: Not Started

### Stage 10b: Drive pension lock outside `runCalculate`
Goal: Currently `applyRaisesNALock` only fires inside `runCalculate`, which requires `canCalculate()` to be true. For incomplete pension forms, the NOPROJ lock would never apply. Wire `updateContractualVisibility` (`index.html:1947`) to call `applyRaisesNALock({ pensionUsesRaises, noRaisesApply: false })` after its visibility decision — `pensionUsesRaises` is already computed locally there. Inside `runCalculate`, the second `applyRaisesNALock` call later in the function (with the real `noRaisesApply`) supersedes for the LASTDAY-suffix case. Wire `maybeCalculate`'s else branch (`:1508`) to call `updateContractualVisibility()` so the lock state stays current when pension form is incomplete.
Success: With an incomplete pension form (e.g., plan + paystubs loaded but no DOB) — pension checkbox state still reflects current `pensionUsesRaises`. When form completes and `runCalculate` runs, LASTDAY suffix takes over if appropriate.
Tests: smoke test passes; manual: select noncontributory plan + nothing else → pension checkbox locks with NOPROJ suffix; enter manual AFC > 0 → still NOPROJ (noncontributory is total-mode, manual AFC doesn't help); switch to hybrid-post2012 + manual AFC → lock releases.
Status: Not Started

### Stage 10c: Drop the inline "hide table when checkbox checked" listener
Goal: The inline `<script>` at `index.html:509-515` (immediately after the contractual fieldset) registers a change listener on `#raises-na` that hides `#raises-table-row` and `#raises-applies-row` when the user manually checks the box. Per user direction (table stays visible whenever the fieldset is), this listener is now incorrect — drop the entire `<script>` block. The auto-lock path's table-hiding is already removed in Stage 10a.
Success: Manually checking the pension `#raises-na` checkbox no longer hides the RAISES table or the "applies to BUs…" line. Table visibility is purely a function of fieldset visibility (Stage 8a's logic).
Tests: smoke test passes; manual: with the contractual fieldset visible and `#raises-na` unchecked, click the checkbox manually → table and BU line both remain visible.
Status: Not Started

## Stage 11: Add vacation-side "lastDay-cutoff" auto-lock
The vacation checkbox should auto-lock when no raise can compound through the vacation hourly rate — i.e., when `lastDayOfSvc` is set and no `RAISES` dates fall strictly after `vacAsOf` and on/before `lastDayOfSvc`. Mirrors the pension LASTDAY lock conceptually, but uses vacation's own raise window (per `vacationPayoutAt`'s logic in `lib/pension.js:491`).

Goal: New `applyVacRaisesNALock()` function (no args — reads state directly via `canCalculateVacation`, `stillActiveEl`, `lastDayEl`, `vacAsOfEl`, and the `RAISES` constant). Internal logic:
- If `!canCalculateVacation() || stillActiveEl.checked || !lastDayEl.value || !vacAsOfEl.value` → not enough info to decide → release lock.
- Else compute `hasRaiseInWindow = RAISES.some(r => rd > vacAsOf && rd <= lastDay)`; lock iff `!hasRaiseInWindow`.

Mirror the pension lock's dataset.forced/prior mechanic for state preservation. Suffix: existing `RAISES_NA_LASTDAY_SUFFIX` (`" due to the Last day of service above"` — verbatim, since `lastDay` lives in the pension form visually above the vacation checkbox).

Wire `applyVacRaisesNALock()` into `maybeCalculateVacation` (`:1538`) — call it *before* `runVacationCalculate` so the calc reads the locked checkbox state.
Success: A URL with vacation inputs + `lastDay` < first future raise → vacation checkbox checked + disabled + LASTDAY suffix; vacation chart respects the lock (no raises applied). Removing `lastDay` (or extending it past the next raise) releases the lock; vacation chart re-applies raises.
Tests: smoke test passes; manual: `?lastDay=2026-06-01&vacHours=400&vacAsOf=2026-01-01&vacHourlyRate=45` with a raise on (say) 2026-07-01 → vacation checkbox auto-locks; extend lastDay to 2026-12-01 → lock releases.
Status: Not Started

## Stage 12: Reword `#raises-note` to reduce redundancy with pension suffix
Goal: With the pension-side NOPROJ suffix now carrying *"pension AFC isn't projecting raises with the current inputs"*, the matching half of the note text becomes redundant. Reword the note from:

> *These raises are projected through the vacation hourly rate. They aren't applied to your pension AFC with the current inputs — load paystubs above to project them through pension as well.*

to:

> *These raises are projected through the vacation hourly rate. Load paystubs above to also project them through pension AFC.*

The first sentence (unique info: raises *are* affecting vacation) and the actionable hint (load paystubs) survive; the redundant "they aren't applied to pension" half collapses into the suffix on the pension checkbox.
Success: Note copy matches the new text; visual layout unchanged.
Tests: smoke test passes; manual: triggers same as Stage 8a's tests — note appears in vacation-only mode with the new wording.
Status: Not Started

## Stage 13: CLAUDE.md doc cleanup (post Stages 9–12)
Goal: Multiple entries in CLAUDE.md need to follow the two-checkbox revert:
- `Vacation` fieldset description (`:31`) — describe the standalone `#vac-raises-na` checkbox + its lastDay-cutoff auto-lock (parallel to pension's). Drop references to `updateVacRaisesNotice` / single-source-of-truth.
- `Raises-NA pension → vacation notice` entry (`:71`) — rewrite/rename. New title proposal: `Raises-NA auto-locks (pension + vacation)`. Describe the two independent checkboxes and the four lock reasons (pension NOPROJ, pension LASTDAY, vacation LASTDAY) with their suffixes and triggers. Note that the two checkboxes are intentionally allowed to diverge.
- `Contractual-adjustments fieldset` entry — extend Stage 8a's pending update to include (a) the new NOPROJ suffix on the pension checkbox and (b) the table-visibility decoupling (table stays visible whenever the fieldset is, regardless of either checkbox's state).

Success: Docs match implementation; no stale references to `vacRaisesNaNotice`, `updateVacRaisesNotice`, or the bidirectional sync.
Tests: `node --test tests/*.test.js`; final manual end-to-end covering: pension NOPROJ lock, pension LASTDAY lock, vacation LASTDAY lock, both clears in isolation, fieldset visibility in all four pension × vacation gate combinations.
Status: Not Started
