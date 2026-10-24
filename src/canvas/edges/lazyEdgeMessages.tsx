import { defineLazySurface } from "../../lib/lazySurface";

/** The same intent reader in editor, read-only and Lab canvas hosts. */
export const EdgeMessages = defineLazySurface({
  id: "edge.reader",
  load: () => import("./EdgeMessages").then((m) => m.EdgeMessages),
  placeholder: { size: {}, testId: "edge.reader-loading" },
  focus: {},
  export: "skip",
  retryToast: true,
});
