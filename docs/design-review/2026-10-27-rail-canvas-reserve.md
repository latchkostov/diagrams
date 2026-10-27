## Canvas reserve fix review

The rail keeps the same labels, disabled states, tooltips and accessible descriptions in Live and Edit. Native titles supply descriptions separately from the buttons' accessible names. The browser regression checks descriptions in English, Arabic and the pseudo-locale. Zoom chevrons keep their direction, RTL mirroring and focus behavior.

The history refactor preserves button order, shortcuts, labels and enabled states. The Lab fallback remains available in development and E2E builds; production uses the existing bezel. This adds no chrome or lazy surface.
