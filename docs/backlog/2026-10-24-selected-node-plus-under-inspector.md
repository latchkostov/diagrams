## Keep the selected node's + clear of the inspector

The building-block tutorial browser solutions exposed a selected-node placement issue:
after a connected node is added, selecting it can leave its right-side + beneath the
inspector's resize handle. Playwright reports pointer interception by `inspector-resize`.
This occurred on the gateway and Kafka-topic solution paths at the next downstream add.

The tutorials explicitly use Fit view before the next + and explain that control in
their hint. The canvas/camera lane should keep the selected node and its grow affordance
inside the usable pane after the inspector opens. Add a direct camera regression using
an invented chain and the normal inspector width; do not relax pointer-hit assertions.
