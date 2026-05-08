# vac
Rewrite the disclaimer as a single string constant used twice, then 
change it to apply to plural graphs.

X-axis max date should either be last day of service, if one was selected;
or Dec 31 of the year the user reaches the max possible accumulated value,
which happens iff they have 720 hours on Jan 1 of a calendar year and
accumulate without spending for that entire year... and if that interval
is greater than say 5 years, maybe we should collapse the intervening
dates until we reach that absolute max?

# insecurity
Having all the field values as urlParams was very helpful during initial
development when I was constantly reloading the page; and is still useful
during manual testing. It does present a minor security hole, though, since
whoever sees the url will see your DOB and some financial info. Would it
be possible to change the code so that one *can* use urlParams to init
any or all of the form fields, *but* the URL after that point will remain
unchanged?  And the reload links would also need to mirror only whatever
params were in the initial URL, rather than updating to track changes in the
form state. Sound good?

# fixing COLA
When the graph starts showing a straight line because the employee has retired, the
COLA curve now also shares that fixed starting point; in that case, change it from
'display on hover' to 'always display'.

# visual sugar
Add an input field near the graph which lets the user put an arbitrary 'cutoff' number in it and,
for each displayed curve (not including COLA), put a marker (X) on that curve at the month where
the value on that line is closest to but not less than the cutoff value

