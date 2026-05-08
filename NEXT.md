# vacationing
Although I'm having trouble finding authoritative documentation, I've been told that,
upon retirement, any unused vacation up to a maximum of 90 days (720 hours) will be
converted into a payout for the retiree using the simple formula
payout = Hourly Rate at Retirement * Unused Vacation Hours

Since I'm already scanning the paystubs, the code contains logic for applying
expected raises to regular base pay, I'd like to duplicate the current fields
for inputting sick leave (number of hours, as of, additional hours-per-month) for
vacation hours, and add an extra field to this new set for 'current hourly rate'
as of the same date; and then add a line to the graph showing how much their
current and maximum-with-no-spending vacation time would be worth upon retirement.


# fixing COLA
When the graph starts showing a straight line because the employee has retired, the
COLA curve now also shares that fixed starting point; in that case, change it from
'display on hover' to 'always display'.

# visual sugar
Add an input field near the graph which lets the user put an arbitrary 'cutoff' number in it and,
for each displayed curve (not including COLA), put a marker (X) on that curve at the month where
the value on that line is closest to but not less than the cutoff value

