import type { ActionContext, MenuNode } from "./actions";

// Installed with the existing cache Live surface; ordinary canvases download no cache menu code or copy.
let build: ((ctx: ActionContext) => MenuNode[]) | undefined;
export const installCacheOriginMenu = (menu: NonNullable<typeof build>) => {
  build = menu;
};
export const cacheOriginMenu = (ctx: ActionContext): MenuNode[] => build?.(ctx) ?? [];
