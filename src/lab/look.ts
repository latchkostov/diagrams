import { nodeVariants } from "../harness/nodeVariants";
import { edgeStyles } from "../harness/edgeStyles";
import type { Settings } from "../harness/settings";
import type { ControlDef } from "./types";

/**
 * Global "look" controls shown for every preset. They map 1:1 onto the harness settings
 * (src/harness/settings.tsx), so the Lab, Gallery and Canvas all share them.
 * URL: `&theme=dark&nodevariant=compact&edgestyle=bezier`.
 */
export const LOOK_CONTROLS = [
  {
    type: "select",
    key: "theme",
    label: "Theme",
    default: "light",
    options: [
      { value: "light", label: "Light" },
      { value: "dark", label: "Dark" },
    ],
  },
  {
    type: "select",
    key: "nodevariant",
    label: "Node variant",
    default: "card",
    options: Object.entries(nodeVariants).map(([value, v]) => ({ value, label: v.label })),
  },
  {
    type: "select",
    key: "edgestyle",
    label: "Edge style",
    default: "smoothstep",
    options: edgeStyles.map((e) => ({ value: e.id, label: e.label })),
  },
] as const satisfies readonly ControlDef[];

export const LOOK_KEYS = LOOK_CONTROLS.map((c) => c.key);
export type LookKey = (typeof LOOK_KEYS)[number];

export const lookSetting: Record<LookKey, keyof Settings> = {
  theme: "theme",
  nodevariant: "nodeVariant",
  edgestyle: "edgeStyle",
};
