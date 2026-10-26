import { getStencil } from "../../stencils/registry";

/** The catalog label is both a stored creation default and an alias indexed in every locale. */
export const stencilSearch = (id: string) => () => getStencil(id).label;

/** Creation stores the catalog default, independently of the translated stencil picker. */
export const createdNodeLabel = stencilSearch;
