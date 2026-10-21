import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { LiveHandle } from "../../live/LiveView";
import type { CanvasViewerOptions } from "../../canvas/CanvasView";
import { HostCanvasBridge, ViewerCanvas } from "../../interop/embed/ViewerCanvas";
import { ViewerAdapter } from "./adapter";
import { ViewerControls } from "./ViewerControls";
import { t } from "../../i18n";
import { SettingsProvider } from "../../harness/SettingsProvider";
import { Toaster } from "../../interop/ui/Toaster";

export function BundleApp({
  adapter,
  attribution,
}: {
  adapter: ViewerAdapter;
  attribution?: CanvasViewerOptions["attribution"];
}) {
  const theme = useSyncExternalStore(adapter.subscribe, adapter.getTheme);
  return (
    <SettingsProvider theme={theme}>
      <BundleContent adapter={adapter} attribution={attribution} />
      <Toaster />
    </SettingsProvider>
  );
}

function BundleContent({
  adapter,
  attribution,
}: {
  adapter: ViewerAdapter;
  attribution?: CanvasViewerOptions["attribution"];
}) {
  const state = useSyncExternalStore(adapter.subscribe, adapter.getSnapshot);
  if (!state.diagram)
    return (
      <div className="ix-embed-msg" role={state.error ? "alert" : "status"}>
        {state.error ?? t("common.loading")}
      </div>
    );
  return <BundleDiagram key={state.generation} adapter={adapter} attribution={attribution} />;
}

function BundleDiagram({
  adapter,
  attribution,
}: {
  adapter: ViewerAdapter;
  attribution?: CanvasViewerOptions["attribution"];
}) {
  const { diagram, generation } = adapter.getSnapshot();
  const fitRef = useRef<() => void>(() => {});
  const [live, setLive] = useState(false);
  const onLive = useCallback(
    (handle: LiveHandle) => {
      adapter.driver.setHandle(handle);
      setLive(!!handle.session);
    },
    [adapter],
  );
  const viewer = useMemo(
    (): CanvasViewerOptions => ({
      live: { live: false, sim: null, speed: null, paused: false },
      wheel: false,
      onLive,
      attribution,
    }),
    [onLive, attribution],
  );
  if (!diagram) return null;
  return (
    <div className="ix-embed hx viewer-bundle" data-testid="viewer-bundle" data-live={live ? "1" : "0"}>
      <ViewerCanvas
        diagram={diagram}
        generation={generation}
        viewer={{
          ...viewer,
          controls: (
            <>
              <HostCanvasBridge fitRef={fitRef} highlight={[]} autoFit live={live} post={adapter.report} />
              <ViewerControls />
            </>
          ),
        }}
      />
    </div>
  );
}
