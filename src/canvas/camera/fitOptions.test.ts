import { expect, it } from "vitest";
import { FIT, FIT_PRESENT } from "./fitOptions";
it("clears the view control without reserving the former title card", () => {
  expect(FIT).toEqual({ padding: { top: "32px", right: "40px", bottom: "72px", left: "32px" }, maxZoom: 1.25 });
  expect(FIT_PRESENT).toEqual({ padding: { top: "56px", right: "56px", bottom: "56px", left: "56px" }, maxZoom: 1.6 });
});
