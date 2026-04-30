# Plan — Hybrid Mixed-Service (NC-Upgrade) + Pre-1971 AFC Dual-Method

## Background

Audit of `index.html` against `info/` specs and `../ers/_js/scripts/` shows
the calculator already covers all five plan variants on the core paths
(plan dropdown, eligibility, ARF lookup, AFC mode/N, single-multiplier
formula). Two real plan-feature gaps remain:

### A. Hybrid mixed-service (NC upgrade)

Hybrid members may have prior Noncontributory plan service that, by spec,
gets the 1.25% multiplier applied to those credited years rather than the
hybrid 1.75%/2.0%. See:

- `info/Retirement-Information-Hybrid-eff.-6.2022.md:111-113`
- `info/ContribHybrid201205.md:134-136`
- `../ers/_js/scripts/ers.utils.js:139-181` (multiplier selection)
- `../ers/_js/scripts/ers.calculator.js:274-620` (blended formula assembly)

The pension formula becomes a sum of two parts:

```
pension = floor( afc × ((hybridYrs × hybridMult) + (ncYrs × 0.0125)) × arf , 2 )
```

Total credited service still drives eligibility, vesting, and the ARF
lookup; only the multiplier is split for the benefit calculation.

### B. Pre-1971 AFC dual-method

Members whose ERS membership date is **before 1971-01-01** are entitled to
the **higher** of two AFC computations
(`info/ContribGeneral201205.md:136-139`,
`info/ContribHybrid201205.md:155-158`):

- **Method A** — average of top **3** highest years of earnings, **excluding** lump-sum vacation pay
- **Method B** — average of top **5** highest years of earnings, **including** lump-sum vacation pay

Applies only to pre-2012 plans (a post-2012 member cannot have pre-1971
membership). The post-1971 pre-2012 cohort uses Method A only — current
behavior (`PLAN_CONFIGS: N=3, mode='total'`) — so the work is opt-in,
keyed off the membership-date input.

### Survivor options

Remain deferred — no work in this plan. The chart currently shows Maximum
Allowance only. The other retirement options (Options A, B, C — various
survivor continuance percentages) reduce the member's monthly amount by
actuarial factors that depend on the member's age and the beneficiary's
age at retirement. Those factors are not in the source PDFs on hand; they
would need to be sourced from ERS before this could be added.

---

## Stage 1: Add NC-service input fields to the form
Goal: optional "of which, noncontributory" years/months sub-row, visible iff `derivePlanKey(...)` starts with `hybrid-` (i.e., plan dropdown is hybrid), hidden and ignored otherwise.
Success: fields render under the "Credited service" row; toggling plan dropdown shows/hides them; default values are 0/0; switching away from hybrid clears values silently.
Tests: load with plan=noncontributory → no NC fields visible; switch to hybrid → fields appear; enter 5 years → switch to contributory → fields hidden and value reset.
Status: Not Started

## Stage 2: Wire URL params (`ncSvcYears`, `ncSvcMonths`)
Goal: serialize/deserialize NC service in the same way as `svcYears`/`svcMonths`; update the reload-bar links.
Success: round-trip works (set values → reload from URL → values restored); params absent → defaults to 0/0; non-hybrid plans drop the params from the URL.
Tests: open `?plan=hybrid&memDate=2014-08-01&ncSvcYears=5&ncSvcMonths=3` → form shows 5/3; reload-bar URL contains `ncSvcYears=5&ncSvcMonths=3`; switch to noncontributory → those params disappear from the reload-bar URL.
Status: Not Started

## Stage 3: Pass NC service through `calculateSeries()`
Goal: thread `ncSvcMonths` from form-read into `calculateSeries({...})`; non-hybrid plans always pass 0.
Success: function signature accepts `ncSvcMonths`; existing callers still produce identical output when `ncSvcMonths === 0`.
Tests: regression — every existing scenario (all five derived plan keys, sick leave on/off, raises on/off) produces byte-identical pension values when NC = 0.
Status: Not Started

## Stage 4: Split-multiplier in the blue curve
Goal: rewrite the pension expression in `calculateSeries()` to use a helper that splits service into NC and hybrid portions. The helper takes already-adjusted `afcMonthly` and `svcMonths` per variant — no awareness of raises or sick-leave semantics.

```js
function blendedBenefit(svcMonths, ncMonths, afc, arf, plan, config) {
  const totalYrs  = svcMonths / 12;
  const ncYrs     = Math.min(ncMonths, svcMonths) / 12;
  const hybridYrs = totalYrs - ncYrs;
  const isHybrid  = plan.startsWith('hybrid');
  const benefit   = isHybrid
    ? afc * ((hybridYrs * config.multiplier) + (ncYrs * 0.0125)) * arf
    : afc * totalYrs * config.multiplier * arf;
  return Math.floor(Math.round(benefit * 100) / 100);
}
```

Use this for `primaryPension`, `pensionWithRaises`, `pensionCurrentSL`, `pensionProjectedSL`, `pensionRaisesCurrentSL`, `pensionRaisesProjectedSL`. Sick-leave months credit to the hybrid portion (NC service ended at upgrade; the member is currently accruing as a hybrid).
Success: blue, green-solid, and dashed curves all reflect the split for hybrid plans; non-hybrid plans unchanged.
Tests:
- Spec example (Retirement-Information-Hybrid §"If you also have Noncontributory plan service"): hybrid-post2012, AFC=$2,500, 20 hybrid yrs + 5 NC yrs → (1.75% × 20 + 1.25% × 5) × $2,500 = $1,031.25/mo at normal retirement (ARF=1).
- Edge: ncMonths > svcMonths → clamped (no negative hybrid years).
- Edge: ncMonths > 0 on a non-hybrid plan → ignored (defensive; UI hides the field but values may persist).
Status: Not Started

## Stage 5: Split-multiplier in the red (official) curve
Goal: apply the same split in the official-comparison series so the red line stays an apples-to-apples reference (current AFC, no sick leave, no raises, but with NC split).
Success: red curve agrees with the official ERS web calculator when fed the same inputs (mixed-service hybrid case).
Tests: pick a hybrid-post2012 mixed-service scenario, run it through `../ers/index.html` in a browser, capture the maximum-allowance number, compare to peng's red-curve value at that retirement date. Tolerance: cents (≤ $1).
Status: Not Started

## Stage 6: Eligibility, vesting, ARF — verify unchanged
Goal: confirm `primaryEligibility()`, `primaryARF()`, the in-line eligibility switch in `calculateSeries` (`index.html:1194`), and vesting checks all use **total** credited service (`svcAtM`), not the hybrid portion.
Success: visual review confirms `ncMonths` is referenced only in the benefit formula, never in eligibility/vesting/ARF code paths.
Tests: hybrid-post2012 (plan=hybrid, memDate ≥ 2012-07-01), 8 hybrid yrs + 2 NC yrs (total 10) → vested (10-yr threshold met); 7 hybrid + 2 NC (total 9) → not vested.
Status: Not Started

## Stage 7: Plan-change UX
Goal: NC fields' visibility follows the derived plan key — visible iff `derivePlanKey(planEl.value, memDateEl.value)` starts with `hybrid-`. When NC values are non-zero and the dropdown changes to a non-hybrid plan, prompt with the same confirmation pattern as the AFC plan-change prompt (`info/DESIGN.md:44-52`). Editing `memDate` within hybrid (which only flips the tier, not the plan type) preserves NC values silently — the AFC tier-cross confirm at `index.html:1888+` still fires for AFC recompute, but NC values are untouched.
Success: dropdown hybrid → noncontributory with NC=5 prompts "this will clear your noncontributory service entry — continue?"; editing memDate within hybrid (e.g., 2015 → 2010) preserves NC values.
Tests: manual UX check.
Status: Not Started

## Stage 8: Pre-1971 dual-method AFC computation
Goal: when `memDate < 1971-01-01` and the derived plan key is `hybrid-pre2012`, `contributory-pre2012`, or `noncontributory`, compute AFC as `max(methodA, methodB)` where Method A is the existing top-3-gross-excluding-lump-sum-vacation and Method B is top-5-all-earnings-including-lump-sum-vacation.

Concrete changes:
- **Identify lump-sum vacation category.** Audit real paystub data and any earnings-category lists in `index.html` (the `KNOWN` and `IGNORED` lists in the paystub section); add the exact key name as a constant `LUMP_SUM_VACATION` so both methods reference it consistently. If the category isn't reliably present in stub data, surface a warning in the dropped/uncovered output rather than silently misclassifying.
- **Extend `scoreStub(stub, mode)`** (`index.html:1386`) with two new modes:
  - `'totalExclVacation'` — sum of all non-IGNORED earnings minus `LUMP_SUM_VACATION` (Method A)
  - `'totalInclVacation'` — sum of all non-IGNORED earnings including `LUMP_SUM_VACATION` (Method B)
  Existing `'regular'` and `'total'` modes remain for plans that don't trigger the dual-method.
- **`computeAndFillAfc()`** (`index.html:1467`): when the pre-1971 trigger fires, run `solveDP(scoreA, 3)` and `solveDP(scoreB, 5)`, take the larger monthly AFC, and write that into `manualAfcEl`. Surface in the windows-section render which method won and the runner-up's AFC, so the user can see the comparison.
- **Manual-AFC path:** if the user enters AFC by hand without paystubs and `memDate` is pre-1971 on a triggering plan, render an inline note: "Pre-1971 members are entitled to the higher of two AFC methods — provide paystubs to compute both, or ensure your manual entry already reflects the higher." No automatic computation possible without stubs.
- **Plan-change / memDate-change confirm:** the existing AFC recompute confirmation flow (plan-change at `index.html:1862+`, memDate-change at `:1888+`) naturally covers this — if the new derivation triggers the pre-1971 path, the recompute uses the dual-method.
- **Plan compatibility:** the trigger fires when `derivePlanKey(planEl.value, memDateEl.value)` is `hybrid-pre2012`, `contributory-pre2012`, or `noncontributory`, AND `memDate < 1971-01-01`. Post-2012 keys are naturally excluded since `memDate >= 2012-07-01` is always `>= 1971-01-01`. The noncontributory spec at `info/Noncontributory200912.md:119-125` extends the dual-method to its pre-1971 members.

Success: pre-1971 stubs produce the higher of the two AFCs in the AFC field; non-pre-1971 stubs produce the same AFC as the current build.

Tests:
- Pre-1971 hybrid-pre2012 case where Method B (5-yr including vacation) is higher → AFC matches Method B; runner-up shown alongside.
- Pre-1971 contributory-pre2012 case where Method A (3-yr excluding vacation) is higher → AFC matches Method A.
- Pre-1971 noncontributory case → dual-method also runs (per spec wording, applies to all plans whose members could have joined pre-1971).
- Post-1971 pre-2012 case (e.g., `memDate=1985-01-01`) → AFC is byte-identical to current build (Method A only, no comparison performed).
- Stub set with no recognizable lump-sum-vacation category → Method B silently equals current `'total'` Method; warning logged.
- Cross-check: the official ERS calculator does **not** appear to expose a pre-1971 dual-method (paystub data isn't its input), so the red-curve comparison does not exercise this path. Verify peng's red curve continues to match the official tool for non-pre-1971 cases.

Status: Not Started

## Stage 9: Documentation updates
Goal: update `CLAUDE.md` — the "Where Things Live" section (mention NC split, `blendedBenefit` helper) and the URL params list in "Running the App" (add `ncSvcYears`, `ncSvcMonths`; `memDate` is already listed post-PREPLAN); update `info/DESIGN.md` with two new subsections — "NC mixed-service" and "Pre-1971 AFC dual-method" — citing specs; remove/update the "hybrid plan support" item in `TODO.md`.
Success: docs reflect current behavior; reading `CLAUDE.md` cold conveys both the split-multiplier rule and the pre-1971 dual-method trigger.
Status: Not Started

---

## Out of scope

- Survivor / option A/B/C and 1-5 ladders (deferred; ARF data unavailable).
- Designated-Category / POFF support (no current users; not in `PLAN_CONFIGS`).
- Multi-plan members beyond hybrid+NC (e.g., contributory + NC) — not requested; spec docs do not describe a contributory+NC blend.
- Auto-deriving plan **type** (hybrid vs. contrib vs. noncontrib) from membership date and other metadata — would require a much richer rules engine (employment history, job class, statute changes); the user picks plan type directly from the 3-option dropdown. Tier (post2012 vs pre2012) **is** derived automatically from `memDate` via PREPLAN's `derivePlanKey`.
