## Self-hosted relay foundation (S1)

Added an optional Node collaboration relay workspace and a client transport behind the existing
encrypted transport contract. The core supports bounded in-memory rooms, broadcast and addressed
frames, Origin/IP admission, rate and size limits, heartbeat cleanup and reconnects. Tests run the
same conformance suite as the existing transports against a real loopback server, including three
encrypted clients and rejoin.

This is developer/e2e groundwork only. Production flags, UI, CSP, static hosting and deployment
packaging remain for later phases. The public bundle is unchanged. No output parity goldens
are changed; existing diagram, simulation, export and rendering outputs are preserved.
