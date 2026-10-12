import { lazy, Suspense } from "react";
import { ON_DEVICE } from "../lib/deployment";

// Needs a real Chrome with the built-in model; the runner loads only when its preset opens. None (and no chunk)
// in a copy deployed without the on-device model (src/lib/deployment.ts).
const OnDeviceEvals = ON_DEVICE ? lazy(() => import("../ai/ondevice/OnDeviceEvals")) : null;

export function OnDeviceEvalsLab() {
  if (!OnDeviceEvals) return null;
  return (
    <Suspense fallback={null}>
      <OnDeviceEvals />
    </Suspense>
  );
}
