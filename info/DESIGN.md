# ERS Pension Graph — Design Decisions

Captures the *why* behind choices made during implementation. Formulae, plan
configs, and eligibility rules live in `CLAUDE.md`; deferred features live in
`TODO.md`.

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
| Official ERS line | Red solid curve drawn alongside blue | Lets members compare own estimate to official calculator output for multiple dates at once |
| Official ARF tables | Embedded as JS literal in `index.html`; source files in `ers/` kept for reference only | Single-file delivery constraint; tables are small enough to inline |
| Official formula | `Math.floor(Math.round(afc × svc × mult × arf × 100) / 100)` | Matches `lgeRnd(..., 2)` + `Math.floor` in official source (`ers/_js/scripts/ers.calculator.js`) |
| Two official age calculations | `officialArfAge` (days ≥ 15 rounds up to next month) for ARF table lookup; `officialEligAge` (no day-rounding) for eligibility thresholds | Official calculator uses two separate functions for these purposes; using the wrong one produces off-by-one-month errors |
| Official line inputs | Uses current AFC; ignores sick leave and raise rate | Official calculator models neither; red line is a clean no-adjustments baseline for comparison |
| Retirement option | Maximum Allowance only | Survivor reductions require actuarial factors not in source PDFs |
| Plan scope | All three plans (5 variants) | Minimal added complexity; maximises usefulness |
| Mixed service | Not supported | Additive formula is known; UI and eligibility logic need more design; tracked in TODO.md |
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
No monthly pro-ration is applied; the official calculator does interpolate by
month, which is why the red (official) line is smooth while the blue is a staircase.

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
