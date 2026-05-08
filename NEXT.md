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

Under 'Earnings data' the 'Regular avg earnings' output is a bit confusing -- please replace that with 'Current monthly earnings as of', using the date and value from the most recent complete pay period.

# caching
The UI for cache-management is confusing, since there's a checkbox but clearing it doesn't *clear* the cache, it just prevents it from being used at the next reload; and the cache gets cleared as a side-effect of clearing the pension fields.  How would you recommend making the interaction of the UI and the cache easier to understand?

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

