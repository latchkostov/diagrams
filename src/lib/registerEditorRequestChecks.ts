import { registerRequestChecks } from "./requestCheckProvider";

/** Keep the editor's lazy worker registration outside the provider module the worker itself reads. */
export function registerEditorRequestChecks(): void {
  registerRequestChecks((d, options) =>
    import("../canvas/checks/runner").then((m) => m.requestChecksOffThread(d, options)),
  );
}
