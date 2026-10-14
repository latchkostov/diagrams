// local/no-literal-ui-text: no hard-coded words people read, in the areas converted to i18n (eslint.config.js lists
// them; docs/I18N.md). Words go through t("key") (src/i18n). It flags:
//   - JSX text with letters: <span>Save</span>
//   - text attributes: title, aria-label, placeholder, alt, label, subtitle
//   - text properties of objects (menu rows, toasts): title, label, desc, text, subtitle, message, placeholder
// Names that are the same in every language (brands, file formats) can stay, with a disable comment that says why:
//   // eslint-disable-next-line local/no-literal-ui-text -- a product name

const ATTRIBUTES = new Set(["title", "aria-label", "placeholder", "alt", "label", "subtitle"]);
const PROPERTIES = new Set(["title", "label", "desc", "text", "subtitle", "message", "placeholder"]);
const WORDS = /\p{L}{2,}/u;

/** The literal text of a string or template literal node (without placeholders); null for anything else. */
function literalText(node) {
  if (!node) return null;
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  if (node.type === "TemplateLiteral") return node.quasis.map((q) => q.value.cooked ?? "").join(" ");
  return null;
}

const rule = {
  meta: {
    type: "problem",
    docs: { description: "Words people read go through the i18n catalog (src/i18n, docs/I18N.md)." },
    messages: {
      literal: '"{{text}}" is UI text: add it to src/i18n/en.ts and use t("…") (docs/I18N.md).',
    },
    schema: [],
  },
  create(context) {
    const report = (node, text) =>
      context.report({ node, messageId: "literal", data: { text: text.trim().slice(0, 40) } });
    const check = (node, value) => {
      const text = literalText(value);
      if (text !== null && WORDS.test(text)) report(value, text);
      else if (value?.type === "ConditionalExpression") {
        check(node, value.consequent);
        check(node, value.alternate);
      } else if (value?.type === "LogicalExpression") check(node, value.right);
    };
    return {
      JSXText(node) {
        if (WORDS.test(node.value)) report(node, node.value);
      },
      JSXAttribute(node) {
        const name = node.name.type === "JSXIdentifier" ? node.name.name : null;
        if (!name || !ATTRIBUTES.has(name) || !node.value) return;
        if (node.value.type === "Literal") check(node, node.value);
        else if (node.value.type === "JSXExpressionContainer") check(node, node.value.expression);
      },
      Property(node) {
        const key =
          node.key.type === "Identifier" ? node.key.name : node.key.type === "Literal" ? node.key.value : null;
        if (typeof key === "string" && PROPERTIES.has(key)) check(node, node.value);
      },
    };
  },
};

export default { rules: { "no-literal-ui-text": rule } };
