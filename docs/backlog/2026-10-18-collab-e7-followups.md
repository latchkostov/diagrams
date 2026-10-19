## Collaboration E7 follow-ups (production switch)

- **Ship: turn the switch on for livediagrams.dev.** Set `VITE_ENABLE_COLLAB=1` in the Vercel project's
  environment variables, then redeploy. The plan's prerequisites still apply: E8 merged, the manual matrix
  recorded, 7 Nightly smoke nights recorded, and the owner's sign-off. The site's CSP already allows the two
  trackers.
- **E8 documents the new variables.** The variables are `VITE_ENABLE_COLLAB`, `VITE_COLLAB_TRACKERS`,
  `VITE_COLLAB_STUN` and `VITE_COLLAB_TURN` (with `_USERNAME` and `_CREDENTIAL`). E8 should:
  - add them to SELF-HOSTING's switch table and its CSP section;
  - say that a TURN username and credential are in the page for anyone who can open it.

  The Helm chart's `build.switches` already accepts them (`imageBuildArgs` checks against
  `DEPLOYMENT_VARIABLES`), but `values.yaml` doesn't list them yet.

- **Query-blind hosts allow the trackers in embeds too.** Netlify, Cloudflare Pages and similar hosts use one flat
  policy for every page. So with rooms on, an embed there is allowed the trackers as well, though it has no rooms.
  This is the same trade-off those hosts already make for framing.
- **Joining needs share links but not link opening.** A copy built with `VITE_DISABLE_LINK_OPEN=1` and rooms on
  still joins room links. If that turns out to matter, decide whether link opening should gate joining.
- **The e2e preview profile has no rooms.** The `subpath` project serves the production build with no variables, so
  it has no rooms. After Ship, consider giving it `VITE_ENABLE_COLLAB=1` so it matches livediagrams.dev.
