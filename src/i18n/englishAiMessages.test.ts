import { afterEach, describe, expect, it, vi } from "vitest";
import { catalogs } from "virtual:i18n/catalogs";
import en from "./en";
import { state, type Catalog } from "./index";
import { compile, parse } from "./icu";
import { formatCombo, SHORTCUTS } from "../editor/shortcuts";
import { legacyKeyHint } from "../editor/keyHints";
import { aiPanelTitle } from "../ai/ui/events";
import { railLabel } from "../ai/ui/unseen";
import { speechErrorMessage } from "../ai/ui/dictation";
import { speechServiceNote } from "../ai/ui/useDictation";
import { FAILED, CHANGED } from "../ai/ondevice/useOnDeviceRequest";
import { TOOL_HELP } from "../ai/webmcp/toolList";
import { readCatalog } from "../../scripts/i18n-plugin";
import { failureText, type Failure } from "../ai/ui/failure";

afterEach(() => {
  state.l = "en";
  state.c = undefined;
  vi.unstubAllGlobals();
});

it.each(Object.keys(catalogs).filter((code) => code !== "en-XA"))(
  "%s contains every AI and key-name message",
  (code) => {
    const messages = readCatalog(code);
    for (const key of Object.keys(en) as (keyof typeof en)[])
      if (key.startsWith("ai.") || key.startsWith("keys.") || key.startsWith("shortcuts.live."))
        expect(messages[key], `${code}: ${key}`).toBeTruthy();
  },
);

// A snapshot of master’s actual literals before extraction, including inline whitespace.
const original: [keyof typeof en, string][] = [
  ["ai.theBrowserDidnTAllowCopyingTry", "The browser didn't allow copying. Try again."],
  ["ai.theReplyDidnTChangeAnything", "The reply didn't change anything."],
  ["ai.checkTheRequestOrAskYourAI", "Check the request, or ask your AI again."],
  ["ai.eGWhereCouldThisFailUnder", "e.g. Where could this fail under load?"],
  [
    "ai.eGAKafkaTopicOrdersCreated",
    "e.g. A Kafka topic orders.created consumed by a .NET service billing-worker that writes to Postgres",
  ],
  ["ai.eGAStormOf100New", "e.g. A storm of 100 new members at 9am, then the payment API fails"],
  ["ai.checkingReply", "Checking reply…"],
  ["ai.aWholeDiagramItReplacesThisOne", "A whole diagram: it replaces this one"],
  ["ai.advanced", "Advanced"],
  ["ai.copyAndPasteWithAnyChatbot", "Copy and paste with any chatbot"],
  ["ai.whatToDo", "What to do"],
  ["ai.simulate", "Simulate"],
  ["ai.change", "Change"],
  ["ai.explain", "Explain"],
  ["ai.describeTheDiagram", "Describe the diagram"],
  ["ai.describeWhatYouWant", "Describe what you want"],
  ["ai.copied", "Copied"],
  ["ai.copyPrompt", "Copy prompt"],
  ["ai.offForThisPrivateDiagram", "Off for this private diagram."],
  ["ai.yourAIAnswersInItsOwnChat", "Your AI answers in its own chat; nothing to paste back."],
  ["ai.pasteItIntoAnyChatbotThenIts", "Paste it into any chatbot, then its reply below."],
  ["ai.pasteTheReply", "Paste the reply"],
  ["ai.apply", " Apply"],
  ["ai.thisStencilChoiceIsStaleItsNode", "This stencil choice is stale: its node changed since."],
  ["ai.somethingChangedSinceThisTurnUseRevert", "Something changed since this turn. Use Revert to here instead."],
  ["ai.conversationCleared", "Conversation cleared."],
  ["ai.undo", "Undo"],
  ["ai.aI", "AI"],
  ["ai.whatAIAgentsChangedInThisDiagram", "What AI agents changed in this diagram"],
  ["ai.clearConversation", "Clear conversation"],
  ["ai.hideTheAIPanel", "Hide the AI panel"],
  ["ai.agentsCopyForAIAndCopiedPrompts", "Agents, Copy for AI and copied prompts can't read it."],
  ["ai.allowTheOnDeviceModelStaysOn", "Allow the on-device model (stays on this device)"],
  ["ai.conversation", "Conversation"],
  ["ai.aIIsOffForThisDiagram", "AI is off for this diagram"],
  ["ai.changeThisDiagramWithAI", "Change this diagram with AI"],
  ["ai.howToUseAIHere", "How to use AI here"],
  ["ai.resizeTheAIPanel", "Resize the AI panel"],
  ["ai.editedTheDiagram", "Edited the diagram"],
  ["ai.setASimulation", "Set a simulation"],
  ["ai.startedANewDiagram", "Started a new diagram"],
  ["ai.onThisDeviceChromeSBuiltIn", " On this device · Chrome's built-in model"],
  ["ai.undone", "Undone"],
  ["ai.undoThisChange", " Undo this change"],
  ["ai.restoreTheDiagramAsItWasAfter", "Restore the diagram as it was after this change (one undo step)"],
  ["ai.revertToHere", " Revert to here"],
  ["ai.close", "Close"],
  ["ai.retry", "Retry"],
  ["ai.aIPanel", "AI panel"],
  ["ai.copyForAI", "Copy for AI"],
  ["ai.private", "Private"],
  ["ai.buildWithAI", "Build with AI…"],
  ["ai.aGuess", "a guess"],
  ["ai.notSure", "not sure"],
  ["ai.nothingWasApplied", "Nothing was applied."],
  ["ai.didYouMeanOneOfThesePick", "Did you mean one of these? Pick one to apply."],
  ["ai.elementsItCouldMean", "Elements it could mean:"],
  ["ai.copyFixUpPrompt", "Copy fix-up prompt"],
  ["ai.yourAICorrectsItsReplyPasteIt", "Your AI corrects its reply; paste it back below."],
  ["ai.tryTheOnDeviceModel", "Try the on-device model"],
  ["ai.chromeSBuiltInModelOnThis", "Chrome's built-in model, on this device: a request box at the panel's foot."],
  ["ai.waysToUseAIHere", "Ways to use AI here"],
  ["ai.yourBrowserSAIAssistant", "Your browser's AI assistant"],
  ["ai.copyExampleRequest", "Copy example request"],
  ["ai.yourCodingAgent", "Your coding agent"],
  [
    "ai.claudeCodeCodexOrTheClaudeApps",
    "Claude Code, Codex or the Claude apps: install the Live Diagrams skill, then ask it to diagram something. It replies with an HTML file, the diagram file or a link.",
  ],
  ["ai.installTheSkill", "Install the skill"],
  ["ai.anyChatbot", "Any chatbot"],
  ["ai.copyAPromptFromAdvancedThenPaste", "Copy a prompt from Advanced, then paste the reply."],
  ["ai.openAdvanced", "Open Advanced"],
  ["ai.whatAgentsCanDoHere", "What agents can do here"],
  ["ai.editingToolsComeBackWhenYouGo", "Editing tools come back when you go back to editing."],
  ["ai.yourBrowserSAssistantMustSupportWebMCP", "Your browser's assistant must support WebMCP to use them."],
  ["ai.stopDictating", "Stop dictating"],
  ["ai.dictate", "Dictate"],
  ["ai.allowTheMicrophoneIfYourBrowserAsks", "Allow the microphone if your browser asks…"],
  ["ai.thinking", "Thinking…"],
  ["ai.checkingAndTryingAgain", "Checking and trying again…"],
  ["ai.applying", "Applying…"],
  ["ai.aIIsOffForThisLocalOnly", "AI is off for this local-only diagram"],
  ["ai.backToEditingToChangeTheDiagram", "Back to editing to change the diagram"],
  ["ai.describeAChange", "Describe a change…"],
  ["ai.onDeviceModel", "On-device model"],
  ["ai.downloadTheOnDeviceModel", " Download the on-device model"],
  ["ai.downloadProgress", "Download progress"],
  ["ai.oneTimeDownloadFromChromeItThen", "One-time download from Chrome. It then runs on this device."],
  ["ai.describeAChange2", "Describe a change"],
  ["ai.runsOnThisDeviceWithChromeS", "Runs on this device with Chrome's built-in model"],
  ["ai.stop", " Stop"],
  ["ai.send", "Send"],
  [
    "ai.theMicrophoneIsBlockedAllowItFrom",
    "The microphone is blocked. Allow it from the icon in the address bar, then try again.",
  ],
  ["ai.noMicrophoneWasFoundPlugOneIn", "No microphone was found. Plug one in, or type instead."],
  ["ai.didnTCatchThatStillListening", "Didn't catch that. Still listening…"],
  [
    "ai.theSpeechServiceCouldnTBeReached",
    "The speech service couldn't be reached. Check your connection, or type instead.",
  ],
  ["ai.dictationDoesnTSupportYourBrowserS", "Dictation doesn't support your browser's language yet. Type instead."],
  ["ai.dictationStoppedUnexpectedlyTryAgain", "Dictation stopped unexpectedly. Try again."],
  [
    "ai.dictationIsOffHereThisBrowserWould",
    "Dictation is off here: this browser would send your voice to its speech service, and this diagram is private.",
  ],
  ["ai.dictationKeepsStoppingTryAgainInA", "Dictation keeps stopping. Try again in a moment."],
  ["ai.couldnTApplyThatTryRephrasing", "Couldn't apply that. Try rephrasing."],
  ["ai.theDiagramChangedWhileTheModelWas", "The diagram changed while the model was thinking. Send it again."],
  [
    "ai.thisDiagramIsTooBigForThe",
    "This diagram is too big for the on-device model. Select the part to change and try again.",
  ],
  [
    "ai.theOnDeviceModelTookTooLong",
    "The on-device model took too long to answer. Try again, or ask for a smaller change.",
  ],
  ["ai.aIIsOffForThisLocalOnly2", "AI is off for this local-only diagram."],
];

const english = (key: keyof typeof en, values: Record<string, unknown> = {}) => {
  const compiled = new Function("return " + compile(parse(en[key]), true))() as
    string | ((v: Record<string, unknown>) => string);
  return typeof compiled === "string" ? compiled : compiled(values);
};

describe("AI extraction preserves the original English", () => {
  it.each(original)("%s", (key, expected) => expect(english(key)).toBe(expected));
  it.each([0, 1, 2, 1000, 12345])("count %i retains its original ungrouped spelling and punctuation", (count) => {
    expect(english("ai.opsReady", { count })).toBe(`${count} ${count === 1 ? "op" : "ops"} ready`);
    expect(english("ai.selected", { count })).toBe(`${count} selected`);
    expect(english("ai.publishedTools", { count })).toBe(
      `This page publishes ${count} tools for AI agents in this browser (WebMCP).`,
    );
    expect(railLabel(count)).toBe(count > 0 ? `AI panel, ${count} new change${count === 1 ? "" : "s"}` : "AI panel");
    expect(english("ai.operationIndex", { count, index: 1 })).toBe(`Op 1 of ${count}:`);
  });
  it("dynamic hints keep their punctuation, labels and quotes", () => {
    expect(english("ai.exampleChange", { name: "Inventory service" })).toBe(
      "e.g. Add a dead-letter queue after Inventory service",
    );
    expect(english("ai.simulationReady", { title: "Storm" })).toBe("Simulation “Storm” ready");
    expect(english("ai.copiedElement", { label: "Worker" })).toBe(
      "Copied “Worker” for your AI. Paste it into your request.",
    );
    expect(english("ai.copiedElements", { count: 1000 })).toBe(
      "Copied 1000 elements for your AI. Paste it into your request.",
    );
    expect(english("ai.downloadPercent", { percent: 50 })).toBe("Downloading the on-device model… 50%");
    expect(english("ai.reverted", { label: "Worker" })).toBe("Reverted to “Worker”");
    expect(english("ai.choiceFor", { kind: "service" })).toBe("for “service”");
    expect(english("ai.emptyType")).toBe(
      "Type a change below, or ask an AI agent. Each change appears here, and you can undo or revert any of them.",
    );
    expect(english("ai.emptyAgent")).toBe(
      "Ask an AI agent to change it. Each change appears here, and you can undo or revert any of them.",
    );
  });
  it("keeps the existing Windows and Mac shortcut labels", () => {
    const names: Record<string, [string, string]> = {
      Mod: ["⌘", "Ctrl"],
      Ctrl: ["⌃", "Ctrl"],
      Shift: ["⇧", "Shift"],
      Alt: ["⌥", "Alt"],
      Delete: ["⌦", "Del"],
      Backspace: ["⌫", "Backspace"],
      Escape: ["Esc", "Esc"],
      ArrowUp: ["↑", "↑"],
      ArrowDown: ["↓", "↓"],
      ArrowLeft: ["←", "←"],
      ArrowRight: ["→", "→"],
    };
    for (const mac of [false, true])
      for (const combo of SHORTCUTS.flatMap((s) => s.keys)) {
        const expected = combo
          .split("+")
          .map((p) => names[p]?.[mac ? 0 : 1] ?? (p.length === 1 ? p.toUpperCase() : p))
          .join(mac ? "" : "+");
        expect(formatCombo(combo, mac)).toBe(expected);
      }
    for (const [platform, mod] of [
      ["Win32", "Ctrl"],
      ["MacIntel", "⌘"],
    ]) {
      vi.stubGlobal("navigator", { platform });
      expect(legacyKeyHint("Mod+Enter")).toBe(`${mod}+Enter`);
      expect(aiPanelTitle()).toBe(`AI panel (\u2066${mod === "⌘" ? "⌘I" : "Ctrl+I"}\u2069)`);
    }
  });
  it("keeps the literal English modifier names in mouse gestures and the AI's Mac prose hints", () => {
    vi.stubGlobal("navigator", { platform: "MacIntel" });
    expect(legacyKeyHint("Ctrl")).toBe("Ctrl");
    expect(legacyKeyHint("Shift")).toBe("Shift");
    expect(legacyKeyHint("Alt")).toBe("Alt");
    expect(legacyKeyHint("Mod+Enter")).toBe("⌘+Enter");
    expect(legacyKeyHint("Mod+Shift+M")).toBe("⌘+Shift+M");
    expect(english("shortcuts.mouse.modClick", { shift: legacyKeyHint("Shift"), ctrl: legacyKeyHint("Ctrl") })).toBe(
      "Shift / Ctrl / ⌘ + click",
    );
  });
});

it("UI failure reasons translate independently of agent-facing wording", async () => {
  state.l = "de";
  state.c = (await catalogs.de()).default as Catalog;
  const failure: Failure = {
    reason: "no-change",
    error: { i: -1, error: "Agent explanation", hint: "Agent hint" },
    reply: "[]",
  };
  const messages = readCatalog("de");
  expect(failureText(failure)).toEqual({
    message: messages["ai.theReplyDidnTChangeAnything"],
    hint: messages["ai.checkTheRequestOrAskYourAI"],
  });
  expect(failure.error).toEqual({ i: -1, error: "Agent explanation", hint: "Agent hint" });
  expect(
    failureText({
      error: { i: -1, error: "The reply didn't change anything.", hint: "Check the request, or ask your AI again." },
      reply: "[]",
    }),
  ).toEqual({ message: "The reply didn't change anything.", hint: "Check the request, or ask your AI again." });
});

it("key and speech messages fall back synchronously while a catalog is absent, then follow its arrival", async () => {
  state.l = "de";
  state.c = undefined;
  expect(formatCombo("Mod+Shift+Z", false)).toBe("Ctrl+Shift+Z");
  expect(speechErrorMessage("denied")).toBe(
    "The microphone is blocked. Allow it from the icon in the address bar, then try again.",
  );
  expect(speechServiceNote("Chrome/140")).toBe("What you say may be sent to Google's speech service.");
  expect(FAILED()).toBe("Couldn't apply that. Try rephrasing.");
  expect(CHANGED()).toBe("The diagram changed while the model was thinking. Send it again.");
  state.c = (await catalogs.de()).default as Catalog;
  expect(formatCombo("Mod+Shift+Z", false)).toBe("Strg+Umschalt+Z");
  expect(formatCombo("Alt+Shift+Enter", true)).toBe("⌥⇧Eingabe");
  expect(formatCombo("Delete+Backspace+Escape", false)).toBe("Entf+Rücktaste+Esc");
  expect(speechErrorMessage("denied")).not.toContain("The microphone");
  expect(FAILED()).not.toContain("Couldn't");
  expect(TOOL_HELP.describe_diagram()).not.toContain("Reads the diagram");
  state.l = "fr";
  state.c = (await catalogs.fr()).default as Catalog;
  expect(formatCombo("Ctrl+Shift+Delete", false)).toBe("Ctrl+Maj+Suppr");
  expect(formatCombo("Mod+Alt+Shift+Z", true)).toBe("⌘⌥⇧Z");
});
