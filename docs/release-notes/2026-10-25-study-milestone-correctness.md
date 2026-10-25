## Design study milestone correctness

Dinner rush now requires backlog at or below eight messages at four seconds. The untouched,
undersized Dispatcher fails that expectation; the reference fleet of two replicas passes.

Skip waits for a reused dead-letter queue's repaired connection before setting its Message
relationship and dead-letter property. It also restores a cut connection and works from editing
or Live view without adding another queue.

No parity goldens were changed.
