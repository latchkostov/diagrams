## Shared Live details review

The merge retains contextual Live and Messages sections in the Inspector and adds no controls.
Hover and docked details share the verdict, vitals, sections and connection readout components.
Numeric vitals retain LTR isolation and section summaries retain bidirectional isolation in both
surfaces. Docked failure rates use the same settled population as hover cards and breaker details.

Keeping duplicate hover implementations was rejected because the Inspector and hover card could
drift. Using started attempts as the failure denominator was rejected because settled failures and
local breaker rejections belong to different populations. Bundle budget increases were unnecessary;
master's lazy Inspector boundaries retain the existing limits.

Regression checks remove the shared vital isolation and substitute the old failure calculation:
the tests fail on missing isolation and a 60% docked rate where the correct settled rate is 20%.
