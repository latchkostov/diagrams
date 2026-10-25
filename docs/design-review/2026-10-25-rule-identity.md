## Message-rule identity: where derived IDs live (MT-09, PR #334)

**Decision.** A derived ID is never stored. Each document copy keeps the rules as they were authored: legacy
strings, maps and ID-less rule arrays stay unchanged. Code that needs identity reads it through
`messageRules(emits)`. For each ID-less rule, that function derives `rule-<FNV-1a of receives>` and memoizes
the result per list reference. Every copy of the same list derives the same IDs. Undo snapshots, room
projections, validation results and reloads are all copies, so none of them needs to carry, strip or
re-derive provenance. An explicit ID exists only after `editMessageProps` writes one, for a rule that was
created or edited.

The derived ID depends on the incoming type, not the rule's position. Removing or reordering siblings
therefore never moves an identity. This is the counterexample behind R-3f4bf4b104.

### Module

`src/model/messageRules.ts` is the only identity API, and only editing code imports it:

- `messageRules(emits)` returns each rule with its runtime ID. A rule keeps its explicit ID if it is the first
  rule to use it. Rules with no ID, or with a duplicate ID, get a derived ID. Derived IDs avoid every explicit
  ID in the list; when two derived IDs collide, later ones get a `-2`, `-3`… suffix in list order.
- `editMessageProps(next, previous)` is the single write boundary. Explicit IDs in `next` are claimed first
  (R-589c66c197). A rule without an ID inherits the previous ID for its incoming type, unless that ID is
  already claimed; otherwise it gets a fresh ID. If a rule's content is unchanged, the previous authored
  object is returned as-is, so an untouched rule stays ID-less. A created or edited rule is written as
  `{id, ...content}`. When nothing changed, the result is the previous list itself. When untouched legacy
  rules are only removed or reordered, the result stays a legacy map.
- `newMessageRuleId()` builds IDs from `crypto.getRandomValues`, so it works without a secure context.

`src/model/emitsMapping.ts` is the behavior view: `emitsMapping(emits)` returns the sanitized lookup table,
memoized per list. The engine, type analysis, storms, the bulk field and planning use it, and it ignores IDs.
The read-only HTML viewer never writes rules. It stubs `messageRules.ts` with `editMessageProps =
props => props` (`EDITOR_ONLY`, `scripts/interactive-viewer.ts`). The stub keeps the viewer and the skill
ZIP from carrying the identity code.

### Boundaries

| Boundary                                | How IDs flow                                                                                                                                                                                                              |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Editor state                            | Holds the authored form. The inspector reads `messageRules`, keys rows by ID and saves through `setNodeProps`.                                                                                                            |
| Undo/Redo                               | Snapshots are copies of the authored form, so restored lists derive the same IDs. Explicit IDs restore verbatim.                                                                                                          |
| Room projection, room Undo              | `projectRecord`/`readValue` deep-copy JSON. The copy derives the same IDs. The projection validator is unchanged.                                                                                                         |
| Proposal validation (P1)                | `validateDiagram` no longer transforms rules, so `applyOps`'s `validated()` and `applyDiagram` keep every runtime identity.                                                                                               |
| Agent operations                        | `add_node`/`update` props pass through `editMessageProps`, so the agent follows the inspector's rules.                                                                                                                    |
| Repeated normalization                  | None at boundaries. Reads are memoized per list reference; an unchanged edit returns the previous list.                                                                                                                   |
| External provenance                     | There is no runtime field to forge. File and room data can carry only `id`: the schema allows a string of 1–200 characters, and anything else is an ordinary validation error. Other fields round-trip as unknown fields. |
| Planning budget                         | `planningInput` budgets and plans `emitsMapping`, never IDs. Legacy inputs are byte-identical.                                                                                                                            |
| Export, share link, autosave, snapshots | These serialize the document as-is, so only explicit IDs appear. Each serializer is back to master's code.                                                                                                                |

### Rejected

- **Position-derived IDs (`rule-1`…).** Deleting a sibling renumbers every rule after it. The inspector then
  remounts the row it is moving focus to.
- **Runtime provenance embedded in rules (round 2).** Every boundary had to opt in or strip it: validation,
  normalization, rooms, the budget and snapshot comparison. Untrusted input could also forge it.
- **Object identity or names.** Room copies break object identity, and Undo can reuse a name.

### Limits

Derived IDs are stable for the life of a list's content. If two ID-less rules hash alike, which in practice
only happens with an ID-less array that repeats an incoming type, the later rule's suffix depends on order.
Deleting the earlier rule renumbers it. Explicit IDs never move.

No controls, copy, focus rules or layout change. MT-09's (a), (b) and (c) are covered by the mounted
inspector cases (local history and the real room adapter). The cases go through the editor's own
`editMessageProps`, and the browser regressions include the real bulk editor.
