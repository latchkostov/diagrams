## Tutorial repair API: one draft-aware module for Skip, demos and Continue

### Problem

Five design studies (checkout, payments, dispatch, fan-out, RAG) were quarantined twice. Each fix round on
#346 and #347 turned up a new P1 from the same cause. Skip and Continue's reconstruction repaired a run's
configuration through several writers, each with its own idea of which copy of the run counts:

- Base-only patches ignored the run's own overrides: saved Inputs (`setup.props`), the inspector's
  run-only caller settings (`setup.edges`) and saved multipliers. Examples: R-347996f610, R-50b17033f7,
  R-74a53e25ad, R-901f42c0a4, R-68f36a041c, R-b67074b474.
- Run-only patches skipped the diagram, so the next run had the old setting again (R-f5cd646f93).
- Some patches replaced a whole override instead of merging into it (R-e29dbd5f9f, R-c23dca43a9,
  R-da278e22d9, R-4360eae213).
- A named repair read the saved run while the learner was running an unsaved draft of it. Saving that
  repair cleared the draft and lost the learner's edits (R-d02740bdce, R-be43d8ba04, R-cdb7a52bec).
- The tutorial-only persistence path changed the app's own Save for everyone. Saving Inputs then dropped
  pending Simulations edits (R-c42f1d2a21), and drafts drifted from the session (R-f4e4578760, R-b4078e8a79).

### Decision

All of these edits go through one module, `src/tutorials/repair.ts`:

- saved runs, Inputs, simulations and overrides;
- each demo kind that makes them: `patch`, `saveSimulation`, `inputs`, and a design study's reference `runSimulation`;
- Skip, a near miss's fix and Continue's reconstruction, which all run demos through `perform`.

`runner.ts` doesn't write any of them itself.

```ts
type RunRef = string | { selected: true };                        // types.ts
type RepairTarget = { node: string } | { edge: string } | { run: true };
interface RepairRequest { target: RepairTarget; patches: readonly PropPatch[]; runs?: readonly RunRef[] }
interface RepairPorts { editor; live: LiveUi | null; liveOn: boolean }  // the app's own writers
type RepairResult = "done" | "waiting";
createRepairs(): { repair, saveSimulation, reference, inputs, reset }
repairedRun(diagram, sim, target, patches): Simulation               // pure: what a copy still overrides
```

Catalog data names the runs: `{ kind: "patch", edge, patches, runs: ["psp-brownout"] }`. Run-level settings are
not per-study data: before every reference replay in a design study (its Skip's `runSimulation`), the runner calls
`reference(run)`, which puts the run's saved capacity and traffic multipliers (Inputs & capacity's Save to
simulation) back to ×1 through the same repair (`REFERENCE_RUN`). Pending Inputs end with the replay itself. So no
milestone's reference can be replayed at ×0.25 capacity (R-68f36a041c, R-db40c0b5e7, R-a43b349e98). A repair then
does three things:

1. **The diagram first.** It applies only what's missing, through `setNodeProps` or `setEdgeProps`, as the
   inspector does outside Live. Every later run inherits the fix.
2. **Target selection, per run.** If Live's session has an unsaved draft of that run (`LiveUi.draft`, from the
   Simulations panel's Run without Save), the draft is the copy to fix. Otherwise it's the saved run.
   `{ selected: true }` resolves to whichever run Live has selected.
3. **Only overridden keys.** For each copy, `repairedRun` merges a key into the copy's own setup only when the
   copy already overrides it with another value. That covers node props, a connection's top-level caller
   fields (the only fields `simulationEdges` lets a run override) and the run's multipliers. Untouched keys
   and sparse overrides stay as they are. Nothing new gets pinned: a key the run inherits keeps inheriting
   the repaired diagram.

### Persistence through the app's own commands

The module never writes Live's state. A repaired copy goes through the Simulations panel's own commands,
unchanged from master:

- A draft goes through `runDraft`, the panel's Run. It stays a draft, and the learner's title, traffic,
  timeline and seed are kept.
- A saved run goes through `saveSimulation`, the panel's Save. LiveSync replays the selected run with the
  new definition, exactly as after the Inputs panel's Save.
- With Live off there's no session, so the document is the copy, through `updateMeta`.

`LiveUi` now exposes `saveSimulation` and `runDraft`, so a caller outside the panel can use them. Save keeps
one identity through a ref, so `LiveUi` doesn't change on each canvas render.

**The panel's working copy.** The Simulations panel edits its own copy (SimPanel's local state), and its Run
and Save submit that copy. A repair would be lost if the learner then pressed Run or Save in a panel opened on
that run (R-d3e304249e). So the panel exposes one command of its own, `onEditCommand`: an edit function
applied to its copy when it shows that run, as `setSim(s => edit(s))`. The session offers it as
`LiveUi.editPanelCopy(id, edit)`, which also edits the copy set aside while the panel is closed. Each repair
passes the same `repairedRun` merge (or the saved simulation's additions), so the panel keeps its pending edits
and gains only the repaired keys. Run and Save themselves are unchanged, and nothing else calls the command.

This PR reverts its earlier changes to `useLiveCommands`, `SimPanel` and `callerPolicy` to master. App save
semantics are master's. That removes R-c42f1d2a21: saving Inputs no longer touches the suspended or open
Simulations working copy.

The `saveSimulation` demo saves, as Simulations…'s Save does. It adds only what's missing to the learner's
copy (their draft of that id, else the saved one), then saves that copy.

### Async consistency

A session write lands on Live's next render. Until then, `LiveUi.draft` and `LiveUi.simulations` still show
the old copy. While a run's last write isn't visible yet, a repair returns `waiting` without writing again.
Repair demos are in the runner's `live` set, so they retry on Live's next publish. The next demo therefore
reads the copy the previous one made. This is what lets fan-out's three pool repairs share a draft.

A refused write (Run rejects an invalid copy, or Save's validation fails) is reported by Live. The repair
then stops waiting rather than looping.

### Checks

`effective` checks read Live's running configuration through `configuration.ts` `checkProps`. That
read-only helper is kept from this branch: it is the only thing left in that file, and it doesn't change app
behaviour.

### Study changes

- **Payments.** Never double-charge repairs the selected run plus both saved runs, so switching runs can't
  undo it. Brownout and Poison repair their runs.
- **Checkout.** The rush and quota milestones repair their runs.
- **Dispatch.** Replicas and partitions repair their runs; the reference replay's ×1 multipliers make the reference
  sizes the fleet (×0.25 would leave Dinner rush one consumer, ×2 would outgrow the partitions).
- **Fan-out.** The pool repair covers both runs and is repeated before the outage. Queues bind by
  `between: [router, sender]`, so removing either connection keeps the queue bound and repairable. DLQ-first
  construction still binds correctly.
- **RAG.** A new `atLeast` patch raises answer-path caller deadlines below the 2-second budget to the budget.
  It applies in the diagram and in the run. Longer deadlines, or none, stay.

### Verification

The completion sweep's fake Live now models master's session commands: Run keeps a draft; Save ends a draft
of its id and syncs the selected run through the real `LiveSync`; selection prefers the draft; lists and drafts
publish on the next render. The sweep runs every step of every lesson and adds these perturbations:

- learner edited saved Inputs, through the Inputs panel's Save;
- saved override changed, through the Live inspector;
- learner has an unsaved draft of the target simulation, with its title and seed asserted kept, every repaired
  key fixed in the draft and the saved run untouched;
- learner disconnected a channel queue, on its incoming or its sender connection;
- a reload in between: Continue over saved runs that override the step's keys, then Skip;
- saved Capacity ×0.25 before the reference replay, on every study milestone that replays a run.

The draft perturbation also keeps the Simulations panel open on the draft with an edit not yet Run, and asserts the
panel's copy gets the repair with that edit kept.

Each study also has a negative case: the starting diagram fails every milestone throughout every saved run.

A mutation that skips draft repairs fails 12 of the draft-perturbation cases. Disabling sparse merges fails
the merge regressions. Skipping the reference normalization fails all 14 capacity cases.

### UX

There are no new controls or copy. Skip doesn't save a learner's draft or end it. The panel's dirty marker
and title stay. A saved-run repair shows the panel's usual "Saved" notice, because it's the panel's Save.
Pending edits that haven't been Run yet stay in the panel.

The open or set-aside panel copy of a repaired run gets the same repair, so its Run and Save keep it.
