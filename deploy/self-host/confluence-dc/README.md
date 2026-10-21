# Confluence Data Center user macro

This recipe uses the existing `<live-diagram>` component and a company's self-hosted Live Diagrams.
Confluence supplies the diagram from an attachment or inline JSON. The viewer receives it in memory;
no diagram is put in a viewer URL or uploaded to a public service. This is for Data Center, not Cloud.

## Install once (system administrator)

1. Build and deploy your self-hosted copy following [Self-hosting](../../../docs/SELF-HOSTING.md#confluence-data-center).
   Copy `confluence-dc.js` from this directory into `dist/embed/confluence-dc.js` **after each build**,
   beside the existing `live-diagram.js`. Serve it with the same module-script CORS headers.
2. In **General Configuration → User Macros**, create `live-diagram`, titled **Live Diagram**,
   with **No macro body** and HTML output. Paste [live-diagram.vm](live-diagram.vm) into Template.
   Replace the script URL with your viewer's HTTPS URL, retaining any directory prefix.
   Only the administrator sets this URL; it is never a page parameter.
3. Keep `$htmlUtil.htmlEncode` around every source/height value. JSON is HTML attribute data, never
   executable script or raw HTML. The standard `$htmlUtil` context variable is sufficient; do not
   broaden the Velocity context or disable its method allowlist. Preview the macro and check logs
   for a blocked method on your supported Confluence release.
4. Configure framing, CSP and viewer authentication as described in the linked self-hosting section.
   This does not require enabling the general-purpose HTML macro.

[Atlassian's user macro documentation](https://confluence.atlassian.com/doc/writing-user-macros-4485.html)
describes administrator access, parameters and version-specific Velocity restrictions.

## Add to a page

Export a **Diagram file** from Live Diagrams, attach it to the page, then insert **Live Diagram**.
Use the attachment's download URL for **Diagram source**, for example
`/confluence/download/attachments/12345/order-flow.diagram.json` (retain your context path).
Older `.livediagram.json` files are also accepted.
Absolute URLs must have the same origin as the page. The host fetches with its existing session;
readers still need permission to download the attachment. Do not use a share link or public URL.

Alternatively paste the entire Diagram file JSON into **Diagram source**. Inline data is part of the
page and inherits that page's visibility/history, not a different attachment's restrictions. Prefer
attachments for larger files and version history. Never put diagram data in the shared macro definition.

**Height** defaults to 480 px; integers from 120 to 1600 are accepted. **Click to play** defaults on
and shows a keyboard-accessible **Play diagram** button once loaded. It starts the first saved
simulation, or free play when there is none. Turning it off hides this extra button; the viewer's
own manual Live controls remain available. Both settings always open on a still diagram, even if
the file was saved to play when opened. There is no autoplay parameter.

Macros initialize their viewers only when scrolled into view, reserving the canvas and button space
so the page stays in place. Each loaded frame and Play action is named for its diagram's title
(or **Untitled diagram**). Inline JSON uses the viewer's input limit before parsing.

To edit, download the attachment, edit it in Live Diagrams, and upload a replacement so Confluence
keeps its attachment history. No editor runs inside the macro. For page exports, supply a static
image alongside the diagram; interactive content does not run in exported documents.

## Verify your deployment

Check a restricted page with an authorized reader and a reader without attachment access; the latter
must see an error, never the diagram. Try two macros, inline JSON containing quotes and `<`/`&`,
both click-to-play settings, and your actual context path. Check the browser console for CSP errors.
The automated host-page test covers markup, session-protected attachments, playback and framing;
it does not run Confluence or its Velocity engine. A real-instance administrator smoke check is
still needed for your Confluence version, theme and security configuration.
