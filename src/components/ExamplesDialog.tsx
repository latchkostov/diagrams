import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { examples, type Example } from "../examples";
import { exampleFeatures } from "../examples/features";
import { ExampleDiscovery } from "../examples/discovery";
import { Dialog } from "../interop/ui/Dialog";
import { t, useLocale } from "../i18n";
import "../styles/examples.css";

export function ExamplesDialog({
  onClose,
  onOpen,
  onTutorials,
  catalog = examples,
}: {
  catalog?: readonly Example[];
  onClose: () => void;
  onOpen: (slug: string, simulation?: string) => void;
  /** The Tutorials view, where there is one: a link above the examples. */
  onTutorials?: () => void;
}) {
  useLocale();
  const [query, setQuery] = useState("");
  const [feature, setFeature] = useState("");
  const search = useRef<HTMLInputElement>(null);
  const state = useSyncExternalStore(
    ExampleDiscovery.subscribe,
    ExampleDiscovery.getSnapshot,
    ExampleDiscovery.getSnapshot,
  );
  useLayoutEffect(() => {
    // Retry removes its button. Only this still-mounted shell may restore the lost focus.
    if ((state.value === "retrying" || state.value === "loaded") && document.activeElement === document.body)
      search.current?.focus();
  }, [state]);
  return (
    <Dialog
      title={t("topbar.examples")}
      subtitle={t("examples.intro")}
      onClose={onClose}
      testId="examples-dialog"
      width={960}
    >
      <div className="examples-filters">
        <label>
          <span className="sr-only">{t("examples.search")}</span>
          <input
            ref={search}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("examples.search")}
            data-testid="examples-search"
            data-autofocus
          />
        </label>
        <label>
          <span>{t("examples.shows")}</span>
          <select value={feature} onChange={(e) => setFeature(e.target.value)} data-testid="examples-feature">
            <option value="">{t("examples.allFeatures")}</option>
            {exampleFeatures.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label()}
              </option>
            ))}
          </select>
        </label>
      </div>
      <ExampleDiscovery
        kind="gallery"
        catalog={catalog}
        query={query}
        feature={feature}
        onOpen={onOpen}
        onTutorials={onTutorials}
      />
    </Dialog>
  );
}
