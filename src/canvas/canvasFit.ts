import { createContext, useContext } from "react";

/**
 * The canvas's Fit view, for controls rendered inside it from outside (the exported HTML viewer's): the
 * overlay-aware fit (routed edges and labels in, clear of the title card, the live bar and every
 * `data-canvas-overlay`), never a second implementation.
 */
export const CanvasFitContext = createContext<() => void>(() => {});

export const useCanvasFit = () => useContext(CanvasFitContext);
