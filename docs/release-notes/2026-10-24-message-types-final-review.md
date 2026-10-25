## Message type rule history and accessible searches

All processor rules appended in an open inspector stay visible and editable through successive Add, Rename, Undo and Redo operations. One snapshot registry follows the mounted editor's history; rendering remains limited to the requested page plus appended rules still in the document.

The Carries and Only pass searches now announce distinct accessible names. Picker tests require both Add and Finish transitions, and a two-canvas regression checks each SVG line's vocabulary and title cleanup after hover and focus leave.

The only changed golden is `node/i18n/catalogs.json`: the two accessible-name keys add two messages and change the `messageTypes` area hash in each catalog. Untranslated catalogs gain two English fallbacks; `en-XA` gains none. The other two targeted i18n goldens are unchanged. Saved diagrams and simulation output are unchanged.

Verification: 142 message-type unit tests and 37 production-build Chromium tests passed. Restoring the old row implementation fails 10 of 12 history cases; removing either picker transition, restoring duplicate search names or restoring the global SVG lookup also fails its regression. Canvas first-view gzip is 374,798 B against 383,000 B, leaving 8,202 B headroom. The full gate is left to PR CI under the fix-round instructions.
