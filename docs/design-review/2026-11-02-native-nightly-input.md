## Input ownership review

The canvas already retains ordinary character keys until a new node's Label can receive them.
Preserve that contract and creation's single Undo step. The keyboard tutorial driver must exercise
the same key path, including the interval before measurement, rather than use direct insertion on
a noneditable canvas. No control, focus rule or chrome is added.

A proposed application beforeinput buffer is rejected: a real Chromium probe shows direct insertion
on the focused canvas emits neither keydown, beforeinput nor input. A synthetic event unit test would
not establish that repair. The source experiment and its synthetic units are removed.

The recurring macOS latency Home observation remains separate. Its trace delivers Home and then
observes scrollTop rise through 11 and 32 to 39 px. Neither a tolerance change nor a speculative
compositor workaround is justified by that trace alone.
