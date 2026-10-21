import { parseMermaid } from "./read";
import { validated } from "../importOutcome";
export { MermaidError } from "./read";

export function mermaidOutcome(text: string, title: string) {
  const { diagram, warnings } = parseMermaid(text, title);
  return validated("mermaid", diagram, warnings);
}
