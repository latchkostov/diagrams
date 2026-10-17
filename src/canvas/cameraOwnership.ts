export type CameraOwner = "fit" | "manual" | "narration";

/** Shared by the canvas and Live: deferred camera work may run only while its claim is current. */
export function createCameraOwnership() {
  let current = { owner: "fit" as CameraOwner };
  return {
    get owner() {
      return current.owner;
    },
    claim(owner: CameraOwner) {
      current = { owner };
      return current;
    },
    isCurrent(claim: object) {
      return current === claim;
    },
  };
}

export type CameraOwnership = ReturnType<typeof createCameraOwnership>;
