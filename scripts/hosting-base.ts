/** Shared directory validation, usable by the server without loading build-time Vite plugins. */
export function hostingBase(base = "/"): string {
  if (!/^\/(?:[a-zA-Z0-9_-]+\/)*$/.test(base))
    throw new Error("base must start and end with / and contain only letters, digits, _ or -");
  return base;
}
