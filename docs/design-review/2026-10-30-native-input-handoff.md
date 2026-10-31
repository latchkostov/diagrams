## Review

Reviewed the stencil library, quick-add and pending name handoffs against the keyboard and text-editing contracts. Typing and Enter retain their order across downloads; subsequent text belongs to the newly picked node. Escape finishes naming and keeps the text, as it does after the inspector field arrives. Closing a pending surface releases its input capture.

No controls, messages, menu entries or persistent settings are added. The chrome budget and progressive disclosure remain unchanged. Tests hold the actual downloaded modules instead of adding waits or reducing their assertions.
