# Portable gate measurements

Worker count reserves one quarter of available CPU capacity and 4 GiB RAM, then
allows 2 GiB per browser, capped at 16. A 10-core/24 GiB Mac gets 7 workers;
a 32-thread/64 GiB PC gets 16. Measurements below distinguish the entire gate
from the browser invocation and never change test assertion timeouts.

Acceptance and source-transport measurements are recorded here after validation.
