## Design study repairs and Dispatch availability

Skip restores the Orders DB Request and repairs existing outbox and dead-letter Message connections
without creating duplicates or replacing their other properties. The PSP brownout reference also
enables the breaker after a learner explicitly switches it off.

Dispatch is available in Design studies and through its direct link. Owner decision 7 (2026-10-25)
uses partitions ≥ consumers and each saved run's own expectations; no cross-run form is needed.
This resolves the Dispatch follow-up recorded in the earlier design-studies fragments.
The solution paths reopen Dispatcher properties after going Live and select the topic's dead-letter
connection explicitly before editing it.

No output parity goldens change.
