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
| Age penalty | 6%/yr below normal retirement age | Consistent across all plans per source PDFs |
| Penalty granularity | Whole years (floor) | PDFs say "each year under age 62" — no monthly pro-ration; produces staircase curve |
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

This is intentional and correct per the source PDFs ("6% for each year under
age 62" — no monthly pro-ration is specified).
