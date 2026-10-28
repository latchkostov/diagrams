import { tRich } from "../../i18n/rich";
import { t, useLocale } from "../../i18n";
import { useEffect, useRef, useState } from "react";
import { Icon } from "../../components/Icon";
import type { DiagramFile } from "../../model/types";
import { copyText } from "../../interop/ui/copyText";
import { notify } from "../../interop/ui/toast";
import { publishedTools } from "../webmcp/toolList";
import { TOOL_HELP } from "../webmcp/toolHelp";
import { exampleRequest, exampleToCopy } from "./exampleRequest";
import { paletteHost } from "../../palette/host";

// How to use AI here: the idle AI panel's answer to "where do I type?". The panel has no request box of
// its own (agents are the main path), so it says where to ask: the browser's AI assistant (with WebMCP),
// a coding agent with the Live Diagrams skill, or any chatbot through Advanced.

const base = () => import.meta.env.BASE_URL;

export function HowTo({
  mcp,
  live,
  current,
  onOpenAdvanced,
}: {
  /** The browser has WebMCP (document.modelContext). */
  mcp: boolean;
  live: boolean;
  current: DiagramFile | null;
  onOpenAdvanced: () => void;
}) {
  useLocale();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const example = exampleRequest(current, live);

  const copyExample = async () => {
    // Asked again now: the diagram may have turned private since this rendered.
    const text = exampleToCopy(paletteHost.get().canvas, live);
    if (text === null) return notify(t("ai.privateNotice"), { kind: "error" });
    if (!(await copyText(text))) return notify(t("ai.theBrowserDidnTAllowCopyingTry"), { kind: "error" });
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="ai-howto" data-testid="ai-howto">
      <h4 className="ai-howto-title">{t("ai.waysToUseAIHere")}</h4>
      <ol className="ai-ways">
        {mcp && (
          <li className="ai-way" data-testid="ai-way-browser">
            <p className="ai-way-title">{t("ai.yourBrowserSAIAssistant")}</p>
            <p className="ai-way-text">
              {tRich("ai.askExample", {
                request: example,
                example: (chunks) => <span data-testid="ai-example-request">{chunks}</span>,
              })}
              {!live && t("ai.exampleUndo")}
            </p>
            <button className="ai-way-action" onClick={() => void copyExample()} data-testid="ai-copy-example">
              <Icon name={copied ? "check" : "copy"} size={13} />
              {copied ? t("ai.copied") : t("ai.copyExampleRequest")}
            </button>
          </li>
        )}
        <li className="ai-way" data-testid="ai-way-skill">
          <p className="ai-way-title">{t("ai.yourCodingAgent")}</p>
          <p className="ai-way-text">{t("ai.claudeCodeCodexOrTheClaudeApps")}</p>
          <a
            className="ai-way-action"
            href={`${base()}skill/`}
            target="_blank"
            rel="noopener"
            data-testid="ai-skill-link"
          >
            <Icon name="link" size={13} />
            {t("ai.installTheSkill")}
          </a>
        </li>
        <li className="ai-way" data-testid="ai-way-chatbot">
          <p className="ai-way-title">{t("ai.anyChatbot")}</p>
          <p className="ai-way-text">{t("ai.copyAPromptFromAdvancedThenPaste")}</p>
          <button className="ai-way-action" onClick={onOpenAdvanced} data-testid="ai-open-advanced">
            <Icon name="chevron-right" size={13} />
            {t("ai.openAdvanced")}
          </button>
        </li>
      </ol>
      {mcp && (
        <details className="ai-tools" data-testid="ai-tools">
          <summary data-testid="ai-tools-toggle">
            <Icon name="chevron-right" size={12} />
            {t("ai.whatAgentsCanDoHere")}
          </summary>
          <ul className="ai-tools-list" data-testid="ai-tools-list">
            {publishedTools(live).map((name) => (
              <li key={name} data-testid={`ai-tool-${name}`}>
                <code>{name}</code>
                <span>{TOOL_HELP[name]()}</span>
              </li>
            ))}
          </ul>
          {live && <p className="ai-tools-note">{t("ai.editingToolsComeBackWhenYouGo")}</p>}
        </details>
      )}
    </div>
  );
}

/**
 * Whether agents can use this page here, honestly: WebMCP only means the page publishes its tools; the
 * browser's assistant still has to support them. Without WebMCP, /llms.txt for agents that drive pages.
 */
export function AgentStatus({
  available,
  localOnly,
  privateDiagram = false,
  live,
  typeHere = false,
}: {
  available: boolean;
  localOnly: boolean;
  /** Off because the person made it Private (rather than a built-in local-only example). */
  privateDiagram?: boolean;
  live: boolean;
  /** The panel has a request box of its own (the on-device model): don't say "not here". */
  typeHere?: boolean;
}) {
  useLocale();
  const on = available && !localOnly;
  const count = publishedTools(live).length;
  return (
    <div
      className={`ai-agent-status${on ? " is-on" : ""}`}
      data-testid="ai-agent-status"
      data-available={on ? "1" : "0"}
      {...(on ? { "data-tools": count } : {})}
    >
      <span className="ai-agent-dot" aria-hidden />
      {localOnly ? (
        <p>{privateDiagram ? t("ai.privateToolsOff") : t("ai.localToolsOff")}</p>
      ) : available ? (
        <div>
          <p data-testid="ai-agent-status-text">{t("ai.publishedTools", { count })}</p>
          <p className="ai-agent-status-hint" data-testid="ai-agent-status-hint">
            {typeHere ? t("ai.yourBrowserSAssistantMustSupportWebMCP") : t("ai.agentRequestHint")}
          </p>
        </div>
      ) : (
        <p>
          {tRich("ai.noWebMCP", {
            link: (chunks) => (
              <a href={`${base()}llms.txt`} target="_blank" rel="noopener" data-testid="ai-llms-link">
                {chunks}
              </a>
            ),
          })}
        </p>
      )}
    </div>
  );
}
