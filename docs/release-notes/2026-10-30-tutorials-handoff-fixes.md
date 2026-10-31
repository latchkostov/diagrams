## Tutorial navigation and keyboard fixes

Stay and Escape now release the finish sheet's Escape listener, so later keyboard practice keeps focus on canvas nodes. Cancelling, failing or superseding Start next discards its automatic-start intent; reopening that lesson normally shows its intro.

Exit and All tutorials return to the requested hub even after opening another lesson from Ctrl+K. Exit also works while the tutorial download is pending or failed. Chapter reset keeps keyboard focus inside its confirmation, with only the selected scope radio in the Tab order.

Malformed saved step indexes now fall back to the first step, keeping the tutorial hub and its reset controls usable. Oversized indexes remain clamped to the lesson's last step when displayed.

No parity goldens change: lesson content, translated messages, diagram outputs and rendering remain unchanged.
