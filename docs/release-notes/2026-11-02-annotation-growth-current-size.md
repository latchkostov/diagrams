## Preserve annotation size during text edits

Editing a note or text annotation no longer lets a delayed measurement shrink a larger committed box.
Auto-growth compares with the current node height, including while React Flow still publishes its previous
measured dimensions. Genuine overflow still grows the box. This repairs the recurring native macOS reload
failure where a 20,000 px note reopened at 9,238 px.

The component regression renders new text with stale measured dimensions and reads the result through the
real editor/persistence conversion. It fails with the original growth code (20,000 becomes 9,000 in the
fixture), and passes after the repair. Full output parity passes all 3,178 goldens unchanged; none is
recorded or updated.
