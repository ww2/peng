# ERS Pension Graph — Deferred Work

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

