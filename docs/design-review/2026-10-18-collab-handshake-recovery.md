## Collaboration recovery

Automatic recovery moves focus from disappearing Retry or Save a file copy controls to the existing room status
through the interaction controller. Focus elsewhere stays put. Recovery requires no additional controls or manual
steps. Disconnect and Connect retain the edited document for the same room without reseeding it; a new room starts
with its own diagram.

The designer-agent source review found no blocking UX issues. The patch adds no chrome or terminology and preserves
the existing Lab layout. Regression coverage checks both banner controls, focus outside the banner, retained edits,
continued editing and new-room isolation. The review inspected source and test coverage; browser validation is
recorded separately in the release note.
