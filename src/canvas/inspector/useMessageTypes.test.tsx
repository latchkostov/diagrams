import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { messageTypesFixture } from "../../lab/messageTypesFixture";
import * as analysis from "../../model/messageTypes";
import type { EditorApi } from "../../editor/types";
import { EdgeMessages, NodeMessages } from "./MessageFields";

it("never computes message propagation while rendering either inspector", () => {
  const compute = vi.spyOn(analysis, "cachedMessageTypesAt");
  try {
    const editor = { getDiagram: messageTypesFixture } as unknown as EditorApi;
    expect(renderToStaticMarkup(<NodeMessages nodeId="api" editor={editor} source={false} />)).toContain("Loading");
    expect(renderToStaticMarkup(<EdgeMessages edgeId="send" editor={editor} />)).toContain("Loading");
    expect(compute).not.toHaveBeenCalled();
  } finally {
    compute.mockRestore();
  }
});
