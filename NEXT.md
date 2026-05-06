# raises
Would updating the paystub-scanning code to verify that past raises are applied to regular pay when and as expected provide a meaningful guard against regressions, or are the existing tests sufficient for that?

For plans which use 'total' earnings, the UI for letting someone manually input all of the related values seems too complex to bother with, which is why we've implemented the raise-projection only when scanning actual paystubs. For plans which only use 'regular' pay to computer their AFC, it seems like we can accurately extrapolate their future windows by just multiplying the AFC vs the applicable raise amounts on a date-wise basis. If that's true, can we go ahead and add raise-extrapolation and graphing for regular-only plans?

# fixing COLA
When the graph starts showing a straight line because the employee has retired, the
COLA curve now also has that fixed starting point, so it should change from 'display on hover' to 'always display', with that fixed starting point

# visual sugar
Add an input field near the graph which lets the user put an arbitrary 'cutoff' number in it and,
for each displayed curve (not including COLA), put a marker (X) on that curve at the month where
the value on that line is closest to but not less than the cutoff value

# paystubbing
The paystub PDFs are hosted on an externally-run website and protected by CAS + Duo MFA. How hard would it be to write an app which would, after I manually login, let me automatically download every paystub PDF by manipulating their UI? (Even better would be if their UI demontrates using a microservice REST API to generate the PDFs dynamically.)

