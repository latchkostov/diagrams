## Save ownership fix review

Save honours the content the user asked to write, even while another diagram opens or an example becomes
an owned copy. Existing document-session tracking binds the destination to the initiating document.
Unexpected aborts use the existing error toast. Explicit picker cancellation and tutorial lifecycle
cancellation remain quiet. No controls, menus or additional chrome are introduced.

Deferred-stream regressions check actual stream closure, captured bytes and destination isolation;
sequence conversion tests settle the pending conversion before checking cancellation and attribution.
