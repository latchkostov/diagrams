## First diagram and keeping work: UX review

Reviewed the three new Chapter I lessons, the six revised lessons, their shared tutorial shell and
the import/save policy against the curriculum and UX principles. The initial review was a source and
content review; the implementation owner subsequently ran real pointer/keyboard paths and reviewed
automated captures. This does not claim a manual screen-reader walkthrough.

The new lessons put navigation before drawing, keeping work after drawing, and import inference after
the learner can change Properties. The invented Compose fixture avoids asking for infrastructure
files. Separate report-reading and privacy acknowledgments correctly avoid treating Done as proof
that an inference is correct. The explicit library copy teaches ownership without turning practice
edits into autosaves. No permanent toolbar control is needed: the two lesson-specific actions live
in the existing tutorial strip, while Properties, File, the gallery and the View menu remain the real
product surfaces.

## Findings sent back to implementation

The first source pass found four misleading affordances or instructions. File Save as had an empty
handler, gallery Open only closed the gallery, the workbench hint named a nonexistent Properties rail
button, and library history copy requested two transactions while the current UI solution used one.
These are resolved: File Save downloads a native file without ownership; gallery Open/Run makes the
normal editor handoff; selection opens Properties; history instructions ask for Undo until the copy
disappears and Redo until its name returns. The real history controller publishes successful steps.
UI drivers wait for the original edit's pending history to settle before duplicating, rather than
assuming an elapsed delay or changing the shared editor's history policy.

The observation checks also need to match their claims. Finding a stencil and closing Add must not
certify “without adding” after an accidental node creation. Redo feedback should claim a restored name
only when that name is checked. The palette command's feedback should describe the verified document
result unless command execution itself is observed. The old palette Add instruction must lose its
unnecessary final selection, and revised intros should include prerequisites and why the outcome
matters. These findings are resolved with document-size checks after searching, a named restored-copy
check, feedback limited to the document result, explicit palette navigation observations and revised
intros. The keyboard driver distinguishes native Tab stops in a menu from roving menus; a regression
exercises that distinction through real keys.

Linux review caught a fractional overflow of the phone import actions and a selected edge intercepting
the next connection gesture. Action buttons now wrap within their available width, and the pointer
solution clears selection before drawing the second connection. The bounds assertion remains strict.
Broader regressions also exposed independent Skip additions inheriting a stale rail anchor: demos now
use unconnected editor creation, leaving the connection step to the learner. A unit reproduces that
stale anchor and fails with the old call. The unassisted database search rejects a connected wrong
store; its negative test was also verified against the previous check.

Repeated Linux paths caught discovery being closed before a deferred matching result appeared. The
workbench and gallery solutions now inspect the actual result before closing; keyboard variants reach
the same result with focus. Display observations publish at layout commit, so closing immediately
after seeing a result cannot discard that evidence. No check is weakened and no timed delay is added.

## Retained exercises: routine review only

- **insert-on-edge:** retain the focused insertion and naming exercise. Its solution searches inside
  Insert node, and the completion check requires both replacement edges and removal of the bypass.
  Preserve the existing repair coverage rather than expanding this into a second quick-add lesson.
- **request-vs-message:** retain the relation change and seeded traffic exercise. The API's processed
  total is not fresh post-change evidence; the ending must not claim a measured caller comparison
  that this check does not establish. No retry or simulation-engine work belongs in this batch.
- **boundaries:** retain selection, membership, naming and drag-in. Fit to contents is a reading/action
  acknowledgment, not a geometrical completion check. The product keyboard gap remains explicit;
  Skip does not certify keyboard completion.
- **dependencies:** retain inferred Secret and visibility practice. Hidden dependencies remain in the
  document and carry no traffic; a remaining pip is an observation aid, not evidence of execution.
- **arrange:** retain region selection and geometrically checked alignment. Tidy up uses Done and
  therefore acknowledges the action rather than grading layout quality. The spatial keyboard gap
  remains explicit.

These five exercises need shared clarity and truthful evidence boundaries, not new required controls
or replacement exercises. The other retained strong exercises are outside this content batch.

## Verification limits

Automated Chromium review covers light/dark desktop, 390 px phone, short landscape, Arabic RTL,
expanded pseudo-locale and reduced motion. Full control bounds and axe caught an inaccessible
scrolling instruction area; it is now a labelled keyboard scroll region whose scroll keys stay out
of canvas shortcuts. The supplied boundary uses a custom slate tone with a legible label. The phone
import and short pseudo-locale screenshots were inspected after those corrections, as was the RTL
phone capture. Screenshots are in the owner's requested `batch-2` task directory outside the repo.

Real pointer/keyboard lessons and policy regressions cover the import report, cancelled/failed imports,
failed/successful copies, and no autosave after a forced pagehide flush following a copy. Removing the
ownership guard and replacement cancellation was rejected by two units, which passed after restoring
the code. Removing keyboard access from the scroll region was rejected by the phone axe regression.
The retained exercises were not changed.
