## Live authoring lazy loading

Reviewed against progressive disclosure, chrome budget and keyboard behavior: no new controls or
menu entries. The loading panel uses the existing drawer geometry and translated Loading, Close,
download-failure and Retry messages. Close and Esc dismiss a pending panel without leaving Live;
the downloaded editor appears only if the panel is still open. The authoring component and its
working-copy behavior are unchanged. Production browser regressions hold the chunk download,
exercise both dismissal paths, then reopen the editor after release.

Kept the existing playback timeline and latency readout eager within Live: deferring the simulation
editor already exceeds the requested 3 kB headroom and avoids extra loading boundaries for playback
and hover details. The build regression checks the complete static import closure, including shared
chunks, so an accidental eager import cannot silently restore these authoring modules.
