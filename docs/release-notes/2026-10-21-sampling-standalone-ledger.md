## Sampling accuracy: standalone W1 processors

W1 workers outside a request call graph now retain sampled capacity through the same ledger
as other processors. Fractional turnover credits carry forward instead of being clipped by
legacy service pacing. With one slot and 10 ms work, scale 1.01 now completes 1,996.77 real
requests against the same-arrivals scale-one reference of 1,997 (previously 1,008.99).
At scale 1.1 the result improves from 1,098.9 to 1,996.5 (reference 1,997); at scale 2.5,
from 1,665 to 1,997.5 (reference 1,996). The fixed generated corpus remains 13/31 passing.

Standalone logical work finishes its first wave at 1,010 ms in the one-second fixture,
matching scale one's first completion; the remaining sampled capacity stays held until
10,010 ms at scale ten. The R4 scale-edit checkpoint moves from 10,010 to 1,010 ms;
resource-enabling checks move from 10,010 to 10 ms; the running-thread oracle moves from
1,100 to 10 ms. These earlier checkpoints preserve their original ownership assertions.

Pre-W1 pacing, caller memory/occupancy accounting, gateway ceilings and release quantization
are unchanged. No parity golden or unit snapshot is changed or re-recorded; the historical
legacy-worker snapshot now explicitly checks the pre-W1 revision. No controls or UI text change.
