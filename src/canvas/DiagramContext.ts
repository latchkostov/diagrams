import { createContext, useContext } from "react";

/** Diagram-level settings nodes need (handle placement follows the flow direction). */
export const DiagramContext = createContext<{ direction: "LR" | "TB" }>({ direction: "LR" });
export const useDiagram = () => useContext(DiagramContext);
