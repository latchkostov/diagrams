# Security policy

Live Diagrams covers the web app at livediagrams.dev, the Confluence app (Live Diagram for Confluence),
the Live Diagrams skill and plugin for Claude, and the self-hosted images and Helm chart in this repository.

## Reporting a vulnerability

Please report security issues privately through GitHub:
**[Report a vulnerability](https://github.com/latchkostov/diagrams/security/advisories/new)**
(the repository's Security tab → *Report a vulnerability*). Don't open a public issue for a security
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
