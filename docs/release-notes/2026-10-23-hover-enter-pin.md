## Enter pins the hovered card

When a Live card is open because the pointer is on a node or connection, and the pointer moved there after the last key press, Enter pins that card, as its footer says. It no longer presses whichever control kept keyboard focus, such as the Live button that started Live and would have turned it off. Text fields, editors, menus and dialogs keep their own Enter, and keyboard-only use is unchanged: any key press makes the keyboard the latest input, so a node reached with Tab still pins its own card with Enter.

## Hover summary without a scroll bar

The Live hover summary no longer shows a scroll bar. Its three section rows stacked 4 px taller than the card's fixed frame; the rows are now 26 px, so the whole summary fits at the same size. A summary also never scrolls when a short viewport caps its height: it shows fewer section rows instead. A pinned card still scrolls only when the viewport is too short for its open section.
