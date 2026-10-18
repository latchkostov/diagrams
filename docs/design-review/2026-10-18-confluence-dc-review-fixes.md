## Confluence Data Center review fixes

The existing optional Play action remains the only macro action. Loaded diagram titles distinguish
frames and buttons in screen-reader navigation; an empty title falls back to Untitled diagram.
Saved simulations behave consistently for inline and attachment sources without autoplay.

The UX review identified a page shift when a deferred macro revealed its button. The template now
reserves the canvas height and retains the disabled button in layout before initialization.
Browser tests compare macro heights before and after scrolling into view, verify independent
titles and still playback, and confirm an off-screen macro has no viewer frame.

Native iframe lazy loading alone was rejected because it still constructs the host component and
can eagerly fetch attachment data. IntersectionObserver keeps the component inert in a template
until the macro reaches the viewport; the iframe retains loading="lazy" too.
