## Gate admission review (PR #152)

This correction changes the verification CLI only; editor controls and browser behavior are unchanged.
Existing holder messages now include reserved ports, making a checkout or port wait explainable.
The existing busy exit and cancellation apply to every admission constraint. Automatic port selection
needs no extra flag, and explicit overlaps wait instead of failing later during server startup.

Preserved FIFO admission and rejected silent worker-count reduction: the declared resource request
must remain the resource request executed. Per-run build/parity output isolation would require
coordinating several independent tools; canonical checkout exclusion addresses the collisions directly.
No new chrome, simulation feature, showcase example or output-golden update is needed.
