# AI integration notes (front-ends → core)

Requests from the front-end lane (Build with AI dialog, WebMCP, schemas) for the `src/ai/` core. The
front-ends work today without them; each one makes something sturdier or nicer.

1. **Alternatives for unsure stencils.** `resolveKind` often returns `confidence: "medium"` (or `"low"`)
   with `alternatives: []`: ".NET consumer" → service.dotnet, "Postgres writer" → postgres, "gizmo" →
   generic.service. The dialog's one-click swap only works with alternatives, so please always offer up
   to 3 when the confidence isn't high (e.g. other `searchStencils` hits for each word of the kind, or
   same-category neighbours of the pick).
2. **The failed reference on the error.** The dialog's "pick a candidate to apply" needs the reference
   that failed. It currently parses it from the message (`"billing" matches 2 elements.` /
   `Unknown reference "x".`, see `failedRef` in `src/ai/ui/apply.ts`). Please add `ref?: string` to
   `AiError` (and keep the message wording).
3. **Summary wording.** `applyOps` returns `summary: "N operations applied"`; the spec's toast wants
   "+3 nodes, +2 connections". The front-ends compute it from a diff that ignores position-only changes
   (`diffDiagrams`/`summarize` in `src/ai/ui/apply.ts`). `editor/diagramDiff.ts` counts moves as
   "updated", so an `auto` layout that moves nothing but a full layout reports "12 updated". If the core
   adopts the same rules, the UI can use `result.summary` directly.
4. **Placement next to boundaries.** Adding a node connected to a node inside a boundary placed it inside
   the boundary's box without being a member (Kafka example: a queue after "Order service" landed in the
   AKS box). Either add it to the boundary (`group`) or keep it outside the box.
5. **Tool annotations** (readOnlyHint, untrustedContentHint, consequentialHint) aren't in `schemas.ts`;
   they live in `src/ai/webmcp/tools.ts` per section 4 of the research doc. Move them to the core if the
   npm MCP package (phase 3) should share them.
6. **diagram.v1 JSON Schema.** There's no core export for the file format's schema, so
   `src/ai/webmcp/publicSchemas.ts` builds `public/schema/diagram.v1.json` from `src/model/types.ts`
   (by hand, enums from the code). Happy to move it to the core.
7. **Schemas are generated.** `public/schema/*.json` is written by `pnpm schemas` (and by `pnpm build`)
   from `schemas.ts` and the catalog; a unit test fails when the committed files are stale. After
   changing tool schemas or the catalog, run `pnpm schemas`.
