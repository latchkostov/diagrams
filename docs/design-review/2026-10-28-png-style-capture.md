## PNG style capture

Reviewed against the UX principles: this changes export preparation only. File menu commands,
image options, progress, Cancel and the presentation picture retain their existing behavior.
No controls or text are added. Resource styles stay on the detached clone until font and image
embedding completes; the original canvas stays available to the existing export cleanup.

The review rejects changing downloadable SVG styles, reducing visual detail, increasing raster
tolerances, or adding a fast-export option. The shared PNG representation is an internal detail.
The existing export, cancellation, resource and collaboration browser checks cover the visible contract.
