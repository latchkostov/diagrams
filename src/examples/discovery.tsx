import { defineLazySurface } from "../lib/lazySurface";
import type { Example } from "./index";
import { t } from "../i18n";

export interface DiscoveryGalleryProps {
  kind: "gallery";
  catalog: readonly Example[];
  query: string;
  feature: string;
  onOpen: (slug: string, simulation?: string) => void;
  onTutorials?: () => void;
}
export type ExampleDetailsProps = { kind?: "thumbnail"; slug: string; testId: string } | DiscoveryGalleryProps;

export const ExampleDiscovery = defineLazySurface<ExampleDetailsProps>({
  id: "examples.discovery",
  load: () => import("./ExampleDetails").then((module) => module.ExampleDetails),
  placeholder: {
    render: (props, status) =>
      props.kind === "gallery" ? (
        <p role="status" data-testid="examples-loading" aria-busy={!status.failed}>
          {t("common.loading")}
        </p>
      ) : null,
  },
  // The shell owns search and trigger restoration. Decorative completion never requests focus.
  focus: { restoreTo: "examples-search", panel: "examples-dialog" },
  export: "skip",
  retryToast: true,
});
