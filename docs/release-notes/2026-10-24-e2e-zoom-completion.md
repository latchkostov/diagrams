## Wait for the exact chosen zoom

The bootstrap-fit regression now advances its paused clock until the 100% zoom
command reaches exactly `scale(1)`. This replaces a fixed clock advance that could
read the final animation frame too early. The exact zoom and unchanged viewport
assertions remain intact. No application behavior or output goldens change.
