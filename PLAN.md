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

## Stage 5: Replace `#vac-raises-na` checkbox with a passive notice
Goal: Swap the vacation-fieldset checkbox+label at `index.html:609-613` for a single `<div id="vac-raises-na-notice" hidden>` styled small/muted, text: `Projected raises do not apply (set in pension section)`. The notice is visible only when `#raises-na` is checked. No new form control — the vacation section reads the pension-side state.
Success: Markup renders correctly; notice hidden by default; toggling `#raises-na` shows/hides the notice; vacation graph still recomputes correctly when the pension checkbox toggles.
Tests: smoke test; manual: tick/untick `#raises-na`, observe notice visibility + vacation graph recompute.
Status: Not Started

## Stage 6: Simplify the raises-NA sync to one-way (pension → vacation)
Goal: Drop `vacRaisesNaEl` from the script entirely. Replace `syncRaisesNaFrom` (`index.html:1539`) with `updateVacRaisesNotice()` that toggles `#vac-raises-na-notice`'s `hidden` attribute from `raisesNaEl.checked`. Wire a single `raisesNaEl` change listener that calls `updateVacRaisesNotice()` and triggers `maybeCalculateVacation()` (replacing the previous `vacRaisesNaEl` change listener). Remove the `vacRaisesNaEl.dispatchEvent(new Event('change'))` and the recursion guard. Update `applyRaisesNALock` (`index.html:1903`) to drop its `vacRaisesNaEl.checked = …` line. Sweep for any remaining `vac-raises-na` / `vacRaisesNa` references in `runClear`, the URL pre-fill block, etc., and remove them.
Success: No `vacRaisesNaEl` symbol remains. Pension checkbox still drives vacation graph re-render and the new notice. The `applyRaisesNALock` auto-lock path still works (lock applies, notice appears).
Tests: smoke test; manual: tick `#raises-na` → vacation chart recomputes + notice appears; set a `lastDay` that cuts off all raises → auto-lock fires + notice appears.
Status: Not Started

## Stage 7: Doc + comment cleanup
Goal: Update CLAUDE.md `Where Things Live` entries that reference the dual checkbox sync (`Dual raises-NA sync`, `Vacation` fieldset description, `syncRaisesNaFrom` line ref) to match the new one-way model. Update any inline comments in `index.html` that mention `vacRaisesNaEl` or the bidirectional sync (including the comment in `runClear` referring to "Stage 5/6" once those stages have landed). Final smoke + unit test pass.
Success: Docs match implementation; no stale references to the removed checkbox.
Tests: `node --test tests/*.test.js`; manual end-to-end one more time covering: both clears in isolation, raises-NA toggle, paystub auto-lock.
Status: Not Started
