## P-05 implementation UX review

Reviewed candidate A against the P-05 boundary and UX principles. The eager registry owns slug,
title, first simulation and authored short summary/order. Rich descriptions, thumbnails and feature
tags download through one registered `examples.discovery` surface with `export: "skip"`.
Candidate D's matching DEV/E2E metadata construction guard already arrived from master.

## Shell and keyboard ownership

The existing start-row button, summary, chevron and fixed thumbnail frame remain mounted during the
hold. Their pointer cursor and hit boxes survive thumbnail completion. Blank, Open, recent diagrams
and the picker remain available. The browser's frame, search, feature filter and Close/Esc stay outside
the chunk; query/filter state belongs to that shell. The results body retains the previous markup,
order, actions, summaries, thumbnails and tags once loaded. No top-bar control or menu item was added.

Focus restoration belongs to the browser's trigger/search, never to a thumbnail. Late completion
cannot reopen an unmounted card/dialog, switch documents, select anything or fit the camera. When
Retry's toast button disappears, only the still-mounted browser shell restores lost focus to search;
focus already placed on another control remains there. The same controls work with a remembered
language and RTL. Discovery is editor chrome and never participates in visual export readiness.

## Review findings resolved

The required designer review rejected per-card enrichment of the pending gallery: typing a query
could unmount every lifecycle client and suppress Retry; late tags could also move action buttons.
The complete discovery body now stays behind a single surface client even for zero matches. Pending
cards have no actions that can move; clickable start rows retain their reserved thumbnail geometry.
The review also caught that the gallery lives outside the canvas interaction context: shell-owned
search restoration handles Retry there without queuing a canvas focus request on completion.
A final review also covered consecutive Retry failures. The regression passes against the existing
recovery path: Toaster remembers the preceding search control and restores it after its action. Extra
retrying/failed focus logic was rejected as redundant; the shell keeps its successful-completion fallback.

## Verification

The generated held-surface family includes discovery and retains the tutorial hold/fail/Retry cases.
Start-card, examples, lazy-loading, model/image/HTML export and recording integration cases cover
pending controls, query retention, one shared Retry, cancellation, English/RTL, focus and camera.
The geometry test waits for the actual entrance animation and fonts before comparing exact hit boxes.
The held-module unit contract fails when the eager shell is deliberately made to read rich metadata.
Output parity reports 3,151 unchanged goldens. B/C, new interaction controllers, budget increases and
extra lazy surfaces were rejected as unnecessary for the measured startup/canvas reserves.
