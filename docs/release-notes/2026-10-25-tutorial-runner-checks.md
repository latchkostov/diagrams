## Tutorials: path checks, edit-preserving patches and metric expressions

The tutorial format can now say more as plain data, so lessons built on real examples keep their checks:

- **Prop paths.** A prop check takes a path of keys, list indices and `where` matches
  (`["settings", 4, "secret"]`), and `measure: "length"` compares a list's length. Paths read own properties only.
- **Edit-preserving patches.** A `patch` demo sets a value, sets it only if missing, or ensures a list has a matching
  item. It writes only what's missing as one edit, so the learner's other settings stay as they are, and Skip never
  repeats it.
- **Metric expressions.** A `compare` check compares two Live numbers, or one with a constant: a subject's reading, a
  sum over named subjects, over every node a subject spec fits, over edges between subjects or every flow out of one.
  `sinceStep` counts from the step's start. Its baseline is read when the step becomes current, kept in the step
  runner's state, emptied by Skip and Restart, and a restarted run counts from zero. Only sticky steps can use it.

Skip on a step that adds a node and then names it now waits for the editor to commit the node before naming it. The
completion sweep runs Live as the real controller, so metric checks (replicas included) can be judged there. It also
sweeps fixture lessons for each new form through the same cases as the catalog. The authoring lint checks paths,
patches, `every` specs and `sinceStep` on sticky steps. No learner-facing UI changes.
