import { useEffect, useLayoutEffect, useRef, useSyncExternalStore, useState, type ComponentProps } from "react";
import { defineLazySurface } from "../lib/lazySurface";
import { rememberCanvas, takePendingStencils } from "../lib/canvasBridge";
import type { Palette as PaletteComponent } from "./Palette";
import { useInteraction } from "./interaction";
import { t, useLocale } from "../i18n";

type Props = ComponentProps<typeof PaletteComponent>;
const Contents = defineLazySurface<Props>({
  id: "canvas.stencils",
  load: () => import("./Palette").then((m) => m.Palette),
  placeholder: { render: (props, status) => <PaletteLoading {...props} failed={status.failed} /> },
  focus: { field: "palette-search", panel: "palette" },
  export: "skip",
  retryToast: true,
});

export function Palette(props: Props) {
  useLocale();
  const [query, setQuery] = useState("");
  // Gallery handoff belongs to the canvas even when its stencil library has never opened.
  const onAdd = useRef(props.onAdd);
  useLayoutEffect(() => {
    onAdd.current = props.onAdd;
  });
  useEffect(() => {
    const timer = setTimeout(() => {
      const slug = new URLSearchParams(window.location.search).get("example");
      if (slug) rememberCanvas(slug);
      for (const id of takePendingStencils()) onAdd.current(id);
    }, 260);
    return () => clearTimeout(timer);
  }, []);
  const state = useSyncExternalStore(Contents.subscribe, Contents.getSnapshot);
  // Once downloaded, keep the instance across folding so its query, family and scroll survive.
  return !props.collapsed || state.value === "loaded" ? (
    <Contents {...props} initialQuery={query} onInitialQuery={setQuery} />
  ) : null;
}

function PaletteLoading(props: Props & { failed: boolean }) {
  const interaction = useInteraction();
  const input = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    const field = input.current;
    return () => {
      if (document.activeElement !== field) return;
      queueMicrotask(() => {
        if (document.activeElement === document.body) interaction?.dispatch({ type: "tool.focus", cause: "library" });
      });
    };
  }, [interaction]);
  return (
    <aside className={props.mode === "flyout" ? "palette is-flyout" : "palette"} data-testid="palette">
      <label className="field">
        <input
          ref={input}
          data-testid="palette-search"
          name="palette-search"
          autoComplete="off"
          spellCheck={false}
          aria-label={t("library.findAStencil")}
          placeholder={t("library.findAStencil")}
          value={props.initialQuery}
          onChange={(event) => props.onInitialQuery?.(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && props.initialQuery) {
              event.preventDefault();
              event.stopPropagation();
              props.onInitialQuery?.("");
            }
          }}
        />
      </label>
      <span data-testid="palette-loading" role="status" aria-busy={!props.failed}>
        {props.failed ? t("fileDialog.loadFailed") : t("common.loading")}
      </span>
    </aside>
  );
}
