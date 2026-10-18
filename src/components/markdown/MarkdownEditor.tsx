import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { MarkdownView } from "./MarkdownView";
import { handleMarkdownKeyDown, indentMarkdown } from "./markdownKeys";

export interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  maxLength?: number;
  name?: string;
  ariaLabel?: string;
  testId?: string;
  onFocus?: () => void;
  onBlur?: () => void;
}

/**
 * Inspector Markdown field with Preview-first mode when populated and Edit mode (<textarea>)
 * when empty. Keeps the underlying <textarea> mounted in the same grid cell so click-to-edit,
 * native word/line selection, and keyboard shortcuts work seamlessly.
 */
export function MarkdownEditor({
  value,
  onChange,
  placeholder,
  rows = 9,
  maxLength,
  name,
  ariaLabel,
  testId,
  onFocus,
  onBlur,
}: MarkdownEditorProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [explicitPreview, setExplicitPreview] = useState(false);
  const previewRef = useRef<HTMLButtonElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const hasContent = value.trim().length > 0;
  const showPreview = !isEditing && (hasContent || explicitPreview);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    if (showPreview) {
      el.style.height = "";
      return;
    }
    el.style.height = "auto";
    el.style.height = `${Math.min(380, Math.max(176, el.scrollHeight))}px`;
  }, [value, showPreview]);

  const switchToEdit = useCallback(() => {
    setIsEditing(true);
    setExplicitPreview(false);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
  }, []);

  const switchToPreview = useCallback(() => {
    setIsEditing(false);
    setExplicitPreview(true);
    textareaRef.current?.blur();
  }, []);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      const el = e.currentTarget;

      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setIsEditing(false);
        setExplicitPreview(true);
        previewRef.current?.focus();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && (e.key === "]" || e.key === "[")) {
        e.preventDefault();
        e.stopPropagation();
        const next = indentMarkdown(value, el.selectionStart, el.selectionEnd, e.key === "[");
        if (maxLength !== undefined && next.value.length > maxLength) return;
        onChange(next.value);
        requestAnimationFrame(() => el.setSelectionRange(next.start, next.end));
        return;
      }

      handleMarkdownKeyDown(e, el, value, onChange);
    },
    [value, onChange, maxLength],
  );

  return (
    <div
      className={`md-editor ${showPreview ? "is-preview" : "is-editing"}`}
      data-testid={testId ? `${testId}-editor` : undefined}
    >
      <div className="md-editor-header">
        <div className="md-editor-tabs">
          <button
            ref={previewRef}
            type="button"
            className={`md-editor-tab ${showPreview ? "active" : ""}`}
            aria-pressed={showPreview}
            onMouseDown={(e) => e.preventDefault()}
            onClick={switchToPreview}
            data-testid={testId ? `${testId}-tab-preview` : undefined}
          >
            Preview
          </button>
          <button
            type="button"
            className={`md-editor-tab ${!showPreview ? "active" : ""}`}
            aria-pressed={!showPreview}
            onMouseDown={(e) => e.preventDefault()}
            onClick={switchToEdit}
            data-testid={testId ? `${testId}-tab-edit` : undefined}
          >
            Edit
          </button>
        </div>
        <span className="md-editor-shortcut-hint">
          {!showPreview ? "Ctrl+B bold · Ctrl+I italic · Ctrl+K link" : "Click to edit"}
        </span>
      </div>

      <div className="md-editor-body">
        <textarea
          ref={textareaRef}
          className={`insp-input md-editor-textarea${showPreview ? " is-preview-hidden" : ""}`}
          rows={rows}
          value={value}
          placeholder={placeholder}
          maxLength={maxLength}
          name={name}
          aria-label={ariaLabel}
          onFocus={() => {
            setIsEditing(true);
            setExplicitPreview(false);
            onFocus?.();
          }}
          onBlur={() => {
            setIsEditing(false);
            onBlur?.();
          }}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          data-markdown-input=""
          data-testid={testId}
        />
        {showPreview && (
          // Scroll regions need a tab stop for keyboard scrolling; Enter and the Edit tab open editing.
          // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
          <div
            className="md-editor-rendered"
            role="region"
            aria-label={ariaLabel}
            // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === "Enter" && event.target === event.currentTarget) {
                event.preventDefault();
                switchToEdit();
              }
            }}
            onClick={(event) => {
              if (!(event.target instanceof Element) || !event.target.closest("a")) switchToEdit();
            }}
            data-testid={testId ? `${testId}-rendered` : undefined}
          >
            {hasContent ? (
              <MarkdownView text={value} />
            ) : (
              <span className="md-editor-placeholder">{placeholder || "Click to edit…"}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
