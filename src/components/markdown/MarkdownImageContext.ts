import { createContext } from "react";

/** The exported viewer cannot load resources from the app's origin. */
export const MarkdownOfflineContext = createContext(false);
