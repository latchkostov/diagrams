// Apply the saved theme before first paint to avoid a flash. A file, not an inline script, so the
// Content-Security-Policy can keep script-src to 'self' (scripts/security-headers.ts).
try {
  const s = JSON.parse(localStorage.getItem("diagrams.settings.v1") || "{}");
  const t = s.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  document.documentElement.dataset.theme = t;
} catch {
  // Storage blocked or bad JSON: the default theme.
}
