import { defineLazySurface } from "../../lib/lazySurface";

/** Free-form properties are only needed after Advanced opens. */
export const PropsEditor = defineLazySurface({
  id: "inspector.properties",
  load: () => import("./PropsEditor").then((m) => m.PropsEditor),
  placeholder: { size: {}, testId: "inspector.properties-loading" },
  focus: {},
  export: "skip",
  retryToast: true,
});
