import { MarkdownOfflineContext } from "./MarkdownImageContext";
import { useContext, Fragment, memo, useMemo, type ReactNode } from "react";
import { markdownImageSource } from "./imagePolicy";
import { parseMarkdown, sanitizeUrl, type BlockToken, type InlineToken } from "./markdownParser";

export interface MarkdownViewProps {
  text: string;
  className?: string;
  testId?: string;
}

function InlineContent({ tokens }: { tokens: InlineToken[] }): ReactNode {
  const offline = useContext(MarkdownOfflineContext);
  return (
    <>
      {tokens.map((token, i) => {
        switch (token.type) {
          case "text":
            return token.text;
          case "bold":
            return (
              <strong key={i}>
                <InlineContent tokens={token.children} />
              </strong>
            );
          case "italic":
            return (
              <em key={i}>
                <InlineContent tokens={token.children} />
              </em>
            );
          case "boldItalic":
            return (
              <strong key={i}>
                <em>
                  <InlineContent tokens={token.children} />
                </em>
              </strong>
            );
          case "strike":
            return (
              <del key={i}>
                <InlineContent tokens={token.children} />
              </del>
            );
          case "highlight":
            return (
              <mark key={i} className="md-mark">
                <InlineContent tokens={token.children} />
              </mark>
            );
          case "subscript":
            return (
              <sub key={i} className="md-sub">
                <InlineContent tokens={token.children} />
              </sub>
            );
          case "superscript":
            return (
              <sup key={i} className="md-sup">
                <InlineContent tokens={token.children} />
              </sup>
            );
          case "code":
            return (
              <code key={i} className="md-inline-code">
                {token.text}
              </code>
            );
          case "link":
            return (
              <a
                key={i}
                href={token.href}
                title={token.title}
                target="_blank"
                rel="noopener noreferrer"
                className="md-link"
                onClick={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
              >
                <InlineContent tokens={token.children} />
              </a>
            );
          case "image": {
            const src = markdownImageSource(
              token.src,
              offline,
              typeof window === "undefined" ? undefined : window.location.origin,
            );
            return src ? (
              <img
                key={i}
                src={src}
                alt={token.alt}
                title={token.title}
                className="md-img"
                data-testid="markdown-image"
              />
            ) : (
              <a
                key={i}
                href={sanitizeUrl(token.src)}
                title={token.title}
                target="_blank"
                rel="noopener noreferrer"
                className="md-link"
                data-testid="markdown-image-fallback"
                onClick={(e) => e.stopPropagation()}
              >
                {token.alt || token.src}
              </a>
            );
          }
          case "br":
            return (
              <Fragment key={i}>
                <br />
                {"\n"}
              </Fragment>
            );
        }
      })}
    </>
  );
}

function BlockNode({ block, index }: { block: BlockToken; index: number }): ReactNode {
  switch (block.type) {
    case "heading": {
      const H = `h${block.level}` as const;
      return (
        <H key={index} id={block.id} className={`md-h md-h${block.level}`}>
          <InlineContent tokens={block.tokens} />
        </H>
      );
    }
    case "paragraph":
      return (
        <p
          key={index}
          className="md-p"
          style={
            block.tokens.some((token) => token.type === "text" && token.text.includes("\n"))
              ? { whiteSpace: "pre-wrap" }
              : undefined
          }
        >
          <InlineContent tokens={block.tokens} />
        </p>
      );
    case "blockquote":
      return (
        <blockquote key={index} className="md-quote">
          {block.children.map((child, cIdx) => (
            <BlockNode key={cIdx} block={child} index={cIdx} />
          ))}
        </blockquote>
      );
    case "code":
      return (
        <pre key={index} className="md-code-block">
          <code className={block.lang ? `lang-${block.lang}` : undefined}>{block.code}</code>
        </pre>
      );
    case "table":
      return (
        <div key={index} className="md-table-wrap">
          <table className="md-table">
            <thead>
              <tr>
                {block.headers.map((h, col) => (
                  <th key={col} style={{ textAlign: block.aligns[col] || "left" }}>
                    <InlineContent tokens={h.tokens} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c} style={{ textAlign: block.aligns[c] || "left" }}>
                      <InlineContent tokens={cell.tokens} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "list": {
      return block.ordered ? (
        <ol key={index} start={block.start} className="md-list md-ol">
          {block.items.map((item, itemIdx) => (
            <ListItemNode key={itemIdx} item={item} itemIdx={itemIdx} />
          ))}
        </ol>
      ) : (
        <ul key={index} className="md-list md-ul">
          {block.items.map((item, itemIdx) => (
            <ListItemNode key={itemIdx} item={item} itemIdx={itemIdx} />
          ))}
        </ul>
      );
    }
    case "hr":
      return <hr key={index} className="md-hr" />;
  }
}

function ListItemNode({
  item,
  itemIdx,
}: {
  item: BlockToken & { type: "list" } extends { items: (infer I)[] } ? I : never;
  itemIdx: number;
}) {
  return (
    <li className={`md-li${item.checked !== undefined ? " md-task-item" : ""}`}>
      {item.checked !== undefined ? (
        <div className="md-task-row">
          <input
            type="checkbox"
            className="md-task-checkbox"
            checked={item.checked}
            readOnly
            tabIndex={-1}
            aria-label={item.text}
          />
          <span className="md-li-content">
            <InlineContent tokens={item.tokens} />
          </span>
        </div>
      ) : (
        <span className="md-li-content">
          <InlineContent tokens={item.tokens} />
        </span>
      )}
      {item.subList && <BlockNode block={item.subList} index={itemIdx} />}
    </li>
  );
}

export const MarkdownView = memo(function MarkdownView({ text, className, testId }: MarkdownViewProps) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);

  if (!blocks.length) return null;

  return (
    <div className={`md-view${className ? ` ${className}` : ""}`} data-testid={testId}>
      {blocks.map((block, idx) => (
        <BlockNode key={idx} block={block} index={idx} />
      ))}
    </div>
  );
});
