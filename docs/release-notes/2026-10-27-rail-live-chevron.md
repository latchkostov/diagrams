## Consistent Workbench actions

In Live, Add and Annotate both wait for Back to editing. Their tooltips and accessible descriptions explain how to add parts or notes, in every supported language. Entering Live closes an open library flyout, and disabled rail items stay out of keyboard navigation.

The zoom controls now show the action their chevron performs: » hides them and « brings them back, mirrored in right-to-left languages. The tooltip and accessible name say Hide zoom controls or Show zoom controls.

The only intentional parity golden change is `node/i18n/catalogs.json`: every locale, including the pseudo-locale, gains two Workbench hint messages and new hashes for the Workbench and chrome areas. The chrome hashes reflect replacing Collapse/Expand toolbar with Hide/Show zoom controls. English fallback counts stay unchanged. Diagram output goldens stay unchanged.
