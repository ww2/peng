# ERS Pension Graph — Design Decisions

Captures the *why* behind choices made during implementation. Formulae, plan
configs, and eligibility rules live in `CLAUDE.md`.

---

## Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Plan input | Single 5-option dropdown | One control fully specifies rules + AFC params; no ambiguity for Noncontributory |
| Service accrual | Ongoing by default | Primary audience is active employees; later retirement = more service + higher pension |
| Last day of service | Optional date input, blank = active | Covers separation/modelling use cases without cluttering the common case |
| AFC source | Scanning populates Monthly AFC field | Replaces manual entry in the common case; user can edit the value before drawing |
| AFC field | Single editable text input | Scanning fills it; user may override; Calculate requires it to be non-empty |
| AFC parameters | Auto-selected from plan variant | User shouldn't need to know ERS rules; single source of truth |
| Plan-change prompt | Confirm before overwriting non-empty AFC | Prevents silent loss of a manually edited value; recomputes from in-memory stubs on confirm; if cancelled, dropdown reverts |
| AFC monthly | `dpTotal / N / 12` | DP total is sum of annual earnings across N windows; pension formula needs monthly |
| AFC window boundaries | Calendar-month aligned (start on 1st, end on last day of month) | The spec says "twelve consecutive months, not necessarily by fiscal or calendar years" — alignment is unspecified. Calendar-month alignment matches how payroll periods are typically reported and keeps window edges unambiguous. Stubs whose `payEndDate` does not fall on the last day of a month do not qualify as window anchors, so a partial trailing month is excluded from consideration. |
| Chart library | D3.js v7 (inlined) | Full axis control; SVG resolution-independent; `line.defined()` handles gaps cleanly |
| Multiple curves | Single curve | No use case expressed for overlays at time of implementation |
| Age penalty | 5%/yr (hybrid, contributory); 6%/yr (noncontributory) | Confirmed against official ERS calculator ARF lookup tables; source PDFs only documented 6% for noncontributory |
| Penalty granularity | Whole years (floor) | Produces staircase curve; official calculator interpolates by month but whole-year approximation is close enough for planning |
| Penalty reference age | Always the primary normal retirement age (65 for hybrid-post2012), regardless of service | The 60/30 alternative threshold only toggles eligibility (ARF=1); it does not lower the penalty basis — confirmed from official ARF tables |
| Official ARF tables | Embedded as JS literal in `index.html`; source files in `ers/` kept for reference only | Single-file delivery constraint; tables are small enough to inline |
| Official formula | `Math.floor(Math.round(afc × svc × mult × arf × 100) / 100)` | Matches `lgeRnd(..., 2)` + `Math.floor` in official source (`ers/_js/scripts/ers.calculator.js`); the primary blue curve uses the same formula and serves as the apples-to-apples comparison line against the official tool |
| Two official age calculations | `primaryArfAge` (days ≥ 15 rounds up to next month) for ARF table lookup; `primaryEligAge` (no day-rounding) for eligibility thresholds | Official calculator uses two separate functions for these purposes; using the wrong one produces off-by-one-month errors |
| Retirement option | Maximum Allowance only | Survivor reductions require actuarial factors not in source PDFs |
| Plan scope | All three plans (5 variants) | Minimal added complexity; maximises usefulness |
| NC mixed-service (hybrid) | Split-multiplier: NC plan years use 1.25%, hybrid years use the plan's multiplier; eligibility/vesting/ARF still use total credited service | Spec calls for the split (`Retirement-Information-Hybrid §"If you also have Noncontributory plan service"`, `ContribHybrid201205 #9`); the official ERS calc agrees when NC is entered via the separate "Noncontributory Service" checkbox |
| Pre-1971 AFC dual-method | Higher of Method A (top 3 yrs excl. lump-sum vacation) vs. Method B (top 5 yrs incl. lump-sum vacation), triggered when `memDate < 1971-01-01` on a pre-2012/noncontributory plan key | Spec mandates the higher of the two (`ContribGeneral201205 #10`, `ContribHybrid201205 #10`, `Noncontributory200912`); only meaningful with paystub data, so the manual-AFC path surfaces an inline note instead |
| X-axis orientation | Earlier dates on left | Curve slopes up-right naturally; matches conventional graph reading direction |
| Y-axis range | Floor min to nearest $1,000; ceil max to nearest $1,000 | Round numbers on the axis; avoids clipping the curve |
| Tick rendering | Two separate `<g>` layers (major + minor) | Allows independent label control and tick-length control without D3 tick filter hacks |
| CLI harness | Removed | Paystub directory can't be passed via URL; limited practical value |
| Delivery | Single HTML file | No server, no install; works offline from `file://` |
| Debug UI | Collapsed by default | Preserved for troubleshooting; not in main user flow |

---

## AFC Field — Plan-Change Behaviour

When the plan dropdown changes after the AFC field already has a value:
- User is prompted to confirm recomputation
- **Confirm**: AFC is recalculated from stubs already in memory (no re-scan needed) using the new plan's N and mode
- **Cancel**: dropdown reverts to the previous plan; AFC field unchanged
- If AFC field is empty when plan changes: recomputation happens silently

This prevents silent loss of a manually edited AFC value while still making
plan switching frictionless in the common case (field empty).

---

## Staircase Curve — Why It Looks That Way

The early-retirement penalty uses `Math.floor(ageAtM)` (whole years). This
means the penalty only steps down on birthdays, and is flat between them.
The result is a visible staircase in the early retirement window: the pension
jumps on each birthday as one fewer year of penalty applies, then stays flat
until the next birthday.

The penalty rate is 5%/year for hybrid and contributory plans and 6%/year for
noncontributory (confirmed against the official ERS calculator's ARF tables).
No monthly pro-ration is applied; the official calculator interpolates by
month and so produces a smooth curve, while peng's blue line is a staircase by
design.

**Penalty reference age:** `yearsEarly` is always computed relative to the
primary normal retirement age (e.g., 65 for hybrid-post2012), not the lower
alternative threshold (e.g., 60 for the 60/30 path). Meeting the 60/30
threshold sets `isNormal = true`, which forces `yearsEarly = 0` directly
(factor = 1.0). This is why the code uses:
```js
const yearsEarly = isNormal ? 0 : Math.max(0, normalRetAge - Math.floor(ageAtM));
```
Using `normalRetAge = 60` when service ≥ 30 was a prior bug: it accidentally
zeroed `yearsEarly` at age 60, but underestimated the penalty for ages 55–59.

---

## NC Mixed-Service (Hybrid)

Hybrid members may have prior Noncontributory plan service that, by spec,
keeps the 1.25% multiplier on those years even though the member is now in
the hybrid plan. The benefit formula becomes:

```
benefit = afc × ((hybridYrs × hybridMult) + (ncYrs × 0.0125)) × arf
```

Implemented in `blendedBenefit(svcMonths, ncMonths, afc, arf, plan, config)`
(`index.html:1211`). Non-hybrid plans ignore `ncMonths` and use the original
single-multiplier formula. The cents-floor (`Math.floor(Math.round(b × 100) / 100)`)
matches the official ERS calculator.

**What is NOT split:** total credited service still drives eligibility,
vesting (10/5-year thresholds), and ARF lookup. Only the multiplier is split,
because that is the only thing the spec splits.

**Sick-leave months credit to the hybrid portion.** The member is currently
accruing as hybrid; NC service ended at the upgrade. So `ncMonths` stays
constant when SL adds months to `svcMonths`, which means SL months land in
the hybrid bucket and pick up the higher multiplier.

**UI gating:** the "of which, noncontributory" sub-row is visible only when
the dropdown is `hybrid` (any tier). If the user has entered NC values and
switches to a non-hybrid plan, a confirm dialog warns that the NC entry will
be cleared; cancel reverts the dropdown.

**Cross-check:** the official ERS web calculator's separate "Noncontributory
Service" checkbox produces matching values. Its other "Service upgraded from
Noncontributory" sub-checkbox does NOT split — it sums all years at the
hybrid multiplier — and so disagrees with both the spec and peng. Test
case: hybrid-post2012, AFC=$2,500, 20 hybrid + 5 NC plan years at normal
retirement → $1,031.25/mo.

---

## Pre-1971 AFC Dual-Method

Members whose `memDate < 1971-01-01` are entitled to the **higher** of two
AFC computations (`ContribGeneral201205 #10`, `ContribHybrid201205 #10`,
`Noncontributory200912`):

- **Method A** — top 3 highest years of earnings, **excluding** lump-sum vacation pay
- **Method B** — top 5 highest years of earnings, **including** lump-sum vacation pay

**Trigger:** `isPre1971DualMethod(planKey)` (`index.html:1519`) is true when
`memDate < 1971-01-01` AND the derived plan key is `hybrid-pre2012`,
`contributory-pre2012`, or `noncontributory`. Post-2012 keys are naturally
excluded since `memDate ≥ 2012-07-01` is always ≥ 1971-01-01.

**Implementation:** `computeDualMethodAfc(config)` (`index.html:1545`) runs
`solveDP` twice — once over windows scored by `'totalExclVacation'` with N=3,
once by `'totalInclVacation'` with N=5 — and writes the larger monthly AFC
into the manual-AFC field. The category constant `LUMP_SUM_VACATION` (`:943`)
is what `scoreStub` excludes/includes; it is also added to the `KNOWN`
earning-category set so it isn't flagged as unknown.

**UX:**
- The earnings-windows section displays which method won, the runner-up's
  monthly AFC, and a warning if no stub in the considered windows had any
  Lump Sum Vacation Pay (because then both methods only differ in N, not in
  what they sum).
- When the user enters AFC manually (no paystub directory) and the trigger
  fires, an orange inline note appears under the AFC field telling them to
  ensure their manual entry already reflects the higher of the two methods,
  since peng can't compute the comparison without stubs.
- Plan-change and memDate-tier-cross confirms naturally handle dual-method
  recomputation: the existing AFC-recompute confirm runs `computeAndFillAfc`,
  which dispatches to the dual-method path when the trigger fires.

**Cross-check:** the official ERS web calculator does not appear to expose a
pre-1971 dual-method (paystub data isn't its input), so there's no
official-comparison line to reconcile against — the trigger is exercised
only on the blue (peng-primary) curve.

---

## Projected Raises — Currently Suppressed

The contractual-raises feature (the projected-raises table, the "Projected
raises do not apply" override, and the four purple raise-based chart curves
plus their estimation-table columns) is hidden in the UI pending resolution
of a per-plan AFC composition issue.

**The problem:** most plans compute AFC from regular pay only — overtime and
differentials are excluded. Noncontributory, however, includes overtime (and
"overtime and bonuses" per the spec) in AFC. The raise table represents
across-the-board contractual percentage bumps to base pay, so blending those
raises into AFC the same way for all plans understates the noncontributory
AFC growth (raises lift base pay but the AFC is denominated against a larger
overtime-inclusive figure). Until the right per-plan blending rule is worked
out, showing one raise-adjusted curve risks being silently wrong for
noncontributory members.

**What's suppressed:**
- `#group-contractual-input` fieldset hidden
- `showRaises` hard-coded to `false` at both the calculate-flow site
  (`index.html:1941`) and inside `drawChart` (`index.html:2349`)

**What's preserved:** `calculateSeries` still computes
`pensionWithRaises` / `pensionRaisesCurrentSL` / `pensionRaisesProjectedSL`
and `applyRaises` / the `RAISES` table are still in source. Re-enabling is a
revert of the three edits above once the per-plan rule is settled.

---

## Out of Scope

These were considered and explicitly deferred. Captured here so the choice
isn't relitigated each time someone reads the code.

- **Survivor options A/B/C and 1–5 ladders.** The chart shows Maximum
  Allowance only. The other retirement options reduce the member's monthly
  amount by actuarial factors that depend on the member's age and the
  beneficiary's age at retirement; those factors are not in the source PDFs
  on hand and would need to be sourced from ERS before this could be added.
- **Designated-Category / POFF support.** Not in `PLAN_CONFIGS`; no current
  users have asked for it.
- **Multi-plan members beyond hybrid+NC** (e.g., contributory + NC). Not
  requested; the spec docs do not describe a contributory+NC blend.
- **Auto-deriving plan type** (hybrid vs. contributory vs. noncontributory)
  from membership date and other metadata. Would require a much richer rules
  engine (employment history, job class, statute changes); the user picks
  plan type directly from the 3-option dropdown. Tier (post2012 vs pre2012)
  *is* derived automatically from `memDate` via `derivePlanKey`.
