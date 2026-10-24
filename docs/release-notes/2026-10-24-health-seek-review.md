## Current health after seeking (#287 review)

Canvas queue attention now uses the controller's checkpointed health window. Seeking into
the retry storm shows the same sustained queue growth as continuous playback, including
while paused; seeking past recovery clears it. Checkpoint health sampling reuses the rendering
snapshot instead of rebuilding it for the same engine state.

All four retry lessons now wait for Continue on their introductory guidance, keeping their
60-second simulation duration. Recovery tests establish the incident first and keep historical
loss and timeout totals after attention clears.

Eight retry-storm goldens change solely to preserve the four introductory `pause: true` flags:
agent describe and edit, native export, draw.io XML and its extracted metadata, both light and
dark HTML exports, and skill script output. Their serialized sizes, hashes and compressed
metadata follow the added flags. Simulation results and drawing geometry remain unchanged.
