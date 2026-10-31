## Routing form and focus ownership

Routing actions continue to use the context menu and inspector. The latest request owns the form and focus; an older field mount may acknowledge only its own request. This preserves the learner's draft and keyboard destination without adding controls or chrome. Existing Default, repeat-request, draft-rename and row-focus assertions stay exact.

The native Default-row pointer/scroll race is separate from request ownership; this change does not substitute a different input path for that test.
