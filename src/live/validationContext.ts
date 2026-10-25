import { createContext } from "react";
export const SimErrors = createContext<ReadonlySet<string>>(new Set());
