## Self-host server deployment review fixes

Static-to-server Helm upgrades now clear the previous RollingUpdate settings before using Recreate.
Server ingress timeouts remain overridable through the existing annotations. The static chart's
rendered bytes remain unchanged.

Helm server mode and Compose now use a 512 MiB memory limit, 128 MiB total outbound buffers,
16 MiB per socket and 32 sockets, with explicit allowances for Node, inbound frames and compression.
Server startup rejects an outbound budget above 25% of a detected OS/container memory limit and
logs how to recover. SELF-HOSTING.md documents the memory formula and override responsibilities.

Regression coverage includes a merge of the rendered server strategy into a defaulted static
deployment, conflicting pinned settings, explicit ingress timeouts, real CLI startup refusal and
slow-recipient reservation bounds under a mocked container limit. No parity golden changes are intended.
