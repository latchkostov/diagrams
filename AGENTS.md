# Diagrams

Free, open tool for distributed-systems diagrams with a live message-flow simulation.
Vite + React 19 + TypeScript + React Flow. Design docs: `docs/PLAN.md`, `docs/SIMULATION.md`,
`docs/SIMULATIONS.md`; contracts: `src/model/types.ts`, `src/sim/types.ts`.

## Private work diagrams: never commit, publish, or bundle

`src/examples/private/` holds local-only diagrams of the owner's employer's real systems. They are the
owner's working reference and stay on this machine.

- Never commit them, copy them elsewhere in the repo, quote their names in code, tests, docs, commit
  messages or screenshots, or include them in a production build.
- They load only in dev (`import.meta.env.DEV` in `src/examples/index.ts`). Code that needs them must glob
  `../examples/private/*.json` generically, never by file name.
- Guards: `.gitignore`, a production build check in `vite.config.ts` (`noPrivateExamples`), and a local
  pre-commit hook. If a guard blocks you, remove the private content. Never bypass the guard.

## Commands

- `pnpm dev`, `pnpm build`, `pnpm test` (Vitest), `pnpm test:e2e` (Playwright), `pnpm check` (all)
- Output parity (`docs/PARITY.md`): `pnpm parity` checks every output against committed goldens. A feature PR that
  changes output on purpose runs `pnpm parity:update` and explains the goldens' diff in its description. The browser
  tier runs in Playwright's Linux image, so Docker must be running; `pnpm parity:node` needs no Docker.

## UX

Follow `docs/UX-PRINCIPLES.md`: simple by default, customizable on demand. Before adding a control,
check the chrome budget and prefer context menus and the inspector. Every feature batch ends with a UX review.

## Conventions

- UI tests select only by `data-testid`; give every interactive element one.
- The browser context menu is never shown; use the action registry in `src/editor/actions.ts`.
- The production build runs under a strict Content-Security-Policy (`scripts/security-headers.ts`, which generates
  `vercel.json` and is served by `vite preview`): no inline scripts or `eval`, and a new outside endpoint goes in
  its connect-src. `tests/e2e/csp.spec.ts` fails on any violation.
- New previews and test fixtures go in the Lab (`src/lab/presets.tsx`, `?view=lab`).
- The agent skill (`skills/livediagrams/`) is partly generated: run `pnpm schemas` after changing the catalog,
  the file format or the layout (`scripts/skill-gen.ts`; `src/ai/skill/skill.test.ts` fails when it is stale).
- The skill's HTML-export viewer (`skills/livediagrams/scripts/lib/viewer-template.html`, `icons.json`) is
  refreshed only by `pnpm skill:release` (it also bumps the plugin version): run it when Claude Code users should
  get the latest viewer. The site's `/skill/` and zip are always built fresh; `pnpm skill:check` reports staleness.
