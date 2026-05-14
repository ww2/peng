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

