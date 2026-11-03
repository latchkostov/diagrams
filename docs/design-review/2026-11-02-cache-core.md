## Scope

Source review of cache core's model upgrade, inert-rule explanation and lazy Live runtime against the UX principles. Cache rule editing, badges, hover details and fault controls belong to later feature batches.

## Chrome and recovery

The upgrade stays in Diagram properties and uses the existing preview and one-step Undo path. No top-bar or Live transport control is added. Dormant rules explain why they do not change playback and offer the existing removal action. Legacy export warns that cache rules stop running.

The cache runtime uses the shared lazy-surface lifecycle. A caching controller cannot mount while its runtime is held. Failed downloads use the existing Retry action, and visual export awaits the active surface. The ordinary no-cache session retains its current entry path.

## Preview correction

The first preview listed every base node with a cache table as a cache that would start answering. That included nodes without an origin and tables containing only no-store policies, while omitting saved simulation overrides. The reviewed `cacheUpgradeNodes` helper includes only supported stencils with a storing policy and an outgoing flow Request. It also names saved simulations whose setup or timeline introduces storing rules when the base node has none. Simulation context names use translated sentences. This resolves the source-review finding without adding controls.

## Verification boundary

This is a source-level UX review. The implementation's browser gate separately verifies held-runtime readiness, failure recovery, export behavior and upgrade Undo. No visual approval of the later cache Inspector or Live readouts is implied.
