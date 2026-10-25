## Six more drawing tutorials

The development and E2E tutorial catalog now teaches boundaries, annotations, Secret dependencies,
selection and arrangement, Ctrl+K, and presenting and private sharing. The Share lesson keeps the
real app controls, names Interactive HTML first, and leaves the practice diagram unsaved until
the learner explicitly chooses Save a copy or Save as.

Solutions use the real UI, including Shift+click, selection boxes, boundary drops and context menus.
Skip performs sticky steps' demos before completing them. Boundary names wait for Enter or leaving
the field, using the editor mode's boundary identity. Fit to contents and Tidy up are acknowledged
moments after trying their controls; opening Ctrl+K alone is not a separate lesson step.
The Ctrl+K add step settles after selecting Service 1, so finding the topic is a separate action
and Undo can still reopen the add step.

All words use English catalog keys. Tutorial metadata and dialog observation stay behind the
development/E2E gate. No simulation, planning or stencil behavior changes, so no new showcase
example is needed. The only intended golden change is
`tests/parity/goldens/node/i18n/catalogs.json`: the tutorial-area hashes, message counts and English
fallback counts include the new lesson copy in every locale. Simulation, diagram and export goldens
remain unchanged.

## One completion contract for Skip, Show me and Continue

A step is complete when its check holds and it has settled. Skip, a near miss's fix and Continue's replay
now complete a step through that one contract: the demo's edits only while the check doesn't hold, then
the settlement's own action (finish the name, close the annotation editor, select the subjects). Skip
from `completing` therefore never repeats an edit: adding the Kafka topic and pressing Skip selects
Service 1 without a second topic, and Skip with a name or an annotation still being typed commits it.

Annotation title, note and zone steps stay current until the annotation's editor closes. The editor
mode hears the annotation editor open before its annotation is inserted, and again with each commit, and the editor reports as its name field.
Show me moves only the camera (`revealNode`), so Align middles keeps the box selection. Continue after
a reload lands on Share when the fresh app is no longer presenting.

`src/tutorials/completionSweep.test.ts` checks Skip from `active`, Skip from `completing`, Continue and
Show me at every step of every tutorial, and the catalog lint requires an annotation settlement and
forbids settlement selects in demos.
