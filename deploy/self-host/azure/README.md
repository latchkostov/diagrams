# Azure Static Web Apps

Build with `pnpm build:internal`, generate policies, copy generated `azure/staticwebapp.config.json` into `dist`,
and deploy with no API. Configure build switches in your pipeline. Verify with `--flat` and your allowlist.

The template sets headers/routing only. Add authenticated roles to every protected matching route and a catch-all
last if you need SSO: early header routes must also be protected. Register Entra separately and store credentials
in platform app settings, not in Vite variables or this file. See [the guide](../../../docs/SELF-HOSTING.md#azure-static-web-apps)
for tenant/cookie notes and links to Azure's configuration reference.
