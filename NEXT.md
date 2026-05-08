# vac
X-axis max date should either be last day of service, if one was selected;
or Dec 31 of the year the user reaches the max possible accumulated value,
which happens iff they have 720 hours on Jan 1 of a calendar year and
accumulate without spending for that entire year... and if that interval
is greater than say 5 years, maybe we should collapse the intervening
dates until we reach that absolute max?

Ask about feasability of auto-populating the vacation-related hourly
rate and as-of date based on the date of the last scanned PDF paystub
(either immediately post-scan, or populating from the cache when the
page loads iff the cache is populated and the 'use cache' flag is set)

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

# reviews
Overall architectural review
Detailed testing review
Detailed code review

