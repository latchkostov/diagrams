## Tutorial review follow-ups (#413, round 1)

- **R-9ef88cbfff:** Add held-boundary tests for reset during a pending local-peer join and failed peer actions followed by Retry. Assert no late edits or observations and released clients/controllers.
- **R-d259fd035b:** Move the AI practice lifecycle into an injected host alongside the peer practice host. The runner still owns the lesson-specific dynamic import and reset; this round repairs initialization Retry without broadening that lifecycle refactor.
- **R-2d660cade9:** Add Continue cases at the Undo and Revert steps that use the learner's visible AI history buttons after reload, asserting restoration and no persisted practice content. Current Continue checks reconstruct the diagram but finish through assistance.
