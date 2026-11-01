## Browser fades outlive the fake camera clock

Baseline Nightly 41245495563 fails macOS's light retry Follow contrast at 2.331 against the unchanged 3:1 floor. Its trace clicks Follow and captures 129 ms later, during the existing 350 ms CSS transition. Advancing the fake JavaScript clock settles camera state but does not finish native CSS animation time.

The camera capture helper now awaits the canvas subtree's actual finite Animation.finished promises after camera and decoration commits. Endless live decoration is excluded, and cancelled transitions settle normally. No product duration, colour, contrast floor or screenshot tolerance changes.

A real-browser regression pauses a finite Web Animation beside an endless animation. Capture must remain pending until the held fade finishes and then return without waiting for the endless animation. Removing the finite-animation wait makes the regression fail. Native and Linux repetitions are recorded in the round-four verification fragment and PR.
