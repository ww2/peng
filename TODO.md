# ERS Pension Graph — Deferred Work

## Post-retirement cost-of-living increases

Each plan has an annual COLA applied after retirement:

| Plan | COLA |
|---|---|
| hybrid-post2012 | 1.5 %/yr |
| hybrid-pre2012 | 2.5 %/yr |
| contributory-post2012 | 1.5 %/yr |
| contributory-pre2012 | 2.5 %/yr |
| noncontributory | 2.5 %/yr |

These rates are known but not currently displayed anywhere. A natural place would
be a secondary annotation on the chart or a note beneath it showing the projected
value at a chosen future year.

## Multiple curves / overlays — sick leave projection

Sick leave accrued at retirement converts to additional service credit under ERS
rules. The conversion formula (hours → credited months) needs to be sourced from
ERS documentation before implementation.

**Proposed inputs** (both optional; feature is suppressed if omitted):
- Sick leave accrued — hours (number input)
- Sick leave as of — date (aligns with the service "as of" date in most cases)

**Proposed chart behaviour** (two additional lines, different colors from the
main curve):
1. **Sick leave — current amount**: at each candidate retirement month, adds the
   entered sick leave hours (converted to service months) as a fixed lump sum on
   top of the credited service. The sick leave balance does not grow — this shows
   the pension impact of cashing out exactly what the member has now.
2. **Sick leave — projected accrual**: same as above, but the sick leave balance
   grows at **14 hours/month** from the "as of" date to the candidate retirement
   date. This shows the pension impact if the member continues accruing at the
   standard rate without using any sick leave before retiring.

The existing (no sick leave) curve should remain visible as a baseline, giving
the user three lines total: base, current sick leave, and projected sick leave.

## Mixed service

Members with service under more than one plan (e.g. Hybrid + Noncontributory)
are not supported. The additive formula is known — each plan segment contributes
`multiplier × (segmentMonths / 12) × segmentAFC × factor` — but the UI would
need a way to enter multiple service/AFC blocks, and the eligibility logic would
need to determine which plan's thresholds govern early/normal status.

## Survivor benefit options

The chart currently shows Maximum Allowance only. The other retirement options
(Options A, B, C — various survivor continuance percentages) reduce the member's
monthly amount by actuarial factors that depend on the member's age and the
beneficiary's age at retirement. Those factors are not in the source PDFs on
hand; they would need to be sourced from ERS before this could be added.

