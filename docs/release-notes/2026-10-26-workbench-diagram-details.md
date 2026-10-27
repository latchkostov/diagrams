## Diagram details and clearer fits

The app now names diagrams in the bezel. Diagram properties holds the description, privacy badge, reset action and checks link. The first-run hint remains at the canvas bottom. Annotation lessons now spell out the Annotate → tool flow in all 37 locales. Presentation and exported viewers retain their title card because they have no bezel.

Edit fits use the round-3 padding (32px top/left, 40px right, 72px bottom), and presentation uses 56px. Live fits count visible edge-label bounds. The existing floating transport remains protected until step 6; a floating status callout keeps its measured height until that step docks it.

Phone playback and panels leave room for the rail, and expanded Checks findings scroll within the dock. The round-4 dim-stroke token has a 3:1 board contrast contract; the rail credit uses secondary text ink.

## Output parity

No committed goldens changed. The spec reserves recording for step 12. The parity check detected the intended catalog signature change in node/i18n/catalogs.json: new translated Workbench keys and updated tutorial directions change message counts, fallback counts, tutorial hashes and the new Workbench hash. Its browser tier suffered an ENOMEM server failure, so it did not validate the new viewport geometry. That failure is recorded rather than treated as a passing parity run.
