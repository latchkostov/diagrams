// What the agent skill runs from the app, bundled by `pnpm schemas` into
// skills/livediagrams/scripts/lib/app.mjs so the skill's scripts use the app's own rules on plain Node:
// the native file validator (what the app accepts, repairs or refuses when it opens a file or a share
// link), its simulation and annotation checks, and the layout.

export { validateDiagram, simulationProblem, LIMITS } from "../../interop/native";
export { annotationGeometryError } from "../../model/annotations";
export { layoutDiagram } from "./layout";
// The Interactive HTML viewer's own check of its payload (export-html.mjs refuses a file the viewer wouldn't show).
export { parsePayload, PAYLOAD_LIMITS } from "../../export/viewer/payload";
// Password-protected HTML (export-html.mjs --password): the app's own encryption, with password links' parameters.
export { lockedFileName, lockPayload, unlockPayloadText, MIN_PASSWORD_LENGTH } from "../../export/lock";
export { passwordStrength } from "../../interop/passwordStrength";
