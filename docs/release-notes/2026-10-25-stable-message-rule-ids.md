## Stable message rule IDs (MT-09)

Processor message rules now keep an invisible identity. Rules added past the first 25 stay visible and
keyboard-editable through renaming, Undo/Redo, name reuse, and a peer moving or renaming the processor in
Edit together. All quarantined MT-09 tests are enabled, and MT-09 is DONE. The design is in
[rule identity](../design-review/2026-10-25-rule-identity.md).

## Schema and compatibility

Node `emits` now also accepts `[{ id?: string, receives: string, sends: string }]`. Untouched rules are
never rewritten. Legacy strings and maps, and ID-less rules, load, save, export, share and autosave
byte-for-byte. Their identity is derived from the incoming type in memory and never serialized. A rule
gains an explicit ID only when it is created or edited in the inspector, the bulk editor or by the agent.
Existing explicit IDs and unknown rule fields always round-trip verbatim. New IDs do not need a secure
context. The engine, type analysis and planning read only the receives → sends mapping, so simulation
results and planning budgets do not change.

The native formats stay `diagrams/v1` and planning's `diagrams/v2`. No planning revision, engine version
or plugin version changes. The public diagram/operation schemas and the installed skill reference are
regenerated.

## Output parity

Five schema-contract goldens change, because they describe the new grammar and not any diagram output:

- `node/agent/tools.json`: the tool input schemas advertise rule arrays.
- `node/skill/{files,corpus-hand-shaped-lines.files}.json`: fingerprints of the generated format reference.
- `node/skill/{public-schemas,corpus-hand-shaped-lines.public-schemas}.json`: fingerprints of the public
  schemas.

No native export, agent description or edit, simulation, planning, checks, image or other output golden
changes. None of those scenarios creates or edits a message rule.
