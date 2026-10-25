## Owner decisions UX review

The batch adds no top-bar controls. Rate limit belongs inside the existing collapsed Simulation
section and uses the Inspector's ledger field pattern behind its lazy chunk. Its hint names requests
per second, and its collapsed summary reports the quota. Live node double-click opens Properties
without entering naming; editing retains selected-name entry. Unconfigured rooms explain the missing
collaboration setup and link to the existing self-hosting guide instead of Retry. Export help
distinguishes narrated recordings from SVG diagrams.

The required designer-agent source review identified request-sequence reuse after opening Properties,
inconsistent Rate limit wording, and outdated gesture help. These were corrected, with a regression
for editing rename → Live Properties → editing rename. The consumer action keeps its button and
generic test target; its nested specific alias is a click/highlight target for the tutorial, adding no
tab stop. A regression checks that clicking it invokes the existing consumer action.

The production Inspector capture confirms that Rate limit aligns with the existing ledger and
updates the capacity readout. The format explanation stays on the SVG option as a tooltip and
accessible description: an extra dialog paragraph was rejected after parity caught hover paint
when the changed dialog geometry put the pointer over a connection during export. Existing
image goldens remain unchanged.
