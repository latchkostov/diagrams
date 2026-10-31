## Peer presence precedes document readiness

Diagnostic Nightly 41249763740 fails Linux Dev's collaboration confirmation at tutorials-ports.spec.ts:212: the guest chip already has one peer, but its collaboration observation is still undefined. Peer count comes from the session; the lifecycle publishes joined only when the shared document is ready. These are separate signals.

Positive creator/joiner assertions now wait for the actual joined publication and its exact role. Cancellation and pending-consent assertions still require no publication. No room, transport, tracker or product behavior changes.

A Lab regression starts the joined reader before publication, acknowledges its first real read, and holds the document-ready observation. It must remain pending until the real observation port publishes joined with the joiner role. Temporarily restoring the old one-shot read fails this regression. Native and two-repeat Linux results are recorded in the round-four verification fragment and PR.
