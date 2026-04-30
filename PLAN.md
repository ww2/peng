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
keyed off a new membership-date input.

Implementation note: `IGNORED` (`index.html:838-844`) does not currently
list any vacation-pay category. Confirm the exact paystub category name
for lump-sum vacation pay (e.g., "Vacation Payoff", "Lump Sum Vacation",
"Termination Vacation Pay") before wiring Method A's exclusion.

### Spec correction noted

In conversation I had earlier described the dual-method rule as
"pre-2012". That was a misreading; it's pre-**1971**. The post-1971
pre-2012 cohort is unaffected and continues to use the existing
single-method top-3-gross AFC.

### Survivor options

Remain deferred — no work in this plan. The chart currently shows Maximum
Allowance only. The other retirement options (Options A, B, C — various
survivor continuance percentages) reduce the member's monthly amount by
actuarial factors that depend on the member's age and the beneficiary's
age at retirement. Those factors are not in the source PDFs on hand; they
would need to be sourced from ERS before this could be added.

---

## Stage 1: Add NC-service input fields to the form
Goal: optional "of which, noncontributory" years/months sub-row, visible only when plan is hybrid-pre2012 or hybrid-post2012, hidden (and ignored) otherwise.
Success: fields render under the "Credited service" row; toggling plan dropdown shows/hides them; default values are 0/0; switching away from hybrid clears values silently.
Tests: load with plan=noncontributory → no NC fields visible; switch to hybrid-post2012 → fields appear; enter 5 years → switch to contributory → fields hidden and value reset.
Status: Not Started

## Stage 2: Wire URL params (`ncSvcYears`, `ncSvcMonths`)
Goal: serialize/deserialize NC service in the same way as `svcYears`/`svcMonths`; update the reload-bar links.
Success: round-trip works (set values → reload from URL → values restored); params absent → defaults to 0/0; non-hybrid plans drop the params from the URL.
Tests: open `?plan=hybrid-post2012&ncSvcYears=5&ncSvcMonths=3` → form shows 5/3; reload-bar URL contains `ncSvcYears=5&ncSvcMonths=3`; switch to noncontributory → those params disappear from the reload-bar URL.
Status: Not Started

## Stage 3: Pass NC service through `calculateSeries()`
Goal: thread `ncSvcMonths` from form-read into `calculateSeries({...})`; non-hybrid plans always pass 0.
Success: function signature accepts `ncSvcMonths`; existing callers still produce identical output when `ncSvcMonths === 0`.
Tests: regression — every existing scenario (all five plans, sick leave on/off, raises on/off) produces byte-identical pension values when NC = 0.
Status: Not Started

## Stage 4: Split-multiplier in the blue curve
Goal: rewrite the pension expression in `calculateSeries()` (`index.html:1142-1146`, `1156-1163`) to use a helper that splits service into NC and hybrid portions.

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
Goal: confirm `primaryEligibility()`, `primaryARF()`, the in-line eligibility switch (`index.html:1099-1129`), and vesting checks all use **total** credited service (`svcAtM`), not the hybrid portion.
Success: visual review confirms `ncMonths` is referenced only in the benefit formula, never in eligibility/vesting/ARF code paths.
Tests: hybrid-post2012, 8 hybrid yrs + 2 NC yrs (total 10) → vested (10-yr threshold met); 7 hybrid + 2 NC (total 9) → not vested.
Status: Not Started

## Stage 7: Plan-change UX
Goal: when user switches plan dropdown, NC fields' visibility follows the new plan; if NC values are non-zero and they're switching to a non-hybrid plan, prompt with the same confirmation pattern as the AFC plan-change prompt (`info/DESIGN.md:44-52`).
Success: switching hybrid → noncontributory with NC=5 prompts "this will clear your noncontributory service entry — continue?"; switching hybrid → hybrid (other tier) preserves NC values.
Tests: manual UX check.
Status: Not Started

## Stage 8: Add Membership-date input field
Goal: optional date input "ERS membership date", placed near DOB; URL param `memDate`. Used solely to detect the pre-1971 dual-method AFC trigger today; could also drive future tier-derivation work (out of scope here).
Success: field round-trips through URL; blank value means "unknown / post-1971" and preserves current behavior; entering a date before 1971-01-01 enables Stage 9's dual-method path.
Tests:
- Blank `memDate` on every plan → byte-identical AFC and curves vs current build (regression).
- `memDate=1968-04-01` on post-2012 plans → ignored (post-2012 eligibility precludes pre-1971 membership), with a small UI note that the dual-method only applies to pre-2012 plans.
- `memDate=1968-04-01` on hybrid-pre2012 / contributory-pre2012 → triggers Stage 9 logic.
- URL round-trip: `?plan=contributory-pre2012&memDate=1968-04-01` → form populates; reload-bar URL preserves it.
Status: Not Started

## Stage 9: Pre-1971 dual-method AFC computation
Goal: when `memDate < 1971-01-01` and plan is pre-2012, compute AFC as `max(methodA, methodB)` where Method A is the existing top-3-gross-excluding-lump-sum-vacation and Method B is top-5-all-earnings-including-lump-sum-vacation.

Concrete changes:
- **Identify lump-sum vacation category.** Audit real paystub data and any earnings-category lists in `index.html` (the `KNOWN` list at `:824-836` and `IGNORED` at `:838-844`); add the exact key name as a constant `LUMP_SUM_VACATION` so both methods reference it consistently. If the category isn't reliably present in stub data, surface a warning in the dropped/uncovered output rather than silently misclassifying.
- **Extend `scoreStub(stub, mode)`** (`index.html:1259-1263`) with two new modes:
  - `'totalExclVacation'` — sum of all non-IGNORED earnings minus `LUMP_SUM_VACATION` (Method A)
  - `'totalInclVacation'` — sum of all non-IGNORED earnings including `LUMP_SUM_VACATION` (Method B)
  Existing `'regular'` and `'total'` modes remain for plans that don't trigger the dual-method.
- **`computeAndFillAfc()`** (`index.html:1340-1351`): when the pre-1971 trigger fires, run `solveDP(scoreA, 3)` and `solveDP(scoreB, 5)`, take the larger monthly AFC, and write that into `manualAfcEl`. Surface in the windows-section render which method won and the runner-up's AFC, so the user can see the comparison.
- **Manual-AFC path:** if the user enters AFC by hand without paystubs and `memDate` is pre-1971, render an inline note: "Pre-1971 members are entitled to the higher of two AFC methods — provide paystubs to compute both, or ensure your manual entry already reflects the higher." No automatic computation possible without stubs.
- **Plan-change confirm:** the existing AFC plan-change confirmation flow naturally extends — if `memDate` is pre-1971, the recompute uses the dual-method.
- **Plan compatibility:** the trigger is gated on `plan !== 'hybrid-post2012' && plan !== 'contributory-post2012'` — i.e., it fires for hybrid-pre2012, contributory-pre2012, and noncontributory (whose spec at `info/Noncontributory200912.md:119-125` also extends the dual-method to pre-1971 members). Post-2012 plans ignore `memDate` entirely; the Stage 8 UI note mentions this so it isn't surprising.

Success: pre-1971 stubs produce the higher of the two AFCs in the AFC field; non-pre-1971 stubs produce the same AFC as the current build.

Tests:
- Pre-1971 hybrid-pre2012 case where Method B (5-yr including vacation) is higher → AFC matches Method B; runner-up shown alongside.
- Pre-1971 contributory-pre2012 case where Method A (3-yr excluding vacation) is higher → AFC matches Method A.
- Pre-1971 noncontributory case → dual-method also runs (per spec wording, applies to all plans whose members could have joined pre-1971).
- Post-1971 pre-2012 case → AFC is byte-identical to current build (Method A only, no comparison performed).
- Post-2012 case with `memDate` set to 1968 → `memDate` ignored, AFC matches current build, UI note surfaces.
- Stub set with no recognizable lump-sum-vacation category → Method B silently equals current `'total'` Method; warning logged.
- Cross-check: the official ERS calculator does **not** appear to expose a pre-1971 dual-method (paystub data isn't its input), so the red-curve comparison does not exercise this path. Verify peng's red curve continues to match the official tool for non-pre-1971 cases.

Status: Not Started

## Stage 10: Documentation updates
Goal: update `CLAUDE.md` (Key Logic section, URL params list including `memDate`, `ncSvcYears`, `ncSvcMonths`); update `info/DESIGN.md` with two new subsections — "NC mixed-service" and "Pre-1971 AFC dual-method" — citing specs; remove/update the "hybrid plan support" item in `TODO.md`.
Success: docs reflect current behavior; reading `CLAUDE.md` cold conveys both the split-multiplier rule and the pre-1971 dual-method trigger.
Status: Not Started

---

## Out of scope

- Survivor / option A/B/C and 1-5 ladders (deferred; ARF data unavailable).
- Designated-Category / POFF support (no current users; not in `PLAN_CONFIGS`).
- Multi-plan members beyond hybrid+NC (e.g., contributory + NC) — not requested; spec docs do not describe a contributory+NC blend.
- Auto-deriving Tier from membership date (today the user picks pre/post-2012 directly via the plan dropdown; this is fine for the calculator's audience). Stage 8's `memDate` field is purely an input for the pre-1971 trigger and does not change tier selection.
