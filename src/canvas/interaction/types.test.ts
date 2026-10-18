import { expectTypeOf, it } from "vitest";
import type { InteractionController } from "./controller";
import type { CanvasSurfaceKind, FocusEvent, MenuFocusKind, MenusEvent, OpenSurface } from "./types";

it("independent Live popovers only participate in focus notifications", () => {
  expectTypeOf<CanvasSurfaceKind>().toEqualTypeOf<"context" | "quickAdd" | "connected" | "dialog">();
  expectTypeOf<MenuFocusKind>().toEqualTypeOf<CanvasSurfaceKind | "live">();
  expectTypeOf<OpenSurface["kind"]>().toEqualTypeOf<CanvasSurfaceKind>();
  expectTypeOf<Extract<MenusEvent, { type: "menu.open" }>["kind"]>().toEqualTypeOf<CanvasSurfaceKind>();
  expectTypeOf<Parameters<InteractionController["openMenu"]>[0]>().toEqualTypeOf<CanvasSurfaceKind>();
  expectTypeOf<Extract<FocusEvent, { type: "menu.opened" }>["kind"]>().toEqualTypeOf<MenuFocusKind>();
  expectTypeOf<Extract<FocusEvent, { type: "menu.closed" }>["kind"]>().toEqualTypeOf<MenuFocusKind>();
});
