## Chunk readiness precedes keyboard return

Baseline Nightly 41253920016 fails Linux Build's canvas.presence Retry at the final immediate body-focus assertion. The surface is decorative and has no focus field. Its Retry toast deliberately returns focus to the invoker on requestAnimationFrame, after the failed toast unmounts; the chunk's loaded state is an earlier signal.

The Retry driver now requires the exact example-picker invoker to regain focus for this surface. All other surfaces, saved-document equality, keyboard actions and the final non-body assertion remain. A real presence failure/retry regression pauses the page clock across the toast's actual return frame and acknowledges the driver's loaded stage before checking that it remains pending. Restored: native Windows passes. Temporarily removing only the focus acknowledgement fails with returned=true before that frame.

The first regression observed the outer state poll before the driver's own loaded stage, so its negative run was inconclusive. The explicit stage removes that race. No application focus policy, frame delay, timeout, tolerance, skip, quarantine or golden changes.
