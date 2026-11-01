## Menu input releases deferred camera work

Round-four diagnostic Nightly 41249763740 repeats macOS Kafka's keyboard failure with the canvas reporting camera `deferred` and interaction `menu-open`. The raw-key driver waits for camera `idle` before sending the menu's Enter. The camera correctly defers pane work until menu close; the existing camera controller unit explicitly verifies this contract. Waiting for idle here prevents the input that releases it.

Raw recipe keys now wait for camera idle or for its explicit menu-owned deferral. Other pending/animating camera work remains a barrier. A deterministic browser fixture reproduces those published owner states and requires Enter to confirm exactly once and release the deferral. Temporarily restoring the unconditional idle wait fails this regression. Full keyboard/native-select Linux repetitions and native group-four results are recorded in the verification fragment and PR.

The product's camera policy, keyboard routing, all lesson completion assertions, timeouts and tolerances remain unchanged. General removal of the camera wait was rejected because canvas keys still need the settled frame.
