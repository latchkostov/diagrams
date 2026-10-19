## Engine R2 thread-tail review

Static UX review: existing thread meters retain reserved thread weight across sampling changes, while resource memory and request pressure count each resident request once. Kafka partition assignments stay withheld during draining ownership. No controls, labels, navigation or canvas layout change, so the chrome budget is unchanged. No new simulation, planning or stencil feature is introduced; existing public examples remain the showcase.

Kept the requested ownership and admission structure. Rejected recursive admission and scanning the call/continuation collections for memory counts: the former overflows on a large immediate backlog and the latter violates existing complexity contracts. Kept the existing logical clocks and cohort admission policy; no timing tolerance or generator was widened.
