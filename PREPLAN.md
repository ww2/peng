# Pre-PLAN — Replace dropdown tier split with ERS membership date field

## Background

The plan dropdown currently encodes both plan type AND tier in five
options:

- `hybrid-post2012` / `hybrid-pre2012`
- `contributory-post2012` / `contributory-pre2012`
- `noncontributory`

`PLAN.md` Stage 8 also adds a separate `memDate` field (purely to gate
the pre-1971 dual-method AFC trigger), which leaves us with two era-ish
controls side by side. This pre-plan eliminates that redundancy by
collapsing the dropdown to three options and using a single ERS
membership date input to drive **both**:

1. **Tier inference** for hybrid and contributory (`memDate ≥ 2012-07-01`
   → post-2012 tier; else pre-2012)
2. **Pre-1971 dual-method AFC trigger** (consumed in `PLAN.md` Stage 9;
   applies to `hybrid-pre2012`, `contributory-pre2012`, and
   `noncontributory`)

`memDate` is **required for all three plans**: hybrid and contributory
need it for tier inference; noncontributory needs it because the
pre-1971 dual-method AFC rule (`info/Noncontributory200912.md:119-125`)
applies to noncontributory members too. Treating it as required up
front avoids ambiguity over whether a blank value means "not pre-1971"
or "user forgot to enter it".

## Scope notes

- `PLAN_CONFIGS` keeps its five-key structure unchanged. A single helper
  `derivePlanKey(plan, memDate)` translates the new (plan, memDate) pair
  into the existing internal key (`hybrid-post2012`, etc.). This keeps
  the refactor surface tiny: the eligibility `switch`, ARF lookup, AFC
  mode/N selection, and COLA rate all keep working as-is.
- Boundary date: `2012-07-01` (matches the existing dropdown labels
  "joined July 2012 or later" / "joined before July 2012").
- No URL backwards compatibility. Legacy URLs (e.g.,
  `?plan=hybrid-post2012`) will fail validation and surface an error to
  the user (Stage 4). Old bookmarks need to be regenerated.

---

## Stage 1: Introduce `derivePlanKey()` helper, no behavior change
Goal: add `function derivePlanKey(plan, memDate)` that returns the
existing internal key. For now, accept the five legacy values
(`hybrid-post2012`, etc.) and pass them through unchanged; ignore
`memDate`. Replace every direct read of `planEl.value` that flows into
`PLAN_CONFIGS`, `calculateSeries`, eligibility, ARF, or COLA with
`derivePlanKey(planEl.value, memDateEl?.value)`.
Success: byte-identical curves and AFCs for every existing scenario;
`grep -nE "PLAN_CONFIGS\[" index.html` shows every read going through the
helper.
Tests: regression — open every fixture URL in `notes.md` plus one URL per
plan variant, compare to git-stash baseline screenshots. No diff.
Status: Complete

## Stage 2: Add the membership-date input field
Goal: optional date input "ERS membership date", placed under DOB in the
Required-information fieldset. URL param `memDate`. Field is rendered
unconditionally but its value is **not yet consumed** (Stage 1 helper
still ignores it). Wire it through `buildReloadUrl()`,
`updateReloadLink()`, `URL parameter pre-fill`, and the clear-all-fields
button.
Success: field round-trips through URL on every plan; reload-bar URL
contains `memDate=YYYY-MM-DD` when set; clear-all clears it.
Tests:
- Open `?plan=hybrid-post2012&memDate=2015-08-01` → field shows
  2015-08-01; reload-bar URL preserves it.
- Open `?plan=noncontributory` (no `memDate`) → field is blank; URL omits
  the param.
- Click Clear all fields → date input is empty.
Status: Complete

## Stage 3: Collapse the plan dropdown to three options
Goal: replace the five `<option>` entries with three: `Hybrid plan` /
`Contributory plan` / `Noncontributory plan` (longer descriptive labels;
the tier qualifier moves to the membership-date field). Update `derivePlanKey()` to:
```js
function derivePlanKey(plan, memDate) {
  if (plan === 'noncontributory') return 'noncontributory';
  if (plan === 'hybrid' || plan === 'contributory') {
    const tier = memDate && parseIsoDate(memDate) >= new Date(2012, 6, 1)
      ? 'post2012' : 'pre2012';
    return `${plan}-${tier}`;
  }
  return plan;  // legacy values still pass through (back-compat shim path)
}
```
Update `canCalculate()` to require `memDate` for **all** plans (hybrid,
contributory, and noncontributory all need it — see the Background note
on the pre-1971 dual-method AFC rule).
Success: dropdown shows three options; Generate-graph is disabled
whenever `memDate` is blank, regardless of plan.
Tests:
- `plan=hybrid` + memDate=2015-01-01 → curves match prior
  `plan=hybrid-post2012` build.
- `plan=hybrid` + memDate=2010-01-01 → curves match prior
  `plan=hybrid-pre2012` build.
- `plan=hybrid` + no memDate → Generate-graph disabled.
- `plan=noncontributory` + no memDate → Generate-graph disabled (this
  is the behavior change — previously curves rendered).
- `plan=noncontributory` + memDate=1968-04-01 → Generate-graph enabled;
  Stage 9 of `PLAN.md` (when implemented) will pick this up.
Status: Complete

## Stage 4: URL parameter validation and error display
Goal: when the URL parameter pre-fill encounters values that don't match
expectations, surface a single visible error rather than silently
loading a partial state. Validation cases:
- Unknown `plan` value (anything other than `hybrid`, `contributory`,
  `noncontributory` — including the now-removed legacy hyphenated forms
  like `hybrid-post2012`)
- Unparseable date (`dob`, `svcAsOf`, `lastDay`, `slAsOf`, `memDate`)
  not in `YYYY-MM-DD` form or rejected by `Date` parsing
- Non-numeric or out-of-range numeric (`svcYears`, `svcMonths`,
  `slHours`, `slRate`, `afc`)
- Unknown param names (likely typos — `slhours` vs `slHours`)

Display: a block-element error banner near the top of the page (above
the form, below the title) listing each problem with the offending
param name and the value received. Each entry references its form
field; that field is outlined in red while the error stands. The banner
and the red outlines auto-clear as the user corrects the corresponding
field — no manual dismiss button. Bad params are ignored; valid params
still pre-fill normally. Plumb a small `urlErrors` array through the
pre-fill block; render the banner from it; per-field listeners remove
their own entries on input.

Success: legacy `?plan=hybrid-post2012&...` URLs render the form fields
they can (DOB, AFC, etc.) but show an error like
`unknown plan "hybrid-post2012" — pick from the dropdown` and leave the
plan dropdown empty. Typo'd `?slhours=240` shows
`unknown parameter "slhours"`.
Tests:
- Open `?plan=hybrid-post2012&dob=1975-06-15&memDate=2015-08-01` →
  banner shows the plan error; DOB and memDate pre-fill; plan dropdown
  blank; Generate-graph disabled until plan is selected.
- Open `?dob=not-a-date` → banner shows the date error; DOB blank.
- Open `?slhours=240` (lowercase) → banner shows unknown-param error.
- Open a fully-valid URL → no banner.
- Reload-bar URLs always pass validation (they're built from the form's
  own values).
Status: Complete

## Stage 5: Plan-change confirmation on memDate boundary crossing
Goal: today, switching the plan dropdown triggers a confirm-prompt when
AFC has been computed (because AFC mode/N may change — see
`info/DESIGN.md:44-52`). The same logic applies when the user edits
`memDate` in a way that crosses the 2012-07-01 boundary (because tier,
N, and mode all flip). Hook the existing confirmation flow so it fires
on either trigger.
Success: setting plan=Hybrid + memDate=2015 + computing AFC, then
changing memDate to 2010, prompts the user before recomputing AFC.
Crossing within a tier (e.g., 2015 → 2018) does **not** prompt.
Tests:
- Manual UX: set up post-2012 hybrid scenario, paystubs loaded; change
  memDate to 2010 → confirm dialog appears.
- Same scenario, change memDate to 2018 → no dialog.
- Change plan dropdown only → existing dialog still fires.
Status: Complete

## Stage 6: Validation and edge cases
Goal: handle obvious bad inputs gracefully without aggressive
validation. memDate after today → highlight field as invalid; memDate
before DOB + 18 years → highlight (but don't block — the user might be
correcting other fields). Blank memDate is already a hard requirement
via `canCalculate` (Stage 3); URL-supplied bad values are caught by the
banner in Stage 4.
Success: bad memDate values surface a visual warning but never throw or
silently produce nonsense curves.
Tests: enter memDate=2099-01-01 → field highlighted, Generate-graph
disabled; enter memDate=1850-01-01 → field highlighted but graph still
generates if other fields are valid (graph will likely show pre-1971
behavior post-Stage-9).
Status: Not Started

## Stage 7: Update `PLAN.md` and `CLAUDE.md`
Goal:
- **`PLAN.md`**: delete Stage 8 entirely (memDate field is now provided
  by this pre-plan); update remaining stages to reference
  `derivePlanKey()` rather than reading `planEl.value` directly; replace
  the "memDate ignored on post-2012 plans" UI note (no longer applicable
  — pre-2012 tier is implied by memDate < 2012-07-01).
- **`CLAUDE.md`**: update the form-structure section (3-option dropdown
  + memDate field); update URL params list; update plan-eligibility
  table to add a Tier column or split rows by tier as appropriate.
Success: docs match new behavior; `PLAN.md` Stage 9 still makes sense
on its own.
Status: Not Started

---

## Out of scope

- The pre-1971 dual-method AFC computation itself — that's `PLAN.md`
  Stage 9, which now gets `memDate` for free from this pre-plan.
- The hybrid mixed-service split-multiplier — `PLAN.md` Stages 1-7,
  unaffected by this refactor beyond the `derivePlanKey()` substitution.
- Auto-deriving plan **type** (hybrid vs. contrib vs. noncontrib) from
  membership date and other metadata — would require a much richer rules
  engine (employment history, job class, statute changes); the user
  picks plan type directly.
