/** Install before navigation; Playwright serializes this without eval in the CSP-protected page. */
export function installCaptureReady() {
  // Tab capture converts colour spaces; the alternating chromatic states remain distinct.
  const markerMatches = (rgb: readonly number[], green: boolean) =>
    green ? rgb[1] > rgb[0] + 64 && rgb[1] > rgb[2] + 64 : rgb[0] > rgb[1] + 64 && rgb[2] > rgb[1] + 64;
  async function captureReadyFrame<T>(
    next: (callback: () => void) => void,
    read: () => T,
    ready: (frame: T) => boolean,
  ): Promise<T> {
    for (;;) {
      await new Promise<void>((resolve) => next(resolve));
      const frame = read();
      if (ready(frame)) return frame;
    }
  }
  Object.assign(window, { __captureReady: captureReadyFrame, __captureMarker: markerMatches });
  return captureReadyFrame;
}

declare global {
  interface Window {
    __captureReady: ReturnType<typeof installCaptureReady>;
    __captureMarker(rgb: readonly number[], green: boolean): boolean;
  }
}
