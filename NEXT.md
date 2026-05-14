Right now, a lot of CLAUDE.md is used to describe both the forms in index.html
and the code in pension.js ; would it be more efficient to embed most of
that explanatory material in those files directly, so that CLAUDE.md itself
would contain fewer references which need to be updated every time the code
gets changed during maintenance?

# misc
Look over the current code and let me know if there are code paths which
lack sufficient automated tests.

# vac
On the vacation graph, when raises apply, create a separate pair of curves for that
case just like we do for the pension graph, so that the raise curves can be easily
visually compared against the non-raise curves.

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

