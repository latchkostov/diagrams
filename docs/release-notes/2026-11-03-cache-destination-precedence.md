## Cache destinations respect rule order

Live cache details now name only destinations belonging to traffic classes that the rule wins in
the runtime's ordered first-match lookup. A storing `/assets/*` rule no longer makes the following
Don't store Default claim the static service: Default lists only the API. Message-type predicates
and connection filters are considered together, including requests without an address. When no
destination resolves, the existing neutral aggregate wording remains.

No engine behavior, UI labels or parity goldens change.
