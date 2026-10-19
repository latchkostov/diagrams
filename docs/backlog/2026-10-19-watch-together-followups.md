## Watch together (shared Live P2) follow-ups

- **The live bar while following.** Design §5 has a follower's live bar stay visible but inert: a click opens "Sam
  is driving. [Ask to drive] [Watch on my own]". In P2 the bar works, and the follower's own use of it (play, a
  tweak) means they watch on their own from there, with a note saying so. Make the bar inert when Ask to drive
  arrives (P3).
- **Narration and the follower's camera.** A note that focuses nodes still moves a follower's view as it does in solo
  Live, at the same tick for everyone. Design §3 wants it to move the view only while the follower hasn't moved it
  themselves: a camera-policy row for narration with the owner `manual`.
- **The run's input isn't pinned.** A follower plays the host's ops on its own copy of the diagram, which the room
  keeps in sync. A diagram edit racing the run shows up as a digest mismatch and a rebuild. The design's
  `inputHash` and pinned input (sent when the hashes differ) would make a racing edit cost no rebuild.
- **Only runs whose start is known are shown.** A host who opens a room while already in Live shows nothing until
  their next restart or simulation: the run's start is no longer known, because the log keeps only the latest Inputs
  snapshot. Say so to the host, or offer **Show to the room**, which restarts.
- **A follower's catch-up replays from the start.** That takes about a headless run's time to that point (seconds at
  thousands of nodes). A sendable checkpoint (P7) would shorten long free play.
- **Slow motion stays local,** for the host and followers alike (owner decision 16, P7).
- **The host's view is shared at most four times a second, while in Live,** in presence (its centre and zoom).
  Outside Live it isn't shared.
