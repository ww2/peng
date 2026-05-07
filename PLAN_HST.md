# Plan: Make "now" timezone-stable (HST)

## Problem

The app reasons about Hawaii calendar dates (paystubs, ERS membership, retirement) but takes "now" from the user's wall clock. Two real exposures exist today:

1. **`RAISES` literals use the UTC-string form.** `lib/pension.js:36-39` builds `new Date('2025-07-01')` etc., which is parsed as UTC midnight. In any zone west of UTC (incl. HST and US mainland), `getMonth()` / `getDate()` then return the *previous calendar day*. The displayed schedule in `renderRaisesTable` (`index.html:614-624`) silently shifts to "2025-06-30 …", and the `r.date > cutoff` filter and `applyRaises` / `projectAfcAtRetirement` comparisons run against an instant ~10 hrs before the contractual raise date.

2. **`new Date()` is used directly for "today" in 5+ places.** A user opening the app from outside HST sees "today" defined by their wall clock, not by the calendar that the paystubs and ERS dates live on. At month boundaries this can shift the projection start, the synthetic-stream anchor, the "still active vs. separated" gate, and the X-axis fallback by one calendar day — and at month boundaries by a month.

The dates that flow into the app from user inputs (`<input type="date">`, paystub `MM/DD/YYYY` strings) and from constants built component-wise (`new Date(y, m-1, d)`) are **already timezone-agnostic** — they construct local-midnight Dates from explicit Y/M/D components, and comparisons among them work regardless of the user's TZ. They do not need to be touched.

## Scope

Fix only the two issues above. Do not touch:

- Paystub parsing or `parseDate` / `parseIsoDate` (already component-wise, TZ-stable).
- Cache `cachedAt` instant (`index.html:670`, `:759`) — a real timestamp; user-local display is reasonable.
- `TIER_BOUNDARY`, `PRE_1971_DATE`, test-fixture Dates (all component-wise; correct).
- Chart COLA / July-1 ticks (built component-wise from `retDate`).

## Stage 1: Fix RAISES UTC-string literals
Goal: Make the `RAISES` schedule render and compare on the intended calendar date in every timezone. | Success: In any local TZ (incl. America/Los_Angeles, Pacific/Honolulu, UTC), the table at `#raises-table-body` shows "2025-07-01, 2026-07-01, 2027-07-01, 2028-07-01" exactly, and `RAISES[i].date.getMonth()` returns `6` for each. | Tests: add a `tests/pension.test.js` case that asserts each `RAISES[i].date` has `getFullYear() === expectedY && getMonth() === 6 && getDate() === 1`. (Currently passes only in TZs at/east of UTC; passes everywhere after the fix.) | Status: Complete

Change:
- `lib/pension.js:36-39` — replace each `new Date('YYYY-MM-DD')` with `new Date(YYYY, M-1, D)`. Four lines, mechanical.

Independent of Stage 2; safe to ship alone.

## Stage 2: Route "today" through a single `todayInHST()` helper
Goal: All "what is today?" reads return the calendar date in HST regardless of the user's TZ. | Success: With the system clock straddling a calendar boundary (e.g. 2026-05-07 02:00 UTC = 2026-05-06 16:00 HST = 2026-05-06 19:00 PDT = 2026-05-07 11:00 JST), every site that previously called `new Date()` agrees the date is 2026-05-06: series start month, raises-table cutoff, validateMemDate "today", `isSeparated` gate, `todayIso()`, and chart X-axis fallback. | Tests: add a unit test that swaps in a fixed `Date` (or stubs `Date.now`) and verifies `todayInHST()` returns 2026-05-06 for the four reference instants above. | Status: Complete

Add helper to `lib/pension.js` alongside the other date utilities (~`:249`):

```js
// Calendar "today" in Pacific/Honolulu, returned as a local-midnight Date
// so it composes with the rest of the component-built date utilities.
function todayInHST() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Pacific/Honolulu',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const get = t => +parts.find(p => p.type === t).value;
  return new Date(get('year'), get('month') - 1, get('day'));
}
```

Export it from the Node hatch at `lib/pension.js:851`.

Replace the direct `new Date()`-for-now sites:

| File:Line | Current | Replace with |
|---|---|---|
| `lib/pension.js:442` | `const today = new Date();` | `const today = todayInHST();` |
| `lib/pension.js:458` | `const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());` | drop — `todayInHST()` is already midnight; use `today` directly |
| `index.html:615-616` (`renderRaisesTable`) | `const now = new Date(); const cutoff = boundary ?? new Date(now.getFullYear(), now.getMonth(), 1);` | `const t = todayInHST(); const cutoff = boundary ?? new Date(t.getFullYear(), t.getMonth(), 1);` |
| `index.html:1381` (`validateMemDate`) | `const today = new Date(); today.setHours(0, 0, 0, 0);` | `const today = todayInHST();` |
| `index.html:1528` (`runCalculate`'s `isSeparated` check) | `const today = new Date(); today.setHours(0, 0, 0, 0);` | `const today = todayInHST();` |
| `index.html:1710-1711` (`todayIso()`) | `const d = new Date(); return …` | `const d = todayInHST(); return …` |
| `index.html:2054-2056` (chart X-axis fallback) | `const today = new Date(); …` | `const today = todayInHST(); …` |

Leave alone:
- `index.html:670` — `cachedAt: new Date().toISOString()` is a real instant.
- `index.html:759` — display of the cache timestamp (user-local is fine).
- All `new Date(date)` clones, `new Date(getTime() ± …)`, `new Date(y, m, d)` constructors — these don't read the wall clock.

## Out of scope (intentional)

- Formatting the cache `cachedAt` display in HST. The instant is correct; user-local "when I last cached" is the natural choice.
- A full HST conversion of every Date in the codebase. The component-built Dates already behave as TZ-agnostic calendar dates; converting them adds complexity without fixing a bug.
- Mocking the system clock in `calculateSeries` tests beyond Stage 2's helper test. Pre-existing non-determinism, untouched here.

## Browser smoke walkthrough

You're in HST, so the regression checks (1–5) are the most important — they confirm the refactor didn't break anything you currently rely on. Section 6 is optional but is the only way to *see* the bug fix actually working, since "browser local TZ === HST" hides the symptom.

### Setup

Open `index.html` in a browser. Open DevTools so you can:
- Check the JS console for errors
- (Later) override the browser timezone to verify HST-anchoring

### 1. RAISES table renders on cold load (Stage 1)

Goal: confirm the formerly-broken display now shows correct calendar dates.

- Load the app fresh (no URL params).
- The **Contractual adjustments** fieldset is hidden until extrapolation kicks in, so it won't be visible yet — skip ahead to step 2 to make it appear, then come back.
- (After step 2) The raises table at `#raises-table-body` should list rows ending in `-07-01`. Specifically: `2025-07-01`, `2026-07-01`, `2027-07-01`, `2028-07-01` (some may be filtered out as already-past depending on today's date in HST — `2025-07-01` definitely is by now).
- **Pre-fix would have shown `-06-30`.** This is the most visible artifact of Stage 1.

### 2. Generate-graph round trip (Stage 2: `calculateSeries today`, `isSeparated`, `setContractualVisible`)

URL:
```
file:///path/to/index.html?plan=hybrid&dob=1980-01-01&memDate=2014-08-01&svcAsOf=2024-01-01&svcYears=10&afc=5000
```

- Generate-graph button auto-fires. Chart should show a primary blue curve and (because this is regular-mode hybrid-post2012 with manual AFC > 0) a purple raises curve diverging upward at each scheduled raise date.
- Contractual-adjustments fieldset becomes visible; raises table populated per step 1.
- No console errors.

This exercises `calculateSeries`'s `today` and the `isSeparated` gate (lastDayOfSvc is null here so isSeparated stays false).

### 3. `validateMemDate` — future-date guard

- In the Required-information fieldset, edit the `memDate` field.
- Today (HST): NOT flagged.
- Tomorrow: red banner "membership date YYYY-MM-DD is in the future".
- 2050: same error.
- Back to `2014-08-01`: banner clears.

### 4. `todayIso()` — Still-active toggle

- Uncheck "Still active". Last-day-of-service field auto-populates with today's HST date in `YYYY-MM-DD` format.
- Re-check "Still active". Field clears.

### 5. Empty-state chart fallback (chart X-axis fallback)

- Click "Clear all fields". Chart clears. No console errors.
- The fallback X-axis range is rarely user-visible; regression risk is low. If clearing didn't error, the fallback path is healthy.

### 6. Optional: TZ-override verification

This is what proves the change works for users *outside* HST.

**Chrome DevTools timezone override:**
1. DevTools → ⋮ → More tools → **Sensors**
2. Sensors panel → "Location" → preset like "Tokyo" / "Berlin", or "Other…" with `Asia/Tokyo`.
3. **Reload the page.** (Override only affects code that runs after enabling it.)
4. Repeat steps 1–4. Everything should behave identically — RAISES table still shows `-07-01`, today-in-HST is still HST's calendar day, "Still active" still puts HST's date in the lastDay field.
5. To make the difference *visible*: with Tokyo override active, `todayIso()` should emit HST's date — not Tokyo's. Spot-check that the date in the lastDay field matches your phone's Hawaii time (not Tokyo).

**Hardest case, most decisive:** the rare moment when HST and your override straddle midnight (e.g. Tokyo 00:00–19:59 = HST previous day). Reproducing manually requires waiting or fudging the OS clock; not worth it unless you suspect a bug — the unit tests already cover the math.
