## Message controls and live hover review

Message filters and renames belong behind a separate **Messages** disclosure in the selected connection's
inspector. This keeps the existing Request keyboard pass intact, avoids suggesting simulation controls on
competing broker routes, and adds no global chrome. Both disclosures retain the existing remembered-open
behavior. The message loader and the Request loader remain independent; retry UI stays outside either chunk.

Connection labels and lines now open the same live readout. No summary content, frame dimensions, scrolling
assertion, or hover delay was changed. Enlarging the summary or replacing line targets in its regression was
rejected. The webhook callback also crossed the dead-letter route at its centre; top ports place the callback
above the nodes, leaving the dead-letter route directly reachable under the original regression's pointer.

The agent assertion's check count changes deliberately because the branch adds message-loop detection.
Findings, saved ignores, and privacy assertions stay exact. Simulation, capacity, and Request keyboard
assertions are unchanged.
