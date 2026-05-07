# fixing COLA
When the graph starts showing a straight line because the employee has retired, the
COLA curve now also shares that fixed starting point; in that case, change it from
'display on hover' to 'always display'.

# visual sugar
Add an input field near the graph which lets the user put an arbitrary 'cutoff' number in it and,
for each displayed curve (not including COLA), put a marker (X) on that curve at the month where
the value on that line is closest to but not less than the cutoff value

# paystubbing
The paystub PDFs are hosted on an externally-run website and protected by CAS + Duo MFA. How hard would it be to write an app which would, after I manually login, let me automatically download every paystub PDF by manipulating their UI? (Even better would be if their UI demontrates using a microservice REST API to generate the PDFs dynamically.)

