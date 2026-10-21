## Confluence macro UX review

The separate macro view has one primary action, **Play diagram**, above a still, fitted diagram.
The button works with keyboard activation; playback never starts from loading or a file preference.
Pan/zoom and playback reuse the existing read-only viewer. The Forge build removes outbound attribution
links; main-app and standalone viewer behavior is unchanged.

Configuration contains attachment, simulation, height and theme, with file upload/replacement nearby.
Save is the primary completion action and Cancel remains available on load/permission failure.
Replacing names its target through the attachment picker; the adjacent warning explains immediate
uploads, version history and the fact that Cancel does not undo an upload. Errors are announced and
give the reader/editor a next step, with no cached/public fallback for inaccessible data.

Inline React Flow styles are explicitly permitted; scripts, fonts and all assets are local. Automatic
height follows the viewer's bounded size report, explicit height remains fixed, and Confluence's theme
updates via the bridge. Narrow-column layout, real host auto-resizing, access changes and live-doc
behavior still require the owner's dev-site checklist; offline tests do not certify those platform behaviors.

The designer review identified two recovery problems: Cancel was delayed until loading completed,
and a removed saved simulation left Save disabled after selecting Free play. Both are fixed and
covered by browser regressions, including stalled context/list/download calls. A startup theme race
is covered too: the viewer cannot reset Confluence's selected theme.
