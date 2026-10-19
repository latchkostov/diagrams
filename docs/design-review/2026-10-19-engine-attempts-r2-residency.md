## Engine attempts R2 review round three

This bookkeeping fix restores memory and request pressure after quota-refused retries and removes
repeated work during completion and replica reassignment. It adds no controls, UI text or layout
changes. Existing Live readouts and interactions retain their contracts; all output goldens must
remain unchanged. No showcase is needed because this fixes existing simulation behavior.
