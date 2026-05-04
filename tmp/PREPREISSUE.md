# CURRENT-ISSUE — OT/differential phase-out in projected AFC

## TL;DR

Your stated premise — "no future OT or differential pay; the raise shouldn't apply to those past amounts" — implies a stronger model than the one currently in PREPLAN.md. PREPLAN treats the OT/diff portion of AFC as a flat constant that persists at all retirement horizons. The mathematically correct model under your premise is a **phase-out**: as the candidate retirement extends past the anchor, the AFC averaging window slides forward and progressively *fewer* of its months overlap the historical paystub period. Once the candidate retirement is N years past the anchor, none of the averaging window contains historical months, and the OT/diff portion drops out entirely.

This document captures the model precisely so we can decide whether to adopt it before rewriting PREPLAN.

## Setup

Let:

- `W = N × 12` — months in the AFC averaging window (3 for hybrid post-2012; 5 for some pre-2012 plans).
- `A` — AFC anchor date. The entered AFC is the user's actual paystub-derived average over the historical window `[A − W, A]`.
- `C = min(lastDayOfSvc, retDate)` — the cap on accrual for a candidate retirement at `retDate`.
- `total` — entered total monthly AFC. Average over `[A − W, A]`. Includes basic pay + OT + differentials + everything else that hit the paystubs.
- `eligible` — entered raise-eligible monthly AFC. Average of just the basic-pay portion of those same paystubs over the same window.
- `frozen = total − eligible` — the historical OT/diff/etc. average. **Not a future income stream — just a residue of past paystubs.**
- `RAISES = [{D, r}, ...]` — scheduled future ATB raises.

## Your premise (as I understood it)

> Pay for OT and differential types is only ever based on paystubs from past work; there should be no ongoing expectation of having future payments of those types, so the raise shouldn't be applied to them at all (since any past values will already have incorporated it, and by presumption there will be no future values of that type).

Two claims, separately:

1. **No future OT/diff.** Months after `A` produce only basic pay, no overtime, no differentials, no lump sums.
2. **Raises do not apply to OT/diff.** Therefore, in projecting AFC forward, the OT/diff portion of the historical AFC should not be multiplied by `(1 + r × …)`.

Both claims are about *future* OT/diff. The historical OT/diff is real and counted (it sits in the entered `total`).

## The implication: phase-out, not flat

The AFC at retirement is, by definition, the average of monthly basic-pay-and-included-extras over the **window ending at the cap**: `[C − W, C]`. As `C` extends past `A`, this window slides forward and reaches less far back into the historical period.

Three regimes (assume `A < C`, the normal case):

| Regime | Condition | Historical months `H` in window | Projected months `P = W − H` |
|---|---|---:|---:|
| Mostly-historical | `C − A ≤ 0` | `W` | `0` |
| Mixed | `0 < C − A < W` | `W − (C − A)` | `C − A` |
| Fully projected | `C − A ≥ W` | `0` | `W` |

In the mostly-historical regime, the window is entirely paystubs — AFC = `total`, full OT/diff included. In the fully-projected regime, the window contains no historical months — AFC reflects only future basic pay grown by raises. **Frozen OT/diff is gone.** In the mixed regime, AFC is a weighted average of the two contributions.

## The formula

For each month in the projected portion `[A, C]`, pay = `eligible × cumulative_raise_factor(month)`. The average projected pay over that period (linear approximation, consistent with current `applyRaises`):

```
b_proj(D, C) = clamp((C − D) / P, 0, 1)               -- D is a raise date, A < D ≤ C
proj_avg     = eligible × ∏ (1 + r × b_proj(D, C))     -- product over raises with A < D ≤ C
```

Then AFC at `C`:

```
H        = max(0, W − monthsBetween(A, C))
P        = W − H
hist_avg = total                                        -- assume historical pay was approximately uniform
AFC_C    = (H × hist_avg + P × proj_avg) / W
        = (H/W) × total + (P/W) × eligible × ∏ (1 + r × b_proj)
```

Boundary checks:

- `C = A`: `H = W, P = 0` ⇒ `AFC_C = total`. ✓ Immediate retirement uses paystub average as-is.
- `C = A + W`: `H = 0, P = W` ⇒ `AFC_C = eligible × ∏ (1 + r × b_proj)`. **OT/diff dropped out**, base pay grown by raises.
- `eligible = total` (everything raise-eligible): `frozen = 0`, the H-vs-P split doesn't matter — formula reduces to `total × ∏ (1 + r × b_proj)`. Slightly different from current `applyRaises` because the blend reference is `P` instead of `W`, but identical in the fully-projected regime.

## Worked example

Hybrid post-2012 (`W = 36`), anchor `A = 2026-05-01`, raises `[2026-07-01: 3.79%, 2027-07-01: 4%, 2028-07-01: 4%]`, paystub-derived `total = $5400/mo`, `eligible = $5000/mo`, `frozen = $400/mo`.

Three retirement horizons:

| Cap `C` | `H` | `P` | Current code | PREPLAN (frozen forever) | Phase-out (this doc) |
|---|---:|---:|---:|---:|---:|
| 2026-08-01 (3 mo past A) | 33 | 3 | $5,417 | $5,416 | $5,375 |
| 2028-05-01 (24 mo past A) | 12 | 24 | $5,772 | $5,744 | $5,580 |
| 2030-01-01 (44 mo past A) | 0 | 36 | $6,037 | $5,990 | $5,456 |

(Numbers above use the linear-blend approximation; rounding may differ slightly from the actual `applyRaises` multiplicative form.)

The phase-out model is consistently **more conservative** than PREPLAN, and meaningfully so at long horizons — the difference is roughly the frozen portion (`$400`) times the phase-out fraction. At 44 months past anchor, frozen is fully phased out and the gap to PREPLAN is ~$534/mo (the entire $400 plus the ~3% growth PREPLAN applies to it that the phase-out model doesn't).

## A non-obvious property worth thinking about

Under the phase-out model, **with no raises and no further work, AFC at long horizons is *lower* than at immediate retirement**. Concretely: if I stop earning OT today and stay in my job another N years at the same base rate (no raises), my AFC at retirement = `eligible` (just my base pay average). My AFC at immediate retirement = `total` (base + OT). So `total > eligible`.

Is this physically right? Yes, if your premise holds:

- AFC averages the last N years of *actual paystub* basic pay. (The pension formula uses AFC × svc × multiplier × ARF.)
- If your last N years contain no OT (because you stopped working OT), AFC reflects only base pay.
- Working longer doesn't help if your additional service comes with strictly lower per-month earnings.

ERS doesn't have a "highest AFC ever achieved" rule — it averages whatever the last N years actually paid. So this property is real, not a model artifact. But it's surprising enough that surfacing it in the chart (e.g., the +raises curve dipping below the no-raises curve in some plausible scenarios) might warrant a UX note.

## What I'm uncertain about

1. **Is `eligible` (a monthly average) a good proxy for the base-pay rate at A?** The `eligible` field is the average base pay over the historical window `[A − W, A]`. The projected formula uses it as if it were the base pay rate at A. If your historical window contained raises (which it likely does if it spans 3+ years), the actual rate at A is higher than `eligible`. Magnitude: for a 3-year historical window with one 3.5% raise in the middle, the rate at A is ~1.75% higher than `eligible`. Probably small enough to ignore. But worth flagging.

2. **Should the projected average use compounded raises (`∏ (1 + r × b_proj)`) or linear (`1 + Σ r × b_proj`)?** Current `applyRaises` uses `∏`. Linear is closer to the truth for the *average over the projected period* (the sum-of-pay-by-month derivation is exactly linear); `∏` slightly overstates. Either is fine for ~3-4% raises (second-order error < 0.2%), but worth picking one and being consistent.

3. **Is the "uniform historical pay" assumption acceptable?** I'm treating the historical part of the new window as contributing `H × total` — i.e., assuming pay was uniform across the historical paystub window. If you had a raise in the middle of your historical window, the months *before* that raise paid less than `total` and the months *after* paid more. Within the new AFC window, only the historical months `[C − W, A]` matter — and depending on which raise dates fall where, the actual historical contribution could differ from `H × total`. Magnitude of error is bounded by the historical raise rate × historical window position, similar order to (1). Probably ignorable for the planning horizon.

4. **UX implication.** Should the chart explicitly show or label the phase-out? The +raises curve will diverge more sharply from the primary curve near anchor (when frozen contributes) and converge back toward `eligible × growth` farther out. Users might find it confusing without an explanation.

## Comparison with what PREPLAN currently says

PREPLAN's math:

```
AFC_C = frozen + eligible × ∏(1 + r × b(C))      where b(C) = monthsBetween(D, C) / W
```

This treats `frozen` as a fixed monthly amount that the user receives at every retirement horizon — like a baseline "pension supplement" that doesn't decay. **That's wrong under your premise**, because there is no future OT/diff stream — the frozen amount in PREPLAN's model is implicitly assuming the OT/diff somehow keeps appearing in future paystubs at the historical average rate.

PREPLAN's model would be correct under a *different* premise: "OT/diff continues at the historical $/mo rate but doesn't get raises." That's not what you said, but it's a defensible simpler approximation if you want to avoid the phase-out's surprising-AFC-decline property.

So we have a fork:

- **Phase-out model** (this doc): mathematically rigorous given your stated premise. More conservative at long horizons. Has the surprising "AFC can drop over time" property. More complex math (introduces `H`, `P`, projected-period blend).
- **PREPLAN's frozen-forever model**: simpler math. Slightly overstates AFC at long horizons relative to your stated premise, but produces no surprising decline. Easier to explain in the UI.
- **Current code**: applies raises to the entire AFC including OT/diff. Most overstating; no eligible-vs-frozen distinction at all.

## What changes if we adopt the phase-out model

PREPLAN's stage list barely changes — same UI fields, same threading, same URL params. What changes is:

- Stage 1's math (the `applyRaises` body) gets the `H/P` split.
- Stage 1's signature still takes `(afcMonthly, eligibleMonthly, retDate, N, cutoff)` but now also needs the anchor `A` to compute `H`. So Stage 1 has to land *with* anchor support, which means PLAN's Stage 1 (the anchor signature change) collapses into PREPLAN's Stage 1. PLAN.md's anchor stages don't disappear, but the plumbing-only stages (UI, threading, URL) become thinner because the math change is already done.
- The composability claim in PLAN.md ("anchor logic layered on top of the eligible split") becomes less true — anchor is *required* for the phase-out math to work, since you can't compute `H` without it.
- The test cases for Stage 1 expand to cover the three regimes (mostly-historical, mixed, fully-projected) instead of just the eligible-fraction cases.

## What I'd like you to consider

- Is the phase-out behavior what you want? Or is the simpler frozen-forever model close enough for the planning horizon you care about?
- If phase-out: do we want to surface the "AFC can decline" property in the chart UI, or just let the curves speak for themselves?
- If frozen-forever: do you want to add a caveat note in DESIGN.md that PREPLAN's model overstates AFC at long horizons relative to a strict "no future OT/diff" premise, but is chosen for math simplicity / explainability?

I'll wait for your call before touching PREPLAN.md or PLAN.md.
