## Derive dependency spacing from lane packing

#397 R-424baed559 remains deferred from the P2 stabilization batch. Dependency spacing currently
does not derive exclusively from the actual lane packing decision. Changing it can move rendered
connections and labels, so it is outside a tests/tooling batch while master needs consecutive green
Linux Nightlies.

Follow up with a shared packing decision consumed by both route and dependency spacing. Cover mixed
dependency/flow fans and rejected packing, preserve hit targets, and review geometry and every intended
parity difference. Run rendered layout neighbours under Linux load before accepting the change. Keep
all existing budgets, reserves, tolerances and assertions.
