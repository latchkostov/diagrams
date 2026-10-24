## Room roster rejection work

Malformed roster messages now publish refusal counts once per message. Checking whether a room has a document
does constant work regardless of its stored client count, and unchanged diagnostic reads reuse their snapshot
without rescanning presence or serializing it again.

Roster verification authority requires a module-private constructor token supplied only after signature verification.
Stored entries remain immutable through the normal add path, and roster readers expose readonly entry types.

Targeted regressions cover 100,000 rejected items against a document with 512 clients, unchanged diagnostic reads,
reflective construction, mutation during normal add, and readonly reader contracts. The first three failed on the
previous head; the normal-add regression also failed with mutable retention deliberately restored.
No output goldens changed. Full-suite and parity runs are deferred to CI for this targeted fix round.
