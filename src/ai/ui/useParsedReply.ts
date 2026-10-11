import { startTransition, useEffect, useState } from "react";
import { parseReply, type ParsedReply } from "./reply";

/** Typing renders only the textarea; parsing runs after typing pauses, outside React render. */
export function useParsedReply(reply: string) {
  const [validation, setValidation] = useState<{ text: string; parsed: ParsedReply | null }>({
    text: "",
    parsed: null,
  });
  useEffect(() => {
    const timer = setTimeout(() => {
      const parsed = reply.trim() ? parseReply(reply) : null;
      startTransition(() => setValidation({ text: reply, parsed }));
    }, 120);
    return () => clearTimeout(timer);
  }, [reply]);
  const pending = validation.text !== reply;
  return { parsed: pending ? null : validation.parsed, pending };
}
