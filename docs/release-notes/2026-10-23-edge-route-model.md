## Saved line routes

Files can now retain up to 64 orthogonal inner corners per connection. Saved bends render in all three line styles, keep automatic lines from nudging them, survive native save, clipboard offsets, reversing and collaboration, and extend image bounds. Route > Reset route and Advanced > Route > Reset clear only the bends in one undo step; pinned sides stay. The Lab has a Hand-shaped lines preset.

Pointer shaping, node-move carry, keyboard/touch shaping and agent/draw.io authoring remain in later roadmap PRs. Live particles follow the drawn path; travelMs is unchanged, so a longer route moves its particles faster.

## Output parity

No pre-existing golden changes. The 35 additions all belong to the hand-shaped-lines corpus fixture. Original schema/catalog/skill metadata remain as compatibility projections; separate full extension records pin the additive contract, so coverage is retained.

| New golden                                                  | What it pins                                                                                 |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `browser/html/corpus-hand-shaped-lines.dark.drawn.json`     | Interactive HTML payload, shell, read-only geometry or rendered image.                       |
| `browser/html/corpus-hand-shaped-lines.dark.html`           | Interactive HTML payload, shell, read-only geometry or rendered image.                       |
| `browser/html/corpus-hand-shaped-lines.dark.json`           | Interactive HTML payload, shell, read-only geometry or rendered image.                       |
| `browser/html/corpus-hand-shaped-lines.dark.png`            | Interactive HTML payload, shell, read-only geometry or rendered image.                       |
| `browser/html/corpus-hand-shaped-lines.default.html`        | Interactive HTML payload, shell, read-only geometry or rendered image.                       |
| `browser/html/corpus-hand-shaped-lines.default.json`        | Interactive HTML payload, shell, read-only geometry or rendered image.                       |
| `browser/images/corpus-hand-shaped-lines.dark.png`          | Light/dark SVG geometry, PNG pixels or image metadata, including the outlying bends.         |
| `browser/images/corpus-hand-shaped-lines.dark.png.json`     | Light/dark SVG geometry, PNG pixels or image metadata, including the outlying bends.         |
| `browser/images/corpus-hand-shaped-lines.dark.svg.json`     | Light/dark SVG geometry, PNG pixels or image metadata, including the outlying bends.         |
| `browser/images/corpus-hand-shaped-lines.dark.svg.txt`      | Light/dark SVG geometry, PNG pixels or image metadata, including the outlying bends.         |
| `browser/images/corpus-hand-shaped-lines.light.png`         | Light/dark SVG geometry, PNG pixels or image metadata, including the outlying bends.         |
| `browser/images/corpus-hand-shaped-lines.light.png.json`    | Light/dark SVG geometry, PNG pixels or image metadata, including the outlying bends.         |
| `browser/images/corpus-hand-shaped-lines.light.svg.json`    | Light/dark SVG geometry, PNG pixels or image metadata, including the outlying bends.         |
| `browser/images/corpus-hand-shaped-lines.light.svg.txt`     | Light/dark SVG geometry, PNG pixels or image metadata, including the outlying bends.         |
| `browser/layout/corpus-hand-shaped-lines.json`              | Layout/Tidy positions and resulting paths; node-move carry/reset remains PR 4.               |
| `browser/render/corpus-hand-shaped-lines.json`              | Measured canvas drawing, port fan-out, paths and labels.                                     |
| `node/agent/check/corpus-hand-shaped-lines.json`            | Checks, planning or agent output for the new fixture; agent waypoint authoring is unchanged. |
| `node/agent/describe/corpus-hand-shaped-lines.json`         | Checks, planning or agent output for the new fixture; agent waypoint authoring is unchanged. |
| `node/checks-words/corpus-hand-shaped-lines.json`           | Checks, planning or agent output for the new fixture; agent waypoint authoring is unchanged. |
| `node/checks/corpus-hand-shaped-lines.json`                 | Checks, planning or agent output for the new fixture; agent waypoint authoring is unchanged. |
| `node/exports/drawio-meta/corpus-hand-shaped-lines.json`    | Native geometry and existing converter output; dedicated draw.io bend support remains PR 6.  |
| `node/exports/drawio/corpus-hand-shaped-lines.drawio`       | Native geometry and existing converter output; dedicated draw.io bend support remains PR 6.  |
| `node/exports/mermaid-plain/corpus-hand-shaped-lines.mmd`   | Native geometry and existing converter output; dedicated draw.io bend support remains PR 6.  |
| `node/exports/mermaid-read/corpus-hand-shaped-lines.json`   | Native geometry and existing converter output; dedicated draw.io bend support remains PR 6.  |
| `node/exports/mermaid/corpus-hand-shaped-lines.mmd`         | Native geometry and existing converter output; dedicated draw.io bend support remains PR 6.  |
| `node/exports/native-meta/corpus-hand-shaped-lines.json`    | Native geometry and existing converter output; dedicated draw.io bend support remains PR 6.  |
| `node/exports/native/corpus-hand-shaped-lines.diagram.json` | Native geometry and existing converter output; dedicated draw.io bend support remains PR 6.  |
| `node/i18n/corpus-hand-shaped-lines.json`                   | The added Route catalog area and fallback counts in every language.                          |
| `node/layout/corpus-hand-shaped-lines.json`                 | Layout/Tidy positions and resulting paths; node-move carry/reset remains PR 4.               |
| `node/planning/corpus-hand-shaped-lines.json`               | Checks, planning or agent output for the new fixture; agent waypoint authoring is unchanged. |
| `node/routes/corpus-hand-shaped-lines.json`                 | Orthogonal, straight and Bezier paths, fixed sides and labels.                               |
| `node/sim/corpus-hand-shaped-lines/free-play.json`          | Deterministic free-play result for the new fixture.                                          |
| `node/skill/corpus-hand-shaped-lines.files.json`            | Full new schema/spec/reference fingerprints or validation of the new fixture.                |
| `node/skill/corpus-hand-shaped-lines.public-schemas.json`   | Full new schema/spec/reference fingerprints or validation of the new fixture.                |
| `node/skill/validate/corpus-hand-shaped-lines.txt`          | Full new schema/spec/reference fingerprints or validation of the new fixture.                |
