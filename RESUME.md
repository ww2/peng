# RESUME — HST timezone refactor

## Where we are

Branch: `caching`. Two stages of `PLAN_HST.md` are **Complete** in code + tests; only **browser smoke** remains before the plan can be deleted.

- Stage 1 (RAISES UTC literal fix) — done, marked Complete in PLAN_HST.md.
- Stage 2 (`todayInHST()` helper + 7 call-site replacements) — done, marked Complete in PLAN_HST.md.
- 36/36 unit tests passing (`node --test tests/pension.test.js`).
- Browser smoke walkthrough — **not yet run**. Procedure is appended to PLAN_HST.md under "Browser smoke walkthrough" (steps 1–5 = HST regression checks, step 6 = optional TZ-override verification).

## Files touched in this session

- `lib/pension.js` — added `todayInHST()` at `:253`, exported at `:863`; switched `RAISES` literals at `:36-39` from UTC-string to component form; replaced `new Date()` for "today" in `calculateSeries` and dropped the now-redundant `todayMidnight` (the late `lastDayOfSvc < today` check at `:600` updated accordingly).
- `index.html` — `todayInHST()` swapped in at 5 sites: `:615` `renderRaisesTable`, `:1381` `validateMemDate`, `:1528` `runCalculate` `isSeparated`, `:1710` `todayIso`, `:2054` chart X-axis fallback. Cache `cachedAt` instant at `:670` intentionally untouched.
- `tests/pension.test.js` — added `RAISES dates are TZ-stable` and `todayInHST` (4 cases) blocks.
- `CLAUDE.md` — updated 4 bullets describing the synthetic-stream / `effectiveStream` work that PLAN.md (now deleted) had landed; line refs corrected for drift. Not part of the HST work but cleaned up in the same session.
- `PLAN.md` — deleted (its work was already implemented; only the cleanup remained).
- `PLAN_HST.md` — new planning doc for this work; both stages marked Complete; browser-smoke walkthrough appended.

## Resume procedure

1. Skim `PLAN_HST.md` to refresh context.
2. Run the **Browser smoke walkthrough** in `PLAN_HST.md` (steps 1–5 minimum, step 6 optional).
3. If anything fails, fix and re-run the unit tests (`node --test tests/pension.test.js`).
4. When smoke passes: delete `PLAN_HST.md` and `RESUME.md`.

## Notes / decisions worth keeping

- `todayInHST(now = new Date())` accepts an optional instant for testability. Tests pass `new Date(Date.UTC(...))` to exercise specific HST/UTC straddle cases without touching system TZ.
- Helper is reachable as a global from `index.html` (same pattern as `addMonths`, `parseIsoDate` — `lib/pension.js` is loaded as a classic script before the inline module-script).
- The remaining `new Date()` reads after Stage 2 are intentional: the helper's default param (`lib/pension.js:253`) and `cachedAt: new Date().toISOString()` (`index.html:670`, a real timestamp instant — user-local display is correct).
