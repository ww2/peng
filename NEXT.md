# caching
Should clearing all form fields immediately update all of the urlParams in the URL?
For testing it's been somewhat useful that the URL doesn't get updated, but in actual use, it seems
odd to have the url params not get cleared when I explicitly ask for the form to clear, especially
if the 'cache' urlParam is already being dynamically added to or removed from the URL

If the cache is populated, and the user clicks 'Clear all fields', go ahead and reset the
'use cache' checkbox to unchecked.

If the cache is populated, and the 'use cache' checkbox is checked, and the user selects a directory to scan,
is there enough information in the cache to allow you to avoid re-scanning paystubs which are already in the cache?

Should every raise whose start date is in the past be dropped from the table and projections?

# fixing COLA
When the graph starts showing a straight line because the employee has retired, the
COLA curve now also has that fixed starting point, so it should change from 'display on hover' to 'always display', with that fixed starting point

# visual sugar
Add an input field near the graph which lets the user put an arbitrary 'cutoff' number in it and,
for each displayed curve (not including COLA), put a marker (X) on that curve at the month where
the value on that line is closest to but not less than the cutoff value

