# Readability / Maintainability Refactor

Each step is self-contained and leaves the app in a working state.

---

## Step 1: Delete dead functions `typeRank` and `typeSort`
Goal: Remove two functions that are defined but never called.
Lines: 748–754
Test: Open app, pick a directory, verify AFC still computes and Calculate still works.
Status: Complete

---

## Step 2: Remove `window.afcComputed`
Goal: Remove the `window.afcComputed` variable (always `null`, never written to a non-null value)
and simplify the `updateCalcBtn` check that tests it.
Lines: 429, 1055, 1069
Test: Pick a directory — Calculate button should still enable after AFC fills in.
Enter a manual AFC directly — button should enable.
Status: Complete

---

## Step 3: Replace local `fmt` with `fmtMoney`
Goal: Delete the `fmt` closure inside `formatFields` and call the module-level `fmtMoney` instead.
Lines: 898 (local `fmt`), 901–904 (call sites)
Test: Click a file link in the paystub list; verify the fields panel shows correctly-formatted money values.
Status: Not Started

---

## Step 4: Hoist `toYmd` to module scope
Goal: Extract the `toYmd` arrow function from inside the `picker` change handler and declare it as
a named module-level function.
Lines: 416 (definition), 421–423 (call site)
Test: Pick a directory; verify the "Paystubs from …/… to …/…" date-range line still appears.
Status: Not Started

---

## Step 5: Hoist `MONTHS` to module scope
Goal: Move the `MONTHS` array out of `drawChart` (where it is recreated on every call) to a
module-level `const`.
Lines: 1354
Test: Calculate a series; hover the chart tooltip and verify month names appear correctly.
Status: Not Started

---

## Step 6: Cache frequently-used DOM elements
Goal: Declare `const` references for the most-accessed elements at module scope so
`document.getElementById` is not scattered throughout the logic.
Elements: `plan`, `dob`, `manualAfcEl`, `calcBtn`, `svcYearsEl`, `svcMonthsEl`, `lastDayEl`,
`svcAsOfEl`, `svcAsOfField`, `earningsFieldset`, `statusLine`, `pickerEl`, `pickerBtn`,
`cancelBtn`, `pickerPath`, `afcComputedEl`, `afcDateRange`, `debugDetails`, `debugBody`,
`reloadLink`
Test: Full smoke test — fill form, pick directory, Calculate, hover tooltip.
Status: Not Started

---

## Step 7: Extract chart style constants
Goal: Replace repeated magic strings in `drawChart` with a module-level `const CHART` object.
Fields: `font` (`'monospace'`), `colorAxis` (`'#555'`), `colorGrid` (`'#e0e0e0'`),
`colorMinorTick` (`'#bbb'`), `colorLine` (`'#0066cc'`), `colorLabel` (`'#333'`),
`colorTitle` (`'#222'`)
Test: Calculate a series; verify chart renders with correct colors, fonts, and labels.
Status: Not Started
