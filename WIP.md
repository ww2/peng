Claude marked stage 2 as Completed, and said:
```
  1. Open ?plan=hybrid&memDate=2014-08-01&ncSvcYears=5&ncSvcMonths=3 → NC fields show 5/3
  2. Reload-bar URL preserves ncSvcYears=5&ncSvcMonths=3 while plan is hybrid
  3. Switch dropdown to noncontributory → NC params disappear from the reload-bar URL
```
alas, when I used the params from 1., I get an error saying `unknown plan "plan=hybrid" — pick from the dropdown`

(which seems to be an problem in the error-detection code, because it *looks* like the url parameter
name and value match legit values)

and stopping to wait for another window to open

