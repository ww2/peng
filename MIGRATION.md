# afc.html → index.html Migration Plan

Ports the complete PDF extraction pipeline from `../afcScanner/afc.html` into
`index.html` (PLAN.md Stage 2). When all steps are done, picking a paystub
directory in `index.html` will extract earnings, show a per-file debug view,
expose a JSON download, and display a filter summary — matching afc.html's
output exactly. `window.afcComputed` stays null until Stage 3 (plan dropdown
+ DP solver).

After Step 8 the project contains no references to `afc.html` or `afcScanner`.

---

## Step 1 — Add pdf.js import ✓

Add to the `<script type="module">` block, before any other code:

```js
import * as pdfjsLib from 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.min.mjs';
pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.worker.min.mjs';
```

**Validate**: Page loads with no console errors. Add `console.log(pdfjsLib.version)`
temporarily and confirm it prints `4.4.168` (or similar). Remove the log.

---

## Step 2 — PDF parsing constants and row/header functions ✓

Copy verbatim from `afc.html` into the script block:

- `GAP_THRESHOLD = 30`
- `ALIASES`, `REVERSED_ALIASES`, `KNOWN`, `IGNORED`
- `reconstructRows(allItems)`
- `rowToString(items)`
- `parseHeader(rows)`
- `findEarningsBlock(rows)`
- `findTaxBoundaryX(rows, headerIdx)`
- `parseEarnings(rows, headerIdx, totalIdx)`

No changes needed — none of these touch the DOM or pdfjsLib.

**Validate**: Page loads; no console errors.

---

## Step 3 — `extractPaystub` function ✓

Copy verbatim from `afc.html`:

- `extractPaystub(file)` — async; reads the file via pdfjsLib, calls
  `reconstructRows` → `parseHeader` → `findEarningsBlock` → `parseEarnings`;
  returns the paystub record plus `_rows`, `_block`, `_warnings` display fields.

**Validate**: Page loads; no console errors. (End-to-end exercise happens in Step 7.)

---

## Step 4 — Date utilities

Copy verbatim from `afc.html`:

- `parseDate(s)` — `MM/dd/yyyy` string → `Date`
- `addMonths(date, n)`
- `addDays(date, n)`
- `fmtDate(date)` — `Date` → `MM/dd/yyyy` string

**Validate**: Page loads. Add a temporary smoke-test block and confirm all
assertions pass silently in the console:

```js
console.assert(fmtDate(parseDate('01/15/2024')) === '01/15/2024', 'round-trip');
console.assert(fmtDate(addMonths(new Date(2024, 0, 1), 1)) === '02/01/2024', 'addMonths');
console.assert(fmtDate(addDays(new Date(2024, 0, 31), 1)) === '02/01/2024', 'addDays');
```

Remove the block after verifying.

---

## Step 5 — AFC pipeline (filtering, windowing, DP solver)

Copy verbatim from `afc.html`:

- `typeRank(k)`, `typeSort(a, b)`
- `fmtMoney(v)`
- `filterStubs(paystubs)` — drops paper checks and stubs with missing dates;
  strips IGNORED earnings types; returns `{ stubs, dropped }`
- `generateWindows(stubs)` — produces candidate 12-month windows anchored at
  every 1st-of-month across the data range
- `scoreStub(stub, mode)` — sums regular or all non-ignored earnings
- `solveDP(windows, N)` — exact DP; picks best N non-overlapping windows by score

**Validate**: Page loads; no console errors.

---

## Step 6 — Display helpers

Copy verbatim from `afc.html`, with two small adaptations noted below:

- `toJson(obj)` — JSON serializer that formats monetary numbers to exactly 2
  decimal places
- `formatFields(result, block, warnings, rows)` — formats per-file field summary
- `populateOutput(file, output)` — async; calls `extractPaystub`, renders
  fields + toggle-able raw rows into a div; marks `output.dataset.parsed = '1'`
- `makeFileEntry(file)` — builds a `<li>` with a click-to-expand link backed by
  `populateOutput`
- `expandAll(listEl)` — **(adaptation)** accepts the `<ul>` element as a
  parameter instead of querying `#files` globally, so it works inside `#debug-body`
- `showFilterSummary(total, stubs, dropped, errors, windows)` — **(adaptation)**
  returns the summary string instead of writing to `#filter-summary` directly;
  caller places it in `#debug-body`

**Validate**: Page loads; no console errors.

---

## Step 7 — Wire the picker change handler

Replace the `// Stage 1 smoke-test` comment in the script with the picker wiring.
Wire `document.getElementById('picker').addEventListener('change', …)` to drive
an adapted `extractAll` function:

1. Collect PDF files from `event.target.files`; sort by path.
2. Set `#afc-computed` to "Extracting…" to show progress.
3. Call `extractPaystub` for each file (show "Extracting… N / M" progress).
4. Sort results by `documentNumber`; build the `{ aliases, paystubs }` output object.
5. Call `filterStubs` and `generateWindows` on the results.
6. Populate `#debug-body` with:
   - A `<p>` showing stub count + "Expand all" + "Extract → JSON" buttons
   - A `<ul id="files">` built via `makeFileEntry` (hidden by default, toggled
     by "show ▶" button)
   - A `<pre>` with the `showFilterSummary` text
   - A `<pre id="json-out">` with the formatted JSON (hidden until Extract is clicked)
7. Wire the "Extract → JSON" button to render the JSON into `#json-out` and
   enable a download link — same logic as `afc.html`'s `extractAll`.
8. Set `#afc-computed` to a status line such as:
   `"16 stubs extracted (01/01/2020 – 12/31/2024) · select a plan to compute AFC"`
9. Leave `window.afcComputed = null` — AFC is computed in Stage 3.
10. Call `updateCalcBtn()`.

**Validate**: Open `index.html` in browser; pick the same paystub directory
previously used with `afc.html`:

- `#afc-computed` shows the extraction status line with correct stub count and
  date range.
- Opening "Show paystub detail / Export JSON" reveals the filter summary and
  file list.
- Clicking a file link expands its per-file fields and raw rows.
- Clicking "Extract → JSON" produces the inline JSON view and enables download.
- Download the JSON; diff against `afc.html`'s output — should be byte-for-byte
  identical (same stub records, same monetary formatting).
- Calculate button remains disabled (plan + DOB not yet filled, afcComputed still null).
- No console errors.

---

## Step 8 — Remove all references to afc.html and afcScanner

1. **`CLAUDE.md`**: Remove the "Existing Code to Port (Stage 2)" section (the
   block that lists functions to import from `afc.html`). Update Stage 2's
   status note.
2. **`PLAN.md`**: Remove the "What Already Exists / afc.html" section. Mark
   Stage 2 as `Status: Complete`.
3. Confirm no remaining references:
   ```
   grep -r "afc\.html\|afcScanner" .
   ```
   Should return no matches within the project directory.

**Validate**: The grep above is clean. Open `index.html`; full picker flow
still works as verified in Step 7.
