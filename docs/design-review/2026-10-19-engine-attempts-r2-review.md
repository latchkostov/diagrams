## R2 review fixes: logical results and retained capacity

Reviewed against the UX principles: these fixes add no controls, settings or terminology. A caller's
successful reply still publishes at logical completion; its capacity meter continues to include
unspent local work. Pause freezes that capacity clock. A caller taken down before its continuation
executes reports failure and publishes nothing, even when its dependency already replied successfully.

The existing public waiting examples remain the showcase for this behavior. This review introduces
no new simulation feature or configuration surface. Regression coverage checks throughput, pause,
down, drain, scale changes, checkpoint replay and outcome diagnostics; timing fixtures preserve
master's complete traces when pools divide evenly. The broader thread-clock migration stays in R3.
