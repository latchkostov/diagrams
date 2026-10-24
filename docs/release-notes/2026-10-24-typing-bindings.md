## Keep autoscaling bindings while editing text

Editing a node's label, subtitle or description keeps autoscaling source choices, binding hints and
policy readouts intact. The inspector uses the editor's stable current-document reader during typing,
preserving render isolation without losing graph context. Selected-node chip updates also reuse edge
comparisons when the edge array has not changed. No output goldens changed.
