# Security policy

Live Diagrams covers the web app at livediagrams.dev, the Confluence app (Live Diagram for Confluence),
the Live Diagrams skill and plugin for Claude, and the self-hosted images and Helm chart in this repository.

## Reporting a vulnerability

Please report security issues privately through GitHub:
**[Report a vulnerability](https://github.com/latchkostov/diagrams/security/advisories/new)**
(the repository's Security tab → _Report a vulnerability_). Don't open a public issue for a security
problem, and never attach private or work diagrams to a report.

Include what you found, how to reproduce it, which part is affected (web app, Confluence app, Claude
skill or self-hosted server) and the impact you expect. You'll get an acknowledgement, and fixes are
released from `master`; the report stays private until a fix is out.

## Supported versions

Only the latest version is supported: the live site, the current Confluence app release, and the
latest commit of the skill and self-hosted images on `master`.

## Scope notes

- The web app and the Confluence app run in the browser and have no Live Diagrams backend or account
  system; the Confluence app runs on Atlassian Forge with the reader's own Confluence permissions.
- The Claude skill's scripts run locally and make no network requests.
- Third-party services (Atlassian, GitHub, Vercel, storage providers) have their own security programmes;
  report issues in them to those vendors.

## Incident response

If a security incident or a critical vulnerability affects Live Diagrams (for example, a flaw that could expose
or alter diagram content in the Confluence app), the maintainer follows these steps:

1. **Contain.** Stop the harm first: roll back or disable the affected Confluence app version, revert the
   affected release of the web app, skill or images, and revoke any credential that might be involved.
2. **Assess.** Work out what is affected, since when, which users and data, and whether it is still exploitable.
   Keep a timestamped record of what was found and done.
3. **Notify.** For the Confluence app, notify Atlassian through the ecosystem service desk
   (ecosystem.atlassian.net), following Atlassian's
   [security incident management guidelines](https://developer.atlassian.com/platform/marketplace/app-security-incident-management-guidelines/),
   and notify affected customers using Atlassian's
   [vulnerability notification template](https://developer.atlassian.com/platform/marketplace/app-vulnerability-notification-template/).
   Report the private details only through those channels, never in a public issue.
4. **Fix and release.** Release the fix from `master` within the timeframes in Atlassian's
   [security bug fix policy](https://developer.atlassian.com/platform/marketplace/security-bugfix-policy/),
   then confirm it with the reporter where possible.
5. **Follow up.** Publish a security advisory once the fix is out, and record what changed to prevent a repeat.

The maintainer is the security contact and holds an account on ecosystem.atlassian.net.
