## Inspector merge UX review

Live details and Messages remain contextual Inspector sections, with no added canvas or toolbar chrome.
The message-type edge reader and live hover readout retain label hit handling. Connection dots retain
master's side attachment behavior. Identity-field downloads use the existing naming controller to keep
typed text and completion keys until the fields arrive, then restore canvas focus after Enter or Escape.
Failed identity downloads use the existing unavailable-panel marker and retry toast.

The connection loading/recovery shell and node identity fields are deferred independently. Simulation
controls keep their existing loading boundary so the split does not increase Live's download budget.
