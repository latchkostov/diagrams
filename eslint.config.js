import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import jsxA11y from "eslint-plugin-jsx-a11y";
import local from "./eslint-rules/no-literal-ui-text.js";

/**
 * The areas converted to i18n (docs/I18N.md, "Build batches"): words people read go through src/i18n, and
 * local/no-literal-ui-text keeps new hard-coded ones out. Add a file here when its batch converts it.
 */
const TRANSLATED = [
  "src/canvas/edges/EdgeRouteHandles.tsx",
  "src/live/observedTrouble.ts",
  "src/live/TroubleCallout.tsx",
  "integrations/confluence-forge/src/{view,configure,attachments,dom,preview}.ts",
  "src/static/*.ts",
  "src/components/ExamplesDialog.tsx",
  "src/examples/GalleryDetails.tsx",
  "src/examples/discovery.tsx",
  "src/components/ColorPickerModal.tsx",
  "src/collab/room/RoomUi.tsx",
  "src/i18n/stencils.ts",
  "src/lib/stencilDisplaySearch.ts",
  "src/canvas/NodeTooltip.tsx",
  "src/i18n/galleryRoles.ts",
  "src/gallery/stencilInfo.ts",
  "src/editor/actions.ts",
  "src/editor/builtinActions.ts",
  "src/editor/relationActions.ts",
  "src/editor/useEditor.ts",
  "src/editor/editMessages.ts",
  "src/components/ContextMenu.tsx",
  "src/canvas/CanvasView.tsx",
  "src/canvas/Inspector.tsx",
  // Modules split out of CanvasView and Inspector keep the translation guard.
  "src/canvas/inspector/**/*.{ts,tsx}",
  "src/canvas/chrome/**/*.{ts,tsx}",
  "src/canvas/menus/**/*.{ts,tsx}",
  "src/canvas/placement/**/*.{ts,tsx}",
  "src/canvas/selection/**/*.{ts,tsx}",
  "src/canvas/document/**/*.{ts,tsx}",
  "src/canvas/camera/**/*.{ts,tsx}",
  "src/live/session/**/*.{ts,tsx}",
  "src/tutorials/**/*.{ts,tsx}",
  "src/canvas/inspector/*.{ts,tsx}",
  "src/canvas/SheetResizeHandle.tsx",
  "src/canvas/Palette.tsx",
  "src/canvas/FirstRunHint.tsx",
  "src/gallery/GalleryView.tsx",
  "src/gallery/StencilDrawer.tsx",
  "src/palette/sources.ts",
  "src/palette/rank.ts",
  "src/palette/PaletteDialog.tsx",
  "src/i18n/chrome.ts",
  "src/lib/canvasBridge.ts",
  "src/editor/shortcuts.ts",
  "src/editor/keyHints.ts",
  "src/ai/ui/Advanced.tsx",
  "src/ai/ui/AiPanel.tsx",
  "src/ai/ui/AiMount.tsx",
  "src/ai/ui/parts.tsx",
  "src/ai/ui/failure.ts",
  "src/ai/ui/HowTo.tsx",
  "src/ai/ui/DictationField.tsx",
  "src/ai/ui/events.ts",
  "src/ai/ui/unseen.ts",
  "src/ai/ui/feedback.ts",
  "src/ai/ui/copyForAi.ts",
  "src/ai/ui/dictation.ts",
  "src/ai/ui/useDictation.ts",
  "src/ai/ondevice/OnDeviceInput.tsx",
  "src/ai/ondevice/useOnDeviceRequest.ts",
  "src/ai/webmcp/toolList.ts",
  "src/interop/passwordLink.ts",
  "src/interop/drawio/write.ts",
  "src/interop/mermaid/write.ts",
  "src/interop/infra/asyncapi.ts",
  "src/interop/infra/asyncapiRefs.ts",
  "src/interop/infra/compose.ts",
  "src/interop/infra/kubernetes.ts",
  "src/interop/infra/map.ts",
  "src/interop/infra/pipeline.ts",
  "src/interop/infra/stencils.ts",
  "src/interop/infra/terraform.ts",
  "src/interop/infra/tfTypes.ts",
  "src/interop/infra/yaml.ts",

  "src/lab/FilePrompts.tsx",
  "src/components/LibraryDialog.tsx",
  "src/interop/useInterop.tsx",
  "src/interop/fileActions.ts",
  "src/interop/ui/dialogs.tsx",
  "src/interop/ui/lazyDialogs.tsx",
  "src/interop/ui/passwordDialogs.tsx",
  "src/interop/ui/PasswordField.tsx",
  "src/interop/ui/StorageDialog.tsx",
  "src/interop/ui/ImportReportDialog.tsx",
  "src/interop/ui/DropOverlay.tsx",
  "src/interop/ui/fileMessages.ts",
  "src/interop/ui/importMessages.ts",
  "src/export/HtmlExportDialog.tsx",
  "src/export/exportHtml.ts",
  "src/interop/files.ts",
  "src/interop/formats.ts",
  "src/interop/storage/device.ts",
  "src/interop/storage/registry.ts",
  "src/interop/storage/gdrive.ts",
  "src/interop/storage/onedrive.ts",
  "src/interop/storage/dropbox.ts",
  "src/interop/storage/oauth.ts",
  "src/interop/storage/http.ts",
  "src/interop/storage/cloudMessages.ts",
  "src/interop/gdrive/client.ts",
  "src/interop/gdrive/google.ts",
  "src/planning/*.tsx",
  "src/canvas/StartCard.tsx",
  "src/canvas/PresentFullscreen.tsx",
  "src/components/TopBar.tsx",
  "src/components/ShortcutsDialog.tsx",
  "src/components/LanguageDialog.tsx",
  "src/interop/ui/menus.tsx",
  "src/interop/ui/ShareChooser.tsx",
  "src/interop/ui/Dialog.tsx",
];

/** React Flow's viewport writers. */
const CAMERA_CALLS = "/^(setViewport|setViewportConstrained|fitView|fitBounds|setCenter|zoomTo|zoomIn|zoomOut|panBy)$/";
const CAMERA_MESSAGE =
  "Only the camera controller moves the viewport (src/canvas/camera). Dispatch a camera event with its cause instead, and add a policy row for new behaviour (src/canvas/camera/index.ts explains how).";

/** The camera's viewport selectors, for the canvas block below (which replaces the camera block's rule there). */
const CAMERA_RESTATED = [
  {
    selector: `CallExpression[callee.property.name=${CAMERA_CALLS}]:not([callee.object.name="editor"]):not([callee.object.property.name="editor"])`,
    message: CAMERA_MESSAGE,
  },
  { selector: `CallExpression[callee.name=${CAMERA_CALLS}]`, message: CAMERA_MESSAGE },
];
const FOCUS_MESSAGE =
  "Only the focus controller moves keyboard focus in the canvas (src/canvas/interaction). Dispatch an interaction event with its cause instead, and add a focus policy row for new behaviour (src/canvas/interaction/index.ts explains how).";
const MENU_MESSAGE =
  "Menus, the shortcuts dialog and the canvas's Tab stop change through the interaction controller (openMenu / closeMenu with a reason, focus events), never a state setter.";
const INTERACTION_RULES = [
  { selector: 'CallExpression[callee.property.name="focus"]', message: FOCUS_MESSAGE },
  { selector: "CallExpression[callee.name=/^set(Menu|ShortcutsOpen|FocusId)$/]", message: MENU_MESSAGE },
];
/**
 * Focus that stays inside one component, allowed outside src/canvas/interaction:
 * - inspector/fields.tsx: a segmented control moves focus among its own radio buttons (the ARIA radio group's
 *   arrow keys), and an inert note's Remove button hands focus to its own section as it removes itself.
 * - SheetResizeHandle.tsx: the handle focuses itself on a press, so its arrow keys resize the sheet it belongs to.
 * - live/TraceCard.tsx: a waiting card that becomes a journey keeps focus on its own hop list.
 * - live/BottleneckCallout.tsx: the bottleneck callout keeps focus on itself when its own action button goes (the
 *   trouble callout's return to the canvas is row L3).
 */
const FOCUS_LOCAL = [
  // The tool rail's roving arrows stay within its own buttons; cross-surface moves use policy row T1.
  "src/canvas/chrome/ToolRail.tsx",
  "src/canvas/inspector/fields.tsx",
  "src/canvas/SheetResizeHandle.tsx",
  "src/live/TraceCard.tsx",
  "src/live/BottleneckCallout.tsx",
];

// Legacy drags remain local until migrated: insertion/membership, box selection, shape and sheet resizing.
const POINTER_LOCAL = [
  "src/canvas/placement/useDragPlacement.ts",
  "src/canvas/selection/useBoxSelection.ts",
  "src/canvas/shapes/useShapeResize.ts",
  // Smart guides observe a node drag owned by React Flow; settled selection observes release only.
  "src/canvas/useSmartGuides.ts",
  "src/canvas/selection/useSettledSelection.ts",
  "src/canvas/SheetResizeHandle.tsx",
];
const POINTER_RULE = {
  selector: 'CallExpression[callee.property.name="addEventListener"][arguments.0.value=/^pointer(move|up|cancel)$/]',
  message:
    "Pointer gestures belong to src/canvas/interaction/usePointerGesture.ts. Add a gesture event and machine row instead of local listeners.",
};

export default tseslint.config(
  {
    ignores: [
      "dist",
      "dist-viewer",
      "services/*/dist/**",
      "integrations/confluence-forge/dist/**",
      "tests/.output",
      "src/examples/private/**",
      "**/*.gen.cjs",
      // Generated by `pnpm schemas`: the app's validator, layout and HTML export injection, bundled for the agent skill.
      "skills/livediagrams/scripts/lib/app.mjs",
      "skills/livediagrams/scripts/lib/inject.mjs",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    files: ["src/**/*.{ts,tsx}", "integrations/confluence-forge/src/**/*.ts"],
    languageOptions: { globals: globals.browser },
    plugins: { "react-hooks": reactHooks, "react-refresh": reactRefresh, "jsx-a11y": jsxA11y },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.flatConfigs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
  {
    files: TRANSLATED,
    plugins: { local },
    rules: { "local/no-literal-ui-text": "error" },
  },
  {
    // One writer for the canvas viewport: src/canvas/camera (see its index.ts), Live and slow motion included.
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/canvas/camera/**", "src/**/*.test.*"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: `CallExpression[callee.property.name=${CAMERA_CALLS}]:not([callee.object.name="editor"]):not([callee.object.property.name="editor"])`,
          message: CAMERA_MESSAGE,
        },
        { selector: `CallExpression[callee.name=${CAMERA_CALLS}]`, message: CAMERA_MESSAGE },
      ],
    },
  },
  {
    // One writer for keyboard focus and menus in the canvas: src/canvas/interaction (see its index.ts). A later
    // no-restricted-syntax replaces an earlier one for the same files, so this restates the camera's selectors.
    // Live (src/live) is a mode of the canvas: its keys, popovers, panels and focus returns go through it too.
    files: ["src/canvas/**/*.{ts,tsx}", "src/live/**/*.{ts,tsx}"],
    ignores: ["src/canvas/interaction/**", "src/canvas/camera/**", "src/**/*.test.*", ...FOCUS_LOCAL],
    rules: { "no-restricted-syntax": ["error", ...CAMERA_RESTATED, ...INTERACTION_RULES] },
  },
  {
    // The camera's own files move the viewport, never keyboard focus (useMoveHandlers closes menus through the
    // callback the canvas hands it).
    files: ["src/canvas/camera/**/*.{ts,tsx}"],
    ignores: ["src/**/*.test.*"],
    rules: { "no-restricted-syntax": ["error", INTERACTION_RULES[0]] },
  },
  {
    files: ["src/canvas/**/*.{ts,tsx}"],
    ignores: ["src/canvas/interaction/**", "src/canvas/camera/**", "src/**/*.test.*", ...POINTER_LOCAL, ...FOCUS_LOCAL],
    rules: { "no-restricted-syntax": ["error", ...CAMERA_RESTATED, ...INTERACTION_RULES, POINTER_RULE] },
  },
  {
    files: ["src/canvas/CanvasView.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "inspector/.*(?:Fields|Panel)(?:\\.tsx)?$",
              allowTypeImports: true,
              message: "Inspector feature UI must load through a registered lazy surface.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["tests/e2e/**/*.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "Literal[value=/^Control\\+/]",
          message:
            "Use ControlOrMeta for the platform's primary modifier. Disable inline with a reason for deliberate literal Ctrl shortcuts.",
        },
      ],
    },
  },
  {
    // The static pages' scripts (theme, sign-in redirect, skill page): plain browser scripts.
    files: ["public/**/*.js"],
    languageOptions: { globals: globals.browser, sourceType: "script" },
  },
  {
    // The host page that tests/e2e/host-embed.spec.ts serves on another origin.
    files: ["tests/fixtures/**/*.js"],
    languageOptions: { globals: globals.browser, sourceType: "script" },
  },
  {
    // The <live-diagram> web component: a standalone ES module that runs on other sites' pages.
    files: ["public/embed/**/*.js"],
    languageOptions: { globals: globals.browser, sourceType: "module" },
    rules: { "@typescript-eslint/no-unused-vars": ["error", { varsIgnorePattern: "^_" }] },
  },
  {
    files: [
      "tests/**/*.ts",
      "*.config.ts",
      "*.config.js",
      "scripts/**/*.ts",
      "services/**/*.ts",
      "integrations/confluence-forge/*.mjs",
      "integrations/confluence-forge/build.ts",
      "skills/**/*.mjs",
      "eslint-rules/**/*.js",
    ],
    languageOptions: { globals: globals.node },
  },
);
