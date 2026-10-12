import { lazy, Suspense } from "react";

// Needs a real Chrome with the built-in model; the runner loads only when its preset opens.
const OnDeviceEvals = lazy(() => import("../ai/ondevice/OnDeviceEvals"));

export function OnDeviceEvalsLab() {
  return (
    <Suspense fallback={null}>
      <OnDeviceEvals />
    </Suspense>
  );
}
