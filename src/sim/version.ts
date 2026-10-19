// The simulation engine's version (scripts/engine-version.ts): a hash of src/sim, src/model and src/stencils, defined at build
// time. Copies with the same version run a simulation identically; shared Live won't follow across versions.
// Code loaded without the app's build (a script's own loader) reads "unversioned".

declare const __ENGINE_VERSION__: string | undefined;

export const ENGINE_VERSION: string = typeof __ENGINE_VERSION__ === "string" ? __ENGINE_VERSION__ : "unversioned";
