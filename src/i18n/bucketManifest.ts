export const catalogBuckets = {
  core: "toast rail workbench examples route workspaceInspector messageTypes messageLoop viewerForge node latency liveSession inspector format cloud fileToast fileType importReport library importReason passwordLink importDetail importKind fileDialog embedDialog password exportToast collab storage workspaceLive live common topbar view file status shared privacy export gallery present start privateDialog clear language shortcuts edge keys menu command canvas edit chrome shape camera routing runResult trouble workspaceRoom workspaceValidation fault liveMenu resilience hover waitChecks health resilienceChecks".split(
    " ",
  ),
  tutorials: ["tutorials"],
  tutorialTitles: [],
  stencils: ["stencil"],
  simulation: ["autoscaling", "admission", "threads", "broker", "planning"],
  exports: ["htmlExport", "imageDialog", "storageDialog", "share"],
  ai: ["ai"],
  standalone: ["staticAuth", "staticSkill"],
} as const;
export const surfaceBuckets = Object.keys(catalogBuckets).filter(
  (bucket): bucket is Exclude<CatalogBucket, "core" | "standalone"> => bucket !== "core" && bucket !== "standalone",
);
export type CatalogBucket = keyof typeof catalogBuckets;
export type SurfaceCatalog = (typeof surfaceBuckets)[number];
export const catalogSuffix = new RegExp(`^(.*)-(${["core", ...surfaceBuckets].join("|")})$`);

export const catalogFile = new RegExp(`(?:^|/)([^/]+?)-(?:${["core", ...surfaceBuckets].join("|")})-`);
