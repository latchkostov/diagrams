import { useLayoutEffect, type ReactNode } from "react";
import { useCameraController } from "../canvas/camera";

export function SimPanelFrame({ children }: { children: ReactNode }) {
  const camera = useCameraController();
  useLayoutEffect(() => {
    camera?.dispatch({ type: "live.panel", open: true });
    return () => camera?.dispatch({ type: "live.panel", open: false });
  }, [camera]);
  return children;
}
