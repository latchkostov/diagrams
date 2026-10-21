import type { Plugin } from "vite";

/** Forge owns html[data-theme]. Keep viewer CSS and its provider on a separate attribute. */
export function forgeTheme(): Plugin {
  return {
    name: "forge-theme",
    enforce: "pre",
    transform(code, id) {
      if (id.endsWith(".css")) return code.replace(/data-theme(?=[=\]])/g, "data-viewer-theme");
      if (id.replaceAll("\\", "/").endsWith("/src/harness/SettingsProvider.tsx")) {
        if (!code.includes("dataset.theme = settings.theme")) this.error("Viewer theme publication changed");
        return code.replace("dataset.theme = settings.theme", "dataset.viewerTheme = settings.theme");
      }
    },
  };
}
